import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateVoices } from '../scripts/generate-voices.mjs';
import { selectVoiceIds } from '../scripts/voice-selection.mjs';

async function withDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'calibrated-voices-test-'));
  try { await run(directory); } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('calibrated-voices-test-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}

test('key-only local config selects available voices and writes local audio; later runs skip existing clips offline', async () => {
  await withDirectory(async (root) => {
    await fs.writeFile(path.join(root, '.env.local'), 'ELEVENLABS_API_KEY=fake_test_key\n');
    const requests = [];
    const logs = [];
    const fetcher = async (endpoint, options) => {
      requests.push({ url: String(endpoint), options });
      assert.equal(options.headers['xi-api-key'], 'fake_test_key');
      assert.ok(options.signal instanceof AbortSignal);
      if (!options.method) return Response.json({ voices: [
        { name: 'Zeta', voice_id: 'professional_voice', category: 'professional' },
        { name: 'Charlie', voice_id: 'charlie_voice', category: 'premade' },
        { name: 'Alpha', voice_id: 'alpha_voice', category: 'premade' },
        { name: 'Beta', voice_id: 'beta_voice', category: 'premade' },
      ] });
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).model_id, 'eleven_v3');
      return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
    };
    await generateVoices({ root, args: ['--cue', 'purpose'], environment: {}, fetcher, log: (text) => logs.push(text) });
    assert.equal(requests.length, 4);
    assert.equal(requests[0].url, 'https://api.elevenlabs.io/v2/voices?page_size=100');
    for (const [index, role] of ['lead', 'left', 'right'].entries()) {
      assert.ok(requests[index + 1].url.includes(['alpha_voice', 'beta_voice', 'charlie_voice'][index]));
      assert.equal((await fs.stat(path.join(root, 'public/audio/generated', `purpose-${role}.mp3`))).size, 100);
    }
    assert.ok(!logs.join('\n').includes('fake_test_key'));
    assert.ok(!logs.join('\n').includes('alpha_voice'));
    await generateVoices({
      root, args: ['--cue', 'purpose'], environment: {},
      fetcher: async () => { assert.fail('existing clips must not make a network request'); }, log() {},
    });
  });
});

test('automatic selection preserves explicit overrides and reuses available voices when fewer than three exist', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ voices: [
      { voice_id: 'only_voice_id', name: 'Only', category: 'premade' },
      { voice_id: 'only_voice_id', name: 'Duplicate' },
      { voice_id: 'legacy_voice', name: 'Legacy', is_legacy: true },
      { voice_id: null },
    ] });
  };
  assert.deepEqual(await selectVoiceIds({ ELEVENLABS_API_KEY: 'fake_test_key', ELEVENLABS_VOICE_LEFT: 'override_voice' }, fetcher), {
    left: 'override_voice', lead: 'only_voice_id', right: 'only_voice_id',
  });
  assert.equal(calls, 1);
  assert.deepEqual(await selectVoiceIds({
    ELEVENLABS_VOICE_LEAD: 'explicit_lead', ELEVENLABS_VOICE_LEFT: 'explicit_left', ELEVENLABS_VOICE_RIGHT: 'explicit_right',
  }, async () => assert.fail('explicit cast must skip discovery')), {
    lead: 'explicit_lead', left: 'explicit_left', right: 'explicit_right',
  });
});

test('dry run and help remain offline without credentials; missing key fails before discovery', async () => {
  await withDirectory(async (root) => {
    const options = { root, environment: {}, fetcher: async () => assert.fail('unexpected network request'), log() {} };
    await generateVoices({ ...options, args: ['--dry-run'] });
    await generateVoices({ ...options, args: ['--help'] });
    await assert.rejects(generateVoices({ ...options, args: [] }), /Set ELEVENLABS_API_KEY/);
    assert.deepEqual(await fs.readdir(root), []);
  });
});

test('voice discovery rejects invalid overrides, malformed lists and service failures without echoing private data', async () => {
  await assert.rejects(selectVoiceIds({ ELEVENLABS_VOICE_LEFT: 'invalid!' }, async () => assert.fail('invalid override must fail offline')), /ELEVENLABS_VOICE_LEFT/);
  const settings = { ELEVENLABS_API_KEY: 'fake_private_key' };
  await assert.rejects(selectVoiceIds(settings, async () => { throw new Error('fake_private_key'); }), (error) => {
    assert.match(error.message, /Could not list/);
    assert.ok(!error.message.includes('fake_private_key'));
    return true;
  });
  await assert.rejects(selectVoiceIds(settings, async () => new Response('fake_private_key', { status: 403 })), /HTTP 403.*key is valid and has Voices: Read/);
  await assert.rejects(selectVoiceIds(settings, async () => new Response('fake_private_key')), /invalid voice list/);
  await assert.rejects(selectVoiceIds(settings, async () => Response.json({ voices: [] })), /No available.*voices/);
});

test('401 voice-list errors distinguish missing scope from invalid credentials without echoing provider data', async () => {
  const settings = { ELEVENLABS_API_KEY: 'fake_private_key' };
  const privateMessage = 'fake_private_key private_voice_id';
  for (const field of ['code', 'status']) {
    for (const code of ['missing_permission', 'missing_permissions', 'insufficient_permission', 'insufficient_permissions']) {
      await assert.rejects(selectVoiceIds(settings, async () => Response.json({ detail: { [field]: code, message: privateMessage } }, { status: 401 })), (error) => {
        assert.match(error.message, /HTTP 401.*Developers > API Keys.*enable Voices: Read.*Text to Speech/);
        assert.match(error.message, /No speech requests were made/);
        assert.ok(!error.message.includes(privateMessage) && !error.message.includes(code));
        return true;
      });
    }
    for (const code of ['invalid_api_key', 'missing_api_key', 'expired_api_key', 'api_key_expired']) {
      await assert.rejects(selectVoiceIds(settings, async () => Response.json({ detail: { [field]: code, message: privateMessage } }, { status: 401 })), (error) => {
        assert.match(error.message, /HTTP 401.*rejected the API key.*valid, unexpired key.*repository-root \.env\.local/);
        assert.ok(!error.message.includes(privateMessage) && !error.message.includes(code));
        assert.doesNotMatch(error.message, /enable Voices/);
        return true;
      });
    }
  }
  await assert.rejects(selectVoiceIds(settings, async () => Response.json({ detail: {
    code: 'unknown_provider_code', message: `Missing permission voices_read. ${privateMessage}`,
  } }, { status: 401 })), (error) => {
    assert.match(error.message, /enable Voices: Read \(voices_read\)/);
    assert.ok(!error.message.includes('unknown_provider_code') && !error.message.includes(privateMessage));
    return true;
  });
});

test('failed discovery is never retried or followed by speech; unknown and malformed errors stay redacted', async () => {
  await withDirectory(async (root) => {
    const bodies = [
      'fake_private_key <html>private response</html>',
      JSON.stringify({ detail: 'fake_private_key' }),
      JSON.stringify({ detail: { code: 'fake_private_key', message: 'private_voice_id fake_private_key' } }),
    ];
    for (const body of bodies) {
      const requests = [];
      const logs = [];
      await assert.rejects(generateVoices({
        root, args: ['--cue', 'purpose'], environment: { ELEVENLABS_API_KEY: 'fake_private_key' },
        fetcher: async (endpoint, options) => {
          requests.push({ endpoint: String(endpoint), method: options.method });
          return new Response(body, { status: 401 });
        },
        log: (line) => logs.push(line),
      }), (error) => {
        assert.match(error.message, /HTTP 401.*key is valid and has Voices: Read.*No speech requests were made/);
        assert.ok(!error.message.includes('fake_private_key') && !error.message.includes('private_voice_id'));
        return true;
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, undefined);
      assert.equal(requests[0].endpoint, 'https://api.elevenlabs.io/v2/voices?page_size=100');
      assert.ok(!logs.join('\n').includes('fake_private_key'));
      assert.deepEqual(await fs.readdir(root), []);
    }
  });
});
