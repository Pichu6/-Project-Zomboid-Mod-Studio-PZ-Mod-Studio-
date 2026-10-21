# Images of the Workshop page

The page ([workshop.txt](workshop.txt)) loads its images from GitHub, from `media/`. Each one is
a live recording of the game or the app (Link 1.13.1, B42.21), no zoom, cut to the part that
matters:

| File | What it shows | How |
| --- | --- | --- |
| `01-mods-screen.gif` | Main menu → MODS → the Link's screen, a mod's details | whole window, app closed |
| `02-search-filters.gif` | search, On / Off / Maps / All, groups | top-left of the screen, app closed |
| `03-requirements.gif` | turning on 3D Equipment Lockers brings 3D Gun Racks; turning Viewpoint off lists who needs it (Back, nothing applied) | list and dialogs, app closed |
| `04-load-order.gif` | sort by load order, drag Blood FX Fixes up: it stops under Blood FX; Undo | list, app closed |
| `05-many-mods.gif` | Ctrl+click five mods → Turn all on (with Gun Racks), Undo; Blood FX's options window | list and details, app closed |
| `06-error-notice.png` | the notice for a Lua error in ModernStatus | crop of the main menu |
| `07-profiles.gif` | the app switches to a small profile, the game's MODS screen shows it, then all installed | app, then game |
| `08-save-check.png` | what changed in a save since its last session (a mod taken out, the order) | crop of the main menu |

"App closed" was the Link told in memory that PZ Mod Studio is not running, so the screen is
what a subscriber without the app sees. Nothing was accepted on the Mods screen during the
recordings; the profiles, mod list and app language were put back afterwards.

## Making them again

1. Record each take (OBS, the Xbox Game Bar with `Win+Alt+R`, or ffmpeg's `gdigrab`) into
   `workshop/Z_StudioLink/recordings/<name>.mp4`; that folder stays out of git.
   `name@2-11.mp4` keeps seconds 2 to 11.
2. `node scripts/make-workshop-gifs.cjs` writes `media/<name>.gif`, each under 5 MB.
3. Commit and push: the page shows the new images, with no new upload of the mod.

## The video

`recordings/pz-studio-link.mp4` (about 2 minutes, 1080p): the same takes, captioned. For the
Workshop page it goes on YouTube, then "Add/edit images & videos" on the item's page.
