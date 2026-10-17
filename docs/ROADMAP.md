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
| 🔨 | Honest shim: the hand-written rules file that promised thirteen fixes nobody applied is gone (one of them redirected `require("ISUI/ISPanel")` to a file Build 42 does not have), Settings lists the shim's own nine parts with their line counts read from the shim that ships, and crash cards are no longer hidden because that file called a fix "enabled". Next: split part 5 (1565 lines in one block) into B41→B42 · vanilla/MP fixes · per-mod patches that only run when that mod is active, each switchable | Honest, opt-in patching |

## Phase 1: The manager everyone expects

| | Item | Inspired by |
|---|---|---|
| 🔨 | Health report UI with one-click fixes: enable missing dependency, move library up, disable mod not for this build, search Workshop for missing mods (done); next: show issues inline in the Mod List | Skyve compatibility report |
| ⬜ | Load-order rules: user rules + community rules database (GitHub, versioned, PR-based) on top of `require`/`loadModAfter`/`loadModBefore` | LOOT masterlist, RimSort rules DB |
| ✅ | Undo / history for every change to the list: Mod List > History lists the last twenty saved versions (the backups every write has always kept), each with when it was saved, how many mods it had and what it would switch on or off, and goes back to one through the same backed-up writer — so going back can be undone too. It also covers changes made outside the Studio, by a profile switch, an import, a bisect or the game itself | LOOT/MO2 keep a way back |
| ✅ | Filters and search: switched on/off, with a problem, maps, libraries, won't load on this build, updated recently — each with its count; and drag a mod to where it should load | Every manager |
| ✅ | Profiles export and import as `.pzpack`, with every mod's Workshop id so the other player can subscribe, plus the version and publish time of each copy, the build it was made on, and — if the sender picks one — the sandbox settings they played it with, read from their own `Sandbox Presets` and saved on import beside the receiver's own, never over them. On this machine that preset holds 1000 settings, 798 of them added by mods | r2modman, Modrinth `.mrpack` |
| 🔨 | Script-level conflicts: every active mod's scripts are parsed (brace-walking, every block kind, nested blocks) and anything two mods both declare — the same `item`, `craftRecipe`, `vehicle`, `xuiSkin` — is an Info issue naming the files and the mod the game keeps, with "move it before" to pick the other. Next: the same view per file | MO2 conflict pane |
| ✅ | Server tools: the sync writes `Mods=`, `WorkshopItems=` **and** `Map=` from the active list, with real ids and map folder names from the catalog, the base map kept last, every other setting untouched and the old file backed up. The Servers tab also reads the `.ini` and says what will not work: a mod never downloaded, an item never loaded, a map mod missing from `Map=`, an entry not installed, a mod the Workshop cannot deliver | Top server-admin pain point |

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
| ✅ | Import a Workshop collection (URL or browsed) into a profile: paste or open a collection to see its items and which you have, subscribe to the missing ones, then "Make a profile from this" — the mods you have installed from it, in your list's order, as a profile to switch to. Items you are not subscribed to are counted and left out rather than silently dropped | `GetCollectionDetails`, no key |
| ✅ | In-app Workshop search (text, trending, most subscribed, updated, newest, top rated; Build 41/42 filter) with the user's own Steam Web API key, verified and kept in Windows Credential Manager |
| ✅ | Subscribe / unsubscribe, for a mod or every mod a collection is missing | ISteamUGC through the game's own `steam_api64.dll` and the running Steam client. No API key, no login, nothing bundled |
| ✅ | **Nexus Mods** browse and search (Browse Mods tab: search, sort, build hint, open page / Files tab) | GraphQL v2 `api.nexusmods.com/v2/graphql` works without a key (verified for game domain `projectzomboid`, id 583) |
| ⬜ | Nexus downloads | v1 `download_link.json`. Premium users directly; free users through the website's "Mod Manager Download" button (`nxm://` link handled by the Studio, like Vortex/MO2) |
| ⬜ | Nexus app registration and SSO login | Required by Nexus before a public release (email support@nexusmods.com with a test build). Personal API keys only for development. No rehosting of Nexus data; 20k requests/day, then 500/hour per user |
| ⬜ | **PZ community mod index** on GitHub, CKAN-style | One small CC-0 file per mod by pull request: `id`, authors, sources (Workshop / Nexus / GitHub / URL + sha256), supported builds, requires, incompatible, load-after, tags. A GitHub Action builds one `index.json` the app downloads. Main value: B41/B42 compatibility data nobody else has |
| 🔨 | GitHub releases and "install from URL / zip" (forum, Discord, itch.io). Done: install from `.zip` or an extracted folder into `Zomboid/mods` (any nesting, zip-slip and size checks, backups on replace, warnings when a Workshop copy wins or the build can't load it). Also done: from a link — a direct `.zip`, or a GitHub repository or release. The release's zip is preferred; with no release (which is the normal case for PZ mods on GitHub) the repository's current files are zipped by GitHub on request, default branch and all. What will be downloaded is shown before it is, only http/https is followed, 512 MB is the cap, the answer must really be a zip, and the link is recorded with each mod so the Mod List can still say where it came from. Steam and Nexus links are turned away with what to do instead. Next: `.7z`/`.rar` | Every non-Workshop install goes through the same zip-slip and size checks, and the build check, before it can be enabled |
| 🔨 | Update tracking and "what changed" per mod; snapshot a mod before it updates so a save can roll back | Done: from Steam's own `appworkshop_108600.acf` (offline), updates waiting to download (the cause of "Workshop item version is different than the server's") are a Mod Health warning, and mods updated since you last played are listed; both are tags/filters on your subscriptions. Next: snapshots for rollback |

## Phase 3: Any mod, any version

| | Item | Notes |
|---|---|---|
| ✅ | Detect installed build (`Zomboid/version.txt`) and flag mods the build cannot load | Done in the scanner |
| 🔨 | "Make compatible copy" (Mod Health button): copy to `Zomboid/mods` with the same id, the Studio launches with `-modfolders mods,workshop,steam`, fixes the version range (e.g. `versionMax=42.20.99`, which the game reads as 42.20) and builds the B42 layout for B41 mods, rewrites each item's Build 41 `Type = Clothing` as Build 42's `ItemType = base:clothing` (only inside `item` blocks, only values Build 41 had, comments and formatting untouched), then reports what may still break (old recipes, `.txt` translations, Lua errors). Removable. Next: translation conversion, once the Build 42 key rule is confirmed per category — vanilla strips the prefix for `ItemName` and keeps it for `ContextMenu`, so it cannot be guessed | Never re-uploads others' mods |
| ⬜ | B41→B42 compatibility polyfill layer grown alongside the converter | From Phase 0 split |
| ⬜ | Branch awareness (stable / unstable / `legacy41`) and per-profile build | Saves don't cross builds |

## Phase 4: Find and fix what breaks

| | Item | Notes |
|---|---|---|
| ✅ | Crash/error → mod attribution: the Monitor names the mod the game blamed and offers to switch it off | The game writes it itself: `Lua((MOD:X)).File.lua>` on the line, and `mod "X" overrides <path>` at startup, which maps any file back to its owner |
| ✅ | Bisect mode (Monitor > "Find the mod that does it"): halves the suspects, launches, and halves whichever half still does it, then confirms the last one alone. Requirements stay on in every trial, the hunt survives closing the Studio (`PZModStudio_Bisect.json`) and the player's list is always put back. When it ends, it shows what the log says about that mod (its cards, exception or warning, with "Patch <file>" for each file the log named), a jump to its console lines, and "Patch a file of it", which opens the Merger on that mod; switching it off is the other choice, not the only one. The same "Patch <file>" sits on every Monitor card that names a mod; when the Studio already knows where the module went, the button is "Fix the path in <file>": the require is rewritten and published into the package in place, from the card; the card goes and one line above the list says what changed and that the game needs a relaunch. When the log does not name the file (`KahluaThread.call > require(...)`), the Studio searches every active mod for the files that ask for the module and fixes each — every active mod, because a `KahluaThread.call` line names no mod either, and the mod the card guesses from the lines above can be the wrong one (a NeatLockpicking require was blamed on FR Used Cars). A card for a package's copy of a mod file offers "Remove the copy", which takes it out of the package in place. A warning the Studio has no fix for gets no Patch button (pressing one led to saving an unchanged copy); a warning never sends to the Merger, only an exception with no known fix does. A packaged package is never unpacked for a patch (unpacking removes every published file from the game until the next publish): one file is published into it, and in the Merger a mod's own file stays editable while the package is packaged, its Save publishing in place. The Merger opens the package and the file before the scan it starts, and the Save of a patched mod file now reaches disk (it used to write nothing, since the scan had never listed that file). The Monitor's console survives leaving the tab | What players do by hand today. Finding the mod is half the job; the Studio's answer to a broken mod is a patched file in the package, with the mod still on |
| ✅ | The Monitor tells exceptions from warnings by the level the game wrote: `ERROR` and stack traces are exceptions (red, "Action Required", the sidebar badge); `WARN` lines that name a mod — `require` with a moved path, a `%` in a translation — are warnings (amber, "the game carried on"). ERROR lines that match no rule and name no mod are counted in the header, not carded. The cards are this game session's: a relaunch (fresh console.txt) clears them and reports every line again, cards dedupe by title + line shape (three different lines of one mod are three cards), and a line the game blames on a Studio package is shown as what it is — the package's patched copy of a mod's file, with "Open in the Merger" — not as a mod of its own | Seven `require` warnings under a red "Crash Diagnostics · Action Required" made a list that played fine look broken |
| ⬜ | Load-time and Lua-error statistics per mod | Find the slow ones |
| ⬜ | MP-safety lint: flag mods doing client-side inventory/world changes that B42 MP makes server-authoritative | Before putting a mod on a server |

## Phase 5: Merging and patching

| | Item | Notes |
|---|---|---|
| ✅ | Mod Health finds file conflicts by itself (pending / changed since merge / merged); safe ones merge in one click, the rest open in the Merger on that file | You only go to the Merger when two mods change the same lines |
| ✅ | Per-conflict choice: keep both · only this mod · vanilla · your own edit, as one row above the editor that shows which is active | Replaces the per-mod toggles, which were hidden and meant two different things |
| ✅ | The old block merger, which dropped every kind it did not know and ended a definition at the first nested `}`, was dead code and is gone. `src-tauri/src/scripts` parses scripts properly instead; merging a script file is diff3 over its text, as for Lua | It truncated nested blocks |
| ⬜ | Translation merge (JSON) | B42.15+ format |

## Phase 6: Sharing

| | Item | Notes |
|---|---|---|
| ✅ | Reproducible modlists: a `.pzpack` records each mod's `mod.info` version and the publish time of the copy the sender had, read from their own install rather than taken on trust, and the build they were on. Importing says which of your copies are older, newer or just differently versioned, and when the build differs. Older packs, which say none of this, still import | Wabbajack |
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
