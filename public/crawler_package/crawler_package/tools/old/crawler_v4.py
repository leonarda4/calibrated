# The crawler ghost (v4): a low figure that drags itself across the floor on two
# overlong arms, its head bowed under a mass of tentacles. The tentacles sprout
# from the floor first, then the body rises among them.
#
# Run in Houdini's Python Shell with:
#   exec(open(hou.expandString("$HOME/Downloads/crawler_v4.py")).read())
#
# First run: builds /obj/crawler_v4, the Karma glow preview, /obj/crawler_cam
# and /mat/ghost_glow (reused if it exists), then exports.
# Later runs: keeps your nodes and sliders, regenerates the crawl rhythm from the
# sliders (stride, timing, pauses, seed) and re-exports.
# Writes to ~/Desktop/calibrated_fx/:
#   crawler_v4.glb        meshes crawler_body (body, tentacles, arms) and crawler_core
#   crawler_v4_anim.json  phases, path, sampled crawl tracks, motion and look values
# It never deletes or changes nodes outside /obj/crawler_v4 and /obj/crawler_cam.

import hou
import json
import math
import os
import random
import struct

GEO_NAME = "crawler_v4"
FILE_BASE = "crawler_v4"
CAM_NAME = "crawler_cam"
OUT_DIR = hou.expandString("$HOME/Desktop/calibrated_fx")
TRACK_RATE = 30  # samples per second in the JSON

# ---------------------------------------------------------------------------
# Shape (rest pose = crawl pose with both arms reaching forward).
# Faces +Z, floor at y = 0, metres. Point attributes:
#   part     0 body, 1 tentacle, 2 glow core, 3 arm (incl. fingers)
#   tid      tentacle number, or arm number (0 left, 1 right); -1 otherwise
#   s        position along the part: body 0 tail .. 1 head front;
#            tentacle 0 root .. 1 tip; arm 0 shoulder .. 1 fingers
#   flutter  0 anchored .. 1 moves the most
#   pull     position in the "pulled" arm pose (= P for everything else)
#   rise     position in the "sprouting from the floor" tentacle pose (= P otherwise)
# ---------------------------------------------------------------------------
SHAPE_SNIPPET = """vector spinep(float u) {
    return spline("catrom", u,
        set(0, 0.03, -1.45), set(0, 0.03, -1.45), set(0, 0.05, -1.0), set(0, 0.14, -0.6),
        set(0, 0.42, -0.28), set(0, 0.56, 0.0), set(0, 0.56, 0.16), set(0, 0.47, 0.3),
        set(0, 0.40, 0.40), set(0, 0.40, 0.40));
}
float spiner(float u) {
    return spline("catrom", u, 0.26, 0.26, 0.22, 0.17, 0.19, 0.21, 0.075, 0.13, 0.03, 0.03);
}
float spinexs(float u) {
    return spline("catrom", u, 1.6, 1.6, 1.4, 1.2, 1.25, 1.35, 1.0, 1.0, 1.0, 1.0);
}
float spineys(float u) {
    return spline("catrom", u, 0.22, 0.22, 0.45, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
}
vector bez(vector a, b, c, d; float t) {
    float m = 1 - t;
    return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
}
vector sideof(vector tn) {
    vector sd = cross(tn, {0, 1, 0});
    if (length(sd) < 0.01) sd = cross(tn, {1, 0, 0});
    return normalize(sd);
}
void addp(vector q, rs, pl; int part; float tid, s, fl) {
    int pt = addpoint(0, q);
    setpointattrib(0, "part", pt, part);
    setpointattrib(0, "tid", pt, tid);
    setpointattrib(0, "s", pt, s);
    setpointattrib(0, "flutter", pt, fl);
    setpointattrib(0, "rise", pt, rs);
    setpointattrib(0, "pull", pt, pl);
}
void quads(int b0, rows, ring) {
    for (int qa = 0; qa < rows; qa++) {
        for (int qb = 0; qb < ring; qb++) {
            int q0 = b0 + qa * ring + qb;
            int q1 = b0 + qa * ring + (qb + 1) % ring;
            addprim(0, "poly", q0, q1, q1 + ring, q0 + ring);
        }
    }
}

float stride = ch("../crawler_preview/actual_stride");
int NT = chi("tentacles");
float tlen = chf("tentacle_length");
float thick = chf("tentacle_thickness");
int SN = 100;
int SR = 32;
int TA = 40;
int TR = 8;
int AN = 40;
int AR = 10;
int FN = 12;
int FR = 6;
float u, r, a, t, rad, rr, r1, r2, r3, r4, phi, Lup, sg, psi, fl;
vector c, tn, side, nrm, p, q, d, P0, P1, P2, P3, Hc, Hf, base, rp, off;
vector Sh, Ep, Hp, Er, Hr, Pr, Pp, tr_, tp_, sr_, sp_, nr_, np_, fo;
int b0;

// ---------- body: hunched torso, bowed head, tail dragging flat on the floor ----------
b0 = npoints(0);
for (int i = 0; i < SN; i++) {
    u = i / float(SN - 1);
    c = spinep(u);
    tn = normalize(spinep(min(u + 0.01, 1.0)) - spinep(max(u - 0.01, 0.0)));
    side = sideof(tn);
    nrm = normalize(cross(side, tn));
    r = spiner(u);
    fl = pow(max(0.0, 0.45 - u) / 0.45, 1.5);
    for (int j = 0; j < SR; j++) {
        a = 2 * PI * j / SR;
        p = c + side * cos(a) * r * spinexs(u) + nrm * sin(a) * r * spineys(u);
        p.y = max(p.y, 0.005);
        addp(p, p, p, 0, -1.0, u, fl);
    }
}
quads(b0, SN - 1, SR);

// ---------- tentacles: from the head, falling forward and spreading over the floor ----------
Hc = spinep(0.88);
Hf = set(Hc.x, 0.03, Hc.z);
for (int ti = 0; ti < NT; ti++) {
    r1 = rand(ti * 1.71);
    r2 = rand(ti * 3.33);
    r3 = rand(ti * 5.17);
    r4 = rand(ti * 7.91);
    phi = radians(lerp(-110.0, 110.0, (ti + r1 * 0.8) / max(NT, 1)));
    d = set(sin(phi), 0, cos(phi));
    q = normalize(set((r2 - 0.5) * 1.6, 0.6 + r3 * 0.6, r4 - 0.7));
    P0 = Hc + q * 0.12;
    P1 = P0 + d * 0.12 + set(0, 0.06, 0);
    P2 = Hf + d * (0.35 + 0.2 * r2) * tlen;
    P3 = Hf + d * (0.75 + 0.5 * r3) * tlen + set(d.z, 0, -d.x) * (r4 - 0.5) * 0.3;
    base = Hf + d * (0.1 + 0.35 * r1);
    Lup = 0.45 + 0.4 * r4;
    rr = lerp(0.7, 1.3, r3) * thick;
    b0 = npoints(0);
    for (int ci = 0; ci <= TA; ci++) {
        t = ci / float(TA);
        p = bez(P0, P1, P2, P3, t);
        tn = normalize(bez(P0, P1, P2, P3, min(t + 0.01, 1.0)) - bez(P0, P1, P2, P3, max(t - 0.01, 0.0)));
        side = sideof(tn);
        nrm = normalize(cross(side, tn));
        rad = lerp(0.028, 0.003, pow(t, 0.7)) * rr;
        rp = base + set(0.04 * sin(t * 5 + ti), Lup * t, 0.04 * cos(t * 4 + ti));
        for (int si = 0; si < TR; si++) {
            a = 2 * PI * si / TR;
            off = side * cos(a) * rad + nrm * sin(a) * rad;
            q = p + off;
            q.y = max(q.y, 0.004);
            addp(q, rp + set(cos(a) * rad, 0, sin(a) * rad), q, 1, float(ti), t, t);
        }
    }
    quads(b0, TA, TR);
}

// ---------- arms: overlong, elbows high, hands planted on the floor ----------
for (int ai = 0; ai < 2; ai++) {
    sg = (ai == 0) ? 1.0 : -1.0;
    Sh = set(sg * 0.2, 0.52, 0.02);
    Ep = set(sg * 0.42, 0.64, 0.05);           // pulled: elbow up and out
    Hp = set(sg * 0.32, 0.03, 0.22);           // pulled: hand close to the body
    Er = set(sg * 0.38, 0.52, 0.45);           // reaching: elbow forward
    Hr = Hp + set(0, 0, stride);               // reaching: hand one stride ahead
    b0 = npoints(0);
    for (int ca = 0; ca <= AN; ca++) {
        t = ca / float(AN);
        Pr = spline("catrom", t, Sh, Sh, Er, Hr, Hr);
        Pp = spline("catrom", t, Sh, Sh, Ep, Hp, Hp);
        tr_ = normalize(spline("catrom", min(t + 0.01, 1.0), Sh, Sh, Er, Hr, Hr)
                      - spline("catrom", max(t - 0.01, 0.0), Sh, Sh, Er, Hr, Hr));
        tp_ = normalize(spline("catrom", min(t + 0.01, 1.0), Sh, Sh, Ep, Hp, Hp)
                      - spline("catrom", max(t - 0.01, 0.0), Sh, Sh, Ep, Hp, Hp));
        sr_ = sideof(tr_);
        sp_ = sideof(tp_);
        nr_ = normalize(cross(sr_, tr_));
        np_ = normalize(cross(sp_, tp_));
        rad = lerp(0.035, 0.02, t);
        for (int sa = 0; sa < AR; sa++) {
            a = 2 * PI * sa / AR;
            q = Pr + (sr_ * cos(a) + nr_ * sin(a)) * rad;
            p = Pp + (sp_ * cos(a) + np_ * sin(a)) * rad;
            q.y = max(q.y, 0.004);
            p.y = max(p.y, 0.004);
            addp(q, q, p, 3, float(ai), t, 0.05);
        }
    }
    quads(b0, AN, AR);
    // four long thin fingers splayed on the floor
    for (int fi = 0; fi < 4; fi++) {
        psi = radians(sg * lerp(-35.0, 45.0, fi / 3.0));
        d = set(sin(psi), 0, cos(psi));
        side = normalize(set(d.z, 0, -d.x));
        b0 = npoints(0);
        for (int cf = 0; cf <= FN; cf++) {
            t = cf / float(FN);
            fo = d * 0.16 * t + set(0, 0.035 * sin(PI * t), 0);
            rad = lerp(0.009, 0.003, t);
            for (int sf = 0; sf < FR; sf++) {
                a = 2 * PI * sf / FR;
                off = side * cos(a) * rad + set(0, sin(a) * rad, 0);
                q = Hr + fo + off;
                p = Hp + fo + off;
                q.y = max(q.y, 0.004);
                p.y = max(p.y, 0.004);
                addp(q, q, p, 3, float(ai), 1.0, 0.15 * t);
            }
        }
        quads(b0, FN, FR);
    }
}

// ---------- glow core: inside the chest ----------
c = spinep(0.66);
b0 = npoints(0);
for (int ui = 0; ui <= 16; ui++) {
    float ph = PI * ui / 16.0;
    for (int uj = 0; uj < 24; uj++) {
        a = 2 * PI * uj / 24;
        p = c + set(sin(ph) * cos(a) * 0.13, -cos(ph) * 0.11, sin(ph) * sin(a) * 0.15);
        addp(p, p, p, 2, -1.0, 0.66, 0.0);
    }
}
quads(b0, 16, 24);
"""

# ---------------------------------------------------------------------------
# Preview animation. The crawl rhythm (progress, arms, lifts, twitch) comes from
# keyframed channels on this node, generated by this script from the sliders.
# ---------------------------------------------------------------------------
ANIM_SNIPPET = """float T = @Time;
float ts0 = chf("tentacle_emerge");
float bs = chf("body_start");
float be = chf("body_emerge");
float dr = chf("drape_time");
float ce = chf("crawl_end");
float hold = chf("hold_time");
float sk = chf("sink_time");
float endT = ce + hold + sk + 0.6;
vector A = chv("start_pos");
vector B = chv("end_pos");
vector dir = normalize(B - A);
float D = length(B - A);
float prog = chf("progress");
float speed = (chf("progress", T + 0.03) - chf("progress", T - 0.03)) / 0.06 * D;
float armL = chf("arm_l");
float armR = chf("arm_r");
float liftL = chf("lift_l");
float liftR = chf("lift_r");
float tw = chf("twitch");
int part = i@part;
float fl = f@flutter;
float s = f@s;
float id = f@tid;
vector rest = @P;
vector p = rest;
// rising and sinking
float yrise = -1.0 * pow(1 - smooth(bs, bs + be, T), 3);
float kb = clamp((T - ce - hold) / sk, 0, 1);
float kt = clamp((T - ce - hold - 0.6) / sk, 0, 1);
float y = yrise - 1.3 * kb * kb;
if (part == 1) {
    // tentacles sprout from the floor first, writhing, then fall over the head
    float yt = -1.0 * pow(1 - smooth(0, ts0, T), 2);
    float drape = smooth(bs + 0.8, bs + 0.8 + dr, T);
    vector rp = v@rise + set(sin(T * 3.1 + id * 1.3 + s * 6), 0,
                             cos(T * 2.7 + id * 2.1 + s * 5)) * 0.07 * s;
    p = lerp(rp, rest, drape);
    y = lerp(yt, yrise, drape) - 1.3 * kt * kt;          // and sink last
    vector sw = curlnoise(rest * 2.0 + set(id, T * 0.7, 0)) * chf("tentacle_sway") * fl;
    sw.y *= 0.3;
    p += sw * drape;
    p += curlnoise(rest * 4 + set(0, T * 8, 0)) * 0.03 * tw * fl;   // shiver on twitch
}
if (part == 3) {
    // arms: blend between reaching (rest) and pulled pose; hands lift while reaching
    float bl = (id < 0.5) ? armL : armR;
    float lf = (id < 0.5) ? liftL : liftR;
    p = lerp(rest, v@pull, bl);
    p.y += lf * 0.12 * smooth(0.45, 1.0, s);
}
if (part == 0 || part == 2) {
    p.x += tw * 0.05 * sin(T * 45) * smooth(0.75, 0.9, s);  // head jerks on twitch
    vector sw2 = curlnoise(rest * 1.5 + set(0, T * 0.4, 0)) * chf("body_sway") * fl;
    sw2.y *= 0.3;
    p += sw2;                                               // tail drifts
}
vector trail = -dir * chf("trail") * speed * pow(fl, 1.5);
float ang = atan2(dir.x, dir.z);
vector rq = set(p.x * cos(ang) + p.z * sin(ang), p.y, -p.x * sin(ang) + p.z * cos(ang));
@P = rq + lerp(A, B, prog) + set(0, y, 0) + trail;
// transparency
float alpha = chf("opacity");
if (part == 0) alpha *= smooth(0.0, 0.08, s + (noise(rest * 8) - 0.5) * 0.08);  // ragged tail
else if (part == 1) alpha *= 1 - smooth(0.85, 1.0, s);                         // tips fade
else if (part == 2) alpha = chf("core_glow") * (0.8 + 0.2 * sin(T * 2 * PI * 0.35));
if (@P.y < 0) alpha = 0;
if (T > endT) alpha = 0;
f@Alpha = alpha;
if (part == 2) @Cd = {0.8, 0.9, 1.0};
else @Cd = {1, 1, 1};
"""

# ---------------------------------------------------------------------------
# Karma glow preview (same idea as ghost_v3_karma.py). CAMPATH is replaced.
# ---------------------------------------------------------------------------
GLOW_SNIPPET = """vector cam = set(ch("CAMPATH/tx"), ch("CAMPATH/ty"), ch("CAMPATH/tz"));
int prs[] = pointprims(0, @ptnum);
vector n = {0, 1, 0};
if (len(prs) > 0) {
    n = 0;
    foreach (int pr; prs) n += prim_normal(0, pr, 0.5, 0.5);
    n = normalize(n);
}
vector V = normalize(cam - @P);
float facing = abs(dot(n, V));
float gi = chf("glow_intensity");
if (i@part == 2) {
    float inner = pow(facing, 1.5);
    v@glowcol = {0.8, 0.9, 1.0} * gi * chf("core_boost") * inner;
    f@Alpha *= inner;
} else {
    float fr = pow(1 - facing, 2.5);
    v@glowcol = lerp({0.85, 0.9, 1.0}, {1.0, 1.0, 1.0}, fr) * gi * (1 + chf("rim_glow") * fr);
    f@Alpha *= lerp(0.2, 1.0, fr);
}
v@glowop = set(f@Alpha, f@Alpha, f@Alpha);
@Cd = v@glowcol;
"""

HALO_SNIPPET = """vector cam = set(ch("CAMPATH/tx"), ch("CAMPATH/ty"), ch("CAMPATH/tz"));
vector c = 0;
float vis = 0;
int nc = 0;
for (int i = 0; i < npoints(1); i++) {
    int pa = point(1, "part", i);
    if (pa == 2) {
        vector cp = point(1, "P", i);
        float ca = point(1, "Alpha", i);
        c += cp;
        vis += ca;
        nc++;
    }
}
if (nc == 0) return;
c /= nc;
vis = clamp(vis / nc * 4, 0, 1);
vector fwd = normalize(cam - c);
vector right = normalize(cross({0, 1, 0}, fwd));
vector up = cross(fwd, right);
float S = chf("halo_size");
int G = 24;
for (int ai = 0; ai <= G; ai++) {
    for (int bi = 0; bi <= G; bi++) {
        float u = ai / float(G) - 0.5;
        float w = bi / float(G) - 0.5;
        vector p = c + right * u * S + up * w * S * 0.8 - fwd * 0.3;
        int pt = addpoint(0, p);
        float d = sqrt(u * u + w * w) * 2;
        float f = pow(clamp(1 - d, 0, 1), 2.2) * vis;
        setpointattrib(0, "glowcol", pt, {0.75, 0.88, 1.0} * chf("halo_strength"));
        setpointattrib(0, "glowop", pt, set(f, f, f));
        setpointattrib(0, "Cd", pt, {0.75, 0.88, 1.0} * f);
        setpointattrib(0, "Alpha", pt, f);
        setpointattrib(0, "part", pt, 4);
    }
}
for (int ai2 = 0; ai2 < G; ai2++) {
    for (int bi2 = 0; bi2 < G; bi2++) {
        int q0 = ai2 * (G + 1) + bi2;
        addprim(0, "poly", q0, q0 + 1, q0 + G + 2, q0 + G + 1);
    }
}
"""

WISPS_SNIPPET = """float T = @Time;
vector A = chv("../crawler_preview/start_pos");
vector B = chv("../crawler_preview/end_pos");
int N = chi("wisp_count");
float life = chf("wisp_life");
int cand[];
for (int i = 0; i < npoints(1); i++) {
    int pa = point(1, "part", i);
    float s = point(1, "s", i);
    if ((pa == 1 && s > 0.85) || (pa == 0 && s < 0.05)) append(cand, i);
}
if (len(cand) == 0) return;
vector now = lerp(A, B, chf("../crawler_preview/progress", T));
for (int k = 0; k < N; k++) {
    float ph = rand(k * 1.37) * life;
    float cyc = floor((T + ph) / life);
    float age = T + ph - cyc * life;
    int src = cand[int(rand(k * 4.1 + cyc * 7.3) * len(cand)) % len(cand)];
    vector sp = point(1, "P", src);
    float sa = point(1, "Alpha", src);
    vector back = lerp(A, B, chf("../crawler_preview/progress", T - age)) - now;
    vector drift = set((rand(k * 2.3) - 0.5) * 0.2, 0.3, (rand(k * 5.9) - 0.5) * 0.2) * age;
    vector p = sp + back + drift;
    float fade = pow(1 - age / life, 2) * smooth(0, 0.2, age) * smooth(0, 0.03, sa);
    int pt = addpoint(0, p);
    setpointattrib(0, "pscale", pt, chf("wisp_size") * (0.6 + 0.8 * rand(k * 3.3)));
    setpointattrib(0, "glowcol", pt, {0.85, 0.92, 1.0} * chf("wisp_glow"));
    setpointattrib(0, "glowop", pt, set(fade, fade, fade));
    setpointattrib(0, "Cd", pt, {0.85, 0.92, 1.0} * fade);
    setpointattrib(0, "Alpha", pt, fade);
    setpointattrib(0, "part", pt, 5);
}
"""

SHAPE_SLIDERS = [  # name, label, default, min, max
    ("tentacle_length", "Tentacle Reach (x)", 1.0, 0.4, 2.0),
    ("tentacle_thickness", "Tentacle Thickness (x)", 1.0, 0.3, 2.5),
]
ANIM_SLIDERS = [
    ("tentacle_emerge", "Tentacles Emerge (s)", 2.5, 0.5, 6.0),
    ("body_start", "Body Starts Rising (s)", 2.0, 0.0, 6.0),
    ("body_emerge", "Body Rise Time (s)", 2.5, 0.5, 6.0),
    ("drape_time", "Tentacles Fall Over (s)", 1.5, 0.2, 4.0),
    ("stride", "Stride (m)", 0.35, 0.15, 0.7),
    ("reach_time", "Reach Time (s)", 0.35, 0.1, 1.5),
    ("pull_time", "Pull Time (s)", 0.45, 0.1, 1.5),
    ("pause_min", "Pause Min (s)", 0.5, 0.0, 3.0),
    ("pause_max", "Pause Max (s)", 1.3, 0.0, 4.0),
    ("seed", "Rhythm Seed", 7.0, 0.0, 100.0),
    ("hold_time", "Hold Before Sinking (s)", 1.0, 0.0, 5.0),
    ("sink_time", "Sink Time (s)", 2.0, 0.5, 6.0),
    ("tentacle_sway", "Tentacle Sway", 0.06, 0.0, 0.3),
    ("body_sway", "Tail Sway", 0.03, 0.0, 0.2),
    ("trail", "Drag Trail", 0.15, 0.0, 0.6),
    ("opacity", "Body Opacity", 0.22, 0.0, 1.0),
    ("core_glow", "Core Glow", 0.35, 0.0, 1.0),
]
TRACKS = ["progress", "arm_l", "arm_r", "lift_l", "lift_r", "twitch"]
START_POS = (0.0, 0.0, -2.5)   # hallway frame: X across, Z along, metres
END_POS = (0.0, 0.0, -0.2)     # stops here; tentacle tips then end ~1.5 m from a visitor at z = 2.8
GLOW_SLIDERS = [
    ("glow_intensity", "Glow Intensity", 1.5, 0.0, 5.0),
    ("rim_glow", "Rim Glow", 1.0, 0.0, 4.0),
    ("core_boost", "Core Boost", 2.0, 0.0, 6.0),
]
HALO_SLIDERS = [
    ("halo_size", "Halo Size (m)", 1.6, 0.5, 4.0),
    ("halo_strength", "Halo Strength", 0.6, 0.0, 3.0),
]
WISP_SLIDERS = [
    ("wisp_life", "Wisp Life (s)", 2.0, 0.3, 5.0),
    ("wisp_size", "Wisp Size (m)", 0.01, 0.002, 0.05),
    ("wisp_glow", "Wisp Glow", 2.0, 0.0, 6.0),
]


def add_sliders(node, folder_name, label, sliders, extra=()):
    ptg = node.parmTemplateGroup()
    folder = hou.FolderParmTemplate(folder_name, label)
    for name, lab, default, lo, hi in sliders:
        folder.addParmTemplate(hou.FloatParmTemplate(
            name, lab, 1, default_value=(default,), min=lo, max=hi))
    for tmpl in extra:
        folder.addParmTemplate(tmpl)
    ptg.append(folder)
    node.setParmTemplateGroup(ptg)


def try_set(node, name, value):
    p = node.parm(name)
    if p is None:
        print("  missing parameter %s on %s" % (name, node.path()))
        return False
    try:
        p.set(value)
        return True
    except Exception as err:
        print("  could not set %s on %s: %s" % (name, node.path(), err))
        return False


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
def build(obj):
    geo = obj.createNode("geo", GEO_NAME)
    shape = geo.createNode("attribwrangle", "crawler_shape")
    shape.parm("class").set(0)  # Run Over: Detail (only once)
    add_sliders(shape, "shape_controls", "Crawler Shape", SHAPE_SLIDERS, extra=[
        hou.IntParmTemplate("tentacles", "Tentacles", 1, default_value=(30,), min=0, max=80)])

    rest = geo.createNode("null", "OUT_crawler_rest")
    rest.setInput(0, shape)

    anim = geo.createNode("attribwrangle", "crawler_preview")
    anim.setInput(0, rest)
    track_folder = hou.FolderParmTemplate("crawl_tracks", "Crawl Tracks (keyed by the script)")
    for name in TRACKS + ["crawl_end", "actual_stride"]:
        track_folder.addParmTemplate(hou.FloatParmTemplate(name, name, 1, default_value=(0.0,)))
    add_sliders(anim, "motion_controls", "Crawler Motion", ANIM_SLIDERS, extra=[
        hou.FloatParmTemplate("start_pos", "Start (m)", 3, default_value=START_POS),
        hou.FloatParmTemplate("end_pos", "End (m)", 3, default_value=END_POS)])
    ptg = anim.parmTemplateGroup()
    ptg.append(track_folder)
    anim.setParmTemplateGroup(ptg)

    # set the snippets after all parameters exist
    shape.parm("snippet").set(SHAPE_SNIPPET)
    anim.parm("snippet").set(ANIM_SNIPPET)

    # Karma glow preview branch
    campath = "/obj/" + CAM_NAME
    glow = geo.createNode("attribwrangle", "glow_bake")
    glow.setInput(0, anim)
    add_sliders(glow, "glow_controls", "Glow", GLOW_SLIDERS)
    glow.parm("snippet").set(GLOW_SNIPPET.replace("CAMPATH", campath))

    halo = geo.createNode("attribwrangle", "halo")
    halo.parm("class").set(0)
    halo.setInput(1, glow)
    add_sliders(halo, "halo_controls", "Halo", HALO_SLIDERS)
    halo.parm("snippet").set(HALO_SNIPPET.replace("CAMPATH", campath))

    wisps = geo.createNode("attribwrangle", "wisps")
    wisps.parm("class").set(0)
    wisps.setInput(1, glow)
    add_sliders(wisps, "wisp_controls", "Wisps", WISP_SLIDERS, extra=[
        hou.IntParmTemplate("wisp_count", "Wisp Count", 1, default_value=(150,), min=0, max=1000)])
    wisps.parm("snippet").set(WISPS_SNIPPET)

    merge = geo.createNode("merge", "merge_karma")
    merge.setInput(0, glow)
    merge.setInput(1, halo)
    merge.setInput(2, wisps)
    out = geo.createNode("null", "OUT_karma")
    out.setInput(0, merge)
    out.setDisplayFlag(True)
    out.setRenderFlag(True)
    geo.layoutChildren()
    print("Built %s." % geo.path())
    return geo


def make_camera(obj):
    cam = obj.node(CAM_NAME)
    if cam is not None:
        return cam
    cam = obj.createNode("cam", CAM_NAME)
    # Visitor's eye height, looking down the hallway at the crawler.
    try_set(cam, "tx", 0.0)
    try_set(cam, "ty", 1.6)
    try_set(cam, "tz", 2.8)
    try_set(cam, "rx", -math.degrees(math.atan2(1.6 - 0.3, 3.8)))
    try_set(cam, "resx", 1280)
    try_set(cam, "resy", 720)
    print("Added %s." % cam.path())
    return cam


def make_material():
    mat = hou.node("/mat")
    surf = mat.node("ghost_glow")
    if surf is not None:
        return surf
    try:
        surf = mat.createNode("mtlxstandard_surface", "ghost_glow")
        for name, value in (("base", 0.0), ("specular", 0.0), ("emission", 1.0)):
            try_set(surf, name, value)
        if surf.parm("thin_walled") is not None:
            try_set(surf, "thin_walled", 1)
        col = mat.createNode("mtlxgeompropvalue", "ghost_glow_col")
        try_set(col, "geomprop", "glowcol")
        try_set(col, "signature", "color3")
        op = mat.createNode("mtlxgeompropvalue", "ghost_glow_op")
        try_set(op, "geomprop", "glowop")
        try_set(op, "signature", "color3")
        surf.setNamedInput("emission_color", col, "out")
        surf.setNamedInput("opacity", op, "out")
        mat.layoutChildren()
        print("Added /mat/ghost_glow.")
    except Exception as err:
        print("Could not build the MaterialX material: %s" % err)
    return surf


# ---------------------------------------------------------------------------
# Crawl rhythm: stop-start lunges, written as keyframes on crawler_preview
# ---------------------------------------------------------------------------
def build_schedule(anim):
    ev = lambda n: anim.parm(n).eval()
    A = anim.parmTuple("start_pos").eval()
    B = anim.parmTuple("end_pos").eval()
    D = math.sqrt(sum((B[i] - A[i]) ** 2 for i in range(3)))
    n = max(1, int(math.ceil(D / max(ev("stride"), 0.05))))
    rnd = random.Random(int(ev("seed")))
    keys = {"progress": [(0.0, 0.0)], "arm_l": [(0.0, 1.0)], "arm_r": [(0.0, 1.0)],
            "lift_l": [(0.0, 0.0)], "lift_r": [(0.0, 0.0)], "twitch": [(0.0, 0.0)]}
    t = ev("body_start") + ev("body_emerge") + 0.3
    p = 0.0
    for i in range(n):
        side = "l" if i % 2 == 0 else "r"
        jr = ev("reach_time") * rnd.uniform(0.8, 1.2)
        jp = ev("pull_time") * rnd.uniform(0.85, 1.15)
        keys["arm_" + side] += [(t, 1.0), (t + jr, 0.0), (t + jr + jp, 1.0)]
        keys["lift_" + side] += [(t, 0.0), (t + jr * 0.5, 1.0), (t + jr, 0.0)]
        keys["progress"] += [(t + jr, p), (t + jr + jp, p + 1.0 / n)]
        p += 1.0 / n
        t += jr + jp
        pause = rnd.uniform(ev("pause_min"), max(ev("pause_min"), ev("pause_max")))
        if pause > 0.35 and rnd.random() < 0.6:
            tp = t + pause * rnd.uniform(0.3, 0.6)
            keys["twitch"] += [(tp, 0.0), (tp + 0.06, 1.0), (tp + 0.25, 0.0)]
        t += pause
    return keys, t, D / n


def apply_schedule(anim):
    keys, crawl_end, actual_stride = build_schedule(anim)
    for name, pairs in keys.items():
        parm = anim.parm(name)
        parm.deleteAllKeyframes()
        for t, v in pairs:
            k = hou.Keyframe()
            k.setTime(t)
            k.setValue(v)
            k.setExpression("ease()")
            parm.setKeyframe(k)
    anim.parm("crawl_end").set(crawl_end)
    anim.parm("actual_stride").set(actual_stride)
    end_time = crawl_end + anim.parm("hold_time").eval() + anim.parm("sink_time").eval() + 1.0
    end_frame = int(math.ceil(end_time * hou.fps())) + 1
    hou.playbar.setFrameRange(1, end_frame)
    hou.playbar.setPlaybackRange(1, end_frame)
    return crawl_end, actual_stride, end_time


# ---------------------------------------------------------------------------
# GLB writer (plain Python). attrs: name -> (components, flat list)
# ---------------------------------------------------------------------------
def write_glb(path, meshes):
    chunks, views, accessors = [], [], []

    def add_view(blob, target):
        offset = sum(len(c) for c in chunks)
        chunks.append(blob + b"\x00" * ((4 - len(blob) % 4) % 4))
        views.append({"buffer": 0, "byteOffset": offset,
                      "byteLength": len(blob), "target": target})
        return len(views) - 1

    def add_float_accessor(values, comps, count, with_bounds=False):
        blob = struct.pack("<%df" % len(values), *values)
        values = struct.unpack("<%df" % len(values), blob)
        acc = {"bufferView": add_view(blob, 34962), "componentType": 5126,
               "count": count, "type": {1: "SCALAR", 3: "VEC3"}[comps]}
        if with_bounds:
            acc["min"] = [min(values[a::comps]) for a in range(comps)]
            acc["max"] = [max(values[a::comps]) for a in range(comps)]
        accessors.append(acc)
        return len(accessors) - 1

    gl_meshes, nodes, materials = [], [], []
    for m in meshes:
        n = len(m["positions"]) // 3
        attributes = {
            "POSITION": add_float_accessor(m["positions"], 3, n, with_bounds=True),
            "NORMAL": add_float_accessor(m["normals"], 3, n),
        }
        for name, (comps, values) in m["attrs"].items():
            attributes[name] = add_float_accessor(values, comps, n)
        idx_blob = struct.pack("<%dI" % len(m["indices"]), *m["indices"])
        accessors.append({"bufferView": add_view(idx_blob, 34963), "componentType": 5125,
                          "count": len(m["indices"]), "type": "SCALAR"})
        materials.append({"name": m["name"] + "_placeholder", "doubleSided": True,
                          "alphaMode": "BLEND",
                          "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 0.25],
                                                   "metallicFactor": 0, "roughnessFactor": 1}})
        gl_meshes.append({"name": m["name"], "primitives": [{
            "attributes": attributes, "indices": len(accessors) - 1,
            "material": len(materials) - 1, "mode": 4}]})
        nodes.append({"mesh": len(gl_meshes) - 1, "name": m["name"]})

    bin_data = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "Calibrated crawler_v4.py (Houdini)"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": gl_meshes, "materials": materials,
        "buffers": [{"byteLength": len(bin_data)}],
        "bufferViews": views, "accessors": accessors,
    }
    json_data = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_data += b" " * ((4 - len(json_data) % 4) % 4)
    total = 12 + 8 + len(json_data) + 8 + len(bin_data)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_data), 0x4E4F534A))
        fh.write(json_data)
        fh.write(struct.pack("<II", len(bin_data), 0x004E4942))
        fh.write(bin_data)


def split_meshes(positions, prims, attrs, part, groups):
    """attrs: name -> (components, flat list over all points). part: per-point list."""
    out = []
    for name, parts in groups:
        used = {}
        indices = []
        for vs in prims:
            if part[vs[0]] not in parts:
                continue
            local = []
            for p in vs:
                if p not in used:
                    used[p] = len(used)
                local.append(used[p])
            for i in range(1, len(local) - 1):
                indices += [local[0], local[i], local[i + 1]]
        order = sorted(used, key=used.get)
        pos = []
        for p in order:
            pos += positions[3 * p:3 * p + 3]
        acc = [0.0] * len(pos)
        for i in range(0, len(indices), 3):
            a, b, c = indices[i], indices[i + 1], indices[i + 2]
            ax, ay, az = pos[3 * a:3 * a + 3]
            bx, by, bz = pos[3 * b:3 * b + 3]
            cx, cy, cz = pos[3 * c:3 * c + 3]
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            for q in (a, b, c):
                acc[3 * q] += nx
                acc[3 * q + 1] += ny
                acc[3 * q + 2] += nz
        normals = []
        for q in range(len(order)):
            x, y, z = acc[3 * q:3 * q + 3]
            length = math.sqrt(x * x + y * y + z * z) or 1.0
            normals += [x / length, y / length, z / length]
        sub = {}
        for key, (comps, vals) in attrs.items():
            flat = []
            for p in order:
                flat += vals[comps * p:comps * p + comps]
            sub[key] = (comps, flat)
        out.append({"name": name, "positions": pos, "normals": normals,
                    "attrs": sub, "indices": indices})
    return out


GROUPS = [("crawler_body", {0, 1, 3}), ("crawler_core", {2})]


def export(geo, crawl_end, actual_stride, end_time):
    rest = geo.node("OUT_crawler_rest")
    shape = geo.node("crawler_shape")
    anim = geo.node("crawler_preview")
    g = rest.geometry()
    if g is None or len(g.points()) == 0:
        print("OUT_crawler_rest is empty. Check crawler_shape for a red error badge.")
        return
    positions = list(g.pointFloatAttribValues("P"))
    prims = [[v.point().number() for v in prim.vertices()] for prim in g.prims()]
    part = list(g.pointIntAttribValues("part"))
    attrs = {
        "_FLUTTER": (1, list(g.pointFloatAttribValues("flutter"))),
        "_S": (1, list(g.pointFloatAttribValues("s"))),
        "_PART": (1, [float(v) for v in part]),
        "_TID": (1, list(g.pointFloatAttribValues("tid"))),
        "_PULL": (3, list(g.pointFloatAttribValues("pull"))),
        "_RISE": (3, list(g.pointFloatAttribValues("rise"))),
    }
    meshes = split_meshes(positions, prims, attrs, part, GROUPS)
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    glb_path = os.path.join(OUT_DIR, FILE_BASE + ".glb")
    write_glb(glb_path, meshes)

    def ev(node, name):
        return node.parm(name).eval()

    zs = positions[2::3]
    tracks = {"rate": TRACK_RATE}
    n_samples = int(math.ceil(end_time * TRACK_RATE)) + 1
    for name in TRACKS:
        parm = anim.parm(name)
        tracks[name] = [round(parm.evalAtTime(i / float(TRACK_RATE)), 5) for i in range(n_samples)]

    meta = {
        "mesh": FILE_BASE + ".glb",
        "meshes": {"crawler_body": "body (part 0), tentacles (part 1), arms and fingers (part 3)",
                   "crawler_core": "inner glow core (part 2), draw additive"},
        "restPose": "crawl pose with both arms reaching; faces +Z; floor y = 0; metres",
        "attributes": {
            "_PART": "0 body, 1 tentacle, 2 core, 3 arm (three.js: '_part')",
            "_TID": "tentacle number, or arm 0 left / 1 right, -1 otherwise ('_tid')",
            "_S": "0..1 along the part: body tail->head, tentacle root->tip, arm shoulder->fingers ('_s')",
            "_FLUTTER": "0 anchored .. 1 moves most ('_flutter')",
            "_PULL": "vec3 position in the pulled arm pose; equals position for non-arms ('_pull')",
            "_RISE": "vec3 position in the sprouting tentacle pose; equals position for non-tentacles ('_rise')",
        },
        "extentZ": {"frontReach": max(zs), "rearReach": min(zs),
                    "note": "measure the stop distance to the visitor from frontReach"},
        "phases": {"tentacleEmerge": ev(anim, "tentacle_emerge"),
                   "bodyStart": ev(anim, "body_start"), "bodyEmerge": ev(anim, "body_emerge"),
                   "drapeTime": ev(anim, "drape_time"), "drapeStartsAfterBodyStart": 0.8,
                   "crawlEnd": crawl_end, "hold": ev(anim, "hold_time"),
                   "sink": ev(anim, "sink_time"), "tentacleSinkDelay": 0.6,
                   "endTime": end_time},
        "path": {"frame": "hallway frame: X across, Z along, Y up, metres",
                 "start": list(anim.parmTuple("start_pos").eval()),
                 "end": list(anim.parmTuple("end_pos").eval()),
                 "actualStride": actual_stride},
        "tracks": tracks,
        "trackNotes": "progress 0..1 along start->end; arm_l/arm_r 0 reach .. 1 pulled; "
                      "lift_l/lift_r 0..1 hand lift while reaching (x 0.12 m); twitch 0..1",
        "motion": {"tentacleSway": ev(anim, "tentacle_sway"), "tailSway": ev(anim, "body_sway"),
                   "dragTrail": ev(anim, "trail")},
        "look": {"bodyOpacity": ev(anim, "opacity"), "coreGlow": ev(anim, "core_glow"),
                 "coreColour": [0.8, 0.9, 1.0]},
        "shape": {"tentacles": ev(shape, "tentacles"),
                  "tentacleReach": ev(shape, "tentacle_length"),
                  "tentacleThickness": ev(shape, "tentacle_thickness")},
        "counts": {m["name"]: {"points": len(m["positions"]) // 3,
                               "triangles": len(m["indices"]) // 3} for m in meshes},
        "source": "%s, Houdini %s" % (geo.path(), hou.applicationVersionString()),
    }
    json_path = os.path.join(OUT_DIR, FILE_BASE + "_anim.json")
    with open(json_path, "w") as fh:
        json.dump(meta, fh, indent=1)
    print("Wrote %s" % glb_path)
    print("Wrote %s" % json_path)
    for m in meshes:
        print("  %s: %d points, %d triangles" % (
            m["name"], len(m["positions"]) // 3, len(m["indices"]) // 3))


def main():
    obj = hou.node("/obj")
    cam = make_camera(obj)
    surf = make_material()
    geo = obj.node(GEO_NAME)
    if geo is None:
        geo = build(obj)
        for other in ("ghost", "ghost_v2", "ghost_v3", "floor_fog", "floor_fog_v2", "fog_preview"):
            node = obj.node(other)
            if node is not None:
                node.setDisplayFlag(False)
    else:
        print("Found %s, keeping your changes." % geo.path())
    if surf is not None and geo.parm("shop_materialpath") is not None:
        geo.parm("shop_materialpath").set(surf.path())

    anim = geo.node("crawler_preview")
    crawl_end, actual_stride, end_time = apply_schedule(anim)
    print("Crawl: %.2f m strides, crawl ends at %.1f s, everything gone at %.1f s."
          % (actual_stride, crawl_end, end_time))
    hou.setFrame(1)
    export(geo, crawl_end, actual_stride, end_time)

    try:
        viewer = hou.ui.paneTabOfType(hou.paneTabType.SceneViewer)
        viewer.curViewport().setCamera(cam)
    except Exception:
        pass
    print("Press play. For the glow, switch the viewport renderer to Karma.")


main()
