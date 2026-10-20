# Z_StudioLink on the Steam Workshop

This folder holds what the Workshop page needs. The mod itself lives in `mods/Z_StudioLink/` and is the same files the app installs.

## Publishing

1. Make the folder the game's uploader expects, in your Zomboid folder:

   ```
   Zomboid/Workshop/Z_StudioLink/
     workshop.txt
     preview.png
     Contents/mods/Z_StudioLink/   <- a copy of mods/Z_StudioLink/
   ```

   `assemble.ps1` does it: `powershell -File workshop/Z_StudioLink/assemble.ps1`.
2. In the game: main menu, Workshop, pick Z_StudioLink, upload. The first upload gives the item an id, which the game writes back into `workshop.txt` as `id=`: copy that line here so later uploads update the same item.

## The app and the Workshop copy

When the Workshop copy is installed (`steamapps/workshop/content/108600/<id>/mods/Z_StudioLink`), the app removes its own copy from `Zomboid/mods` and stops installing it (`studio_link::install_link_mod`). Two folders with the same mod id would otherwise make the game load one of them at random. So a Workshop update has to keep up with the app: publish a new version together with each app release that changes the mod.
