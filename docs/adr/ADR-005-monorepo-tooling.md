## ADR-005: Monorepo tooling — Turborepo + npm workspaces

**Status:** Decided

**Context:** MathMentor spans several units that share TypeScript config and
types: the extension, a Next.js web app, and shared packages
(`ai`, `learning`, `auth`, `types`, `utils`). They need consistent package
linking and a cached, dependency-aware build/lint/typecheck pipeline. We had
to choose a monorepo manager.

**Decision:** Use npm workspaces for package linking and Turborepo for the
task pipeline (`build`, `lint`, `typecheck`).

**Rationale:**
- npm workspaces ship with the toolchain already in use — no additional
  package manager to standardise on.
- Turborepo adds incremental, cached task running and topological ordering
  (`^build`) across workspaces with minimal configuration.
- Keeps the repo root as the single source of the shared `tsconfig`, ESLint,
  and Prettier config that every workspace extends.

**Consequences:**
- Enables: one command (`turbo run <task>`) across all current and future
  workspaces, plus shared config inheritance from the root.
- Forecloses: no Nx / Lerna / pnpm-specific features are assumed.
- The workspace list (`extension`, `web`, `packages/*`) is declared up front
  even though some directories arrive in later sprints; non-matching globs
  resolve cleanly so `npm install` succeeds from day one.
