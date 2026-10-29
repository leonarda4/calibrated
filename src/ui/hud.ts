// src/ui: status line + desktop FPS HUD. In-headset status comes later (M3);
// the DOM overlay is not visible in immersive sessions.
export function makeHud() {
  const statusEl = document.getElementById('status')!
  const hudEl = document.getElementById('hud')!
  const appEl = document.getElementById('app')!

  let frames = 0
  let last = performance.now()

  return {
    setStatus(html: string) {
      statusEl.innerHTML = html
    },
    appendStatus(html: string) {
      statusEl.innerHTML += `<br/>${html}`
    },
    hideOverlay() {
      appEl.style.display = 'none'
      hudEl.textContent = ''
    },
    showOverlay() {
      appEl.style.display = ''
    },
    /** call once per rendered frame */
    tickFrame(isPresenting: boolean) {
      if (isPresenting) {
        hudEl.textContent = ''
        return
      }
      frames++
      const now = performance.now()
      if (now - last >= 1000) {
        hudEl.textContent = `${frames} fps`
        frames = 0
        last = now
      }
    },
  }
}