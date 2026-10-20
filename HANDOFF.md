# Card Studio / GLEP — Start here
Updated: 2026-10-19, America/Los_Angeles.

## Current state
The game is playable in production. Older October handoffs saying “lobby only” or “feature branch only” are obsolete.
The user confirmed that they can start and play a match after the Start Game fixes. The subsequent desktop tabletop layout is deployed; full visual/two-device testing of that latest layout has not been recorded.

- Live: https://fc3p0.github.io/Glep_Card_Studio/
- Repository: https://github.com/Fc3p0/Glep_Card_Studio
- Production branch: main. User authorized production/main work and removed earlier user-imposed branch/PR/staging restrictions.
- Functional desktop layout commit: d50d419525bd00ac0b654752da1470d58bd14dfc.
- Production Supabase: chfzvfyigycpkcsxbscu.
- Development Supabase: tlctsthlndxzwopfpycl.
- Azure DevOps project: https://dev.azure.com/fc3p0/Card%20Studio. A GitHub/Boards connection was previously reported; a separate ADO source mirror is NOT verified. This backup was committed to GitHub.

## Where the implementation lives
- index.html: Card Studio, Deck, Card Master, feedback, the creator-code Game gate, and iframe session/resize messaging.
- beta/online-lobby.html: room controls and responsive game UI. Wide desktop felt table, opponent at top, own hand at bottom, controls on right; phone layout stacks. Card inspection uses a dialog.
- backend/glep-beta-rooms/index.ts: deployed room/game API, production Edge Function v3.
- backend/beta-schema.sql: clean-project beta table/constraint/index/access-control snapshot.
- backend/beta-room-functions.sql: deployed create/join/leave/status/logout/login-rate-limit RPCs.
- backend/beta-game.sql: authoritative game state machine and private match table.
- tests/beta-game.sql: transaction-scoped database integration checks, ending in ROLLBACK.
- backend/glep-publish/index.ts, backend/glep-card-master/index.ts, backend/glep-feedback/index.ts, backend/glep-game-access/index.ts: other production Edge Function source snapshots.

## Authentication and room behavior
Keep the existing creator-code gate. Only Billy and Francesca are admitted to Game login.
Each API action validates an opaque bearer session; a hidden page or Origin check is not authentication.
Existing creator-code hashes stay server-side. Do not request or commit plaintext codes, session tokens, credential hashes, or service-role keys.
The room/game API has verify_jwt=false because it implements its own opaque-session authentication.
Game login uses production glep-beta-rooms; glep-game-access is older source retained for reference.
Rooms support two sessions, create/join/leave/status/logout, polling, atomic room creation and joining, expired-room recovery, and token revocation on logout.
Either authenticated room participant may start when both are connected; starting an already active match is rejected.
Reloading does not currently restore the previous in-memory beta token automatically. Old sessions can occupy rooms until leave/logout/expiry; reconnect behavior remains an improvement area.

## Implemented game flow
- Uses an immutable per-match snapshot of currently approved cards; database card IDs distinguish duplicate/local source IDs.
- Two attacks plus two modifiers per initial private hand.
- Players submit one attack and one modifier; selections remain hidden until both submit.
- Server rolls d6 gem prize, sums base damage/stars, resolves shared reveal.
- 10+ stars permits an optional blind Fate draw. Initial damage ties trigger Fate draws while cards remain.
- Printed effects are NOT interpreted automatically. Both players can review revealed cards and apply their own damage/gem adjustments, then both confirm.
- Adjustments invalidate both confirmations; confirmation checks the current revision to prevent scoring unseen changes.
- Highest adjusted damage wins the prize. Remaining ties carry unclaimed prize into the next round (explicit beta convention).
- Both signal readiness for next round; cards refill while draw piles remain.
- Match ends at selected gem target or when a player lacks an attack/modifier; scores determine winner or draw.
- Fate text and nonnumeric effects still require agreement/manual resolution; complex swaps/discards are not yet fully encoded.

## Most recent requested direction — DISCUSSION ONLY
User asked about backend rules for individual cards, e.g. “automatically lose unless condition X.”
We discussed adding structured conditions/actions/timing and explicit exception semantics, with a Game Rules editor under Card Master -> Manage Deck -> Edit Card.
User explicitly said to discuss, not implement. No card rule engine/editor has been built.
Next conversation should continue from that design discussion unless user gives a new task.

## Verification
- Live API tests passed for concurrent room creation/join capacity, synchronized status, leave/rejoin and logout.
- SQL integration tests passed for guest-started match, private hand/output redaction, duplicate/invalid submissions, shared reveal, stale confirmation rejection, gem scoring, round progression, deck exhaustion and winner.
- UI state checks ran in a simulated DOM for selection, lock-in, Fate controls, reveal, next round, rematch, card inspection and frame resize.
- GitHub Pages publication and presence of the desktop layout/resize code were verified by HTTP after successful deployment.
- Do not call simulated-DOM checks full browser or full two-device validation.
- Existing unrelated Supabase security advisor notices remain outside this change scope.

## Backups and recovery boundaries
This repository preserves source, tests and beta schema definitions. It is NOT a complete current database/storage backup.
The older backups/approved-cards-pre-stat-images-2026-10-17.json is historical and must not replace current approved cards.
Approved card records, creator credentials, uploaded artwork, feedback, live sessions and saved matches remain in Supabase; they are not exported by this code backup.
Keep production data and original artwork intact. Do not treat the backup SQL as a production reset script.

For a clean beta restore:
1. Provision base Card Studio schema (including existing glep_cards and glep_creator_codes); this repository does not yet contain a full non-beta database bootstrap.
2. Apply backend/beta-schema.sql in a clean project, then backend/beta-room-functions.sql, then backend/beta-game.sql.
3. Restore required approved card/artwork data and provision creator access securely outside git.
4. Deploy Edge Functions with their existing authentication behavior. Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; beta optionally uses GLEP_BETA_ALLOWED_ORIGIN.
5. Update frontend API references deliberately for the new project, host the frontend, and validate the complete login/room/match flow.
6. Run tests/beta-game.sql only with suitable test data/environment; it asserts at least four approved attacks and four approved modifiers and rolls back its fixtures.
A clean restore has not been executed; documentation is an inventory/runbook, not proof of recovery.
