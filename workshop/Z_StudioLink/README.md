# Z_StudioLink on the Steam Workshop

This folder holds what the Workshop page needs (`workshop.txt`: title, description, tags;
`preview.png`). The mod itself lives in `mods/Z_StudioLink/` and is the same files the app installs.

## What the mod does on its own

Anyone can subscribe without the app. Without it the mod changes nothing in the game: no screen
is replaced, no save is touched, no question is asked. The main menu shows a small card saying
what the app does, with Download (the releases page, in the browser) and Hide (for good:
`Zomboid/Lua/PZModStudio_LinkInvite.txt`). "Has the app" means PZ Mod Studio has run on this PC
(its heartbeat file `PZModStudio_LinkApp.txt` exists); with it, the card shows the profile, Mod
Health and the save Continue would load instead.

## Publishing

1. `node scripts/prepare-link-workshop.cjs` makes the folder the game's uploader reads:

   ```
   Zomboid/Workshop/Z_StudioLink/
     workshop.txt      <- from here, with the item's id= kept once it has one
     preview.png
     Contents/mods/Z_StudioLink/   <- a copy of mods/Z_StudioLink/
   ```

2. In the game: main menu, Workshop, Create and update items, Z_StudioLink, upload. The first
   upload gives the item an id, which the game writes into that `workshop.txt` as `id=`: copy
   that line here so later uploads update the same item (the script also keeps it).

## The app and the Workshop copy

When a Workshop copy is installed (`steamapps/workshop/content/108600/<id>/mods/Z_StudioLink`)
at least as new as the Link this app carries (`modversion`), the app removes its own copy from
`Zomboid/mods` and stops installing it: two folders with one mod id would make the game load
either. When the Workshop copy is older (Steam not updated yet, or an app newer than the last
upload), the app keeps its own copy and starts the game reading `Zomboid/mods` first
(`-modfolders mods,workshop,steam`), so its newer Link runs. Publish a new version with each app
release that changes the mod.
