# Pre-release audit — what has to be true before strangers use this

Five read-only audits of the whole app, October 2026, one per area. Everything below was read in
the code, and the worst findings were checked a second time by hand. Ticked items are fixed; the
rest are the worklist, worst first.

The good news first, so the list below is read in proportion: **nothing of the author's own setup
ships** — no Steam id, no user name, no personal paths, no personal mods (one leftover, P12, was
removed in 4873543). There is no telemetry, no analytics, no update check, and every network call
is one the user asked for. The mod-list writer, the path safety in the patch generator, the merge
engine and the health rules are genuinely solid and should not be regressed.

## Critical — it lies to the player, or it destroys their work

| | What | Where |
|---|---|---|
| ☐ | **Kick, Ban, Godmode and Broadcast do nothing and report success.** They write a JSON file no server reads: there is no RCON anywhere. Worse, the one consumer is the *client* bridge, whose kick branch quits the local game — a host who kicks someone can close their own game. | `server_manager/mod.rs:966-1003`, `ServerModule.tsx:250,857,871,1068` |
| ☐ | **"Make Admin" invents a role.** It writes the role to a local file and reads it back as truth, so the app shows an ADMIN badge for a player who was never promoted. | `server_manager/mod.rs:977-1000`, `:914-934` |
| ☐ | **The invite link sends friends to their own PC** (`steam://connect/127.0.0.1`). | `ServerModule.tsx:337` |
| ☐ | **Creating a profile before the game is found switches off every mod.** The Profiles tab is the first screen, is not gated on valid paths, and creating a profile with an empty list writes an empty `default.txt` into the real Zomboid folder — with a success message. Recoverable only from `PZModStudio_Backups`, which nothing mentions. | `InstanceModule.tsx:48-76`, `instance_manager/mod.rs:128-136` |
| ☐ | **Publishing a merge package silently unpublishes every other one.** Only one package can ever be active, while the UI sells multi-package. | `patch_generator/mod.rs:389-390` |
| ☐ | **The "visible in mod list" eye scrambles the whole load order**, because the active list is round-tripped through a `HashSet`. Enabling also writes nothing while reporting success. | `patch_generator/mod.rs:996-1019`, `:974-992` |
| ☐ | **Draft resolutions are shared between packages.** The draft map is keyed by file path only, across every package folder, so opening B can show A's merges and publish them as B's. | `vfs/mod.rs:436-456` |
| ☐ | **"1-Click Repair" on a crash card replaces the user's active package** with `Z_PZModStudio_MergedPatch`, possibly empty, and rewrites the mod list — without fixing the error. | `App.tsx:440-457`, `patch_generator/mod.rs:231-233,389-391` |
| ☐ | **A mod that runs arbitrary Lua is installed without asking**, on every mod scan. It is not auto-enabled, which is the only thing keeping it safe, and in single player its command queue has no gate at all. | `mod_info.rs:726-733`, `PZModStudio_Bridge.lua:145-169` |
| ☐ | **Launching rewrites the player's `options.ini`** in every candidate folder, forces `borderless=false`, and keeps no backup. | `sandbox/mod.rs:65-97` |
| ☐ | **The 13 polyfill switches, their counter and the import button do nothing.** The same 2075-line shim is written whether none or all are ticked, and the setting is not even remembered across restarts. | `patch_generator/mod.rs:268` vs `:270`, `SettingsModule.tsx:534-562` |
| ☐ | **Spanish strings in the English UI.** | `ServerModule.tsx:307,308,314` |
| ☐ | **The MCP tool list is mis-nested** — two group wrappers open one level too deep and a stray `</div>` papers over it, which is why those boxes look uneven. | `SettingsModule.tsx:893,930,1008` |

## Important

| | What | Where |
|---|---|---|
| ☐ | Closing the Studio force-kills a running dedicated server, with no save first. | `lib.rs:592-596`, `server_manager/mod.rs:464` |
| ☐ | Activating a profile permanently drops mods that are not installed right now, so profiles cannot travel between machines. | `App.tsx:417-435`, `instance_manager/mod.rs:186-191` |
| ☐ | Profiles cannot be exported or shared at all; presets live in `localStorage` and their export leaks the author's whole library as bare ids. | `LoadOrderModule.tsx:265,331` |
| ☐ | A published package shows as *disabled* in the Mod List straight afterwards, and the next toggle removes it. | `patch_generator/mod.rs` (no master-order update), `mod_info.rs:955-962` |
| ☐ | `.pzmerge` sharing has no compatibility check: no mod versions, no warning when the recipient lacks the mods, and a draft exports as an empty mod. | `patch_generator/mod.rs:1224-1293,1349` |
| ☐ | Unsaved merge edits are discarded without a prompt by four ordinary navigations; "Unmerge All" deletes every manual merge with no backup. | `MergerModule.tsx:704-708,253,273-277,304-316` |
| ☐ | Mod Health's bulk fix reorders and enables mods with no preview and no undo; `disable_mod` has no confirmation; the commonest error (`missing_mod`) has a fix button that never appears. | `HealthModule.tsx:28,173-184,359` |
| ☐ | "Merge automatically" can create and activate a different package than the one the user is working in. | `vfs/mod.rs:131-171` |
| ☐ | The Monitor's live log only works when the game was launched from the Studio, shows nothing and says nothing otherwise, and leaks one watcher thread per launch click. | `sandbox/mod.rs:171-219`, `lib.rs:294-300` |
| ☐ | Crash diagnostics name specific third-party mods with invented line numbers, and offer a repair button for errors they did not diagnose. | `sandbox/mod.rs:226-351` |
| ☐ | Server port, RCON port and map are editable, reported as saved, and never written for configs the app created; the port never reaches the server process. | `server_manager/mod.rs:1118-1124,322-334` |
| ☐ | The server admin password is kept in plain `localStorage`, though the app has a credential store. | `ServerModule.tsx:58-67` |
| ☐ | A saved Steam key cannot be seen or removed from the UI any more — both commands exist and nothing calls them. | `tauri.ts:327,336` |
| ☐ | Failures reach the player as raw Rust text, through 30 `alert()` calls and the toast; startup failures are swallowed entirely. | `InstanceModule.tsx:74`, `App.tsx:117-123` |
| ☐ | Deleting the active profile leaves the header and sidebar showing it until restart. | `instance_manager/mod.rs:202` |
| ☐ | Two animation conventions are used 20 times and neither exists (no Tailwind config, no plugin), so every modal pops in hard. | `animate-fade-in`, `animate-in` across `src/` |
| ☐ | `user-select: none` on everything: a player cannot copy an error message or a path to ask for help. | `index.css:24` |
| ☐ | Hardcoded dependency guesses for popular mods, including "any id containing *tsar* requires Tsarslib", invent missing-dependency errors on other people's libraries. | `mod_info.rs:323-365` |
| ☐ | Auto-detect never looks in `Documents/Zomboid`, which OneDrive redirection makes common. | `vfs/mod.rs:274` |

## Polish

- Wrong counts everywhere: "22 Tools" (there are 34) in four places, "~11 MB" (it is 17.8).
- Three dead components (589 lines), `mock_data.ts` and its props, `topological_sort.rs` and its
  command, `ensure_master_patch_exists_on_disk`, `clsx`, `tailwind-merge`, `src/App.css` (a
  light-theme template with a global `outline: none`).
- "Mod Configuration **File**" opens a folder picker; "Valid Path" is a non-empty-string check;
  "Settings saved and validated" shows even when validation failed.
- Three user-visible strings name `ModListData.ini`, which the app never writes.
- The copied MCP config contains a placeholder path that cannot work, though the app knows its own.
- `py-0.2` (15 places) resolves to 0.05 rem; `text-[9px]` is used for real information; Settings is
  double-padded and double-scrolled; 11 card backgrounds and 6 radii for the same roles.
- Icon-only buttons with no accessible name; `focus:ring-0` on the only focusable controls in
  Settings; jargon (VFS, AST, polyfill, topological, matrix) in player-facing copy.
- A forced ten-second splash on every start.
- Every generated mod's poster comes from a file called `111.png`, read relative to the working
  directory, and carries the Studio's repo URL in its `mod.info`.
