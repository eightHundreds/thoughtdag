import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages project sites live at /<repo>/; leave unset for Cloudflare
  // and local preview, which serve from the origin root.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
})
