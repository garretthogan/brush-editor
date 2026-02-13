import { defineConfig } from 'vite'

// Use relative base so the app works on GitHub Pages at any path
// (e.g. https://username.github.io/brush-editor/ or a custom domain)
export default defineConfig({
  base: './',
  server: {
    host: true, // Expose on local network (e.g. http://192.168.x.x:5173)
  },
})
