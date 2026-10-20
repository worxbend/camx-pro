import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('viewer.html', import.meta.url)),
      },
    },
  },
});
