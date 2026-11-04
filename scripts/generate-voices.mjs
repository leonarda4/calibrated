// Offline asset production. Run with Node >=22.18 (native TS type stripping).
// No API request occurs during import or --dry-run; credentials never enter Vite.
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VOICE_CUES, voiceClipPath } from '../src/audio/voiceCues.ts';
import { selectVoiceIds } from './voice-selection.mjs';

export async function generateVoices({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  args = process.argv.slice(2),
  environment = process.env,
  fetcher = fetch,
  log = console.log,
} = {}) {
  const allowed = new Set(['--dry-run', '--force', '--cue', '--help']);
  const cueFilters = new Set();
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown option. Use --help.`);
    if (args[i] === '--cue') {
      const cue = args[++i];
      if (!Object.hasOwn(VOICE_CUES, cue ?? '')) throw new Error(`Unknown cue. Use ${Object.keys(VOICE_CUES).join(', ')}.`);
      cueFilters.add(cue);
    }
  }
  if (args.includes('--help')) {
    log('Usage: node scripts/generate-voices.mjs [--dry-run] [--cue NAME ...] [--force]');
    log(`Available cues: ${Object.keys(VOICE_CUES).join(', ')}. Repeat --cue to select several without generating the others.`);
    log('Put ELEVENLABS_API_KEY in the ignored repository-root .env.local. That is the only required setting.');
    log('Available voices are selected automatically; ELEVENLABS_VOICE_LEAD/LEFT/RIGHT are optional overrides.');
    log('Default model: eleven_v3; override with ELEVENLABS_MODEL_ID. Existing clips are skipped unless --force.');
    log('Only explicit generation calls ElevenLabs (and consumes speech credits). --dry-run stays offline.');
    return;
  }

  // A deliberately narrow dotenv reader: no expansion/evaluation or shell execution.
  // Only named ElevenLabs variables are admitted, and nothing is ever echoed.
  const names = ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_LEAD', 'ELEVENLABS_VOICE_LEFT', 'ELEVENLABS_VOICE_RIGHT', 'ELEVENLABS_MODEL_ID'];
  const settings = Object.fromEntries(names.map((name) => [name, environment[name] ?? '']));
  try {
    const env = await readFile(resolve(root, '.env.local'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !names.includes(match[1]) || settings[match[1]]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      settings[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Could not read local voice configuration.');
  }

  const jobs = Object.entries(VOICE_CUES)
    .filter(([cue]) => !cueFilters.size || cueFilters.has(cue))
    .flatMap(([cue, definition]) => definition.layers.map((layer) => ({
      cue, role: layer.role, text: layer.text,
      target: resolve(root, 'public', voiceClipPath(cue, layer.role).slice(1)),
      relative: voiceClipPath(cue, layer.role),
    })));
  const force = args.includes('--force');
  const pending = [];
  for (const job of jobs) {
    let existing = false;
    try { existing = (await stat(job.target)).size > 0; } catch (error) { if (error?.code !== 'ENOENT') throw new Error('Could not inspect local audio output.'); }
    if (!existing || force) pending.push(job);
  }
  const characters = pending.reduce((total, job) => total + job.text.length, 0);
  log(`Voice production: ${pending.length} speech requests, ${characters} input characters; ${jobs.length - pending.length} existing clips skipped.`);
  if (args.includes('--dry-run')) {
    log('Dry run only. No network requests or audio files created.');
    return;
  }
  if (!pending.length) return;
  if (!settings.ELEVENLABS_API_KEY) throw new Error('Set ELEVENLABS_API_KEY in the process environment or ignored .env.local.');
  const model = settings.ELEVENLABS_MODEL_ID || 'eleven_v3';
  if (!/^eleven_[a-zA-Z0-9_]{1,70}$/.test(model)) throw new Error('Invalid ELEVENLABS_MODEL_ID.');
  const voiceIds = await selectVoiceIds(settings, fetcher, [...new Set(pending.map((job) => job.role))]);

  for (const job of pending) {
    const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceIds[job.role])}`);
    endpoint.searchParams.set('output_format', 'mp3_44100_128');
    let response;
    try {
      // Sequential, bounded requests; no automatic retry can consume credits twice.
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'xi-api-key': settings.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: job.text, model_id: model, voice_settings: { stability: model === 'eleven_v3' ? 0 : 0.5, similarity_boost: 0.75 } }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new Error('ElevenLabs request failed or timed out. Existing clips are preserved; retry this command after checking connectivity.');
    }
    // Do not print API error bodies or request objects (they may contain private data).
    if (!response.ok) throw new Error(`ElevenLabs returned HTTP ${response.status}. Check account/model/voice access; no automatic retry was made.`);
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('ElevenLabs returned non-audio content. No clip was written.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 64) throw new Error('ElevenLabs returned an empty or truncated clip. No clip was written.');
    await mkdir(dirname(job.target), { recursive: true });
    await writeFile(job.target, bytes);
    log(`Saved ${job.relative}`);
  }
  log('Voice clips generated. Listen to all cues on headphones before the physical trial.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateVoices().catch((error) => { console.error(`Voice production failed: ${error.message}`); process.exitCode = 1; });
}
