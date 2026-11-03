// Offline production only. Never imported by the browser.
// API: https://elevenlabs.io/docs/api-reference/voices/search
export const VOICE_KEYS = {
  lead: 'ELEVENLABS_VOICE_LEAD',
  left: 'ELEVENLABS_VOICE_LEFT',
  right: 'ELEVENLABS_VOICE_RIGHT',
};

const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);

async function voiceListingError(response) {
  let detail;
  try { detail = (await response.json())?.detail; } catch { /* Never echo an untrusted response body. */ }
  // Current responses use code; older endpoints use status. HTTP 401 alone
  // cannot distinguish an invalid key from a restricted but valid key.
  const codes = [detail?.code, detail?.status].filter((value) => typeof value === 'string');
  const credentialErrors = new Set(['invalid_api_key', 'missing_api_key', 'expired_api_key', 'api_key_expired']);
  const permissionErrors = new Set(['missing_permission', 'missing_permissions', 'insufficient_permission', 'insufficient_permissions']);
  let guidance = 'Check that your API key is valid and has Voices: Read access.';
  if (codes.some((code) => credentialErrors.has(code))) {
    guidance = 'ElevenLabs rejected the API key. Copy a valid, unexpired key into the repository-root .env.local (ELEVENLABS_API_KEY).';
  } else if (codes.some((code) => permissionErrors.has(code)) ||
      (typeof detail?.message === 'string' && /\bvoices_read\b/.test(detail.message))) {
    guidance = 'In ElevenLabs Developers > API Keys, edit this key and enable Voices: Read (voices_read). Also enable Text to Speech for generation.';
  }
  // Print only fixed guidance, never provider messages, codes or key values.
  return new Error(`ElevenLabs voice listing returned HTTP ${response.status}. ${guidance} No speech requests were made.`);
}

export async function selectVoiceIds(settings, fetcher = fetch) {
  const selected = {};
  for (const [role, key] of Object.entries(VOICE_KEYS)) {
    if (!settings[key]) continue;
    if (!validId(settings[key])) throw new Error(`Set ${key} to an available ElevenLabs voice ID, or remove it for automatic selection.`);
    selected[role] = settings[key];
  }
  if (Object.keys(selected).length === 3) return selected;

  let response;
  let result;
  try {
    response = await fetcher('https://api.elevenlabs.io/v2/voices?page_size=100', {
      headers: { 'xi-api-key': settings.ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not list ElevenLabs voices. Check connectivity and try again; no speech requests were made.');
  }
  if (!response.ok) throw await voiceListingError(response);
  try { result = await response.json(); } catch {
    throw new Error('ElevenLabs returned an invalid voice list; no speech requests were made.');
  }
  if (!Array.isArray(result?.voices)) throw new Error('ElevenLabs returned an invalid voice list; no speech requests were made.');

  // Defaults are included on the first page. Prefer them, then order by name/ID
  // so service response ordering cannot randomly change the cast.
  const rank = (voice) => ['premade', 'default'].includes(voice.category) ? 0 : 1;
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const voices = result.voices
    .filter((voice) => voice && validId(voice.voice_id) && !voice.is_legacy)
    .sort((a, b) => rank(a) - rank(b)
      || compare(String(a.name ?? '').toLowerCase(), String(b.name ?? '').toLowerCase())
      || compare(a.voice_id, b.voice_id));
  const ids = [...new Set(voices.map((voice) => voice.voice_id))];
  if (!ids.length) throw new Error('No available ElevenLabs voices were found. Add a voice to your account or set optional voice IDs; no speech requests were made.');

  const used = new Set(Object.values(selected));
  let reuse = 0;
  for (const role of Object.keys(VOICE_KEYS)) {
    if (selected[role]) continue;
    selected[role] = ids.find((id) => !used.has(id)) ?? ids[reuse++ % ids.length];
    used.add(selected[role]);
  }
  return selected;
}
