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
