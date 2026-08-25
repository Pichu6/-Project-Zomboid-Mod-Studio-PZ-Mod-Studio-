# 🧟 Project Zomboid Mod Studio (PZ Mod Studio)
### *A Free, Open-Source Desktop Suite for Mod Compatibility, 3-Way AST Merging, Load Order Management & Live Crash Diagnostics*

---

## 👋 Community Introduction & Message from the Author

> **Hello everyone!**
> 
> I wanted to share a tool I've been working on with the Project Zomboid community: **PZ Mod Studio**.
> 
> To be completely transparent: **this app is "vibe-coded" using AI assistance**. I am not a professional programmer and I don't know how to code by hand. However, throughout my own extensive testing, the app has been working and performing exactly as I hoped. 
> 
> I'm sharing it here with all of you so that anyone with coding knowledge and modding experience can review, improve, optimize, or fix things if needed. I am making the entire project **100% free and open-source (MIT License)**, leaving the repository, portable executables, and technical documentation available for everyone to inspect and test.
> 
> A dedicated tool like this didn't exist yet for Project Zomboid, and I believe it can be genuinely helpful for players, server admins, and modders alike.
> 
> ### 🧪 What It Can Do & What Still Needs Community Testing
> 
> - **Virtual File & Script Merging (Tested & Working Great):** If two or more mods overwrite the same vanilla file (Lua scripts or `.txt` definitions), the app parses them and performs a **3-Way AST merge**, combining non-overlapping changes into a single synthetic patch mod (`Z_PZModStudio_MergedPatch`). In my testing, this completely eliminated file-overwrite conflicts in my mod list and allowed incompatible mods to run together seamlessly.
> - **Build 41 / SP Mods in Build 42 & Multiplayer (Experimental / Work in Progress):** In theory, the built-in **Polyfill Engine** injects runtime compatibility shims (such as wrapping B41 String arguments into B42 Enums, creating safe proxies for uninitialized globals, and sanitizing string formats) to help run older B41 and Singleplayer mods in B42 Multiplayer. 
>   - *My test results:* I tested **Brita's Weapon/Armor mods (B41)** and **Week One Bandits** on a **B42 Dedicated Multiplayer Server**, and I actually managed to get them running and playable, albeit with a few minor errors/quirks.
>   - *The limitation:* Because compatibility is largely case-by-case, and because I don't code myself, I rely on AI to diagnose and repair those specific stacktrace errors. As we all know, AI code generation isn't always 100% reliable—sometimes fixing one error can introduce another. This is exactly where community contributions, refined polyfill rules, and developer feedback will be invaluable!

---

## 📑 Table of Contents

1. [What is PZ Mod Studio?](#1-what-is-pz-mod-studio)
2. [Download & Quick Start (Portable Edition)](#2-download--quick-start-portable-edition)
3. [The Interface — Tab by Tab](#3-the-interface--tab-by-tab)
   - [3.1 Profiles](#31-profiles)
   - [3.2 Mod List (Load Order Manager & Presets)](#32-mod-list-load-order-manager--presets)
   - [3.3 Mod Merger (3-Way AST Conflict Resolution)](#33-mod-merger-3-way-ast-conflict-resolution)
   - [3.4 Monitor Center (Live Log Inspector & Crash Cards)](#34-monitor-center-live-log-inspector--crash-cards)
   - [3.5 Servers (Dedicated Server Runner & Live Console)](#35-servers-dedicated-server-runner--live-console)
   - [3.6 App Settings (Paths, Polyfills & AI Integration)](#36-app-settings-paths-polyfills--ai-integration)
4. [Step-by-Step UX Flow (How to Use It)](#4-step-by-step-ux-flow-how-to-use-it)
5. [Sharing Mod Lists (.pzpack) & Master Patches](#5-sharing-mod-lists-pzpack--master-patches)
6. [AI Agent Integration (Model Context Protocol / MCP)](#6-ai-agent-integration-model-context-protocol--mcp)
7. [How Mod Studio Interacts with Project Zomboid](#7-how-mod-studio-interacts-with-project-zomboid)
8. [Open Source & Git Guide (Building & Contributing)](#8-open-source--git-guide-building--contributing)
9. [Tech Stack & Architecture](#9-tech-stack--architecture)
10. [FAQ (Frequently Asked Questions)](#10-faq-frequently-asked-questions)

---

## 1. What is PZ Mod Studio?

**Project Zomboid Mod Studio (PZ Mod Studio)** is a lightweight, portable desktop suite built with **Tauri 2.0 (Rust backend)** and **React 19 (TypeScript frontend)** designed to solve mod conflicts, broken load orders, and version breaks in Project Zomboid.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          PZ MOD STUDIO SUITE                           │
├───────────────────┬───────────────────┬────────────────────────────────┤
│   PROFILES & VFS  │  3-WAY AST MERGER │   MONITOR & CRASH DIAGNOSTICS  │
│ Manage mod lists, │ Merge conflicting │ Live console.txt watcher with  │
│ topological sort, │ Lua/txt files     │ 1-click polyfill error cards   │
│ & .pzpack presets │ without overrides │ and live companion bridge      │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

### The Core Problem It Solves

In Project Zomboid's Virtual File System (VFS), when two mods modify the same vanilla file (e.g. `ISInventoryPane.lua` or an item script), **only the mod loaded last takes effect**. The first mod's changes are completely overwritten and lost, causing game-breaking bugs or silent feature loss.

**PZ Mod Studio solves this by:**
1. Identifying all overlapping files across Vanilla, Steam Workshop, and local mod folders.
2. Parsing the Lua code into an **Abstract Syntax Tree (AST)** using the Rust `full_moon` parser.
3. Performing a **3-Way Merge** (Vanilla Base vs. Mod A vs. Mod B) to keep both mods' unique code.
4. Packaging the resolved code into a custom synthetic mod (`Z_PZModStudio_MergedPatch`) that loads last in your load order.

---

## 2. Download & Quick Start (Portable Edition)

### 📦 Zero-Install Portable Version

1. Go to the **[GitHub Releases Page](https://github.com/Pichu6/Project-Zomboid-Mod-Studio/releases)**.
2. Download `PZ-Mod-Studio-Portable.zip`.
3. Extract the folder anywhere on your PC (e.g., Desktop or a dedicated folder).
4. Inside, you'll find:
   - `Project-Zomboid-Mod-Studio.exe` — **The main desktop app**. Double-click to launch.
   - `pz-mcp-server.exe` — **The standalone MCP server** for AI assistants (Claude, Cursor, Antigravity).
   - `README_PORTABLE.txt` — Quick reference guide.
5. **No installer, no extra dependencies, and no administrative privileges required.**

### System Requirements
- **OS:** Windows 10 or Windows 11 (64-bit).
- **Runtime:** Microsoft Edge WebView2 (included by default in modern Windows).

### Initial Launch & Auto-Detection
When you first run the app:
- A cinematic splash screen initializes the Rust backend.
- The app automatically detects your **Project Zomboid install directory**, **Steam Workshop content folder** (`108600`), and user **`Zomboid/` folder**.
- If your game is installed in a custom non-Steam library, you can easily point to it in the **App Settings** tab.

---

## 3. The Interface — Tab by Tab

The app features a persistent **Top Header** and a **Left Sidebar** connecting 6 core modules:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Logo] PZ Mod Studio   [Profile: B42 Brita]  [Conflicts: 4]  [▶ Launch Debug]│
├──────────────┬───────────────────────────────────────────────────────────────┤
│ 📂 Profiles  │                                                               │
│ 📊 Monitor   │                     MAIN CONTENT AREA                         │
│ 📋 Mod List  │              (Module-specific workspace)                      │
│ 🔀 Merger    │                                                               │
│ 🖥️ Servers   │                                                               │
│ ⚙️ Settings   │                                                               │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

---

### 3.1 📂 Profiles

The **Profiles** tab allows you to create, save, and switch between completely isolated mod list configurations with **1 click**.

- **Multi-Profile Management:** Create separate setups such as *"Solo Vanilla+ B42"*, *"Hardcore Survival (Brita + Bandits)"*, or *"Co-op Server Client"*.
- **Instant Activation:** Clicking **"Activate (1-Click)"** writes the profile's active mods and exact load order directly to your game's `ModListData.ini` and `default.txt`.
- **Edit & Clone:** Rename profiles, update descriptions, or duplicate existing setups.
- **Safety Gate:** Other studio tabs are locked until an active profile is selected, preventing accidental desynchronization.

---

### 3.2 📋 Mod List (Load Order Manager & Presets)

A comprehensive mod management center that reads both **Steam Workshop items** and **local mods**.

- **Automatic Dependency Health Inspector:**
  - 🔴 **Missing Dependencies:** Identifies mods that require frameworks/libraries not installed on your system, complete with Steam Workshop lookup.
  - 🟡 **Disabled Dependencies:** Flags when a required base mod is installed but currently toggled OFF.
  - 🟠 **Load Order Violations:** Warns you when a mod loads *before* the library it depends on, offering a 1-click **"Fix Order"** button.
  - ⚠️ **Incompatible Variants:** Detects conflicting editions of the same mod family (e.g. GunFighter 1.0 vs GunFighter 2.0).
- **Auto-Sort Dependencies:** Executes a **Topological Sort algorithm (Kahn's algorithm)** with mod family cohesion scoring to arrange your entire list in the mathematically optimal order.
- **Multi-Mod Package Grouping:** Color-codes sub-mods that belong to the same Steam Workshop download so you can manage modular packs easily.
- **Rich Text Manifest Viewer:** Renders PZ's native formatting tags (`<SIZE:large>`, `<RGB:r,g,b>`, `<LINE>`) directly from `mod.info` files.
- **Preset Collections (`.pzpack`):**
  - **Export:** Export your entire mod list and load order into a shareable `.pzpack` file.
  - **Import & Missing Mod Report:** When importing a friend's preset, the studio scans your system and provides a detailed report showing installed mods vs. missing mods (with clickable Steam Workshop links).

---

### 3.3 🔀 Mod Merger (3-Way AST Conflict Resolution)

The engine that eliminates mod overwrite incompatibilities.

- **VFS Conflict Detection:** Scans the virtual file paths of all enabled mods against vanilla game files (`media/lua/` and `media/scripts/`).
- **3-Way Lua AST Merger:** Uses the Rust `full_moon` crate to parse Lua code trees:
  - Compares `Vanilla Base` vs `Mod A` vs `Mod B`.
  - Merges distinct function additions, variable changes, and event hooks automatically.
- **Integrated Monaco Code Editor:** When conflicting mods modify the *exact same line/function*, the app provides a full VS Code-grade side-by-side diff editor with syntax highlighting, allowing you to choose changes or hand-edit the merged output.
- **Master Patch Packaging (`Z_PZModStudio_MergedPatch`):** With one click of **"Auto-Merge All"**, the engine compiles all resolved files into a clean synthetic mod placed in `Zomboid/mods/Z_PZModStudio_MergedPatch`.
- **Multi-Package Management:** Create custom named patch packages (e.g., `Z_PZModStudio_VehiclesPatch`, `Z_PZModStudio_WeaponsPatch`).

---

### 3.4 📊 Monitor Center (Live Log Inspector & Crash Cards)

A real-time telemetry and debugging lab.

- **Real-Time `console.txt` Streaming:** Watches game logs live without needing external text editors.
- **Log Severity Filters:** Toggle between `ALL`, `ERRORS ONLY`, `LUA`, `JAVA`, and `BRIDGE IPC` logs.
- **Translation Spam Filter:** Intelligently filters out hundreds of missing translation warning lines that usually clutter `console.txt`.
- **Interactive Crash Diagnostic Cards:** When an exception occurs (`KahluaThreadException`, `NoSuchMethodError`, `UnknownFormatConversionException`), the parser extracts the exact file and line number and generates an explanation card.
- **1-Click "Apply Fix" Polyfills:** If an error matches a known compatibility issue (e.g., B41 String passed to a B42 Enum), the card features an **"Apply Fix"** button that activates the corresponding rule and rebuilds the Master Patch automatically.

---

### 3.5 🖥️ Servers (Dedicated Server Runner & Live Console)

A control suite for running and managing dedicated multiplayer servers.

- **Host Tab:** Launch the PZ dedicated server process directly with configurable RAM allocation (4GB, 6GB, 8GB, 16GB) and `-nosteam` mode toggles.
- **Mods Sync:** Automatically generates the correct `Mods=` and `WorkshopItems=` server config strings from your active client profile.
- **Live Players Tab:** Displays connected players in real-time with ping, health status, coordinates $(X, Y, Z)$, and moderation tools (Kick player with reason, broadcast server announcement).
- **Live Server Console:** Real-time terminal output with an input field to send server RCON commands directly.
- **Quick Settings:** Fast editing of server name, passwords, max players, PvP rules, and map lists.

---

### 3.6 ⚙️ App Settings (Paths, Polyfills & AI Integration)

- **Path Configuration:** Edit and re-verify Project Zomboid installation, Steam Workshop (`108600`), and user `Zomboid/` folder paths with native folder pickers.
- **Polyfill Rules Library:** Enable/disable specific syntax transformation rules:
  - *Body Location String to Enum Wrapper* (`player:getWornItem`)
  - *Safe Access to Uninitialized Globals* (`ISInventoryPane` proxy)
  - *Sanitize Translator Format Strings* (`Translator.getText` format fix)
  - *Require Path Redirects* (Mapping legacy paths to B42 folders)
  - *Deprecated Event Hook Migration* (`Events.OnFillContainer`)
- **AI Agent (MCP) Setup:** Quick-copy configuration snippets for connecting AI assistants.

---

## 4. Step-by-Step UX Flow (How to Use It)

Here is the standard workflow to set up, merge, and play with your mod list:

```
[ Step 1: Launch App ] ──▶ Portable .exe auto-detects your PZ installation.
           │
[ Step 2: Profiles ]   ──▶ Create or activate a profile (e.g. "B42 Survival").
           │
[ Step 3: Mod List ]   ──▶ Enable desired mods. Click "Auto-Sort" to resolve
           │               load order violations.
           │
[ Step 4: Mod Merger ] ──▶ Click "Scan Conflicts". Click "Auto-Merge All" to 
           │               generate the synthetic Master Patch mod.
           │
[ Step 5: Launch ]     ──▶ Click "Launch Debug (Fullscreen)" in the header.
           │               App switches to Monitor Center.
           │
[ Step 6: Diagnostics] ──▶ If a crash occurs, click "Apply Fix" on the Error Card
           │               and relaunch.
           │
[ Step 7: Play! ]      ──▶ Launch in Normal Mode and enjoy a clean, conflict-free game.
```

---

## 5. Sharing Mod Lists (.pzpack) & Master Patches

### How to Share Your Mod Setup with Friends

#### 1. Exporting a Mod Preset (`.pzpack`)
1. In the **Mod List** tab, click **Export (📤)**.
2. Choose where to save your `.pzpack` file (e.g., `MyServerMods.pzpack`).
3. Send this file to your friends or community.

#### 2. Importing a Preset
1. Your friend opens PZ Mod Studio, goes to **Mod List**, and clicks **Import (📥)**.
2. The app inspects their system:
   - Mods they already have are enabled automatically.
   - Any missing mods are listed with one-click **Steam Workshop links** so they can subscribe immediately.
3. Clicking **Apply** sets the exact same load order on their machine.

#### 3. Sharing the Resolved Merge Patch
If you merged conflicting mods, your friend doesn't need to re-merge them manually:
1. Go to your `Zomboid/mods/Z_PZModStudio_MergedPatch/` folder.
2. Zip this folder and send it to your friends/server players.
3. They place it in their `Zomboid/mods/` folder and activate it. It loads last and provides all the merged scripts.

---

## 6. AI Agent Integration (Model Context Protocol / MCP)

PZ Mod Studio includes a native **MCP Server** (`pz-mcp-server.exe`) adhering to the **MCP 2024-11-05 standard** (JSON-RPC 2.0 over stdio). 

This allows AI assistants like **Claude Desktop**, **Cursor**, **Windsurf**, or **Antigravity** to directly inspect game state, debug crashes, and manage mods.

```
┌─────────────────────────┐          stdio (JSON-RPC)          ┌──────────────────────────┐
│   AI Assistant (Client) │ ◄────────────────────────────────► │     pz-mcp-server.exe    │
│ (Claude, Cursor, etc.)  │                                    │  (Rust MCP Tools Engine) │
└─────────────────────────┘                                    └────────────┬─────────────┘
                                                                            │ Reads & Writes
                                                                            ▼
                                                               ┌──────────────────────────┐
                                                               │  Project Zomboid Game    │
                                                               │  console.txt / IPC Bridge│
                                                               └──────────────────────────┘
```

### 🛠️ Key MCP Tools Exposed to AI Agents

| Category | Tools | Description |
| :--- | :--- | :--- |
| **Diagnostics & Logs** | `get_monitor_logs`, `get_crash_diagnostics`, `read_log_file` | Reads `console.txt`, parses stacktraces, returns diagnostic cards. |
| **Process Control** | `get_game_status`, `launch_game`, `terminate_game` | Checks PID, launches PZ with `-debug`, kills hung processes. |
| **Live Game IPC** | `send_game_ipc_command`, `get_game_ipc_response`, `install_bridge_companion_mod` | Evaluates Lua in real-time, spawns items, checks player state. |
| **Mods & Load Order** | `get_studio_paths`, `list_installed_mods`, `sort_mod_load_order`, `scan_mod_conflicts` | Auto-detects paths, resolves topological load orders, scans VFS. |
| **AST Merging** | `validate_lua_syntax`, `merge_lua_scripts`, `save_draft_resolution` | AST syntax validation (`full_moon`), 3-way merge, saves patch drafts. |
| **Profiles** | `list_mod_profiles`, `create_mod_profile`, `activate_mod_profile` | Programmatic profile management. |

### Configuration Snippets

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\PZ-Mod-Studio-Portable\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### Cursor / Windsurf / VS Code (`mcp.json`)
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\PZ-Mod-Studio-Portable\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### Antigravity / Gemini CLI (`.gemini/settings.json`)
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "C:\\Path\\To\\PZ-Mod-Studio-Portable\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

---

## 7. How Mod Studio Interacts with Project Zomboid

### 🛡️ Non-Invasive, File-Based Architecture

PZ Mod Studio **does NOT inject DLLs, modify executable memory, or alter core game installation files**. 

It interacts purely through native file system operations:
1. **Load Order:** Reads and writes the game's official `Zomboid/ModListData.ini` and `default.txt` files.
2. **Patch Delivery:** Merged files are written to a standard mod folder (`Zomboid/mods/Z_PZModStudio_MergedPatch/`) containing a valid `mod.info`. The game loads it naturally on startup.
3. **Telemetry:** Reads `console.txt` and session logs from `Zomboid/Logs/`.
4. **Live IPC Bridge (Optional):** When using live AI debugging, the companion mod `Z_PZModStudio_Bridge` listens to `Zomboid/Lua/pz_ipc_queue.json` on `OnTick` and writes output to `pz_ipc_resp.json`.

---

## 8. Open Source & Git Guide (Building & Contributing)

PZ Mod Studio is open-source under the **MIT License**. Developers, modders, and contributors are warmly invited to inspect the code, fix bugs, and add features.

### 🔗 Repository Links
- **GitHub Repository:** [https://github.com/Pichu6/Project-Zomboid-Mod-Studio](https://github.com/Pichu6/Project-Zomboid-Mod-Studio)

### 🛠️ Building from Source

#### Prerequisites
- **Node.js:** v22+
- **Rust Toolchain:** Stable (`rustup default stable`)
- **Git**

#### Steps
```bash
# 1. Clone the repository
git clone https://github.com/Pichu6/Project-Zomboid-Mod-Studio.git
cd Project-Zomboid-Mod-Studio

# 2. Install frontend dependencies
npm install

# 3. Run in development mode (hot-reload frontend + Rust backend)
npm run tauri dev

# 4. Build the standalone portable release
npm run build:portable
```

### 📂 Repository Structure

```
PZ-Mod-Studio/
├── src/                               # React 19 Frontend
│   ├── components/
│   │   ├── instances/                 # Profile manager
│   │   ├── layout/                    # Header, Sidebar, Splash
│   │   ├── load_order/                # Mod List & dependency sorting
│   │   ├── merger/                    # 3-Way AST Merge & Monaco Editor
│   │   ├── sandbox/                   # Monitor Center & Crash Inspector
│   │   ├── server/                    # Dedicated server manager
│   │   └── settings/                  # Paths & polyfills configuration
│   ├── services/tauri.ts              # Typed Rust IPC bridge
│   └── types/index.ts                 # Shared TypeScript interfaces
├── src-tauri/                         # Rust Backend (Tauri 2.0)
│   ├── src/
│   │   ├── bin/mcp_server.rs          # Standalone MCP CLI binary
│   │   ├── diff_engine/               # Lua AST parser (full_moon) & diffing
│   │   ├── load_order/                # mod.info parser & topological sort
│   │   ├── mcp/                       # MCP 2024-11-05 JSON-RPC server
│   │   ├── patch_generator/           # Master Patch mod compiler
│   │   ├── sandbox/                   # Game process control & IPC queue
│   │   ├── server_manager/            # Dedicated server manager
│   │   └── vfs/                       # Virtual File System conflict detector
│   └── Cargo.toml
├── docs/                              # 9-Chapter Technical Wiki on PZ internals
├── AGENTS.md                          # Master guide for AI agents & MCP integration
└── scripts/package-portable.js        # Packaging script for portable distribution
```

### 🤝 How You Can Help / Contributing Areas
- **Refining Polyfill Rules:** Adding new AST/runtime shims for common B41→B42 API changes in `src/data/default_rules.ts`.
- **Merge Engine Edge Cases:** Improving AST resolution for complex table manipulations.
- **Translations:** Adding multi-language support to the UI.
- **Linux / SteamDeck Testing:** Validating path resolution on Proton/Linux environments.

---

## 9. Tech Stack & Architecture

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Desktop Framework** | **Tauri 2.0** | Ultra-lightweight (~11 MB executable), low RAM usage (50-80 MB), native Windows performance without shipping Chromium. |
| **Backend Language** | **Rust** | High-speed VFS directory scanning, safe concurrency, and low-latency file I/O. |
| **Lua AST Parser** | **`full_moon` crate** | Complete Lua 5.1 abstract syntax tree parsing for structural code diffing. |
| **Diff Engine** | **`similar` crate** | High-performance Myers and LCS diffing algorithms for line and block comparison. |
| **Frontend Framework**| **React 19 + TypeScript** | Modern component lifecycle, strict type safety. |
| **Styling** | **Tailwind CSS 4** | Sleek, fast, responsive dark-mode UI. |
| **Code Editor** | **Monaco Editor** | The VS Code editor engine running in the browser for side-by-side diffing and syntax highlighting. |
| **AI Protocol** | **Model Context Protocol (MCP)** | Standardized JSON-RPC 2.0 tool interface for AI agents. |

---

## 10. FAQ (Frequently Asked Questions)

#### Q: Does this replace the in-game mod menu?
**A:** You can use both! When you configure and activate a profile in PZ Mod Studio, it writes directly to `ModListData.ini`. When you launch Project Zomboid, the game loads your exact configured mod list and order automatically.

#### Q: Will using the Mod Merger modify or corrupt my original mod files?
**A:** No. PZ Mod Studio strictly treats your Steam Workshop and local mod files as **read-only**. All merged scripts and compatibility fixes are written into a separate, isolated mod folder (`Z_PZModStudio_MergedPatch`). Disabling or deleting this folder instantly restores everything to its default state.

#### Q: Do I have to keep PZ Mod Studio open while playing?
**A:** No. Once you have saved your profile and generated the Master Patch, you can close the studio completely and launch the game directly from Steam. You only need to reopen the studio when you want to change your mods, update patches, or monitor live logs.

#### Q: Is the AI / MCP integration mandatory?
**A:** Not at all. The entire app (Mod List, 3-Way AST Merger, Profiles, Presets, Dedicated Server Manager, and Crash Inspector) functions 100% locally and offline without any AI tools or internet connection. The MCP server is an optional bonus for users who enjoy debugging with AI assistants.

#### Q: Where can I report bugs or submit feature suggestions?
**A:** Please open an issue or pull request on the **[GitHub Repository](https://github.com/Pichu6/Project-Zomboid-Mod-Studio)** or reply right here in this forum thread!

---

*Project Zomboid is a registered trademark of The Indie Stone. PZ Mod Studio is an unofficial, community-made, free and open-source project.*
