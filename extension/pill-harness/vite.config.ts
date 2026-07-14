import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Dev-only harness config (see main.tsx). Run from /extension:
//   npx vite pill-harness --config pill-harness/vite.config.ts
export default defineConfig({
  root: __dirname,
  plugins: [tailwindcss()],
  server: { port: 5199 },
});
