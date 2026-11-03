import * as THREE from 'three';

/** Interruption/recovery cue only. Narrative transcripts stay on the PC. */
export function createExperienceHud(camera: THREE.Camera) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'experience-stop';
  sprite.position.set(0, -0.3, -1.4);
  sprite.scale.set(1.1, 0.275, 1);
  sprite.renderOrder = 1100;
  sprite.visible = false;
  camera.add(sprite);
  let stopped = false;
  let stopReason = '';
  let viewRestored = false;

  const draw = () => {
    sprite.visible = stopped;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite.visible) { sprite.userData.message = ''; return; }
    context.fillStyle = viewRestored ? 'rgba(12,38,32,.94)' : 'rgba(65,12,18,.94)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffd5d5';
    context.font = '32px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const text = viewRestored
      ? 'VIEW RESTORED — RECALIBRATE\nPress either controller FRONT trigger once.\nThen place LEFT on A and RIGHT on B (7 seconds).'
      : `PAUSED — stay still.\n${stopReason}`;
    sprite.userData.message = text;
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width > 940 && line) { lines.push(line); line = word; }
        else line = candidate;
      }
      lines.push(line);
    }
    const visibleLines = lines.slice(0, 5);
    visibleLines.forEach((line, i) => context.fillText(line, 512, 128 + (i - (visibleLines.length - 1) / 2) * 42));
    texture.needsUpdate = true;
  };
  return {
    setStopped(value: boolean, reason = 'Return to the VR app and close system menus.', ready = false) {
      stopped = value; stopReason = reason; viewRestored = ready; draw();
    },
    clear() { stopped = false; draw(); },
    dispose() { camera.remove(sprite); texture.dispose(); material.dispose(); },
  };
}
