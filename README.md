# FatASS Friday

A buildless, responsive tournament website for GitHub Pages. Anyone can view the live board, player records, and match history. Only approved organizers can edit after signing in with an email and password.

The frontend is plain HTML, CSS, and JavaScript. Supabase supplies the shared database and password authentication. No server needs to run on GitHub Pages, and the website has no runtime npm dependencies.

## Optional match notes (v1.5)

Run the updated `supabase/setup.sql` in your existing project, replace the website files, and retain your existing connection settings in `config.js`. This adds a note column and note-editing action while preserving your current tournament and notes on subsequent script runs.

Each match can have one optional **Note / comment** containing any free text you want to keep. There are no predefined game, punishment, or other categories. Enter multiple lines, punctuation, Unicode, or whatever context makes sense (up to 10,000 characters).

- Add a note when recording a new card result or extra match.
- Use **Match history → ⋯ → Add note / Edit note** to add or change one later. Empty the field and save to remove the note.
- Notes appear below the history entry, with line breaks preserved. They are public like the rest of the match history.
- Adding or editing a note does not affect scores, placements, outcomes, or ignored status. Correcting a winner or ignoring/restoring a match preserves its note.
- Notes are literal text, not HTML. CSV exports include them in a Note column.
- A later edit to a historical match's note survives rollback to that match's round. Rolling back past the match itself removes it along with its note, as with all other current-round changes.

## Match-history management (v1.4)

**Upgrade:** run the included `supabase/setup.sql` in your existing project, then replace the website files while retaining your project URL/public key in `config.js`. This adds an `ignored` flag and authorized history actions without resetting existing data. Existing matches remain counted. The script also refreshes the Data API schema cache.

Each history entry has an organizer-only **⋯ menu**:

| Action | Behavior |
| --- | --- |
| Edit result | Choose the corrected winner from the original two players. Reverse the earlier counted win/loss and apply the corrected result. Ignored matches remain ignored. The entry keeps its identity, round, type, and original played time. To fix incorrect participants, delete the entry and record the correct match. |
| Delete match | Permanently remove the entry and reverse its win/loss if it was counted. Deleting an ignored match does not subtract anything again. If it is a current-round card result, reopen that card so it needs another result or a skip. |
| Ignore for records | Keep the match and outcome visible, but remove its contribution to both players' win/loss totals. The match is labeled **Ignored · no W/L**. Its card winner still determines movement. |
| Restore to records | Count an ignored entry again, using its currently recorded winner. Repeating ignore or restore does not double-adjust totals. |

Editing a current-round card winner also updates the bracket's next-round preview. Correcting a completed round changes records, not the active ladder's positions. History corrections update all affected saved checkpoints, so rollback cannot resurrect deleted results or restore stale totals. Deleting a historical card result clears that result if you later roll back to its round; later saved placements are retained rather than recalculated.

Use the **Records** filter to see all, counted, or ignored matches. CSV exports honor that filter and include a **Counts toward record** column. The Matches recorded total includes ignored entries because they remain in history. Original played dates do not change when a result is edited or ignored; an updated marker indicates changes.

## Appearance

Dark mode and the compact bracket remain included. Open the ⋯ menu on a card to edit, delete, skip, restore, or undo its result.

## Round management and a traditional bracket style (v1.3)

The site uses a dark tournament layout with charcoal bracket sheets, compact seeded player rows, thin connectors, and orange accents. Per-card tools are in the ⋯ menu. Win/loss totals remain on Player records and in bracket player hover text; repeated movement labels are removed from the bracket. Current and next-round columns still show where winners, losers, and skipped players go. On phones, scroll the bracket sideways.

### Upgrade an existing installation

1. Run the included `supabase/setup.sql` in your **existing** project's SQL Editor. This update adds private round checkpoints and an editable display number. It preserves existing players, scores, placements, results, matches, and organizer access.
2. Replace the website files, including `core.mjs`, `api.mjs`, `app.mjs`, `bracket.mjs`, `index.html`, `styles.css`, and `favicon.svg`. Retain your existing project URL and public key in `config.js`; keep its title as `FatASS Friday`.
3. Refresh open tabs. Any edit opened before the upgrade may need to be reopened because versions have changed.

You do not need a new project, user account, or public key. Local-demo saves remain compatible.

### Manage round

Organizers have a **Manage round** button beside Add player and Next round:

| Action | Behavior |
| --- | --- |
| Set round number | Change the current displayed round number, including resetting it to 1. Keep all pairings and scores. Current-round match labels change to match; earlier match labels remain. The next round counts upward from this number. |
| Clear this round’s card results | Undo all card results in the current round, reverse those wins/losses, remove those match entries, and clear skips. Keep the current pairings, round number, earlier matches, and all extra matches. |
| Roll back one round | Restore the most recent completed round to its saved state, including subsequent permanent history corrections, including pairings, results, skips, players, and records. Discard **all changes made after that advance**, including current-round matches, newly added players, and pairing edits. Restored results remain recorded; correct or clear them as needed before advancing again. |

Checkpoints start with the first advance made after this update is installed. Earlier rounds cannot be reconstructed automatically. Rollback is disabled until a checkpoint exists. Each rollback consumes the most recent checkpoint, so you can step backward repeatedly through saved rounds. Re-advancing creates a fresh checkpoint.

The displayed count is separate from the internal round sequence. Resetting the count does not collide with earlier matches that have the same displayed number. CSV exports include both the displayed Round and the stable Round sequence for reference. Rollback restores the saved display number as well as positions and records. Database versions keep increasing even during rollback, so older edits are rejected rather than silently applied.

Player records also has an organizer-only **Edit name** action. It corrects a player’s name without changing their identity, position, record, or matches. History displays the corrected name. A rollback will also revert name changes made after its checkpoint.

The database checkpoints are private to organizer operations. Browser-local demo checkpoints stay with that browser's demo save. CSV remains a match-history export, not a full database backup.

## Updating from the first version

1. In your existing Supabase project's SQL Editor, run this updated `supabase/setup.sql` again. It upgrades the action function and adds skip state while keeping your existing players, results, history, and organizer access. Do not create another project or user.
2. Replace the website files in your GitHub repository with this version. In `config.js`, retain your existing project URL and public key, and set `title: 'FatASS Friday'`.
3. Publish the changes and refresh any open browser tabs. An edit started before the database upgrade can be rejected as stale; reopen it after refreshing.

If you were using the local demo, its existing browser save continues to work. Internal database and browser-save identifiers are retained for compatibility.

## New card controls

Organizer controls appear beneath each card:

- **Edit card:** choose active players for its seats. Those players swap places with the current occupants. Any cards whose pairings actually change have their current-round results undone and skips cleared. Only those results are removed and their win/loss counts reversed. Past rounds and extra matches stay intact. A solo card still has one seat; adding a player fills the bottom solo card normally.
- **Delete card:** remove the card and its players from the active ladder. Undo a result recorded for that card in the current round. Lower cards close the gap, and their current-round result numbers are adjusted together. Earlier scores and matches remain; removed players appear as **Off ladder** in Player records. Enter an off-ladder player's existing name in **Add player** to return them at the bottom with their earlier record.
- **Undo result:** clear just this card's current-round result, remove that erroneous match from history, and reverse its win/loss. Both players stay. You can then record another result or skip the card.
- **Skip round:** let the round advance without that match. Both players stay on their card with no score. Their card acts as a boundary: cards above and below advance within separate groups. Winners immediately below a skipped card stay, and losers immediately above it stay. Any current-round result on the skipped card is first undone.
- **Restore card:** cancel a skip before advancing. The pair needs a result again.

A round can advance when every paired card is either resolved or skipped. All paired cards can be skipped if necessary. Skips clear when the next round starts. No match-history entry is created for a skip because no match was played.

## Try the local demo

From this folder, run:

```sh
python3 -m http.server 8080
```

Open http://localhost:8080. On Windows, `py -m http.server 8080` also works. With empty connection settings the app runs in **local demo mode**: anyone using that browser can edit its local sample tournament. Data persists in that browser only, and never touches the public database. The banner makes the distinction explicit. Do not open index.html with a file:// URL; JavaScript modules need HTTP.

Add names in the initial order you want: the first two occupy Card 1, the next two Card 2, and so on. The app intentionally starts empty rather than inventing players or records.

## Set up the shared public tournament

1. Create a new project at https://supabase.com/dashboard. Keep its database password private; this app does not need it.
2. In the project's SQL Editor, run the entire `supabase/setup.sql` file. This creates an empty board, match history, public read policies, and the protected organizer actions.
3. In **Authentication → Users**, create an organizer with an email address and password. Create the user directly in the dashboard, mark/auto-confirm its email, and copy its user UUID. No sign-up form is provided on the website.
4. Run this separate SQL statement, replacing the placeholder with the actual UUID from step 3:

   ```sql
   insert into ladder_private.editors(user_id)
   values ('YOUR-ORGANIZER-USER-UUID'::uuid)
   on conflict do nothing;
   ```

5. In Authentication settings, disable new user sign-ups if you only want dashboard-created accounts. Even if sign-ups are enabled, new accounts have **no editing rights** until their UUID is explicitly added to the organizer table.
6. Find the **Project URL** and **publishable key** in the project connection/API settings. A legacy **anon** key is also supported. Edit `config.js`:

   ```js
   window.LADDER_CONFIG = {
     title: 'FatASS Friday',
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabasePublishableKey: 'YOUR-PUBLIC-PUBLISHABLE-KEY',
   };
   ```

   These two connection values are meant to be public. **Never use a secret key, service_role key, database password, or organizer password in any committed file.** Access is enforced by the database and authenticated organizer UUID, not by hiding buttons.
7. Reload the website. The local demo banner should disappear. Click **Organizer login** and enter the account email and password. Add your real players.
8. In a private/incognito window, verify that you can read the tournament without logging in and cannot edit it. Changes made by the organizer appear for viewers within approximately 15 seconds while the tab is visible. Viewer reads do not require an account.

Supabase Auth supports password login, and the database grants protect reads and organizer-only mutations. References: [password authentication](https://supabase.com/docs/guides/auth/passwords), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [public API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## Host on GitHub Pages

1. Extract this folder and put its **contents** at the root of your GitHub repository. `index.html`, `config.js`, `app.mjs`, `api.mjs`, `core.mjs`, `bracket.mjs`, `styles.css`, `favicon.svg`, and `.nojekyll` must be at that root. Keep the other supplied source and setup files in the repository too.
2. Commit and push.
3. In your repository's **Settings → Pages**, deploy from your default branch and the `/ (root)` folder.
4. Open the Pages URL GitHub provides. Relative asset paths support both `username.github.io` and `username.github.io/repository-name/`.

No build step, GitHub Actions workflow, Node server, or npm install is needed for hosting. Login does not redirect away from the website, so no OAuth callback configuration is needed. If your Supabase project is paused or unavailable, restore it in its dashboard before using the shared tournament.

## Tournament behavior

- Each card contains two players, except a possible solo card at the bottom.
- Selecting a winner immediately adds a win to that player, a loss to the opponent, and one history entry. Card positions remain fixed until the round advances.
- Select the other player on that same card to correct the current round's result. The earlier win/loss is reversed and the same history entry is updated, rather than adding another match. The history displays a correction marker. To adjust the most recent completed round, use Manage round → Roll back one round when a checkpoint exists.
- Once all paired cards have results or are skipped, **Next round** moves everyone simultaneously: winners go up one card and losers go down one card. The top winner and bottom loser stay. If there is only one paired card, both stay on it.
- A solo player receives a bye, moves one card up next round if that does not cross a skipped card, and receives no win or loss. A lone player at the top stays. You cannot advance a tournament with fewer than two players.
- New players append to the bottom without reordering anyone. A solo bottom card fills first; otherwise a new solo bottom card opens. They can join midround: newly created pairs must also finish or be skipped before that round advances.
- **Record extra match** lets you choose any two different players and then choose who won. It changes their records and appends history, without affecting card positions or completing a card match.
- Player records follow ladder order, not win percentage. Off-ladder players appear after active players. Both players on a card have the same card tier; their display order within it is not an additional rank.
- History has player/type filters and pages of 50 matches. CSV export includes all matches matching the selected filters, not just the visible page. Match times display in the viewer's local timezone; the database stores timestamps with time zones.
- Nobody is automatically eliminated and no season resets automatically. Intentional card deletion takes players off the ladder while retaining their earlier records. Undoing, skipping, editing, or deleting a current-round card removes any result being invalidated and reverses its score.

For example, if three cards start as `[A,B] [C,D] [E,F]` and A, C, E win, the next round is `[A,C] [B,E] [D,F]`.

## Access and reliability

The public board contains player names, placements, and win/loss totals. Public history contains player IDs, outcomes, rounds, card numbers, and timestamps. Use names that participants are comfortable publishing. Passwords and the organizer allowlist are not publicly readable.

Every edit is verified and calculated in a database transaction. The board row is locked while changing it, stale versions are rejected, and request IDs prevent replaying an identical successful request. Two organizers cannot silently overwrite each other. After a conflict, refresh, review the board, and try again. If a request times out, refresh and check history before recording it again: the server may have received it.

Organizer login tokens are stored in sessionStorage for the current tab and refreshed while that session is used. Closing the tab ends the persisted browser session; logging out revokes its refresh token. Nothing stores the password. Additional organizers can be created and allowlisted using the same procedure. Remove an organizer using:

```sql
delete from ladder_private.editors
where user_id = 'ORGANIZER-UUID'::uuid;
```

Use the Supabase dashboard to manage passwords and back up the database. CSV is a readable match-history export, not a full database restore file. Demo data does not migrate automatically into the shared tournament. Public boards poll rather than using a persistent realtime connection. The board stores current players in a single JSON row; match history is stored separately and paginated. For very large leagues with thousands of simultaneous players, split current player records into normalized tables.

## Source layout

| File | Purpose |
| --- | --- |
| `index.html` | Accessible page structure, views, and modal shell |
| `styles.css` | Dark tournament layout with compact match rows and orange accents |
| `config.js` | Tournament title and public Supabase connection settings |
| `app.mjs` | Rendering, forms, filters, history export, and polling |
| `api.mjs` | REST requests, organizer authentication, and local demo persistence |
| `bracket.mjs` | Next-round seats and outcome sources for the bracket preview |
| `core.mjs` | Pure tournament logic used in the demo and unit tests |
| `supabase/setup.sql` | Authoritative shared rules, persistence, and access control |
| `tests/ladder.test.mjs` | Movement, scoring, corrections, skips, editing, deletion, and conservation tests |
| `tests/bracket.test.mjs` | Preview seat accuracy, source routes, and skipped boundaries |
| `tests/notes.test.mjs` | Optional free text, editing/clearing, score independence, and rollback preservation |
| `tests/history.test.mjs` | History editing, deletion, ignore/restore, totals, and checkpoint consistency |
| `tests/round.test.mjs` | Counter resets, round clearing, rollback, and history consistency |
| `tests/database-check.mjs` | PostgreSQL execution, access checks, and demo/server parity tests |

## Development checks

Run the dependency-free tournament tests with Node.js 22 or newer:

```sh
npm test
```

The optional database check uses PGlite (PostgreSQL compiled to WebAssembly). It stubs Supabase's `auth.uid()` and roles locally; it does not contact or modify a Supabase project:

```sh
npm install --save-dev @electric-sql/pglite@0.5.10
npm run test:database
```

Before going live, verify the deployed connection and organizer login against your actual project. Local database tests do not verify Supabase's hosted gateway, live credentials, or GitHub Pages hosting.
# FatassFriday
