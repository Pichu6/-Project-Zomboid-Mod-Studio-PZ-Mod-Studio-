# Update — PZ Mod Studio 1.2.0: the game side, save backups, maps, servers and Discord

![PZ Mod Studio](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/banners/hero.jpg)

Hello again!

Since the walkthrough above, PZ Mod Studio grew in two directions: **into the game itself**, through its companion mod, and **around your saves**, so a mod update or a changed list doesn't cost you a world. Here is what is new in 1.2.0, one screen at a time.

**[Download PZ Mod Studio 1.2.0](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases/latest)** (portable, nothing to install) · **[PZ Mod Studio Link on the Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3824256253)**

---

## 1. PZ Mod Studio Link — now on the Steam Workshop

![Profiles in the game](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/media/07-profiles.gif)

The companion mod is now a Workshop item you can subscribe to, and it does a lot more than before. With the app:

- **The active profile on the game's Mods screen**: its mods first, and what you switch on or off in the game goes back to the profile. New subscriptions show as "+N new".
- **Mod Health marks** on the mods with a problem, with the reason, and **your notes and groups** of mods, made in the app and shown in the game.
- **A card on the main menu**: the active profile, how many problems Mod Health found, and what changed in the save Continue would load.

And even without the app, it gives you a clearer Mods screen:

![The Link's Mods screen](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/media/01-mods-screen.gif)

- Search, filters (on, off, problems, maps), each mod's poster, description, version, what it requires and what needs it.
- Switching a mod on brings what it requires; switching one off tells you first what needs it.

![Requirements](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/media/03-requirements.gif)

- Drag to reorder, select several mods at once, Undo, and the game's own screen is always one button away.

It is only Lua: plain-text files you can read in its folder. It writes nothing but its own small files and your mod list, the same way the game's screen does.

## 2. Your saves, backed up

![A check before a save loads](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/media/08-save-check.png)

Loading a save with different mods can lose items, vehicles or whole map areas for good. So now:

- **A check before every save loads**: when a save's mods changed since you last played it (added, taken out, updated, reordered), the Link shows what changed and you choose: **Load it** (the app backs it up first), **Play on a copy**, or **Back**.
- **Automatic backups**: a zip of the save when you leave it, before it loads with changed mods, before its mod list is changed, and before a restore. Each zip is read back after it is written.
- **A new Saves screen**: every save, whether its newest backup matches it, the room left on your disk, and **Restore** (it backs up the save as it is first, so a restore can be undone too). Pin a backup to keep it for good.

## 3. What's new since you last played

Your Workshop mods updated since your last session, and the ones whose update is still waiting in Steam, each with its change notes — read before you load a save in progress.

- A **May break saves** mark when a map mod changed or the notes talk about new saves, wipes, things removed or renamed (hover it to see the words that raised it).
- **Keep the version I have**: when an update is still waiting in Steam, keep a copy of the current one, to put back if the update breaks your save.
- **The mod's own changelog** (`ChangeLog.txt`, `CHANGELOG.md`), read from its folder, offline too.

## 4. Errors, named in the game

![The error notice in the game](https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/workshop/Z_StudioLink/media/06-error-notice.png)

- When a mod's Lua fails, the Link shows a notice **in the game** with the mod it came from, and the one that called it. **Copy report** puts the details on the clipboard for its author. (The picture shows an example mod made to fail, not a real one.)
- In the Monitor: **one card per error**, "called from" read from the game's own stack, a card for an item a save cannot rebuild (naming the mod), and Mod Health now points out a mod that fills the console.

## 5. Maps

Every map mod drawn on **the real map of Knox Country**: which cells each one replaces, and where two map mods fight over the same ground (or use the same tile numbers, which gives you wrong walls and floors). Zoom with the wheel, drag to move, and switch a clashing map off from there.

## 6. Servers: join one, and Discord

- **Join a server**: Steam's public server list (no key needed), with filters for your build, players, password, modded or vanilla. Add a private server by its address. Before joining you see its mods, which ones you have, and you can **make a profile with its mods**.
- **Discord for your hosted server**: a webhook posts when the server is up, stopped, crashed or restarted, who joins and leaves, and when Workshop mods need a restart. The Studio also sets up **the game's own Discord bot** (game chat ↔ a channel), and optional commands (`!status`, `!players`, `!restart`) for a role you choose.

## 7. For mod authors

- **Support the author**: the Ko-fi, Patreon and other support links an author ships with the mod (in its changelog or its Workshop description), shown beside each of their mods.
- **Error reports ready to send** them, from the Monitor or from the notice in the game.
- Their mods are never edited or re-uploaded: fixes stay in separate folders.

## 8. Community lists

Mod lists shared by other players: see how many of their mods you already have, **copy one into your lists**, then subscribe to what is missing or make a profile from it. Every list is read by a person before it is published, and they are all on the **[community web page](https://pichu6.github.io/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/)**, next to the index of known issues and their fixes.

## 9. For modders: Lua reload in a fraction of a second

Save a `.lua` file and it is checked and running in the game in about **0.3 s** — on the main menu, in game or paused — without restarting. Event handlers and your global tables are kept, so open windows and their state carry on with the new code. `PZStudio.onReload(...)` runs your own set-up again after a reload.

## And smaller things

- **Help on every screen**, in English and Spanish.
- **Preview before a change**: switching mods on or off, subscribing with requirements, and the launch file show what will change first.
- The window opens as you left it, and closing it can keep it in the tray.
- Steam requests are paced and cached, so browsing the Workshop is faster and never hammers Steam.
- Safer writes: the app never writes over a file it could not read, and waits for files another program is holding.

---

**Download:** [PZ Mod Studio 1.2.0](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases/latest) · [PZ Mod Studio Link (Workshop)](https://steamcommunity.com/sharedfiles/filedetails/?id=3824256253) · [Source code](https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-) · [Community index and lists](https://pichu6.github.io/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/)

As always: if something breaks, post here or open an issue on GitHub, with the **Save report** file (or the in-game **Copy report**) if it is about an error.

Thanks for reading, and happy surviving!
