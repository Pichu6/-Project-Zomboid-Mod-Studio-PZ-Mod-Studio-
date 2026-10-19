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
| ✅ | **Kick, Ban, Godmode and Broadcast do nothing and report success.** They write a JSON file no server reads: there is no RCON anywhere. Worse, the one consumer is the *client* bridge, whose kick branch quits the local game — a host who kicks someone can close their own game. | `server_manager/mod.rs:966-1003`, `ServerModule.tsx:250,857,871,1068` |
| ✅ | **"Make Admin" invents a role.** It writes the role to a local file and reads it back as truth, so the app shows an ADMIN badge for a player who was never promoted. | `server_manager/mod.rs:977-1000`, `:914-934` |
| ✅ | **The invite link sends friends to their own PC** (`steam://connect/127.0.0.1`). | `ServerModule.tsx:337` |
| ✅ | **Creating a profile before the game is found switches off every mod.** The Profiles tab is the first screen, is not gated on valid paths, and creating a profile with an empty list writes an empty `default.txt` into the real Zomboid folder — with a success message. Recoverable only from `PZModStudio_Backups`, which nothing mentions. | `InstanceModule.tsx:48-76`, `instance_manager/mod.rs:128-136` |
| ✅ | **Publishing a merge package silently unpublishes every other one.** Only one package can ever be active, while the UI sells multi-package. | `patch_generator/mod.rs:389-390` |
| ✅ | **The "visible in mod list" eye scrambles the whole load order**, because the active list is round-tripped through a `HashSet`. Enabling also writes nothing while reporting success. | `patch_generator/mod.rs:996-1019`, `:974-992` |
| ✅ | **Draft resolutions are shared between packages.** The draft map is keyed by file path only, across every package folder, so opening B can show A's merges and publish them as B's. | `vfs/mod.rs:436-456` |
| ✅ | **"1-Click Repair" on a crash card replaces the user's active package** with `Z_PZModStudio_MergedPatch`, possibly empty, and rewrites the mod list — without fixing the error. | `App.tsx:440-457`, `patch_generator/mod.rs:231-233,389-391` |
| ✅ | **A mod that runs arbitrary Lua is installed without asking**, on every mod scan. It is not auto-enabled, which is the only thing keeping it safe, and in single player its command queue has no gate at all. | `mod_info.rs:726-733`, `PZModStudio_Bridge.lua:145-169` |
| ✅ | **Launching rewrites the player's `options.ini`** in every candidate folder, forces `borderless=false`, and keeps no backup. | `sandbox/mod.rs:65-97` |
| ✅ | **The 13 polyfill switches, their counter and the import button do nothing.** The same 2075-line shim is written whether none or all are ticked, and the setting is not even remembered across restarts. | `patch_generator/mod.rs:268` vs `:270`, `SettingsModule.tsx:534-562` |
| ✅ | **Spanish strings in the English UI.** | `ServerModule.tsx:307,308,314` |
| ✅ | **The MCP tool list is mis-nested** — two group wrappers open one level too deep and a stray `</div>` papers over it, which is why those boxes look uneven. | `SettingsModule.tsx:893,930,1008` |

## Important

| | What | Where |
|---|---|---|
| ✅ | Closing the Studio force-kills a running dedicated server, with no save first. | `lib.rs:592-596`, `server_manager/mod.rs:464` |
| ✅ | Activating a profile permanently drops mods that are not installed right now, so profiles cannot travel between machines. | `App.tsx:417-435`, `instance_manager/mod.rs:186-191` |
| ✅ | Profiles cannot be exported or shared at all; presets live in `localStorage` and their export leaks the author's whole library as bare ids. | `LoadOrderModule.tsx:265,331` |
| ✅ | A published package shows as *disabled* in the Mod List straight afterwards, and the next toggle removes it. | `patch_generator/mod.rs` (no master-order update), `mod_info.rs:955-962` |
| ✅ | `.pzmerge` sharing has no compatibility check: no mod versions, no warning when the recipient lacks the mods, and a draft exports as an empty mod. | `patch_generator/mod.rs:1224-1293,1349` |
| ✅ | Unsaved merge edits are discarded without a prompt by four ordinary navigations; "Unmerge All" deletes every manual merge with no backup. | `MergerModule.tsx:704-708,253,273-277,304-316` |
| ✅ | Mod Health's bulk fix reorders and enables mods with no preview and no undo; `disable_mod` has no confirmation; the commonest error (`missing_mod`) has a fix button that never appears. | `HealthModule.tsx:28,173-184,359` |
| ✅ | "Merge automatically" can create and activate a different package than the one the user is working in. | `vfs/mod.rs:131-171` |
| ✅ | The Monitor's live log only works when the game was launched from the Studio, shows nothing and says nothing otherwise, and leaks one watcher thread per launch click. | `sandbox/mod.rs:171-219`, `lib.rs:294-300` |
| ✅ | Crash diagnostics name specific third-party mods with invented line numbers, and offer a repair button for errors they did not diagnose. | `sandbox/mod.rs:226-351` |
| ✅ | Server port, RCON port and map are editable, reported as saved, and never written for configs the app created; the port never reaches the server process. | `server_manager/mod.rs:1118-1124,322-334` |
| ✅ | The server admin password is kept in plain `localStorage`, though the app has a credential store. | `ServerModule.tsx:58-67` |
| ✅ | A saved Steam key cannot be seen or removed from the UI any more — both commands exist and nothing calls them. | `tauri.ts:327,336` |
| ✅ | Failures reach the player as raw Rust text, through 30 `alert()` calls and the toast; startup failures are swallowed entirely. | `InstanceModule.tsx:74`, `App.tsx:117-123` |
| ✅ | Deleting the active profile leaves the header and sidebar showing it until restart. | `instance_manager/mod.rs:202` |
| ✅ | Two animation conventions are used 20 times and neither exists (no Tailwind config, no plugin), so every modal pops in hard. | `animate-fade-in`, `animate-in` across `src/` |
| ✅ | `user-select: none` on everything: a player cannot copy an error message or a path to ask for help. | `index.css:24` |
| ✅ | Hardcoded dependency guesses for popular mods, including "any id containing *tsar* requires Tsarslib", invent missing-dependency errors on other people's libraries. | `mod_info.rs:323-365` |
| ✅ | Auto-detect never looks in `Documents/Zomboid`, which OneDrive redirection makes common. | `vfs/mod.rs:274` |

## Polish

All done. For the record, what it covered:

- ✅ Wrong counts: "22 Tools" where there are 34, "~11 MB" where it is 17.5.
- ✅ Three dead components, `mock_data.ts`, `topological_sort.rs` and three uncalled commands,
  `ensure_master_patch_exists_on_disk`, `clsx`, `tailwind-merge`, and `src/App.css` — a leftover
  light-theme template carrying a global `outline: none`.
- ✅ "Mod Configuration File" opened a folder picker; "Valid Path" was a non-empty-string check;
  "Settings saved and validated" appeared even when validation had failed.
- ✅ Three user-visible strings named `ModListData.ini`, a file the app never writes.
- ✅ The copied MCP config had a placeholder path; it now carries this Studio's own.
- ✅ `py-0.2` in 15 places (Tailwind reads it as 0.05rem), `py-0.8`, and `text-[9px]` on mod ids
  and statuses — 21 of them, now 10px.
- ✅ Settings was padded and scrolled twice, and capped narrower than every other screen.
- ✅ Icon-only buttons with no accessible name, and `focus:ring-0` on the only focusable controls
  in Settings, which now have a visible focus ring.
- ✅ Jargon in player-facing copy: VFS, AST, Kahlua, topological, matrix, and the bracketed
  subsystem tags on the splash.
- ✅ The ten-second splash, now under three.
- ✅ Every generated mod's poster came from `111.png`, read from the working directory, so a
  stray file of that name became the poster. It is `assets/package-poster.png`, compiled in.

Still true and deliberate: generated packages carry the Studio's repo URL in their `mod.info`,
and the card background and radius drift (11 shades, 6 radii) is cosmetic and widespread enough
that it wants one pass with a shared set of classes rather than scattered edits.

---

# Second full review — 2026-10-19

Eight read-only reviews in parallel, one per area (profiles and Studio Link, Mod List and
Health, Browse, Merger, Monitor/Developer/bisect, Servers, Settings/MCP/companion mods, and a
cross-cutting security pass). Every finding was checked again in the code before it was fixed or
listed. Tests added beside the fixes; `cargo test --lib`, `tsc` and `vitest` green.

## Fixed

| | What | Where |
|---|---|---|
| ✅ | **Stored XSS with full backend access.** i18next runs with `escapeValue: false` and ~37 `dangerouslySetInnerHTML` translations put mod names (mod.info), Workshop collection titles, Nexus names and fields of imported `.pzpack`/`.pzmerge` into HTML; with `csp: null` a mod named `<img onerror=…>` could call any Tauri command. Every such translation goes through `tHtml`, which escapes the values; a CSP is set (`script-src 'self'`) | `src/i18n/html.ts`, `tauri.conf.json` |
| ✅ | **"Open in VS Code" ran commands from a mod's file name** (`cmd /C code --goto <path>`: `&` in a Workshop file name is cmd syntax). VS Code's own executable is started directly; without it the file opens in its own program | `devtools.rs` |
| ✅ | `save_text_file_cmd` wrote anything anywhere; it only writes `.md`/`.txt`. `read_log_file_cmd` only reads `.txt`/`.log` | `lib.rs` |
| ✅ | **Publishing deleted whatever a package's `patch_metadata.json` listed**, `..` and absolute paths included, and an archive could install a folder named `Z_PZModStudio_*` carrying one. The list goes through `safe_join`; installs refuse that prefix | `publish.rs`, `mod_install/mod.rs` |
| ✅ | **Importing a `.pzmerge` overwrote a package of the same name** (drafts, metadata, `mod.info`). It goes in beside it (`_2`, `_3`…); `mod.info` and the Studio's own files are refused as merged paths | `transfer.rs` |
| ✅ | **The Mod List ignored `default.txt`** once the Studio had saved a list: changes made in the game's Mods screen, an Earlier list restored, a bisect trial were shown as not there and undone at the next save. The scan now takes what the game reads when it differs and updates the profile / saved order; ids match exactly first, a looser match only when it names one mod | `load_order/mod_info.rs` |
| ✅ | **Stale profile copies overwrote newer changes** (Remove from profile, Add to profile, a package made in the Merger, renaming a profile): each edit starts from the profile on disk | `utils/profiles.ts` |
| ✅ | A failed activation left the files on the new profile and the screen on the old one; the game's list is written first. Deleting the active profile left the game's Mods screen locked to it; the link file goes, the profile JSON is kept in `PZModStudio_Backups/profiles` | `instance_manager` |
| ✅ | Profile, list, rule, bisect and launch-file JSON written in place (a crash left an empty file that read as "no profile"); written through temp + rename; an unreadable lists/rules file is kept aside before it is replaced | `ini_parser::atomic_write` |
| ✅ | The `default.txt` watcher, the MCP server and the zbNative edit used auto-detected folders, not the ones chosen in Settings; the chosen paths are saved for them (`%APPDATA%/PZModStudio/paths.json`) | `vfs::studio_paths` |
| ✅ | Developer "launch with only this mod" started the game with the full list (stale render), and a closed Studio forgot the list it set aside; the list is passed in and kept in localStorage until it is put back | `App.tsx` |
| ✅ | Bisect replaced `default.txt` before saving the session that knows how to put it back; Studio Link could be named the culprit | `bisect/mod.rs` |
| ✅ | Merger: create / import / rename did not tell the scan which package was open, so its merges were shown and published into another one; renaming kept the old id in `42/mod.info` (B42 stopped loading it) and could land on another package; creating an existing name reset it; "Unmerge this file" published the vanilla file; failed writes reported "published"; two different deletions of overlapping lines counted as the same edit | `MergerModule.tsx`, `packages.rs`, `drafts.rs`, `publish.rs`, `diff_engine/lua.rs` |
| ✅ | Browse: a subscribe Steam refused (removed or private item) counted as done and the button said "Subscribed"; the button's state carried over to the next item opened (Unsubscribe on a mod never subscribed); Steam started after the Studio was never seen; downloads over two minutes failed | `steam_client`, `ModDetail.tsx`, `BrowseModule.tsx`, `from_url.rs` |
| ✅ | Servers: **Create overwrote an existing server's `.ini`** and took `..` in the name; Delete removed files in every Zomboid folder without a backup, also while running; Stop killed the server without a save (now `quit` over RCON first, new servers get an RCON password); Start could orphan a running server; a name with spaces started a fresh vanilla config; quick settings were written in place without a backup; stale map mods stayed in `Map=`; B42's `\ModId` read as not installed | `server_manager` |
| ✅ | Z_ClaudeAgent re-ran the last session's command at every game start and had no multiplayer gate; the bridge answered `ok` when `eval_lua` failed, and its error JSON broke on `\` or a newline; `terminate_game` could kill any PID | companion mods, `sandbox/mod.rs` |
| ✅ | Enable / Disable all switched the whole library (into the profile for good), draft packages and several packages at once, without asking; "Share" opened a public PR at once, replaced the registry others had added to, and could publish the Windows user name inside log paths | `LoadOrderModule.tsx`, `communityIndex.ts`, `lib.rs`, `propose.rs` |
| ✅ | New-mod template broke on quotes or line breaks in the name; the Nexus description parser panicked on non-ASCII text after `&` | `devtools.rs`, `nexus/mod.rs` |

## Still open

| | What | Where |
|---|---|---|
| ✅ | Mods switched on but not installed vanish from the Mod List, so Health's `missing_mod` never shows there. Now kept as rows marked `not_installed` (red NOT INSTALLED badge, counted under Problems); Studio packages that are gone are still pruned | `mod_info.rs` scan |
| ⬜ | Dev launch / bisect still go through the profile: during a hunt the profile follows the trial list (it comes back when the hunt ends) | `bisect`, `App.tsx` |
| ✅ | Publishing a package is not a swap: files are written in place (errors now fail the publish). Now built in `Zomboid/PZModStudio_Staging/<pkg>.new` from a copy of the package, metadata and drafts included, then swapped in; the old one comes back if the swap fails | `publish.rs` |
| ✅ | Unpack deletes `media/` and `42/` whole, hand-placed files included; publish replaces the package description with a fixed text. Unpack now removes only what the publish wrote (and empty folders); publish keeps the package's name, description and pictures | `publish.rs` |
| ✅ | IPC commands still trust folder roots the page passes (`open_package_folder_cmd`, launch commands with an install dir); with the XSS fixed and a CSP set this needs a compromised page. Launch, dedicated server and the Steam helper use `vfs::trusted_install_dir()`; open-package goes through `to_package_folder` under the saved Zomboid folder; the folder allow-lists (validate, MP check, open in editor, open mod folder) read the saved paths | `lib.rs` |
| ⬜ | Players tab shows a fixed ping and health; server log snapshot may pick the client's log | `server_manager` |
| ✅ | Bisect "Launch" forces fullscreen; one non-UTF-8 log line stops the per-mod stats; whole log read into memory. Only a launch naming a screen mode touches `options.ini`; logs are read as bytes with lossy decoding (stats, live watcher, MCP); `tail_lines` reads the end of a log for line-limited reads | `sandbox` |
| ✅ | MCP: parse errors answered without `id: null`, `prompts` capability advertised but not served, `--mcp` on the main exe runs on a 1 MB stack. `-32700`/`-32600` with `id: null` (or the id read), `prompts` dropped, `--mcp` on an 8 MB thread | `mcp/` |
| ✅ | Backend messages of Browse, bisect, devtools and servers are English only; MCP setup guides in Settings are English only. `backendSays` (tauri.ts) matches the known texts and says them from `backend.say`; the guides come from `settings.mcp.guides` | i18n |
| ⬜ | A GitHub "releases/tag" link installs the latest release | `from_url.rs` |
