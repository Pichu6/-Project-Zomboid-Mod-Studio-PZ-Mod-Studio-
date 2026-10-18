# Community rules

`rules.json` holds what `mod.info` does not say: that one mod has to load after another or
its recipes vanish, that two mods cannot be on together. PZ Mod Studio downloads it once a day
(and keeps the last copy for when it is offline), and then:

- **Auto-Sort** places the mods as if the earlier one had written `loadModAfter` itself.
- **Mod Health** says when the active list breaks a rule, names the rule's source, and offers
  the move that mends it.

The player's own rules (Mod List → right-click → Load-order rules…) win over these; a player can
also switch the download off in Settings.

## Adding a rule

Open a pull request that edits `rules.json`. Every rule needs where it was seen:

```json
{
  "load_after": [
    { "mod_id": "SomeOverhaul", "after": "SomeLibrary", "note": "recipes vanish otherwise", "source": "https://steamcommunity.com/workshop/filedetails/discussion/..." }
  ],
  "incompatible": [
    { "a": "ModOne", "b": "ModTwo", "note": "both replace ISInventoryPane and the second wins silently", "source": "..." }
  ]
}
```

- `mod_id`, `after`, `a`, `b` are the `id=` line of the mod's `mod.info`, exactly (case matters
  to the game).
- `note` is one sentence a player can act on: what breaks, how it shows.
- `source` is a link to where it was reported or discussed, or `"tested on 42.21"` with your
  name. A rule nobody can check does not go in.
- A rule the mod's own `mod.info` already states (`require`, `loadModAfter`, `incompatible`)
  does not go here: the Studio reads those from the mod.

Keep `updated` as the date of the change.
