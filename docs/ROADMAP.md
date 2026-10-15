# PZ Mod Studio Roadmap

Goal: the complete Project Zomboid mod manager. Everything players and server admins
currently do with five separate tools (in-game mod managers, load-order sorters, Workshop ID
grabbers, crash-log reading, hand-editing `default.txt` and server `.ini` files) in one app
that understands the game as well as the game does.

Principles, learned from the best managers in other games (Mod Organizer 2, Vortex, LOOT,
RimSort, Irony, Skyve, CKAN, Prism/Modrinth, r2modman, Wabbajack):

1. **Never touch what Steam or the game owns without being asked.** No writes into Workshop
   folders, no silent rewrites of saves. Every write is backed up and atomic.
2. **Match the game exactly.** Version folders, `mod.info` parsing and load order follow the
   game's own rules (checked against the decompiled 42.20.4 code), so what the Studio shows is
   what the game will do.
3. **Warn, never block.** A mod for another build, a missing dependency or an incompatibility is
   shown with the reason and a fix; the player decides.
4. **Explain everything.** Every sort, conflict and error says *why*.

Status legend: ✅ done · 🔨 in progress · ⬜ planned

---

## Phase 0: Foundations (make everything else reliable)

| | Item | Why |
|---|---|---|
| ✅ | Safe writes: only `mods/default.txt`, backups in `Zomboid/PZModStudio_Backups`, atomic, errors shown | The old writer rewrote ~30 files and every save |
| ✅ | No writes into Workshop folders, no `taskkill java.exe`, path-traversal and injection fixes | Data safety |
| ✅ | Version-folder selection identical to the game (`42.x` ≤ installed build, `common/` fallback) | Base for "any mod, any version" |
| ✅ | Deterministic load-order sort that keeps cycles and reports incompatibilities | Same input, same order |
| ✅ | Real diff3 Lua merge; Lua checks accept what Kahlua accepts | Trustworthy merges |
| ✅ | Errors surfaced in the UI; slow commands off the UI thread; CI + releases | Basic quality |
| ✅ | **Mod catalog** (`src-tauri/src/catalog`): one read-only model of every installed mod (sources, version folders, chosen `mod.info`, loadability, which copy the game uses, relations) | Every feature below reads from it instead of re-scanning |
| ✅ | **Health report**: everything that will go wrong on launch, with the reason (Mod Health tab, MCP `get_mod_health`) | The thing players need most |
| ⬜ | Catalog cache (rescan only changed folders) | Measured: the full catalog of 115 mods builds in well under 0.5 s, so this waits until it is needed |
| 🔨 | Split the 2000-line components; virtualized mod list; one state store | Done: the Mod List takes its problems from the health check (no more guessed conflicts) and no longer scans the list per row. Next: virtualization and splitting |
| ⬜ | Polyfills split into: B41→B42 compatibility layer · vanilla/MP bug fixes · per-mod patches that only run when that mod is active. Settings toggles control what ships (today they do nothing) | Honest, opt-in patching |

## Phase 1: The manager everyone expects

| | Item | Inspired by |
|---|---|---|
| 🔨 | Health report UI with one-click fixes: enable missing dependency, move library up, disable mod not for this build, search Workshop for missing mods (done); next: show issues inline in the Mod List | Skyve compatibility report |
| ⬜ | Load-order rules: user rules + community rules database (GitHub, versioned, PR-based) on top of `require`/`loadModAfter`/`loadModBefore` | LOOT masterlist, RimSort rules DB |
| 🔨 | Undo / history for every load-order change | Auto-sort is now game-exact (moves only what rules force) and can be undone; full history next |
| ⬜ | Filters and search (enabled, broken, maps, libraries, not for this build, updated recently), drag and drop | Every manager |
| ⬜ | Profiles with share codes and `.pzpack` export (exists) including sandbox settings | r2modman, Modrinth `.mrpack` |
| ⬜ | Per-file conflict view: which mod's file the game actually uses, plus script-level conflicts (same item/recipe defined twice) | MO2 conflict pane |
| ⬜ | Server tools: build `WorkshopItems=` / `Mods=` / `Map=` from a profile using real IDs from `mod.info`; detect client/server mismatches | Top server-admin pain point |

## Phase 2: Every mod source in one place (a "Modrinth for Project Zomboid")

Research (2026-10-15): Steam Workshop is where almost all PZ mods live. **Nexus Mods** is the only
other real host (298 mods, about 1M downloads, actively updated, many marked "Build 42" in their
names but no build tag). The Indie Stone forums announce mods but link to the Workshop instead of
hosting files. mod.io, Thunderstore, CurseForge and ModDB have no real PZ presence; itch.io has a
few mods and tools; some authors publish on GitHub. **No open, source-agnostic PZ mod index exists**
(nothing like Modrinth or KSP's CKAN): that gap is the opportunity.

Every mod in the Mod List carries a source tag (Steam, Nexus, Manual, Local, Studio) with a source filter; installs through the Studio record where they came from in `Zomboid/PZModStudio_Origins.json`.

Design: one `ModSource` interface in Rust (`search`, `get_mod`, `list_files`, `resolve_download`,
`check_updates`) with a provider per platform, and a source badge per mod in the UI. Identity across
sources is the `mod.info` id **plus** source/author and a content hash, with explicit cross-links
(`workshop:2392709985` ↔ `nexus:projectzomboid/445`); never merged on the id alone (forks reuse ids).

| | Item | Notes |
|---|---|---|
| ✅ | **Steam Workshop** metadata (title, B41/B42 tags, last update, size, preview): Browse Mods > Steam Workshop shows your subscriptions with live details | `ISteamRemoteStorage/GetPublishedFileDetails`, no API key |
| 🔨 | Import a Workshop collection (URL) into a profile. Done: paste a collection link to see its items, which are installed and which are missing, and open it in Steam to subscribe. Next: turn it into a profile | `GetCollectionDetails`, no key |
| ✅ | In-app Workshop search (text, trending, most subscribed, updated, newest, top rated; Build 41/42 filter) with the user's own Steam Web API key, verified and kept in Windows Credential Manager |
| ⬜ | Subscribe / unsubscribe / download | ISteamUGC through the running Steam client (steamworks-rs); SteamCMD fallback for dedicated servers |
| ✅ | **Nexus Mods** browse and search (Browse Mods tab: search, sort, build hint, open page / Files tab) | GraphQL v2 `api.nexusmods.com/v2/graphql` works without a key (verified for game domain `projectzomboid`, id 583) |
| ⬜ | Nexus downloads | v1 `download_link.json`. Premium users directly; free users through the website's "Mod Manager Download" button (`nxm://` link handled by the Studio, like Vortex/MO2) |
| ⬜ | Nexus app registration and SSO login | Required by Nexus before a public release (email support@nexusmods.com with a test build). Personal API keys only for development. No rehosting of Nexus data; 20k requests/day, then 500/hour per user |
| ⬜ | **PZ community mod index** on GitHub, CKAN-style | One small CC-0 file per mod by pull request: `id`, authors, sources (Workshop / Nexus / GitHub / URL + sha256), supported builds, requires, incompatible, load-after, tags. A GitHub Action builds one `index.json` the app downloads. Main value: B41/B42 compatibility data nobody else has |
| 🔨 | GitHub releases and "install from URL / zip" (forum, Discord, itch.io). Done: install from `.zip` or an extracted folder into `Zomboid/mods` (any nesting, zip-slip and size checks, backups on replace, warnings when a Workshop copy wins or the build can't load it). Next: `.7z`/`.rar`, from URL, GitHub | Every non-Workshop install is hash-checked and goes through the Lua scan before it can be enabled |
| ⬜ | Update tracking and "what changed" per mod; snapshot a mod before it updates so a save can roll back | Workshop only serves the latest version (Wabbajack-style pinning) |

## Phase 3: Any mod, any version

| | Item | Notes |
|---|---|---|
| ✅ | Detect installed build (`Zomboid/version.txt`) and flag mods the build cannot load | Done in the scanner |
| ⬜ | "Try on B42" converter: local copy (new ID or `-modfolders mods,steam,workshop`), B42 folder layout, `Type`→`ItemType`, translations `.txt`→JSON, report of what still needs manual work | Never re-uploads others' mods |
| ⬜ | B41→B42 compatibility polyfill layer grown alongside the converter | From Phase 0 split |
| ⬜ | Branch awareness (stable / unstable / `legacy41`) and per-profile build | Saves don't cross builds |

## Phase 4: Find and fix what breaks

| | Item | Notes |
|---|---|---|
| ⬜ | Crash/error → mod attribution from `console.txt` stack traces | Partly exists in Monitor |
| ⬜ | Bisect mode: halve the active list, launch, repeat until the culprit is found | What players do by hand today |
| ⬜ | Load-time and Lua-error statistics per mod | Find the slow ones |
| ⬜ | MP-safety lint: flag mods doing client-side inventory/world changes that B42 MP makes server-authoritative | Before putting a mod on a server |

## Phase 5: Merging and patching

| | Item | Notes |
|---|---|---|
| ⬜ | Per-conflict buttons: use A · use B · both in order · edit | Today: A active, B kept in a comment |
| ⬜ | Fix the script merger (items/recipes/`craftRecipe`, nested blocks) | Current one truncates nested blocks |
| ⬜ | Translation merge (JSON) | B42.15+ format |

## Phase 6: Sharing

| | Item | Notes |
|---|---|---|
| ⬜ | Reproducible modlists: Workshop IDs pinned to `time_updated`, warn on drift | Wabbajack |
| ⬜ | Public community rules repo + in-app rule editor | RimSort |

---

## Facts from the game code (42.20.4) that the Studio relies on

- Mod folders are searched in the order Workshop uploads → subscribed Workshop → `Zomboid/mods`;
  the first copy of a mod ID wins (`-modfolders` changes the order).
- B42 reads `common/` plus the highest version folder between 42.0 and the installed build
  (major.minor only); the mod root is never read. Build 41 reads only the root.
- `mod.info` keys are case-sensitive and matched with "contains" in a fixed order (`name=`,
  `poster=`, `description=`, `require=`, `incompatible=`, `loadModAfter=`, `loadModBefore=`, then
  `id=` must start the line, ...). All backslashes are removed from list values. An invalid
  `versionMin`/`versionMax` makes the whole mod invalid.
- A mod is unavailable if it is outside its `versionMin`/`versionMax` or any required mod (at any
  depth) is missing or unavailable.
- The engine loads mods in list order; `loadModAfter`/`loadModBefore`/`incompatible` are only
  used by the in-game mod selector UI.
- The game reads `Zomboid/mods/default.txt` and rewrites each save's `mods.txt` when it loads.
  `default.txt` values are split on every comma and never unquoted.
