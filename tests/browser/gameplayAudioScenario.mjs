import assert from 'node:assert/strict';

/** A desktop scan-fitting hitch freezes visuals, not a native music stream. */
async function coordinatorMusicStall(page) {
  await page.evaluate(async () => {
    const { setupExperience } = await import('/src/experience/setupExperience.ts');
    const { THREE } = window.__gameplayNative;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), scan = new THREE.Group();
    scene.add(camera, scan); camera.position.set(0, 1.7, 4);
    scan.position.set(-2, 1.45, 20);
    scan.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); scan.updateMatrixWorld(true);
    const points = [];
    for (const x of [.95, 3.05]) for (let y = 15; y <= 29.001; y += .05) {
      for (let z = -1; z <= .251; z += .1) points.push(x, y, z);
    }
    scan.viewer = { splatMesh: { material: new THREE.ShaderMaterial({ uniforms: { uGlobalOpacity: { value: 1 } } }),
      splatDataTextures: { baseData: { centers: new Float32Array(points) } } } };
    const xr = new THREE.EventDispatcher();
    Object.assign(xr, { isPresenting: false, getSession: () => null, getReferenceSpace: () => null });
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const experience = setupExperience({ xr, domElement: canvas }, scene, camera, scan, { isScanReady: () => true });
    const button = document.createElement('button'); button.id = 'gameplay-coordinator-unlock'; button.textContent = 'Start silent coordinator preview';
    button.addEventListener('click', () => { void experience.gameplayAudio.unlock().then(enabled => {
      if (enabled) experience.startTestScenarioPreview();
    }); });
    document.body.append(button); window.__musicCoordinator = { experience, scene, camera };
  });
  try {
    await page.locator('#gameplay-coordinator-unlock').click();
    await page.waitForFunction(() => window.__musicCoordinator.experience.gameplayAudio.snapshot().currentMusic?.endsWith('Ambience_1.wav'));
    return await page.evaluate(async () => {
      const { experience } = window.__musicCoordinator, s = window.__gameplayNative;
      const { ensure } = s;
      const background = s.media.filter(record => record.element.src.endsWith('/Ambience_1.wav')).at(-1).element;
      const beforeTime = background.currentTime;
      const before = experience.scenario.snapshot(), box = experience.installation.snapshot();
      experience.update(3);
      await new Promise(resolve => setTimeout(resolve, 80));
      const after = experience.scenario.snapshot();
      ensure(after.running && after.elapsedSeconds === before.elapsedSeconds && after.stage === before.stage,
        'A desktop fitting hitch cancelled or advanced the story clock');
      ensure(experience.installation.snapshot().phase === box.phase && !experience.installation.snapshot().secondBox.visible,
        'A long desktop frame forced a future visual event');
      ensure(experience.gameplayAudio.snapshot().running && !background.paused && background.currentTime > beforeTime,
        'The actual coordinator stopped native background playback during a desktop hitch');
      experience.update(.25);
      ensure(Math.abs(experience.scenario.snapshot().elapsedSeconds - before.elapsedSeconds - .25) < 1e-8,
        'The desktop story clock did not resume normally after the hitch');
      experience.prepareForCalibration();
      ensure(!experience.gameplayAudio.snapshot().running && background.paused,
        'Explicit calibration recovery lost its authority to stop the background');
      return { coordinatorDesktopHitchKeepsMusic: true, coordinatorDesktopClockFreezes: true,
        normalFramesResumeStory: true, explicitRecoveryStopsMusic: true, hardwareSession: false };
    });
  } finally {
    await page.evaluate(() => { window.__musicCoordinator?.experience.dispose(); delete window.__musicCoordinator; });
  }
}

/** Real local decoders/media/nodes through a silent native destination. No audible-output claim. */
export async function runGameplayAudioScenario(parentPage) {
  const page = await parentPage.context().newPage();
  const errors = [], audioRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/audio/')) audioRequests.push(url.pathname);
  });
  try {
    await page.route('**/src/main.ts', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(new URL('/', parentPage.url()).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const [{ createGameplayAudio, equalPowerCrossfade }, { GAMEPLAY_AUDIO, GAMEPLAY_SPEECH, gameplayMusicLevel },
        { createHoleTransition, headsetAboveHole }, THREE] = await Promise.all([
        import('/src/audio/gameplayAudio.ts'), import('/src/audio/gameplayAudioConfig.ts'),
        import('/src/experience/holeTransition.ts'), import('/node_modules/.vite/deps/three.js'),
      ]);
      const ensure = (ok, message) => { if (!ok) throw new Error(`Native gameplay audio regression: ${message}`); };
      const near = (a, b, message, tolerance = 1e-6) => ensure(Math.abs(a - b) < tolerance, `${message}: ${a} versus ${b}`);
      const originalContext = Object.getOwnPropertyDescriptor(window, 'AudioContext'), originalFetch = window.fetch;
      const NativeAudioContext = window.AudioContext;
      ensure(typeof NativeAudioContext === 'function', 'Native Web Audio unavailable');
      const contexts = [], media = [], sources = [], decoded = new Map(), inputPaths = new WeakMap(), bufferPaths = new WeakMap();
      const gains = new WeakMap(), requests = new Map(), captions = [], statuses = [], panners = [];
      const speechPaths = new Set(Object.values(GAMEPLAY_SPEECH).map(speech => `/audio/SoundFX/${speech.file}`));
      class SilentNativeContext {
        constructor() {
          const audio = new NativeAudioContext(), nativeDestination = audio.destination;
          const silent = audio.createGain(); silent.gain.value = 0; silent.connect(nativeDestination);
          Object.defineProperty(audio, 'destination', { configurable: true, value: silent });
          const createGain = audio.createGain.bind(audio), createMedia = audio.createMediaElementSource.bind(audio);
          const decode = audio.decodeAudioData.bind(audio), createBuffer = audio.createBufferSource.bind(audio);
          const createPan = audio.createStereoPanner.bind(audio);
          audio.createStereoPanner = () => {
            const node = createPan(), set = node.pan.setValueAtTime.bind(node.pan), ramp = node.pan.linearRampToValueAtTime.bind(node.pan);
            const disconnect = node.disconnect.bind(node), record = { node,events:[],disconnected:false }; panners.push(record);
            node.pan.setValueAtTime = (...args) => { record.events.push(args); return set(...args); };
            node.pan.linearRampToValueAtTime = (...args) => { record.events.push(args); return ramp(...args); };
            node.disconnect = (...args) => { record.disconnected = true; return disconnect(...args); };
            return node;
          };
          audio.createGain = () => {
            const gain = createGain(), curve = gain.gain.setValueCurveAtTime.bind(gain.gain);
            const record = { gain, curves: [] }; gains.set(gain, record);
            gain.gain.setValueCurveAtTime = (values, at, duration) => {
              record.curves.push({ values: Array.from(values), at, duration });
              return curve(values, at, duration);
            };
            return gain;
          };
          audio.createMediaElementSource = element => {
            const node = createMedia(element), connect = node.connect.bind(node);
            const record = { element, node, gainRecord: null }; media.push(record);
            node.connect = destination => { record.gainRecord = gains.get(destination); return connect(destination); };
            return node;
          };
          audio.decodeAudioData = async bytes => {
            const path = inputPaths.get(bytes), buffer = await decode(bytes);
            ensure(buffer.length > 0 && buffer.duration > 0, `Empty native decoded sound: ${path}`);
            decoded.set(path, { frames: buffer.length, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
            bufferPaths.set(buffer, path); return buffer;
          };
          audio.createBufferSource = () => {
            const source = createBuffer(), start = source.start.bind(source), stop = source.stop.bind(source), connect = source.connect.bind(source);
            const record = { id: sources.length + 1, path: null, starts: 0, stopped: false, ended: false };
            sources.push(record);
            source.connect = destination => { record.gainNode = destination; return connect(destination); };
            source.addEventListener('ended', () => { record.ended = true; record.endedAt = audio.currentTime; });
            source.start = (...args) => {
              record.path = bufferPaths.get(source.buffer); record.starts++; record.at = args[0]; record.duration = args[2]; record.offset = args[1];
              record.loop = source.loop; record.buffer = source.buffer;
              ensure(record.starts === 1 && source.buffer?.length > 0, 'An empty/duplicate native source was started');
              // Genuine native ended events exercise the FIFO; accelerated only in this silent check.
              if (speechPaths.has(record.path)) source.playbackRate.value = 64;
              start(...args);
            };
            source.stop = (...args) => { record.stopped = true; stop(...args); };
            return source;
          };
          contexts.push({ audio, silent }); return audio;
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: SilentNativeContext });
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        ensure(url.origin === location.origin, 'External audio requested');
        ensure(!url.pathname.startsWith('/audio/generated/'), 'Generated voice requested by new soundtrack');
        const response = await originalFetch.call(window, input, init);
        if (!url.pathname.startsWith('/audio/SoundFX/')) return response;
        const path = decodeURIComponent(url.pathname), arrayBuffer = response.arrayBuffer.bind(response);
        requests.set(path, (requests.get(path) ?? 0) + 1);
        response.arrayBuffer = async () => { const bytes = await arrayBuffer(); inputPaths.set(bytes, path); return bytes; };
        return response;
      };
      const engine = createGameplayAudio({ onCaption: text => captions.push(text), onStatus: text => statuses.push(text), random: () => .5 });
      const bounded = async (promise, label, milliseconds = 15000) => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
        })]); } finally { clearTimeout(timer); }
      };
      const waitFor = async (condition, label, milliseconds = 8000) => {
        const deadline = performance.now() + milliseconds;
        while (!condition()) {
          ensure(performance.now() < deadline, `${label} timed out`);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      const button = document.createElement('button'); button.id = 'gameplay-native-unlock'; button.textContent = 'Enable silent gameplay audio test';
      const state = { engine, contexts, media, sources, decoded, requests, captions, statuses, speechPaths, panners,
        ensure, near, bounded, waitFor, originalContext, originalFetch, config: GAMEPLAY_AUDIO, speech: GAMEPLAY_SPEECH,
        equalPowerCrossfade, gameplayMusicLevel, createHoleTransition, headsetAboveHole, THREE, ready: false };
      button.addEventListener('click', () => { void engine.unlock().then(ready => { state.ready = ready; }); });
      document.body.replaceChildren(button); window.__gameplayNative = state;
    });
    await page.locator('#gameplay-native-unlock').click();
    await page.waitForFunction(() => window.__gameplayNative.ready);
    const result = await page.evaluate(async () => {
      const s = window.__gameplayNative, { engine, ensure, near, bounded, waitFor, config } = s;
      ensure(s.contexts.length === 1 && s.contexts[0].silent.gain.value === 0, 'Audio destination is not silent');
      await bounded(engine.preload(), 'Real local soundtrack preloading');
      const expectedShortClips = new Set([...Object.values(s.speech).map(speech => speech.file),
        'BoxMoving01.wav', 'BoxMoving03.wav', ...config.explorationFootsteps.clips,
        ...config.explorationEvents.map(event => event.clip), 'RoomTilting.wav']);
      ensure(s.media.length === 7 && s.decoded.size === expectedShortClips.size,
        `Unexpected media/decode allocation: ${s.media.length}/${s.decoded.size}, expected ${expectedShortClips.size} short clips`);
      for (const file of expectedShortClips) ensure(s.decoded.has(`/audio/SoundFX/${file}`), `Supplied WAV was not decoded: ${file}`);
      await bounded(Promise.all(s.media.map(({ element }) => Number.isFinite(element.duration) && element.duration > 0 ? Promise.resolve()
        : new Promise((resolve, reject) => {
          element.addEventListener('loadedmetadata', resolve, { once: true });
          element.addEventListener('error', () => reject(new Error(`Missing background WAV: ${element.src}`)), { once: true });
        }))), 'All seven real background metadata records');
      const metadata = s.media.map(({ element }) => ({ path: new URL(element.src).pathname, duration: element.duration, looping: element.loop }));
      for (const track of metadata) ensure(Number.isFinite(track.duration) && track.duration > 0, `Empty background metadata: ${track.path}`);
      for (let index = 1; index <= 3; index++) {
        const track = metadata.find(entry => entry.path.endsWith(`Transition_${index}.wav`));
        near(track.duration, config.transitionSourceSeconds[index], `Real transition ${index} duration`, .1);
      }
      ensure(metadata.every(track => track.looping), 'Every background needs a loop guard until its replacement is ready');
      for (let step = 0; step <= 20; step++) {
        const [outgoing, incoming] = s.equalPowerCrossfade(step / 20);
        near(outgoing ** 2 + incoming ** 2, 1, 'Equal-power crossfade energy');
      }
      let now = 0;
      const advance = async seconds => {
        const end = now + seconds;
        while (now < end - 1e-9) {
          now = Math.min(now + .25, end); engine.update(now);
          await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        }
      };
      const expectMusic = async filename => {
        await waitFor(() => engine.snapshot().currentMusic?.endsWith(filename), `Playback ${filename}`);
        return s.media.find(record => record.element.src.endsWith(filename));
      };
      engine.start(0);
      const initial = await expectMusic('Ambience_1.wav');
      await new Promise(resolve => setTimeout(resolve, (config.crossfadeSeconds + .1) * 1000));
      const initialMusicGain = initial.gainRecord.gain.gain.value;
      const initialLevel = s.gameplayMusicLevel(initial.element.getAttribute('src'));
      near(initialMusicGain, initialLevel, 'Normalized nominal background gain');
      const beforeStall = initial.element.currentTime;
      now = 2.25; engine.update(now);
      await new Promise(resolve => setTimeout(resolve, 80));
      ensure(engine.snapshot().running && !initial.element.paused && initial.element.currentTime > beforeStall,
        'A render/scan-fitting stall stopped the native ambient stream');
      engine.update(Number.NaN); engine.update(0);
      ensure(engine.snapshot().running && !initial.element.paused, 'Stale diagnostic clocks cancelled active music');

      const speechBefore = s.sources.length;
      const footSources = () => s.sources.filter(record => /\/Footsteps0[12]\.wav$/.test(record.path));
      await advance(2.25);
      await waitFor(() => footSources().length === 1, 'First native random walking pass');
      ensure(s.panners.length === 1 && s.panners[0].node instanceof StereoPannerNode, 'Random footsteps need a real native panner');
      const [panFrom,panTo] = s.panners[0].events;
      ensure(panFrom[0] * panTo[0] < 0 && Math.abs(panTo[1]-panFrom[1]-config.explorationFootstepSeconds) < 1e-6,
        'Footstep pan must sweep across the authored three-second pass');
      ensure(footSources()[0].gainNode.channelCount === 1 && footSources()[0].gainNode.channelCountMode === 'explicit',
        'A stereo recording must downmix to one walker before constant-power panning');
      engine.speech('welcome'); engine.speech('findBox'); engine.speech('stepOnBox');
      engine.speech('sitOnBox');engine.speech('classroom');engine.speech('cleanRoom');
      ensure(engine.snapshot().queuedSpeech.join(',') === 'findBox,stepOnBox,sitOnBox,classroom,cleanRoom', 'Speech was interrupted instead of queued');
      await waitFor(() => s.sources.filter(record => s.speechPaths.has(record.path)).length === 6 &&
        engine.snapshot().playingSpeech.length === 0 && engine.snapshot().queuedSpeech.length === 0, 'Native speech FIFO completion');
      const spoken = s.sources.slice(speechBefore).filter(record => s.speechPaths.has(record.path));
      ensure(spoken.map(record => record.path).join('|') === ['welcome', 'findBox', 'stepOnBox', 'sitOnBox', 'classroom', 'cleanRoom']
        .map(id => `/audio/SoundFX/${s.speech[id].file}`).join('|'), 'Native speech scheduled out of order');
      for (let i = 1; i < spoken.length; i++) ensure(spoken[i].at >= spoken[i - 1].endedAt - .002, 'Speech sources overlapped');
      near(initial.gainRecord.gain.gain.value, initialMusicGain, 'Speech ducked background music');
      ensure(!initial.element.paused && engine.snapshot().currentMusic?.endsWith('Ambience_1.wav'),
        'Speech interrupted the ambient bed');
      ensure(config.gains.speech > config.gains.music && config.gains.box < config.gains.music && config.gains.bonk < config.gains.footsteps,
        'Speech/background/support gain ordering changed');
      const tiltPath = '/audio/SoundFX/RoomTilting.wav';
      const tiltSources = () => s.sources.filter(record => record.path === tiltPath);
      ensure(s.captions.includes(s.speech.cleanRoom.caption), 'The supplied cleaning instruction did not publish its caption');
      ensure(tiltSources().length === 0 && !engine.snapshot().roomTiltingPlaying,
        'Preloading or narration started an anticipatory room-tilting loop');
      for (let pass = 0; pass < 2; pass++) {
        engine.setRoomTilting(true);
        await waitFor(() => engine.snapshot().roomTiltingPlaying, `Native room-tilting pass ${pass + 1}`);
        const count = tiltSources().length;
        ensure(count === pass + 1 && tiltSources().at(-1).loop, 'Each motion leg needs one looping native source');
        engine.setRoomTilting(true); engine.setRoomTilting(true);
        ensure(tiltSources().length === count, 'Repeated moving frames restarted the active tilt sound');
        near(initial.gainRecord.gain.gain.value, initialMusicGain, 'Room tilting ducked background music');
        ensure(!initial.element.paused, 'Room tilting paused the background music');
        engine.setRoomTilting(false);
        ensure(!engine.snapshot().roomTiltingPlaying && !engine.snapshot().roomTiltingMoving,
          'A held pose retained the movement-only loop');
      }
      ensure(tiltSources().every(record => record.buffer === tiltSources()[0].buffer) && s.requests.get(tiltPath) === 1,
        'The return leg reloaded or decoded another copy of the tilt buffer');
      engine.effect('box1'); engine.effect('box2');
      await waitFor(() => s.sources.some(record => record.path?.endsWith('/BoxMoving01.wav')) &&
        s.sources.some(record => record.path?.endsWith('/BoxMoving03.wav')), 'Both brief box effects');
      ensure(!initial.element.paused, 'A supporting effect paused background music');
      const resumeTime = initial.element.currentTime;
      initial.element.pause();
      now += .1; engine.update(now); now += .05; engine.update(now);
      await waitFor(() => !initial.element.paused, 'Native ambient resume after unexpected media pause');
      ensure(initial.element.currentTime >= resumeTime - .01, 'Resuming an interrupted background rewound the recording');
      ensure(s.media.length === 7, 'Background recovery reallocated media nodes');
      await advance(20);
      const preTurnFootsteps = footSources().length;
      const stages = ['Ambience_1.wav'];
      for (let index = 1; index <= 3; index++) {
        ensure(engine.transition(index), `Transition ${index} rejected`);
        const incoming = await expectMusic(`Transition_${index}.wav`);
        ensure(!engine.transition(index), `Duplicate transition ${index} restarted`);
        stages.push(`Transition_${index}.wav`);
        if (index === 1) {
          const outgoingCurve = initial.gainRecord.curves.at(-1), incomingCurve = incoming.gainRecord.curves.at(-1);
          ensure(outgoingCurve && incomingCurve, 'Native gain nodes received no crossfade curves');
          const incomingLevel = s.gameplayMusicLevel(incoming.element.getAttribute('src'));
          near(outgoingCurve.values[0], initialLevel, 'Crossfade outgoing start');
          near(incomingCurve.values[0], 0, 'Crossfade incoming start');
          near((outgoingCurve.values[16] / initialLevel) ** 2 + (incomingCurve.values[16] / incomingLevel) ** 2, 1,
            'Native midpoint normalized energy');
          near(outgoingCurve.values.at(-1), 0, 'Crossfade outgoing end');
          near(incomingCurve.values.at(-1), incomingLevel, 'Crossfade incoming end');
        }
        await advance(config.transitionSeconds[index]);
        await expectMusic(`Ambience_${index + 1}.wav`);
        ensure(engine.snapshot().transition === null, `Transition ${index} did not complete its excerpt window`);
        stages.push(`Ambience_${index + 1}.wav`);
      }
      ensure(footSources().length === preTurnFootsteps && footSources().every(record => record.stopped || record.ended) &&
        s.panners.every(pan => pan.disconnected), 'First transition must cancel every passing walker and its panner');
      ensure(engine.snapshot().lastTransition === 3, 'Fourth ambience did not follow the third transition');
      const requestCounts = JSON.stringify([...s.requests.entries()].sort()), createdMedia = s.media.length;
      engine.stop();
      ensure(!engine.snapshot().running && engine.snapshot().currentMusic === null && s.media.every(record => record.element.paused),
        'Stop retained background playback');
      ensure(s.sources.every(record => record.stopped || record.ended), 'Stop retained an earlier supporting source');
      engine.start(100); now = 100; await expectMusic('Ambience_1.wav');
      ensure(engine.snapshot().lastTransition === 0 && s.media.length === createdMedia, 'Restart retained a phase or reallocated music nodes');
      ensure(JSON.stringify([...s.requests.entries()].sort()) === requestCounts, 'Restart fetched already decoded short clips again');
      engine.speech('classroom'); engine.stop();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      ensure(engine.snapshot().playingSpeech.length === 0 && engine.snapshot().queuedSpeech.length === 0,
        'A cancelled pending speech request revived after restart');
      engine.start(200); await expectMusic('Ambience_1.wav'); engine.setRoomTilting(true);
      await waitFor(() => engine.snapshot().roomTiltingPlaying, 'Native tilt before mute');
      engine.setMuted(true);
      ensure(engine.snapshot().muted && s.media.every(record => record.element.paused) && !engine.snapshot().roomTiltingPlaying &&
        !engine.snapshot().roomTiltingMoving, 'Mute retained background or room-tilting playback');
      engine.setMuted(false); engine.stop();
      engine.setRoomTilting(true);
      await waitFor(() => engine.snapshot().roomTiltingPlaying, 'Native tilt before explicit stop');
      engine.stop();
      ensure(!engine.snapshot().roomTiltingPlaying && !engine.snapshot().roomTiltingMoving && tiltSources().every(record => record.stopped || record.ended),
        'Explicit stop retained a native room-tilting source');

      engine.start(300); await expectMusic('Ambience_1.wav');
      engine.speech('classroom'); engine.speech('cleanRoom'); engine.effect('box1'); engine.setRoomTilting(true);
      engine.finishReality(); engine.finishReality();
      const endingSources = () => s.sources.filter(record => record.path?.endsWith('/WhatIsReality.wav'));
      await waitFor(() => endingSources().length === 1, 'Full native reality ending');
      const ending = endingSources()[0], endingDecoded = s.decoded.get('/audio/SoundFX/WhatIsReality.wav');
      near(endingDecoded.duration, 6.710979166666666, 'Complete supplied reality recording duration', .001);
      near(ending.offset, 0, 'Reality recording offset'); near(ending.duration, endingDecoded.duration, 'Reality recording is not truncated');
      ensure(engine.snapshot().realityFinished && !engine.snapshot().running && s.media.every(record => record.element.paused) &&
        !engine.snapshot().roomTiltingPlaying && !engine.snapshot().explorationFootsteps.active,
        'Reality ending retained background or support');
      engine.speech('welcome'); engine.effect('box2'); engine.finishReality();
      ensure(!engine.warnDanger('danger1') && !engine.setRoomTilting(true), 'A late ordinary cue interrupted the final line');
      await waitFor(() => ending.ended, 'Full native reality recording completion');
      ensure(endingSources().length === 1 && !ending.stopped, 'Duplicate ending replayed or interrupted the line');
      engine.start(400); await expectMusic('Ambience_1.wav'); engine.finishReality();
      await waitFor(() => endingSources().length === 2, 'Reality ending after a fresh game');
      ensure(s.requests.get('/audio/SoundFX/WhatIsReality.wav') === 1 && s.contexts.length === 1,
        'Reality ending did not reuse the decoded buffer/context');
      engine.stop();

      const frame = new s.THREE.Matrix4().makeRotationY(.63).setPosition(3, 0, -4), before = frame.toArray();
      const footprint = { open: true, floorY: 0, startZ: -2.9, endZ: -.3, nearBounds: [-1, 1], farBounds: [-.7, 1.3] };
      const world = new s.THREE.Vector3(.3, 1.65, -1.5).applyMatrix4(frame);
      const route = world.clone().applyMatrix4(frame.clone().invert()).toArray();
      ensure(s.headsetAboveHole(route, footprint), 'Translated/yawed headset missed the fitted route-space hole');
      ensure(!s.headsetAboveHole(world.toArray(), footprint), 'Fixture does not distinguish world axes from the hole frame');
      let starts = 0, visualStarts = 0;
      const hole = s.createHoleTransition({ leadSeconds: 2, onAnticipate() { starts++; }, onTransition() { visualStarts++; } });
      hole.update(.25, true, true);
      for (let i = 0; i < 8; i++) hole.update(.25, true, false);
      ensure(starts === 1 && visualStarts === 1 && hole.snapshot().visualImplemented, 'Hole music did not anticipate exactly one visual transition');
      ensure(JSON.stringify(frame.toArray()) === JSON.stringify(before), 'Hole trigger changed the calibrated placement transform');
      return { nativeWebAudio: true, streamedBackgrounds: metadata, decodedShortClips: [...s.decoded].map(([path, info]) => ({ path, ...info })),
        stages, silentOutputGain: s.contexts[0].silent.gain.value, sourceStarts: s.sources.length,
        equalPowerNativeGainCurves: true, speechQueueUsesNativeEndedEvents: true, speechCheckPlaybackRate: 64,
        cleanRoomRealWavQueued: true, roomTilting: { nativeLoopStarts: tiltSources().length, returnReusesDecodedBuffer: true,
          noAnticipatoryPlayback: true, repeatedMovingFramesReuseSource: true, musicUnducked: true, heldMuteAndStopCancelLoop: true },
        speechDoesNotDuckMusic: true, effectsDoNotPauseMusic: true, renderStallKeepsNativeMusic: true,
        randomFootsteps: { nativePasses: preTurnFootsteps, stereoPassBy: true, monoGainHeadroom: true,
          stopAtFirstTransition: true, pannersReleased: true },
        staleClockKeepsMusic: true, backgroundLoopGuards: true, pausedMusicResumesWithoutRewind: true,
        steadyMusicGain: config.gains.music, resourcesReused: true,
        stopCancelsMusicAndEffects: true, staleSpeechSuppressed: true, mappedHoleTrigger: true, holeVisualImplemented: hole.snapshot().visualImplemented,
        realityEnding: { fullSourceSeconds: endingDecoded.duration, nativeStarts: endingSources().length,
          oncePerGame: true, replacesPreviousLayers: true, blocksLateCues: true, cachedContextReused: true },
        noAudibilityOrHardwareClaim: true };
    });
    assert.equal(result.stages.length, 7); assert.equal(result.silentOutputGain, 0);
    assert.ok(audioRequests.length > 0 && audioRequests.every(path => !path.startsWith('/audio/generated/')),
      'Gameplay soundtrack requested a generated voice');
    assert.deepEqual(errors, []);
    const coordinator = await coordinatorMusicStall(page);
    return { ...result, ...coordinator, generatedVoiceRequests: 0 };
  } finally {
    await page.evaluate(async () => {
      const s = window.__gameplayNative;
      if (!s) return;
      s.engine.dispose();
      for (const { audio, silent } of s.contexts) {
        silent.disconnect(); if (audio.state !== 'closed') await audio.close().catch(() => {});
      }
      window.fetch = s.originalFetch;
      if (s.originalContext) Object.defineProperty(window, 'AudioContext', s.originalContext);
      else delete window.AudioContext;
      delete window.__gameplayNative;
    }).catch(() => {});
    await page.close();
  }
}
