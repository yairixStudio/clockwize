import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Kept separate from vite.config.js, which reads the local .server-port file.
// Tests run in the app's home timezone so date-boundary assertions are deterministic
// (Israel is UTC+2/+3, which is exactly where UTC-vs-local mistakes show up).
process.env.TZ = 'Asia/Jerusalem'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx']
    }
  }
})
