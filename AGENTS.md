# Project Zomboid Mod Studio — AI Agent & MCP Integration Guide

This file serves as the **master technical reference guide for AI Agents** (Antigravity, Claude, Cursor, Cline, Windsurf, Roo Code, etc.) working on this repository or connecting to **PZ Mod Studio** via the **Model Context Protocol (MCP)**.

---

## 1. 🏗️ Overall Project Architecture

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Monaco Editor, Lucide Icons.
- **Backend:** Tauri 2.0 (Rust) with specialized crates:
  - `full_moon`: AST parsing and static analysis for Lua code.
  - `similar`: Line-by-line and chunk-by-chunk diffing algorithms.
  - `dirs-next` / `walkdir`: Filesystem resolution and recursive scanning.
- **MCP Server:** Pure Rust implementation (`src-tauri/src/mcp/`) adhering to the **MCP 2024-11-05 (JSON-RPC 2.0 over stdio)** standard.

---

## 2. 🔌 Connecting an Agent to the MCP Server

The MCP server can be launched as a dedicated console binary or via the `--mcp` CLI flag on the main executable.

### Executable Paths
- **Portable console binary (Recommended):**
  `C:\Path\To\Project-Zomboid-Mod-Studio\pz-mcp-server.exe`
- **Development build:**
  `C:\Path\To\src-tauri\target\release\pz-mcp-server.exe`
- **Main application CLI flag:**
  `C:\Path\To\Project-Zomboid-Mod-Studio\Project-Zomboid-Mod-Studio.exe --mcp`

### JSON Configuration Snippets

#### For Antigravity / Gemini CLI (`.gemini/settings.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\Project-Zomboid-Mod-Studio\\pz-mcp-server.exe",
      "args": [],
      "env": {}
    }
  }
}
```

#### For Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\Project-Zomboid-Mod-Studio\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### For Cursor / Windsurf (`mcp.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\Project-Zomboid-Mod-Studio\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### For VS Code (Roo Code / Cline / Offline Ollama & LM Studio — `cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\Project-Zomboid-Mod-Studio\\pz-mcp-server.exe",
      "args": [],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

#### For OpenAI / Codex / ChatGPT MCP Bridges:
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\Project-Zomboid-Mod-Studio\\pz-mcp-server.exe",
      "args": [],
      "description": "Project Zomboid Mod Studio MCP Server (Build 41/42 AST & Live Bridge)"
    }
  }
}
```

---

## 3. 🛠️ MCP Tool Catalog (*Tools*)

Connected MCP clients can invoke the following tools via `tools/call`:

### Diagnostics, Monitor Center & Process Control
| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `get_game_status` | `{}` | Checks whether `ProjectZomboid64.exe` is running and returns its Process ID (PID). |
| `launch_game` | `debug_mode` (bool), `windowed` (bool), `nosteam` (bool), `extra_args` (array) | Launches `ProjectZomboid64.exe` with configurable debug flags and windowed mode. |
| `terminate_game` | `pid` (int optional), `force` (bool default true) | Closes or forcefully terminates the Project Zomboid process. |
| `send_game_ipc_command` | `command` (object: `give_item`, `eval_lua`, `set_godmode`, etc.) | Sends a command to the active game session through the companion mod `Z_PZModStudio_Bridge`. |
| `get_game_ipc_response` | `{}` | Reads the latest execution response returned by the companion mod. |
| `install_bridge_companion_mod` | `user_zomboid_dir` (optional) | Installs the companion mod `Z_PZModStudio_Bridge` into `Zomboid/mods` to enable the IPC bridge. |
| `get_monitor_logs` | `max_lines` (int, default 100)<br>`errors_only` (bool)<br>`user_zomboid_dir` (string optional) | Reads and filters recent lines from the active log file `console.txt`. |
| `list_available_logs` | `user_zomboid_dir` (optional) | Lists all session log files on disk (`console.txt` and `Zomboid/Logs/`). |
| `read_log_file` | `file_path` (string required)<br>`max_lines` (int)<br>`errors_only` (bool) | Reads a specific log file with exception filtering. |
| `get_crash_diagnostics` | `user_zomboid_dir` (string optional) | Parses Java/Lua exceptions and generates Build 41 & 42 diagnostic cards with recommended fixes and polyfills. |

### Paths, Mods, Profiles & Load Order
| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `get_studio_paths` | `{}` | Auto-detects and returns installation paths for the game, Steam Workshop, and user Zomboid folder. |
| `list_installed_mods` | `pz_install_dir`, `user_zomboid_dir`, `workshop_dir` (optional) | Scans and lists all installed Steam Workshop and local mods along with metadata and IDs. |
| `sort_mod_load_order` | Same path parameters | Executes topological dependency sorting and detects circular or missing dependencies. |
| `scan_mod_conflicts` | Same path parameters | Scans the Virtual File System (VFS) to detect collisions between mods and the vanilla base game. |
| `list_mod_profiles` | `user_zomboid_dir` (optional) | Lists all saved mod profiles, active mod IDs, and custom load orders. |
| `create_mod_profile` | `name` (string required)<br>`description` (string)<br>`active_mod_ids` (array)<br>`load_order` (array) | Creates a new independent mod combination profile. |
| `activate_mod_profile` | `profile_id` (string required) | Activates a mod profile and writes it directly to `default.txt` / `ModListData.ini`. |

### Merge Engine & Patch Generator
| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `validate_lua_syntax` | `code` (string required) | Validates Lua syntax using the AST parser (`full_moon`), providing exact line and column numbers on error. |
| `merge_lua_scripts` | `base`, `target_a`, `target_b` (strings required) | Performs a 3-way AST merge between a base script and two conflicting mod variants. |
| `list_merged_packages` | `user_zomboid_dir`, `mod_list_ini_path` (optional) | Lists all patch and merged packages (`Z_PZModStudio_*`) registered in the system. |
| `get_master_patch_status` | `user_zomboid_dir`, `package_folder_name` (optional) | Queries the status of the `Z_PZModStudio_MasterPatch` package and saved resolutions. |
| `save_draft_resolution` | `relative_path`, `resolved_content` (required)<br>`package_folder_name`, `status` (optional) | Saves a resolved code draft directly into the master patch package. |

---

## 4. 📚 MCP Resource Catalog (*Resources*)

Passive read endpoints available via `resources/read`:

1. `pz://monitor/console-log`: Real-time streaming content of `console.txt`.
2. `pz://mods/installed-summary`: JSON summary of detected mods and load order.
3. `pz://paths/config`: System path configuration (`StudioPaths`).
4. `pz://patches/status`: Master patch package and draft resolution status.

---

## 5. 🧠 Technical Knowledge Base & Modular Wiki (`docs/`)

For in-depth architectural details, refer to the [**Modular Technical Wiki**](docs/INDEX.md):

- **[01. Engine Architecture, JVM & Kahlua VM](docs/01-engine-architecture-kahlua-jvm.md):** Java vs Lua types (List vs Table, 0-based vs 1-based indexing).
- **[02. Lua Script Lifecycle & Event Bus](docs/02-lua-lifecycle-and-events.md):** `shared`/`client`/`server` phases, alphabetical order, and Monkey Patching.
- **[03. Item Definitions, Crafting & Fluid API (B42)](docs/03-crafting-items-and-fluids-b42.md):** `craftRecipe`, `Tags`, physical inheritance, and `FluidContainer`.
- **[04. UI Hierarchy, Context Menus & Timed Actions](docs/04-ui-context-menu-and-timedactions.md):** `ISUIElement`, `OnFillWorldObjectContextMenu`, and `ISBaseTimedAction` state machine.
- **[05. Loot Distribution & Procedural Spawning](docs/05-loot-distribution-and-spawns.md):** `ItemPickerJava`, `ProceduralDistributions.lua`, and container APIs.
- **[06. ModData Persistence, Networking & Security](docs/06-networking-moddata-and-security.md):** Persistence scopes, client-server sync, and CHAP anti-cheat attestation.
- **[07. FMOD Audio, JSON Translations & 3D Z-Levels](docs/07-sound-translations-and-b42-space.md):** Sound scripts, mandatory JSON format (B42.15+), and Z-coordinates (-32 to +32).
- **[08. Crash Diagnostics, VFS & 3-Way AST Merging](docs/08-crash-diagnostics-and-vfs.md):** `console.txt` error taxonomy and 3-way AST merge.
- **[09. Game Process Control & Live IPC Bridge](docs/09-game-control-and-ipc-bridge.md):** `ProjectZomboid64.exe` lifecycle control and live in-game execution.

---

## 6. 💻 Development & Build Commands

```powershell
# Compile the standalone MCP server (Fast, no GUI):
cargo build --bin pz-mcp-server --manifest-path "src-tauri/Cargo.toml"

# Run the full desktop application in development mode:
npm run tauri dev

# Build production bundle:
npm run build
```
