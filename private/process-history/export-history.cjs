// Local, read-only source extraction. Run from the calibrated repository root.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = process.cwd();
const out = path.join(root, 'private/process-history');
const norm = p => p.replace(/^\\\\\?\\/, '').replaceAll('\\', '/').toLowerCase().replace(/\/$/, '');
const project = norm(root);
const projectParent = norm(path.resolve(root, '../..'));
const generatedAt = new Date().toISOString();
for (const p of ['conversations', 'images', 'sources']) fs.mkdirSync(path.join(out, p), { recursive: true });
const redact = s => String(s ?? '')
  .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED API KEY]')
  .replace(/(\b(?:api[_ -]?key|access_token|refresh_token|authorization)\b\s*[:=]\s*["']?)(?:Bearer\s+)?[A-Za-z0-9_./+=-]{20,}/gi, '$1[REDACTED CREDENTIAL]');
const write = (p, text) => fs.writeFileSync(path.join(out, p), text);
const json = (p, value) => write(p, JSON.stringify(value, null, 2) + '\n');
const iso = n => n ? new Date(n < 1e12 ? n * 1000 : n).toISOString() : null;
const title = s => redact(s).replace(/^# Context from my IDE setup:[\s\S]*?## My request:\s*/i, '').replace(/\s+/g, ' ').slice(0, 130);
const linkText = s => s.replaceAll('[', '(').replaceAll(']', ')').replaceAll('|', '/');
const images = new Map(), sessions = [], requests = [], missing = [], failures = [];
function picture(value, context) {
  let bytes, mime, source;
  if (typeof value === 'object') value = value.image_url?.url ?? value.image_url ?? value.url ?? value.path;
  if (typeof value !== 'string') { missing.push({ ...context, reason: 'Unsupported image reference' }); return null; }
  if (value.startsWith('data:image/')) {
    const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(value);
    if (!match) { missing.push({ ...context, reason: 'Unsupported data URI' }); return null; }
    mime = match[1]; bytes = Buffer.from(match[2], 'base64'); source = 'embedded image in local conversation';
  } else {
    let p = value.replace(/^file:\/\//, '');
    try { p = decodeURIComponent(p); } catch {}
    if (!path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      missing.push({ ...context, reference: value.slice(0, 500), reason: 'Image reference is not a readable local file' }); return null;
    }
    bytes = fs.readFileSync(p); mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(p).toLowerCase()] ?? 'image/unknown'; source = p;
  }
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  let image = images.get(hash);
  if (!image) {
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[mime] ?? 'bin';
    const file = `images/${hash}.${extension}`;
    write(file, bytes);
    image = { id: hash, file, mime, bytes: bytes.length, source, occurrences: [] };
    if (mime === 'image/png' && bytes.length >= 24 && bytes.subarray(1,4).toString() === 'PNG') {
      image.width = bytes.readUInt32BE(16); image.height = bytes.readUInt32BE(20);
    }
    images.set(hash, image);
  }
  if (!image.occurrences.some(x => x.sessionId === context.sessionId && x.message === context.message)) image.occurrences.push(context);
  return image.file;
}
function exportSession(s, messages) {
  s.file = `conversations/${s.provider}-${s.id}.md`;
  s.messages = messages.length;
  s.userMessages = messages.filter(m => m.role === 'user').length;
  s.assistantMessages = messages.filter(m => m.role === 'assistant').length;
  let md = `# ${s.title}\n\nProvider: ${s.provider}; source: ${s.source}; session: ${s.id}.\n\nOriginal local record: ${s.originalPath}.\n\nCreated: ${s.createdAt ?? 'unknown'}. Export snapshot: ${generatedAt}.\n\nThis transcript contains stored user-facing user/assistant messages, with image links. System/developer prompts, tool payloads and internal reasoning are omitted. Credential-shaped strings are redacted. A delegated thread's user-role messages may be inherited context or instructions from another agent.\n`;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i], number = i + 1;
    md += `\n<a id="message-${number}"></a>\n\n## ${number}. ${m.role} · ${m.timestamp ?? 'time not stored'}\n\n${m.text || '(Image attachment without text.)'}\n`;
    for (const image of m.images ?? []) md += `\n![Supplied image](../${image})\n`;
    if (m.role === 'user' && s.source === 'user' && !/^# AGENTS\.md instructions|^<environment_context>|^<external_codex_apps_open_page>/.test(m.text.trim())) {
      const request = m.text.replace(/^# Context from my IDE setup:[\s\S]*?## My request:\s*/i, '');
      requests.push({ provider: s.provider, sessionId: s.id, timestamp: m.timestamp, message: number, text: request, images: m.images, conversation: `${s.file}#message-${number}` });
    }
  }
  write(s.file, md);
  sessions.push(s);
}
async function main() {
  const statePath = 'C:/Users/user/.codex/state_5.sqlite';
  const state = new DatabaseSync(statePath, { readOnly: true });
  const index = new Map();
  for (const l of fs.readFileSync('C:/Users/user/.codex/session_index.jsonl', 'utf8').split('\n').filter(Boolean)) {
    try { const o = JSON.parse(l); index.set(o.id, o.thread_name); } catch {}
  }
  const threads = state.prepare('SELECT id,title,cwd,rollout_path,thread_source,created_at_ms,created_at FROM threads').all().filter(t => norm(t.cwd) === project);
  const excluded = threads.filter(t => t.thread_source === 'guardian_review').map(t => ({ id: t.id, reason: 'Automatic permission review, not a project conversation', originalPath: t.rollout_path }));
  for (const t of threads.filter(t => t.thread_source !== 'guardian_review')) {
    const s = { provider: 'codex', id: t.id, title: title(index.get(t.id) ?? t.title), source: t.thread_source, originalPath: t.rollout_path, createdAt: iso(t.created_at_ms ?? t.created_at) };
    if (!fs.existsSync(t.rollout_path)) { failures.push({ sessionId: t.id, reason: 'Rollout missing' }); continue; }
    const stat = fs.statSync(t.rollout_path); s.sourceBytes = stat.size; s.sourceModifiedAt = stat.mtime.toISOString();
    const messages = [];
    const lines = readline.createInterface({ input: fs.createReadStream(t.rollout_path, { end: stat.size - 1 }), crlfDelay: Infinity });
    let line = 0;
    for await (const l of lines) {
      line++;
      let o; try { o = JSON.parse(l); } catch { failures.push({ sessionId: t.id, line, reason: 'Incomplete or malformed JSONL record' }); continue; }
      const p = o.payload;
      if (o.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
      const text = redact((p.content ?? []).filter(c => ['input_text', 'output_text', 'text'].includes(c.type)).map(c => c.text).join('\n'));
      // Snapshot the ongoing conversation before this export task's own messages.
      if (p.role === 'user' && /can you acces the memories and full conversations with the agents from this vs code/i.test(text)) break;
      const message = { role: p.role, timestamp: o.timestamp, text, images: [] };
      const context = { provider: 'codex', sessionId: s.id, title: s.title, source: s.source, timestamp: o.timestamp, message: messages.length + 1, sourceLine: line, explanation: text.replace(/^# Context from my IDE setup:[\s\S]*?## My request:\s*/i, ''), conversation: `${s.file ?? `conversations/codex-${s.id}.md`}#message-${messages.length + 1}` };
      if (p.role === 'user') for (const c of p.content ?? []) if (['input_image', 'image'].includes(c.type)) {
        const file = picture(c.image_url ?? c.url, context); if (file && !message.images.includes(file)) message.images.push(file);
      }
      if (text || message.images.length) messages.push(message);
    }
    exportSession(s, messages);
  }
  state.close();
  const memoryPath = 'C:/Users/user/.codex/memories_1.sqlite';
  const memory = new DatabaseSync(memoryPath, { readOnly: true });
  const allowed = new Set(threads.map(t => t.id));
  const memories = memory.prepare('SELECT thread_id,raw_memory,rollout_summary,rollout_slug,generated_at FROM stage1_outputs').all().filter(m => allowed.has(m.thread_id));
  json('sources/codex-memories.json', memories.map(m => ({ ...m, raw_memory: redact(m.raw_memory), rollout_summary: redact(m.rollout_summary) })));
  memory.close();
  const ocPath = 'C:/Users/user/.local/share/opencode/opencode.db';
  const oc = new DatabaseSync(ocPath, { readOnly: true });
  const ocSessions = oc.prepare('SELECT id,title,directory,parent_id,time_created FROM session_v2 ORDER BY time_created').all().filter(s => norm(s.directory) === project || norm(s.directory) === projectParent);
  for (const t of ocSessions) {
    const s = { provider: 'opencode', id: t.id, title: title(t.title), source: t.parent_id ? 'subagent' : 'user', originalPath: `${ocPath} (session_message.session_id=${t.id})`, createdAt: iso(t.time_created) };
    const messages = [];
    for (const r of oc.prepare("SELECT id,type,data,time_created FROM session_message WHERE session_id=? AND type IN ('user','assistant') ORDER BY seq,time_created").all(t.id)) {
      const d = JSON.parse(r.data);
      const text = redact(r.type === 'user' ? d.text : (d.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n'));
      const message = { role: r.type, timestamp: iso(r.time_created), text, images: [] };
      for (const f of [...(d.files ?? []), ...(d.metadata?.attachments ?? [])]) if (/^image\//.test(f.mime ?? f.mediaType ?? '')) {
        const file = picture(f, { provider: 'opencode', sessionId: s.id, source: s.source, title: s.title, timestamp: message.timestamp, message: messages.length + 1, explanation: text, conversation: `conversations/opencode-${s.id}.md#message-${messages.length + 1}` });
        if (file && !message.images.includes(file)) message.images.push(file);
      }
      if (text || message.images.length) messages.push(message);
    }
    exportSession(s, messages);
  }
  oc.close();
  const copilot = new DatabaseSync('C:/Users/user/AppData/Roaming/Code/User/globalStorage/github.copilot-chat/session-store.db', { readOnly: true });
  const copilotSessions = copilot.prepare('SELECT id,cwd FROM sessions').all().filter(t => norm(t.cwd ?? '') === project);
  copilot.close();
  for (const p of ['ai/strategy.md', 'docs/PROJECT_PLAN.md', 'docs/CALIBRATION.md', 'docs/VALIDATION.md', 'docs/INTERACTION_PLAN.md', 'docs/BACKLOG.md']) {
    fs.copyFileSync(path.join(root, p), path.join(out, 'sources', p.replaceAll('/', '--')));
  }
  for (const im of images.values()) im.occurrences.sort((a,b) => (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1) || String(a.timestamp).localeCompare(String(b.timestamp)));
  const imageList = [...images.values()].sort((a, b) => String(a.occurrences[0].timestamp).localeCompare(String(b.occurrences[0].timestamp)));
  requests.sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  json('inventory.json', { generatedAt, project: root, sessions, images: imageList, missingImages: missing, failures, excluded, memories: memories.length, copilotSessions: copilotSessions.length });
  json('user-requests.json', requests);
  write('USER_REQUESTS.md', '# User requests in chronological order\n\nIDE context is removed from this index; the linked transcript retains it. Delegated copies are excluded. OpenCode forks may repeat earlier requests.\n\n' + requests.map(r => `- **${r.timestamp}** [${r.provider}, message ${r.message}](${r.conversation}): ${linkText(r.text.replace(/\s+/g, ' ').slice(0, 500))}${r.images?.length ? ` (${r.images.length} supplied images)` : ''}`).join('\n\n') + '\n');
  write('CONVERSATIONS.md', '# Conversation inventory\n\nStored user-facing messages are exported; original event streams remain at their listed source paths. Root conversations and delegated agent threads are labelled separately. Automatic permission review threads are inventoried in inventory.json but omitted here.\n\n| Started (UTC) | Source | Thread | Messages |\n| --- | --- | --- | --- |\n' + sessions.sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(s => `| ${s.createdAt} | ${s.provider} / ${s.source} | [${linkText(s.title)}](${s.file}) | ${s.messages} |`).join('\n') + '\n');
  write('IMAGES.md', '# Supplied images and their explanations\n\nDeduplicated by SHA-256 from user-role image attachments. This includes screenshots and any other supplied pictures; no automated test screenshots are added. Repeated/inherited attachments retain every conversation reference. Dates below are UTC.\n\n' + imageList.map((im, i) => `## ${i+1}. ${im.occurrences[0].timestamp}\n\n![Supplied image ${i+1}](${im.file})\n\n${im.occurrences.map(o => `[${o.provider} / ${o.source}, message ${o.message}](${o.conversation})\n\n${o.explanation || '(No text supplied with this image.)'}`).join('\n\n---\n\n')}\n`).join('\n'));
  const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  write('gallery.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibrated — supplied images</title><style>body{font:16px/1.5 system-ui;margin:32px;background:#f4f4f2;color:#171717}h1{font-size:28px}input{padding:12px;width:min(650px,85%);font:inherit}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px;margin-top:24px}article{background:white;padding:18px;border:1px solid #ddd;border-radius:8px}img{width:100%;height:250px;object-fit:contain;background:#eee}pre{white-space:pre-wrap;font:inherit;max-height:260px;overflow:auto}small{overflow-wrap:anywhere}a{color:#2452a0}</style><h1>Calibrated: images supplied to agents</h1><p>${imageList.length} unique pictures. Search the explanation to find placement corrections, annotated views and other discussions. Original image files and linked transcripts stay local.</p><input id="search" aria-label="Search explanations" placeholder="Search explanations…"><main>${imageList.map((im,i)=>`<article><h2>${i+1}. ${esc(im.occurrences[0].timestamp?.slice(0,10)??'Unknown date')}</h2><a href="${im.file}"><img loading="lazy" src="${im.file}" alt="Supplied picture ${i+1}"></a>${im.occurrences.map(o=>`<details ${im.occurrences.length===1?'open':''}><summary>${esc(o.provider+' / '+o.source+' · '+o.timestamp)}</summary><pre>${esc(o.explanation)}</pre><a href="${o.conversation}">Open conversation, message ${o.message}</a></details>`).join('')}<small>SHA-256: ${im.id}</small></article>`).join('')}</main><script>document.querySelector('#search').addEventListener('input',event=>{const query=event.target.value.toLowerCase();document.querySelectorAll('article').forEach(card=>card.hidden=!card.textContent.toLowerCase().includes(query))})</script></html>`);
  console.log(JSON.stringify({ generatedAt, sessions: sessions.length, providers: sessions.reduce((a,s)=>(a[s.provider]=(a[s.provider]??0)+1,a),{}), sources: sessions.reduce((a,s)=>(a[s.source]=(a[s.source]??0)+1,a),{}), messages: sessions.reduce((n,s)=>n+s.messages,0), requests: requests.length, uniqueImages: images.size, imageOccurrences: imageList.reduce((n,im)=>n+im.occurrences.length,0), missingImages: missing.length, failures: failures.length, memories: memories.length, excludedReviews: excluded.length, dateStart: requests[0]?.timestamp, dateEnd: requests.at(-1)?.timestamp }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
