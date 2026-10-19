# 09 — Game Process Control & Live IPC Bridge

This chapter explains how an AI Agent or external tooling (such as **PZ Mod Studio**) can manage the lifecycle of `ProjectZomboid64.exe` and communicate bidireccionaly with an active game session via an **Inter-Process Communication (IPC) Bridge**.

---

## 1. Project Zomboid Process Control

### Key Command-Line Flags:
| CLI Flag | Purpose |
| :--- | :--- |
| `-debug` | Enables the in-game debug menu, cheat options, Lua reload shortcuts, and on-screen exception viewers. |
| `-windowed` | Forces the game into windowed mode (ideal for automated developer workflows). |
| `-nosteam` | Runs the game without active Steam client authentication (useful for isolated testing). |
| `-debugtranslation` | Generates `translationProblems.txt` for translation key verification. |

### Process Lifecycle in Rust:
1. **Detection:** Scans the operating system process tree (`tasklist` on Windows) for `ProjectZomboid64.exe` and captures its Process ID (PID).
2. **Launch:** Spawns a child process with `std::process::Command::new("ProjectZomboid64.exe").arg("-debug").spawn()`.
3. **Termination:** Issues graceful termination signals or force kills with `taskkill /PID <pid> /F`.

---

## 2. Companion Mod Architecture: `Z_PZModStudio_Bridge`

Because the vanilla engine does not expose a local REPL socket in singleplayer mode, we implement a **Synchronized File-Based IPC Bridge**:

```
┌─────────────────────────┐                        ┌─────────────────────────┐
│     AI AGENT / MCP      │                        │  PROJECT ZOMBOID (GAME) │
└────────────┬────────────┘                        └────────────┬────────────┘
             │                                                  │
             │ 1. Writes pz_ipc_queue.json                      │
             ├─────────────────────────────────┐                │
             │                                 │                │
             │                                 ▼                │
             │                  ┌──────────────────────────────┐│
             │                  │  Zomboid/pz_ipc_queue.json   ││
             │                  └──────────────┬───────────────┘│
             │                                 │                │
             │                                 │ 2. Events.OnTick (Every 30 frames)
             │                                 │    Polls & executes commands
             │                                 ▼                │
             │                  ┌──────────────────────────────┐│
             │                  │    PZModStudio_Bridge.lua    │├┘
             │                  │  - getPlayer()               │
             │                  │  - AddItem / Equip / Teleport│
             │                  │  - loadstring(lua_code)()    │
             │                  └──────────────┬───────────────┘
             │                                 │
             │                                 │ 3. Writes execution result
             │                                 ▼
             │                  ┌──────────────────────────────┐
             │                  │   Zomboid/pz_ipc_resp.json   │
             │                  └──────────────┬───────────────┘
             │                                 │
             │ 4. Reads response & confirms    │
             │◄────────────────────────────────┘
             ▼
```

---

## 3. JSON IPC Protocol Specification

The command queue file at `C:/Users/<User>/Zomboid/pz_ipc_queue.json` receives command objects:

### 1. Give / Equip Item (`give_item`)
```json
{
  "id": "cmd_001",
  "action": "give_item",
  "item": "Base.Axe",
  "count": 1,
  "equip": "primary"
}
```
*Effect:* Instantiates the item and equips it into the primary hand of the player character.

### 2. Teleport Character (`teleport`)
```json
{
  "id": "cmd_002",
  "action": "teleport",
  "x": 10520,
  "y": 9410,
  "z": 0
}
```
*Effect:* Instantly teleports the local player to target grid coordinates.

### 3. Modify Player Stats (`set_stat`)
```json
{
  "id": "cmd_003",
  "action": "set_stat",
  "godmode": true,
  "health": 1.0,
  "hunger": 0.0,
  "thirst": 0.0
}
```
*Effect:* Sets godmode and resets health, hunger, and thirst stats.

### 4. Dynamic Lua Evaluation (`eval_lua`)
```json
{
  "id": "cmd_004",
  "action": "eval_lua",
  "code": "local p = getPlayer(); p:Say('AI Command Executed!'); HaloTextHelper.addText(p, 'AI Link Active', 0, 255, 0);"
}
```
*Effect:* Executes arbitrary Lua code in the live game environment.

---

## 4. Companion Mod Script Implementation

The `Z_PZModStudio_Bridge` mod resides inside the user's mod directory (`Zomboid/mods/Z_PZModStudio_Bridge/`):

```lua
-- media/lua/client/PZModStudio_Bridge.lua
local Bridge = {}
Bridge.tickCounter = 0
Bridge.IPC_PATH = "pz_ipc_queue.json"
Bridge.RESP_PATH = "pz_ipc_resp.json"

function Bridge.OnTick()
    Bridge.tickCounter = Bridge.tickCounter + 1
    -- Poll the queue every 30 ticks (~0.5s)
    if Bridge.tickCounter % 30 ~= 0 then return end

    local player = getPlayer()
    if not player then return end

    local fileReader = getFileReader(Bridge.IPC_PATH, false)
    if not fileReader then return end

    local content = ""
    local line = fileReader:readLine()
    while line do
        content = content .. line
        line = fileReader:readLine()
    end
    fileReader:close()

    if content ~= "" and content ~= "{}" then
        -- Process JSON payload
        Bridge.ProcessCommand(content, player)
        
        -- Flush queue
        local fileWriter = getFileWriter(Bridge.IPC_PATH, true, false)
        if fileWriter then
            fileWriter:write("{}")
            fileWriter:close()
        end
    end
end

function Bridge.ProcessCommand(jsonStr, player)
    -- Parse command object and trigger actions (AddItem, Teleport, eval_lua)
end

Events.OnTick.Add(Bridge.OnTick)
```

---

## 5. Claude Agent Protocol (`Z_ClaudeAgent`)

`Z_ClaudeAgent` (source: `mods/Z_ClaudeAgent/`, installed by `install_claude_agent_mod` or `install_bridge_companion_mod` with `include_claude_agent: true`) is a second companion mod for agents that play the game. The bridge above only polls from `OnTick` with a player present; the Claude Agent polls from `OnFETick` (main menu), `OnTickEvenPaused` (in game, also paused) and `OnPreUIDraw`, so it also drives the new-game, sandbox-options, character-creation and spawn-select screens, and it returns values.

Files in `<Zomboid>/Lua/`:

| File | Writer | Content |
| :--- | :--- | :--- |
| `claude_cmd.lua` | agent | Line 1 `--id:<n>`, then Lua; the chunk may `return` a value. Runs once per new id. |
| `claude_out.txt` | mod | `id:<n>\n<ok\|err>\n<result>`; result is `CA.ser` output (JSON when the value serializes cleanly) or the error message. |
| `claude_log.txt` | mod | `CA.log(...)` lines, cleared at boot. |

The MCP server writes the command atomically (temp file + rename) with a fresh id and polls `claude_out.txt` until the same id appears or `timeout_ms` passes. Sending the whole `ClaudeAgent.lua` as a command hot-reloads it (event handlers are registered only once, guarded by `CA.registered`).

**Helpers on the global `CA`:** `state()`, `ui(filter)`, `find(text, type)`, `click(text, type)`, `answer("YES"|"NO"|"OK")`, `stats()`, `zombies(r)`, `speed(n)` (presses the speed-widget buttons: "Play", "Fast Forward x 1" = x5, "Fast Forward x 2" = x20, "Wait" = x40, since `SetCurrentGameSpeed` alone does not move the clock; fast-forward is refused near zombies), `walkTo(x,y,z)`, `travel(tx, ty, alert, hop)`, `findItem/take/invItem/equip/eat/inventory`, `findFood(r)`, `drink(r)`, `sleep(r)`, `craft(recipe, item)`, `wounds()`, `bandageAll()`, `busy()` (`{actions, current, moving}`), `flee(dist)`, `fight(radius, minHealth, crowd)`, `buildings(r)`, `enter(b)`, `door(x, y, want)` / `doorAt(x, y, z)`, `eachObject(r, fn, z)`, `zombies(r)` (with inside / sameBuilding flags), `methods(obj, filter)`, `fields(obj, filter)`, `try(fn)`, `task(name, ms, fn)` / `untask(name)`, `log(...)`. Distances use euclidean `getDistanceSq` (`DistTo` is ~1.41x off on diagonals). Under `-debug` the mod calls `UIManager.setShowLuaDebuggerOnError(false)` so errors do not freeze the game; cheats (`setGhostMode`, `setGodMod`, `setInvisible`) only work under `-debug`. `IsoStove` objects are replaced when toggled or burnt, so look them up again instead of keeping references. A hot reload keeps the running `CA.tasks`.

**MCP tools:** `agent_eval_lua` (any code; `wait_idle_ms` waits for `CA.busy().actions == 0` first), `agent_ui_list` (`CA.ui`), `agent_ui_click` (`CA.click`), `agent_dialog_answer` (`CA.answer`), `agent_game_state` (`CA.state`).

**Window tools (Win32, never take focus unless asked):**
- `game_window` `park` restores a minimized window (minimized GL windows stop presenting), moves it to 0,0 at 1280x720 (or `width`/`height`) and puts it at the bottom of the z-order with `SWP_NOACTIVATE`. `minimize` uses `SW_SHOWMINNOACTIVE`; `show` restores and brings it forward (thread-input attach + ALT tap, so `SetForegroundWindow` is allowed); `info` reports rect, client size, foreground and minimized state.
- `capture_game_screenshot` uses `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)`, which captures the game while other windows cover it, and saves a PNG (default `<temp>/pz-mod-studio/game_screenshot.png`, downscaled to `max_width`). `looks_blank: true` means the capture came back a single color.
- **Click to start:** after Continue/Play the game sits on a black "click to start" screen (GameLoadingState) that suppresses Lua callbacks, so the mod is silent there. `agent_enter_game` polls `CA.state()` (2 s timeout); once the mod has been silent >20 s it posts a centre click every ~3 s via `game_click_window` (WM_MOUSEMOVE + WM_LBUTTONDOWN/UP, no focus) until `"ingame":true`. Clicks are only sent while the mod is silent, so nothing in game gets clicked. `agent_ui_click` retries while `CA.click` answers "not found" (`retry_ms`, default 20 s), because menus build over several frames.
- `game_send_key` posts `WM_KEYDOWN` / `WM_KEYUP` to the game window (lParam = repeat 1 + `MapVirtualKeyW` scan code, extended bit for arrows/navigation keys); modifiers go down first and up last, so `SHIFT+O` works while the window is parked and unfocused.
- `launch_game` with `agent_mode: true` starts without `-debug` (under `-debug` the Lua debugger halts on any error, even inside `pcall`), adds `-windowed`, and runs a background guard that waits for the window, keeps it parked and hands focus back to the previously focused window for about 45 s while the game boots (`park` / `no_focus_steal` toggle each part).


## 6. Studio Link (`Z_StudioLink`)

Makes the game's Mods screen show the profile that is active in the Studio, and brings what the player changes there back to that profile. Source: `mods/Z_StudioLink/` (B42 only), compiled into the app and installed into `Zomboid/mods` whenever a profile is activated or changed (`studio_link::install_link_mod`). Every profile has it on and counts it as one of its mods; the Mod List does not let it be switched off while a profile is active.

**Profile members.** A profile holds `members` (its mods, on or off) besides `active_mod_ids`; anything else installed is outside it. Profiles from before have no `members` and are read as "the mods it has on". A mod switched on becomes a member; "Take out of the profile" in a Mod List row removes it and switches it off (`set_profile_members`).

| File | Writer | Content |
| :--- | :--- | :--- |
| `Zomboid/Lua/PZModStudio_Link.txt` | Studio | `profile=<name>` then `member=<mod id>` per member, in load order. Missing = no profile active: the mod leaves the game's screens alone. |
| `Zomboid/mods/default.txt` | both | The game rewrites it when its Mods screen is accepted. `studio_link::watch_mod_list` polls it every 2 s; a change that is not the Studio's own last write updates the active profile (active mods, order merged with `merge_game_order`, new members) and emits `profile-changed-in-game`. |
| `Zomboid/PZModStudio_JavaAgents.json` | Studio | The Java-agent VM args the Studio took out of `ProjectZomboid64.json`, so it only ever puts back its own. |

**In the game** (`PZModStudio_Link.lua`): wraps `ModSelector.Model:filterMods` to keep only members (and anything switched on), hides itself, adds a "Show all subscribed mods" tick and the profile name next to the game's "enabled only" tick, and wraps `MainScreen.checkSaveFile`: after the game's own checks pass, a save whose `mods.txt` uses a mod outside the profile is refused with the game's own error dialog (`displayCheckSavefileModal(text, true)`), naming the mods. A save without `mods.txt` uses the default list and is never refused.

**Zombie Buddy.** Its core is loaded by `-agentlib:zbNative` in the game's `ProjectZomboid64.json` (with `zbNative.dll` in the game folder), not through the mod list, so it ran with every profile; the mod list only decides which of its Java mods load (`[ZB] java mod list to load:` in `console.txt`). `studio_link::sync_java_agents` takes the line out when the active list lacks `ZombieBuddy` and puts it back first in `vmArgs` when it has it, at profile activation and at every launch from the Studio. Each change keeps the previous file in `Zomboid/PZModStudio_Backups`. Steam's "Verify integrity" restores the shipped file, which has no agent line at all.