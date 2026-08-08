# 🧟 Project Zomboid Mod Studio (PZ Mod Studio)

> **The ultimate desktop suite for managing, resolving conflicts, and ensuring mod compatibility in Project Zomboid, across any Build.**

---

## 🇬🇧 English Description

### Overview
**Project Zomboid Mod Studio (PZ Mod Studio)** is a high-performance, portable desktop application designed to solve mod conflicts and version breaks in **Project Zomboid (Build 42+ & legacy builds)**.

Far beyond a simple *script merger*, **PZ Mod Studio** provides a comprehensive 4-module studio suite that allows players and modders to intelligently merge Lua code & game scripts, inject compatibility layers for outdated mods (Polyfills), manage load order (`ModListData.ini`), and diagnose startup errors in an isolated sandbox lab.

---

### ✨ Key Features

- **🔀 Virtual Path Conflict Detector & Dual 3-Way AST Merger:**
  Overlays Vanilla paths (`media/lua/` & `media/scripts/`), Steam Workshop content, and Local Mods. Automatically merges non-overlapping edits in Lua files and PZ data script blocks (`.txt` files for items, recipes, fluids, vehicles).
- **🛡️ JSON-Driven Polyfill Engine (B42 Compatibility):**
  Injects static and dynamic syntax patches to fix legacy B41 calls (String-to-Enum conversions, uninitialized global table safety, `require` path redirection, and Java `Translator.getText` format string sanitization).
- **📋 Load Order & Dependency Manager:**
  Reads and writes directly to `ModListData.ini` and `mod.info` manifests. Performs topological dependency sorting to highlight missing base mods and save custom mod list profiles.
- **🧪 Test Sandbox Lab & Crash Inspector (`console.txt`):**
  Launches isolated test runs (`-cachedir`, `-debug`) and intercepts crashes in `console.txt`, translating raw Java/Lua stacktraces into actionable, human-readable 1-click solutions.

---

### 🛠️ Tech Stack

- **Frontend:** React + TypeScript + TailwindCSS + Monaco Editor (VS Code Engine).
- **Backend:** Rust + Tauri (Blazing fast Virtual File System scanner & AST diffing).
- **Format:** Portable executable (no installer required, ready for GitHub Releases).

---

## 🇪🇸 Descripción en Español

### Visión General
**Project Zomboid Mod Studio (PZ Mod Studio)** es una aplicación de escritorio portátil de alto rendimiento diseñada para resolver los conflictos de mods y las roturas de versión en **Project Zomboid (Build 42+ y versiones anteriores)**.

Ofrece una suite de 4 módulos para combinar código Lua y scripts de datos, inyectar capas de compatibilidad (Polyfills), administrar el orden de carga (`ModListData.ini`) y diagnosticar errores en un laboratorio de pruebas aislado.

---

## 📄 License

MIT License - Free and open-source for the Project Zomboid community.
