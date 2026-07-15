import { randomBytes } from 'crypto'

// 128 bits, URL-safe. Unguessable so the code can gate a signup on its own
// (a partial unique index on waitlist.invite_code guarantees no two rows
// collide). Shared by POST /api/admin/invite and POST /api/waitlist.
export function generateInviteCode(): string {
  return randomBytes(16).toString('base64url')
}
