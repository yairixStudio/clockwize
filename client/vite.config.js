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

// CLOCKWIZE_API_PORT points the dev proxy at a specific server (e.g. a throwaway demo one)
const serverPort = Number(process.env.CLOCKWIZE_API_PORT) || getServerPort();
console.log(`🔗 Proxying /api to http://localhost:${serverPort}`);

// The pages are code-split (src/App.jsx), but their CSS is not scoped and pages reuse each other's
// classes, so all CSS ships as one file in a fixed order (src/routeStyles.js). A stylesheet that is
// only reachable through a lazy chunk would land at the end of that file, after global.css - warn.
function lazyChunkCssGuard() {
  return {
    name: 'clockwize-lazy-chunk-css',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.isEntry) continue;
        const css = chunk.moduleIds.filter((id) => /\.css($|\?)/.test(id));
        if (css.length) {
          this.warn(`${css.map((id) => path.relative(__dirname, id)).join(', ')} only load(s) through the lazy chunk ` +
            `${chunk.fileName}, so it lands after global.css. Import it in src/routeStyles.js to keep the cascade order.`);
        }
      }
    }
  };
}

// פורט 5000 תפוס על ידי macOS ControlCenter, אז משתמשים ב-5001
export default defineConfig({
  plugins: [react(), lazyChunkCssGuard()],
  build: {
    // One stylesheet for the whole app, in the same cascade order as before the code split
    cssCodeSplit: false
  },
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

