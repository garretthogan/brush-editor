import { defineConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default defineConfig({
  ...viteConfig,
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/*.spec.js'],
    globals: true,
  },
})
