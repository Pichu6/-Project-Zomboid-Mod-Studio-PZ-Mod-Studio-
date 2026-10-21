# Other mod managers: what they do, and where we stand

Studied on 2026-10-20 to make PZ Mod Studio the most reliable and safest manager for Project Zomboid. Ideas only: none of their code, text or images is used here. Sources were their Workshop pages (text, pictures, comments), their mod files, PZMM's video thumbnails (the video itself could not be fetched: YouTube asks to sign in), and PZMM's public source code, which was read but never run.

| | **PZMM** (SEVNC3) | **DMM - Definitive Mod Manager** (Kasualidad) |
| :--- | :--- | :--- |
| What it is | A desktop app (Rust, Tauri 2, Svelte 5; MIT) plus a Workshop Lua mod, `PZMMClient`, that copies the app's Mods screen into the game | A Lua mod only (`DefinitiveModManager`), which reshapes the game's Mods screen |
| Size | About 37k lines of Rust, 24k of TS/Svelte, and a 15.8k-line Lua file | About 9k lines of Lua in 46 modules |
| Age and pace | Repo created 2026-10-10; about 13 releases in 10 days (v1.3.0 on 10-20) | First published 2026-10-16; 7 updates in 4 days |
| Workshop (10-20) | 278 subscribers, 1,319 visitors | 228 subscribers, 429 visitors |
| Platforms | Windows and Linux; installer not code-signed (SmartScreen warns) | Wherever the game runs; no controller support yet |

## What each one does

**PZMM, desktop app**

- **My mods:**
  - library and load order side by side, in sections;
  - columns for size, install date, last change and overwrites;
  - hide a mod without switching it off;
  - undo and redo, plus 10 snapshots per profile;
  - Autosort: frameworks first, translations last; it follows `require`, `loadModAfter` and `loadModBefore`, and pins are written in Mod Load Order Sorter's `sorting_rules.txt`.
- **What's new:** the change notes of each update since you last played, with "may break saves" guessed from map mods, major versions and keywords.
- **Browse Workshop:** no Steam login; downloads through SteamCMD `+login anonymous`, item data from the keyless `GetPublishedFileDetails` and from scraped pages.
- **Maps:**
  - every map's cells on a grid, from about 2,900 Workshop maps in an index they ship as a private Workshop item;
  - clashes between maps;
  - "most maps that fit", an exact maximum independent set for up to 40 maps.
- **Servers:**
  - join a modded server into a profile of its own;
  - host a dedicated server: SteamCMD, RCON, restarts that warn players, backups, Discord.
- **Saves:**
  - zip backups at launch, at exit, every N minutes and after a crash, with named slots;
  - "give it my mods", with a diff first;
  - sandbox editor and repairs.
- **Java mods:**
  - sets up ZombieBuddy and Viewpoint, taking the jar only from the official Workshop item, with Repair after Steam's "verify files";
  - a jar scan that flags network, process, native and hidden code;
  - the screen is a checklist of the four things that must be true (mod downloaded, agent files in the game folder, launch flag in `ProjectZomboid64.json`, mod on in the profile) under a red warning that Java mods can do anything on the computer;
  - before it changes the launcher file it shows "PZMM will: add `-agentlib:zbNative` to <path>" with Apply changes / Cancel, and a notice says when a game update has reset the flag.
- **Check setup:** findings graded Broken, Risk, Check and Low, with fixes; "run harmless fixes"; the same check runs before Launch and Join.
- **Find the broken mod (bisect):**
  - mods that need each other move as one group;
  - mods the log blames, then the newest, are tried first;
  - a control round first, and a "breaks only together" result.
  - A player on the Workshop page says it still switches off dependencies and breaks the list.
- **Make a mod:** checks an upload folder the way the game does, and builds `workshop.txt` and the preview.
- **Rules they write down for themselves:**
  - only change or delete what PZMM installed (`installed.json`);
  - every write is atomic;
  - never write over a file that could not be read;
  - show every change before it is made;
  - ask in the app, never with a system dialog;
  - one word per idea in the wording.

**PZMM, in-game mod (`PZMMClient`)**

- Replaces the Mods button with its own full-screen panel, drawn in `prerender`.
- Works without the app; with the app open, hands it what Lua cannot do.
- Talks to the app through files in `Zomboid/Lua/pzmm/`:
  - the app rewrites `app.txt` every 5 s (`running_at`, `busy`, `*_rev` counters);
  - the game appends `<id>\t<profile>\t<action>\t<args>` lines to `requests.txt`;
  - the app answers in `acks.txt`;
  - the game writes `game.json` with what it loaded.
- Opens the app from the game through an https page that redirects to `pzmm://`.

**DMM (Lua only)**

- Catalogue, inspector and load order in three columns. Categories with icons; groups combined into modpacks; a profile composer; up to 20 revisions per profile.
- Planner:
  - switching a mod on pulls in what it requires; switching one off offers to switch off what needs it;
  - every change goes through a preview (added, removed, moved, blocked, with the reason);
  - only mods that really moved are marked.
- SaveGuard: before loading a save, compares it with the last time it was played:
  - mods removed, with map and vehicle mods weighed more;
  - mods added, maps changed, order changed;
  - mods missing.
- Diagnostics of the Lua errors in the log, grouped and attributed to mods.
- Import and export of the server `Mods=` / `WorkshopItems=` lines; share codes.
- Five themes, a guided tutorial, density settings. Files are written with a header, a trailer count, a backup copy and a read-back check.
- The two things players asked for on its page were low resolutions (1366x768, 300 mods) and controller support.

## Where we stand

**Already ahead**

- **The Monitor.** Errors are attributed to mods live while the game runs, with crash cards and fixes, and `get_error_report` gathers everything needed to fix one error. Theirs read the log afterwards, or only the Lua errors.
- **Patching.**
  - Merge of Lua files, three ways, on the syntax tree.
  - Patch packages that load last and fix a mod without touching it (`publish_file_into_package`).
  - Conflict scan of the virtual file system.
  - Neither of them changes files of other mods at all.
- **The community index** of known issues and their fixes, and the player's own load rules.
- **Kept versions of a mod.** A copy put back as a local mod that wins over the Workshop update. PZMM's rollback only covers mods it installed itself.
- **Control by an AI through MCP:** launch, play, screenshots, the IPC bridge.
- **Saves outside the profile are refused, not just warned about.** A save with an empty mod list is caught before the game drops every modded item.
- **The Studio Link protocol** (since 1.2): heartbeat, requests with an id answered ok or error, game state, and stepping aside when another manager owns the Mods screen.
  - Unlike PZMM's "quiet" requests, the game can only ask us to add mods to the profile.
  - PZMM lets any mod's Lua write a request that changes settings, for example switching save backups off.
- **Bisect.** Ours already keeps everything an active mod requires on in every trial, transitively, and keeps its state in `Zomboid/PZModStudio_Bisect.json` across restarts. Theirs keeps it in the web view's localStorage.

**Behind, and worth doing (in order)**

1. ~~**Save backups.**~~ Done (Saves screen, `save_backup`): a zip when the player leaves a save, before it loads with changed mods and before its mod list changes, read back and compared after writing, with the free space in view; 5 automatic per save, kept ones forever; restore backs up first.
2. ~~**Compare a save with its last session before it loads.**~~ Done: before a save loads, the Link shows what changed since its last session (mods taken out, map mods marked; added; updated on the Workshop; order changed) and offers Load it (backed up first), Play on a copy (the app copies the save to `<world>_copy` and the copy loads), or Back. The Saves screen shows the same summary per save.
3. ~~**Dependency planner with a preview.**~~ Done: switching a mod on brings what it requires (all the way down, requirements moved before it), switching one off names what needs it, and anything beyond the one mod is shown first (`utils/planner.ts`, `ChangePreview`). Subscribing in Browse follows the Workshop's "Required items" down the chain and offers them in the same subscription; what arrives goes on in the active profile, requirements first. Switching a profile on shows the launch-file change first (`java_agents_plan_cmd`), and says when it will wait for the game to close.
4. ~~**Never write over what could not be read.**~~ Done: `guard_overwrite`, `try_parse_default_txt` (read twice, whole), `atomic_write` with `sync_all` and a wait for held files.
5. **Shared Steam limiter.** One cooldown per host that follows Retry-After, one request in flight per id, and a cache kept on disk so a restart does not ask again. Today's Workshop outage (eresult 10) showed why.
6. ~~**What's new since you last played,**~~ Done (What's new screen, `whats_new`): mods updated since the last session (or the last 7 / 30 days) and updates waiting in Steam, with their change notes (cached, read at most 12 pages at a time and stopping at Steam's first refusal), a "May break saves" mark (a map mod, or notes about new saves, wipes, removed items, changed ids) and a weaker "Read first" one, and "Keep the version I have" for an update still waiting.
7. **Map cells grid and clashes.**
8. **Release integrity.**
   - Sign the app updater and the checksums.
   - Run the tests in the release job.
   - Pin the Actions by commit.
   - Code-sign the Windows build when possible.
9. **"Copy diagnostics" with the user name masked,** and panics shown in the app's log.
10. **In-game details.** Low-resolution layout and controller support for the Link's screens; translations kept in sync by a check in CI.

**Their mistakes to avoid** (found in their code and their pages)

- Unauthenticated in-game requests that change settings silently.
- Passwords in `pzmm://` and `steam://` links and on the server's command line.
- SteamCMD downloaded without a hash check.
- Save zips never verified.
- Caches lost on restart, so the rate limits come back.
- Many releases in a few days.
- Bisect that still breaks dependencies in practice.
- 4,000-line files, with algorithms copied between the app and Lua.
