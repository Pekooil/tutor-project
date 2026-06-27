# Calyxa — Claude Code Working Instructions

## Architecture decisions (locked)
- Manifest V3 only. Never suggest MV2 patterns.
- Overlay uses shadow DOM. Never mutate the host page DOM.
- All API keys are server-side. Never put keys in the extension bundle.
- Audio is never persisted. STT is real-time streaming only.
- Free tier limits are enforced server-side. Client is a hint only.
- RLS policies must exist before any table receives data.

## Stack (locked)
- Extension: WXT + React + TypeScript
- Backend: Next.js API routes on Vercel
- Database: Supabase (Postgres + Auth + RLS)
- AI: Anthropic Claude API (server-side proxy only)
- STT: OpenAI Whisper API
- TTS: ElevenLabs streaming API

## Current phase
Phase 1, Sprint 6

## File structure reference
See /docs/architecture.md

## What is NOT in scope for V1
- Firefox support
- Diagram/video understanding
- B2B / school licensing
- Parent dashboard
- Non-math subjects