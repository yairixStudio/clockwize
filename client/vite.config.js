import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// קריאת הפורט של השרת מהקובץ
function getServerPort() {
  const portFile = path.join(__dirname, '..', '.server-port');
  try {
    if (fs.existsSync(portFile)) {
      return parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
    }
  } catch (e) {
    console.log('Using default server port 3000');
  }
  return 3000;
}

const serverPort = getServerPort();
console.log(`🔗 Proxying /api to http://localhost:${serverPort}`);

// פורט 5000 תפוס על ידי macOS ControlCenter, אז משתמשים ב-5001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5001,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true
      }
    }
  }
})

