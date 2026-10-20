# Card Studio / GLEP — Start here
Updated: 2026-10-19, America/Los_Angeles.

## Current state
The game is playable in production. Older October handoffs saying “lobby only” or “feature branch only” are obsolete.
The user confirmed that they can start and play a match after the Start Game fixes. The subsequent desktop tabletop layout is deployed. The direct Create/Join entry was verified in Safari. Full latest two-device match validation has not been recorded.

- Live: https://fc3p0.github.io/Glep_Card_Studio/
- Repository: https://github.com/Fc3p0/Glep_Card_Studio
- Production branch: main. User authorized production/main work and removed earlier user-imposed branch/PR/staging restrictions.
- Functional desktop layout commit: d50d419525bd00ac0b654752da1470d58bd14dfc.
- Production Supabase: chfzvfyigycpkcsxbscu.
- Development Supabase: tlctsthlndxzwopfpycl.
- Azure DevOps project: https://dev.azure.com/fc3p0/Card%20Studio. A GitHub/Boards connection was previously reported; a separate ADO source mirror is NOT verified. This backup was committed to GitHub.

## v3 site redesign — live since 2026-10-20
Full-site restyle shipped in PR #3 (merge 66f1d93). Visual only: existing scripts and element IDs unchanged; one script appended to index.html (top bar, home Deck strip, collapsing the game headline once players are in a room). The direct Create/Join flow is kept; the lobby entry panel is the "Join a game" box under "The table is ~~locked~~ open." Billy's home-page art is in assets/billy/. Design tokens and rules: design/README.md.
Follow-ups, also live: PR #4 (home Deck strip orders by approval time `reviewed_at`, falling back to `created_at`, and shows the real approved total; the "why are you still here" corner was removed from the game page) and PR #5 (Card Master review: edit fields folded behind an "Edit card" toggle).
Restore point before the redesign: branch snapshot/pre-v3-redesign-2026-10-20 (2eb5cc9). To roll back, revert the merge commits on main, newest first (#5, #4, #3), or restore index.html and beta/online-lobby.html from that branch. Do not delete the snapshot branches.

## How changes ship
- Work on a branch, open a PR into main. GitHub Pages publishes main, so merging = deploying.
- The "Check pages" workflow (tools/check-pages.mjs) syntax-checks every inline script on each PR and push to main; don't merge while it is red.
- Merge with a merge commit (not squash) so one `git revert -m 1 <merge>` undoes a release.
- Delete a branch once its PR is merged; snapshot/* branches are permanent restore points.

## Where the implementation lives
- index.html: Card Studio, Deck, Card Master, feedback, the direct Game entry, and iframe resize messaging.
- beta/online-lobby.html: inline creator-code access, room controls, and responsive game UI. Wide desktop felt table, opponent at top, own hand at bottom, controls on right; phone layout stacks. Card inspection uses a dialog.
- backend/glep-beta-rooms/index.ts: deployed room/game API, production Edge Function v3.
- backend/beta-schema.sql: clean-project beta table/constraint/index/access-control snapshot.
- backend/beta-room-functions.sql: deployed create/join/leave/status/logout/login-rate-limit RPCs.
- backend/beta-game.sql: authoritative game state machine and private match table.
- tests/beta-game.sql: transaction-scoped database integration checks, ending in ROLLBACK.
- backend/glep-publish/index.ts, backend/glep-card-master/index.ts, backend/glep-feedback/index.ts, backend/glep-game-access/index.ts: other production Edge Function source snapshots.

## Authentication and room behavior
Play the Game now opens the Create/Join flow directly. The separate Game lock page has been removed. Creator-code entry and login are inside the room flow; the backend still admits only Billy and Francesca. Do not reintroduce the separate lock screen.
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

## Exact handoff point — 2026-10-19, 20:05 America/Los_Angeles
The user intends to upload a FULL-SITE UI redesign handoff next. Wait for and read that upload before implementing a redesign. The scope is the whole site, not only the Card Editor or game.
Card Editor changes were explicitly discussion-only before this forthcoming handoff. Do not treat earlier proposed editor features or a hybrid editor direction as approved implementation requirements.

Latest completed change: Play the Game opens directly into Create/Join. The separate lock page and Lock button have been removed. Creator-code entry is inline within Create/Join; production API authentication remains unchanged. This was verified in desktop Safari from Home -> Play the Game, showing the inline code field and both room buttons. Code and tests of the new flow passed.

A full-site pre-redesign snapshot was saved:
- Frozen branch: snapshot/pre-ui-redesign-2026-10-19
- Frozen commit: 63b386c2243bf31535a2eff982f0a10749ba1258
- Downloadable archive provided to the user: Card-Studio-Full-Site-Before-Redesign-2026-10-19.zip, containing complete source at that commit, 13 desktop screenshots and rollback notes.
- The visual archive is saved separately from GitHub; Claude needs the user to attach it if it cannot access the user's files. The frozen branch itself contains the full source baseline.
- That baseline predates the latest removal of the separate Game lock page. Current main includes the direct Create/Join flow. Preserve this latest explicitly requested flow during a redesign unless the user changes it.
- Screenshots cover major public pages and login gates, not authenticated administration, authenticated gameplay, all responsive sizes or every UI state.
- Site-specific backend state (current cards, artwork, feedback, credentials, sessions and matches) still lives in production Supabase; source backup is not a full data/storage backup.

Other design discussion, NOT implemented:
User asked about backend rules for individual cards, e.g. “automatically lose unless condition X.”
We discussed structured conditions/actions/timing and explicit exception semantics, with a Game Rules editor under Card Master -> Manage Deck -> Edit Card. User said discuss only. No rule engine or rules editor has been built.

## Verification
- Live API tests passed for concurrent room creation/join capacity, synchronized status, leave/rejoin and logout.
- SQL integration tests passed for guest-started match, private hand/output redaction, duplicate/invalid submissions, shared reveal, stale confirmation rejection, gem scoring, round progression, deck exhaustion and winner.
- UI state checks ran in a simulated DOM for selection, lock-in, Fate controls, reveal, next round, rematch, card inspection and frame resize.
- GitHub Pages publication and presence of the desktop layout/resize code were verified by HTTP after successful deployment.
- Do not call simulated-DOM checks full browser or full two-device validation.
- Existing unrelated Supabase security advisor notices remain outside this change scope.

## Backups and recovery boundaries
Automatic: the "Back up the deck" workflow (tools/backup-deck.mjs) runs every Monday and on demand (Actions tab → Back up the deck → Run workflow). It copies approved cards, the shared gallery list and all their images into the `deck-backup` branch, one commit per change. It uses only the public key, so it covers what the live site shows: pending/denied cards, creator codes, feedback and matches are NOT included; those need Supabase's own backups or a database dump with the service key, stored outside git.
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
