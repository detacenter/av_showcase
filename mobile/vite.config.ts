import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base — same reasoning as frontend/vite.config.ts: this app is
// nested under /mobile/ in the showcase deploy, so asset URLs must resolve
// relative to the page's own location, not the site root.
export default defineConfig({
  plugins: [react()],
  base: "./",
})
