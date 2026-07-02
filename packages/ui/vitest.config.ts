import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Primitive tests render real React components (Button/Field/Spinner/
    // CalyxaMark/VisuallyHidden), so they need a DOM — jsdom, not vitest's
    // default node environment.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
