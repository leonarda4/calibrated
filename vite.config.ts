import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR requires a secure context (HTTPS) — basic-ssl generates a self-signed
// cert automatically. --host 0.0.0.0 (in package.json) binds to the LAN so the
// headset can connect via https://192.168.1.7:5173
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // don't watch raw model exports / big binaries (EBUSY crash guard)
      ignored: ['**/01_GS_Model/**', '**/public/models/**', '**/node_modules/**'],
    },
  },
})