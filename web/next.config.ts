import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // COMPATIBILITY WITH ALREADY-INSTALLED EXTENSIONS (2026-07-25).
      //
      // The two-workflow onboarding cleanup deleted /welcome and replaced it
      // with /install. But the extension version published to the Chrome Web
      // Store (0.1.2) still opens `calyxa.app/welcome?src=extension` — that
      // build is on every existing user's machine and is what a NEW installer
      // gets until a fresh version is submitted, reviewed, and auto-updated.
      // Without this redirect, deploying the web app 404s the first thing every
      // one of those users sees.
      //
      // Keep it until CWS telemetry shows no meaningful traffic on /welcome —
      // it costs nothing and the old URL will keep arriving for as long as any
      // un-updated install exists. `permanent: false` (307) deliberately: this
      // is a compatibility shim, not a promise about the URL's future, and a
      // 308 would be cached in users' browsers indefinitely.
      { source: '/welcome', destination: '/install', permanent: false },
    ]
  },
}

export default nextConfig
