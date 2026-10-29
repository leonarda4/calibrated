// TEMP test config: same app over plain HTTP for the in-app browser
// (the desktop browser refuses self-signed certs). The headset keeps
// using the HTTPS instance on 5173 — WebXR requires a secure context.
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/01_GS_Model/**', '**/public/models/**', '**/node_modules/**'],
    },
  },
})