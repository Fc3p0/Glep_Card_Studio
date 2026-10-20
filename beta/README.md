# Beta 0.2 — Room API (NOT DEPLOYED)

The first prototype remains UI-only until an isolated Supabase development project is provisioned.
No changes must be made to the production Supabase project `chfzvfyigycpkcsxbscu`.

## Deployment requirements
1. Create a *separate* Supabase project for beta. Do not reuse prod.
2. Provision `glep_creator_codes` in that project with *test-only* creator-code hashes for Billy and Francesca. Do not export production hashes/codes.
3. Apply `beta/sql/001_rooms.sql` only to that beta project.
4. Deploy `beta/edge/glep-beta-rooms/index.ts` to the beta project with `GLEP_BETA_ALLOWED_ORIGIN` set to the trusted development preview's exact origin.
5. Configure the preview UI with the beta function endpoint once available; never embed service-role keys in browser JavaScript.
6. Test with two devices, including invalid access, cross-room access, room limits, reload, expired token, and leave/rejoin.

## Security and MVP limitations
- Edge Function validates access on every call with an opaque session token; room state is stored server-side.
- Sessions are restricted to creator name Billy or Francesca by the **beta** creator table. Rate limiting for login and room creation is still required before public exposure.
- RLS blocks browser roles; there are no public table policies.
- Room membership and two-player limit rely on multiple statements and are not fully transactional yet. Before shared testing, change join/create/leave operations to atomic server-side SQL functions or transaction-safe locking to prevent concurrent joins.
- Status uses polling; Realtime will come later.
- No private cards, reveals, scoring, or Fate implementation yet.
- The existing locked Under Development page must continue to be the sole in-app entry point; hiding UI is not sufficient as the backend authorization boundary.
