# PZ Mod Studio — a mod manager and fixer for Project Zomboid (Build 42)

Free and open source · Windows · no installer · works with your Steam Workshop mods

Hello everyone!

Back in August I shared the first version of **PZ Mod Studio** here. It has changed a lot since, so here is a fresh walkthrough of what it does now, one screen at a time.

A quick, honest note first: I am not a programmer. The app is built with AI assistance, and I test every change on my own install (B42.21, 120+ mods). Everything is open source, so anyone who knows the code can review it, fix it or improve it — that is very welcome.

**▶ Video tour (1 minute):** [pz-mod-studio-tour.mp4](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/pz-mod-studio-tour.mp4)

---

## What it is for

If you play with many mods you have probably met at least one of these:

- the game crashes or throws red errors and you don't know **which mod** did it;
- two mods change the **same file**, and one of them silently stops working;
- a mod made for **Build 41** half-works in Build 42;
- you want a "vanilla+" setup and a "100 mods" setup **without unsubscribing** from anything;
- a friend sends you a mod list and nothing matches.

PZ Mod Studio is one window for all of that. It never touches the game's code: it only reads your logs and mod folders and writes the same files you would write by hand (your mod list, and a normal mod folder for its fixes).

## Download and first start

1. Go to the **[Releases page](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases)** and download `Project-Zomboid-Mod-Studio.exe`.
2. Put it in any folder and double-click it. There is nothing to install.
3. It finds your game, your Steam Workshop folder and your `Zomboid` folder by itself. If you use a custom Steam library or GOG, set the folders in **App Settings**.

Requirements: Windows 10/11 (64-bit). The app can be switched between **English and Spanish** in Settings.

---

## 1. Profiles — one click, a whole mod setup

![Profiles](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/01-profiles.png)

A **profile** is a set of mods (switched on or off) and their load order. Make one for each way you play — "Vanilla+", "Hardcore 120 mods", "Server with friends" — and switch between them with one click.

- **Start one** from what is on now, from everything installed, from a hand-picked list, or empty.
- **The game follows the profile.** A small companion mod (*PZ Mod Studio Link*, added to every profile automatically) makes the game's own **Mods screen show only that profile's mods**, and **refuses to load a save that uses mods the profile doesn't have** — the same way the game blocks a save with missing mods.
- **It works both ways.** Switch a mod on or reorder it in the game's Mods screen, and the profile in the app updates by itself.
- **Mods that load outside the mod list** (Zombie Buddy's Java core) are switched on or off with the profile too.
- **Share** a profile as a `.pzpack` file (see section 9).

## 2. Mod List — your load order, and what is wrong with it

![Mod List](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/02-mod-list.png)

Every mod of the active profile, in the order the game loads them.

- **Drag** to reorder, or use the arrows and "Pos #".
- **Auto-Sort** puts every mod after what it requires, exactly the way the game itself would, and keeps the rest of your order.
- **Chips on each row** say what matters: where it comes from (Steam, Nexus, local, compatible copy), how long it took to load last session, and any problem Mod Health found — click a chip to fix it or to jump to the details.
- **Filters**: on/off, problems, maps, libraries, "won't load on this build", "updated since you last played", by source, and by tag.
- **Earlier lists**: every previous version of your mod list is kept, and you can go back to any of them.
- The panel on the right shows the mod's description, poster, what it requires and what requires it.

![Right-click menu](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/03-mod-list-menu.png)

**Right-click any mod** for everything else: add it to or take it out of the profile, load-order rules ("this mod loads after that one"), **keep this version** (a copy of the mod as it is today, to bring back if a Workshop update breaks your save), favorites and lists, open its folder or its Workshop page.

## 3. Mod Health — your list checked with the game's own rules

![Mod Health](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/04-mod-health.png)

One page that answers "will my list load?" before you start the game. It uses the same rules the game uses (read from the game's own code), so it doesn't guess:

- mods your build can't load, missing or switched-off requirements, wrong order, incompatible mods switched on together, duplicates;
- **file conflicts**: two mods shipping the same file, where the game only keeps one of them;
- **known issues** from a small **community index** (shared facts like "this mod needs X on 42.21"), with the fix the app can apply.

Most issues come with a **button that fixes them**: switch a mod on or off, move it, make a compatible copy, merge the files, open the Merger.

**Compatible copies:** for many Build 41 mods (or B42 mods broken by a game update), the app can make a local copy that rewrites what changed — old `require` paths that moved in Build 42, the old `Type =` item field — and the game uses that copy instead of the Workshop one. The original is never touched, and you can remove the copy any time.

## 4. Browse Mods — the Workshop and Nexus, inside the app

![Browse Mods](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/05-browse.png)

Search and browse the **Steam Workshop** the way Steam shows it (Most Popular, Top Rated, Most Recent, Last Updated, categories, build), without a Steam key.

- **Subscribe and unsubscribe from the app**, through your own Steam client. When Steam finishes downloading, the mod joins your active profile by itself.
- Open a mod for its full description, screenshots, requirements and what the community index says about it.

![Hover](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/06-browse-hover.png)

Rest the pointer on a card to read its description, like on the Workshop.

![Collections](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/07-browse-collections.png)

- **Collections**: see how many of its mods you already have, subscribe to the missing ones in one click, or turn a collection into a profile.
- **Nexus Mods**: search and open mod pages; install the `.zip` / `.7z` you download, or install from a folder or a link (GitHub too).
- **My mods / My lists**: everything you have installed, plus your own lists and favorites.

## 5. Mod Merger — making conflicting mods work together

![Merge packages](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/08-merger-packages.png)

When two mods ship the same file, the game only reads the one that loads last, and the other mod loses that part. The Merger puts **both mods' changes into one file**, inside a **package**: a normal mod folder (`Zomboid/mods/Z_PZModStudio_...`) that loads last, so the game reads the merged version.

- **Merge automatically** what can be merged safely (a real three-way merge against the vanilla file), and decide the rest by hand in a side-by-side code editor: keep both, keep one mod, keep vanilla, or write your own.
- Item, recipe and profession **script blocks** that two mods declare are settled into one complete block.
- **Patch a mod's own file**: fix a bug in someone else's mod without touching the mod — the fixed copy goes in your package.
- Packages belong to profiles: each profile shows its own packages.

![Published package](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/09-merger-package.png)

**Package & Publish** writes it for the game. A published package is read-only until you open it again to edit — while it is open (a draft), the game doesn't load it, and the app tells you so.

The package also carries a small **Build 42 compatibility shim** (safe guards for common B41-style calls), with per-mod patches you can switch on or off in Settings.

## 6. Monitor Center — what went wrong, and whose fault it is

![Monitor Center](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/10-monitor.png)

The game's `console.txt`, live, whether you start the game from the app or from Steam.

- **Error cards** for each problem, with **the mod the game blamed** on its own log lines, how many times it happened, and whether it was a real exception or just a warning (the game carried on).
- **Fix buttons** where a fix is known: switch the mod off, fix a moved `require` path (publishes just that file into your package), patch the file.
- **Save report**: writes everything needed to fix one error into a Markdown file — the log lines, your build, the mod (version, Workshop link, requirements) and the source of the file that failed. Hand it to the mod author, or to an AI assistant.
- **Find the mod that does it**: a guided search that switches half of your mods off at a time, asks you "does it still happen?", and narrows down to the mod that causes it. Your list comes back when you are done.

## 7. Servers — a dedicated server with your mods

![Servers](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/11-servers.png)

- Create and run a dedicated server (memory, Steam or no-Steam) and watch its console live.
- **Mods & Sync** writes your profile's mods into the server's `.ini` (`Mods=`, `WorkshopItems=`, `Map=`) and checks the `.ini` for mods it can't find.
- Quick settings (name, password, players, PvP, port), the players connected, and **Stop** saves the world before closing.
- A **multiplayer check** lists calls in a mod's client code that only work in single player.

## 8. Developer — for people who make mods

![Developer](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/12-developer.png)

(Switch it on in Settings > Developer features.)

- **New mod**: makes the Build 42 folder structure with a working `mod.info`.
- **Check every file**: every Lua file through a parser and every script file through a brace check, before the game reads them; click an error to open that line in VS Code.
- **Start the game with only this mod** (and what it requires) to test it alone; your list comes back when the game closes.
- **Reload in the game while it runs**: save a Lua file and the game reloads it, no restart.
- **Multiplayer check**, and **TileZed / WorldEd** launchers.

It works on other people's mods too, for checking and testing. To fix someone else's mod, use **Patch a mod file** in the Merger, so a Workshop update doesn't wipe your fix.

## 9. Sharing your setup

- **Mod list (`.pzpack`)**: from Mod List > Presets, or the Share button of a profile. It records each mod's version and Workshop date and the game build, and can carry your sandbox settings. When your friend imports it, the app lists what they are missing (with **Subscribe to all**), which mods are a different version than yours, and whether their build differs.
- **Merge package (`.pzmerge`)**: from the Merger. It records which mod copies it was made with, and warns on import if the other person's copies differ — publishing a merge made from other versions can put old code over new.
- Friends without the app can still use your package: zip the `Zomboid/mods/Z_PZModStudio_<name>` folder; it is a normal mod that has to load last.

## 10. App Settings

![Settings](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/raw/main/docs/forum/images/13-settings.png)

Folders, language (English / Español), which warnings you see, the community index downloads, the Build 42 shim and its per-mod patches, and (optional) the AI agent server.

---

## A typical session

1. **Profiles**: make or pick a profile.
2. **Mod List**: switch mods on, then **Auto-Sort**.
3. **Mod Health**: fix what it shows (most issues have a button).
4. **Mod Merger**: if Mod Health found file conflicts, *Merge automatically*, decide the rest, **Package & Publish**.
5. **Launch** from the header (normal or debug, fullscreen or windowed).
6. **Monitor Center**: if something goes wrong, read the card, use its fix, or **Save report**.

## For AI-assisted modding (optional)

The download includes `pz-mcp-server.exe`, a **Model Context Protocol** server. Connect it to an AI assistant (Claude, Cursor, Cline…) and the assistant can read your logs and error reports, check your mod list, merge files, launch the game and, with the optional companion mods, run Lua in the game and even play through menus. Setup snippets are in Settings > MCP Agent Server and in `AGENTS.md`.

## How it touches the game

- **Mod list**: it writes `Zomboid/mods/default.txt` (the file the game reads), always keeping a backup of the previous one.
- **Fixes**: they live in normal mod folders in `Zomboid/mods` (packages, compatible copies). Workshop mods are never edited.
- **Logs**: it only reads `console.txt` and `Zomboid/Logs`.
- **Zombie Buddy only**: it adds or removes Zombie Buddy's line in the game's `ProjectZomboid64.json`, with a backup every time. Steam's "Verify integrity" puts the original file back.
- No DLLs, no memory editing, nothing is sent anywhere. The app talks to the internet only to browse the Workshop/Nexus and to download the community index (which you can switch off).

## FAQ

**Is it safe for my saves?** It never edits saves. The Link mod only *blocks* loading a save whose mods aren't in the profile, so you don't load it with the wrong list by accident.

**Do I have to launch the game from the app?** No. Mod list, profiles and packages work from Steam too. Compatible copies need the launch option `-modfolders mods,workshop,steam` when you start from Steam (the app adds it for you when it launches the game).

**Does it work on Build 41?** It is made for Build 42, and it can help many B41 mods run on B42. The B41 game itself is not the target.

**Something broke / I found a bug.** Please post here or open an issue on GitHub, with the **Save report** file if it is about an error. That report is exactly what is needed to fix it.

**Links**: [GitHub](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-) · [Releases](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases) · [Technical docs](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/tree/main/docs)

Thanks for reading, and happy surviving!
