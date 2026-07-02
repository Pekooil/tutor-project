import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Explicit, not relying on @testing-library/react's global-afterEach
// auto-detection (which needs `test.globals: true`) — each render() in a
// primitive test must start from an empty document, or a later test's
// getByRole/querySelector can match a still-mounted element from an earlier
// one in the same file.
afterEach(() => {
  cleanup();
});
