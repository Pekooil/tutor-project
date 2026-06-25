// TEMPORARY Sprint-01 scaffold placeholder.
// WXT refuses to build with zero entry points, so this popup exists only so
// the Task 2 acceptance gate (`wxt build` exits 0) can pass. It is NOT a real
// feature — remove or replace it once real entry points land (Tasks 4–5 add
// the background and content scripts; the overlay UI comes in Sprint 02).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <h1>MathMentor</h1>;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
