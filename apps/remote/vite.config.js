import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';
export default defineConfig({
  plugins: [solid()],
  base: './',
  build: { target: 'es2022' },
  server: { host: '127.0.0.1' },
});
