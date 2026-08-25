# Project Zomboid Mod Studio — AI Agent & MCP Integration Guide

Este archivo sirve como **guía maestra de referencia técnica para agentes de IA** (Antigravity, Claude, Cursor, Cline, Windsurf, Roo Code, etc.) que trabajen en este repositorio o que se conecten a **PZ Mod Studio** a través del protocolo **Model Context Protocol (MCP)**.

---

## 1. 🏗️ Arquitectura General del Proyecto

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Monaco Editor, Lucide Icons.
- **Backend:** Tauri 2.0 (Rust) con crates especializadas:
  - `full_moon`: Parsing de AST y análisis estático de código Lua.
  - `similar`: Algoritmos de diffing línea por línea y bloque por bloque.
  - `dirs-next` / `walkdir`: Resolución y escaneo recursivo del sistema de archivos.
- **Servidor MCP:** Implementado en Rust puro (`src-tauri/src/mcp/`) bajo el estándar **MCP 2024-11-05 (JSON-RPC 2.0 sobre stdio)**.

---

## 2. 🔌 Cómo Conectar un Agente al Servidor MCP

El servidor MCP puede ejecutarse como un binario de consola dedicado o mediante el flag `--mcp` del ejecutable principal.

### Rutas de los Ejecutables
- **Binario de consola directo (Recomendado para MCP):**
  `e:\PZ Mod Studio\src-tauri\target\debug\pz-mcp-server.exe`
- **Compilación en Release:**
  `e:\PZ Mod Studio\src-tauri\target\release\pz-mcp-server.exe`
- **Flag CLI del ejecutable principal:**
  `e:\PZ Mod Studio\src-tauri\target\debug\pz-mod-studio.exe --mcp`

### Fragmento de Configuración JSON

#### Para Antigravity / Gemini CLI (`.gemini/settings.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "e:\\PZ Mod Studio\\src-tauri\\target\\debug\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### Para Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "e:\\PZ Mod Studio\\src-tauri\\target\\debug\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

#### Para Cursor / Windsurf / VS Code (`mcp.json`):
```json
{
  "mcpServers": {
    "pz-mod-studio": {
      "command": "e:\\PZ Mod Studio\\src-tauri\\target\\debug\\pz-mcp-server.exe",
      "args": []
    }
  }
}
```

---

## 3. 🛠️ Catálogo de Herramientas MCP (*Tools*)

Cualquier cliente MCP conectado puede invocar las siguientes herramientas vía `tools/call`:

### Diagnóstico, Monitor Center y Control de Procesos
| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `get_game_status` | `{}` | Comprueba si `ProjectZomboid64.exe` está en ejecución y devuelve su Process ID (PID). |
| `launch_game` | `debug_mode` (bool), `windowed` (bool), `nosteam` (bool), `extra_args` (array) | Lanza el proceso `ProjectZomboid64.exe` con flags configurables de depuración y modo ventana. |
| `terminate_game` | `pid` (int opcional), `force` (bool default true) | Cierra o fuerza la terminación del proceso de Project Zomboid. |
| `send_game_ipc_command` | `command` (object requerido: `give_item`, `eval_lua`, `set_godmode`, etc.) | Envía un comando a la partida en vivo a través del companion mod `Z_PZModStudio_Bridge`. |
| `get_game_ipc_response` | `{}` | Lee la respuesta de ejecución más reciente emitida por el companion mod. |
| `install_bridge_companion_mod` | `user_zomboid_dir` (opcional) | Instala el companion mod `Z_PZModStudio_Bridge` en `Zomboid/mods` para habilitar el bridge IPC. |
| `get_monitor_logs` | `max_lines` (int, default 100)<br>`errors_only` (bool)<br>`user_zomboid_dir` (string opcional) | Lee y filtra las líneas recientes del archivo de log activo `console.txt`. |
| `list_available_logs` | `user_zomboid_dir` (opcional) | Lista todos los archivos de log de sesiones en disco (`console.txt` y `Zomboid/Logs/`). |
| `read_log_file` | `file_path` (string requerido)<br>`max_lines` (int)<br>`errors_only` (bool) | Lee cualquier archivo de log específico con filtrado de excepciones. |
| `get_crash_diagnostics` | `user_zomboid_dir` (string opcional) | Parsea excepciones Java/Lua y genera tarjetas de diagnóstico de Build 41 & 42 con soluciones y polyfills sugeridos. |

### Rutas, Mods, Perfiles y Orden de Carga
| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `get_studio_paths` | `{}` | Auto-detecta y devuelve las rutas de instalación del juego, Steam Workshop y carpeta Zomboid del usuario. |
| `list_installed_mods` | `pz_install_dir`, `user_zomboid_dir`, `workshop_dir` (opcionales) | Escanea y lista todos los mods de Steam Workshop y locales con sus metadatos e IDs. |
| `sort_mod_load_order` | Mismos parámetros de rutas | Ejecuta la ordenación topológica y detecta dependencias circulares o faltantes. |
| `scan_mod_conflicts` | Mismos parámetros de rutas | Escanea el sistema de archivos virtual (VFS) para detectar colisiones entre mods y el juego base. |
| `list_mod_profiles` | `user_zomboid_dir` (opcional) | Lista todos los perfiles de mods guardados, sus mods activos y orden de carga. |
| `create_mod_profile` | `name` (string requerido)<br>`description` (string)<br>`active_mod_ids` (array)<br>`load_order` (array) | Crea un nuevo perfil independiente de combinación de mods. |
| `activate_mod_profile` | `profile_id` (string requerido) | Activa un perfil de mods y lo escribe en `default.txt` / `ModListData.ini`. |

### Motor de Fusión y Generador de Parches
| Herramienta | Parámetros | Descripción |
| :--- | :--- | :--- |
| `validate_lua_syntax` | `code` (string requerido) | Valida sintaxis Lua usando el parser AST (`full_moon`), indicando línea y columna exacta en caso de error. |
| `merge_lua_scripts` | `base`, `target_a`, `target_b` (strings requeridos) | Ejecuta un 3-way AST merge entre código base y dos variantes de mods en conflicto. |
| `list_merged_packages` | `user_zomboid_dir`, `mod_list_ini_path` (opcionales) | Lista todos los paquetes de parches y fusiones (`Z_PZModStudio_*`) del sistema. |
| `get_master_patch_status` | `user_zomboid_dir`, `package_folder_name` (opcionales) | Consulta el estado del paquete maestro `Z_PZModStudio_MasterPatch` y las resoluciones guardadas. |
| `save_draft_resolution` | `relative_path`, `resolved_content` (requeridos)<br>`package_folder_name`, `status` (opcionales) | Guarda una resolución de código directamente en el paquete del parche maestro. |

---

## 4. 📚 Catálogo de Recursos MCP (*Resources*)

Lectura pasiva disponible vía `resources/read`:

1. `pz://monitor/console-log`: Contenido en tiempo real del archivo `console.txt`.
2. `pz://mods/installed-summary`: Resumen en JSON de los mods detectados y orden de carga.
3. `pz://paths/config`: Configuración de rutas del sistema (`StudioPaths`).
4. `pz://patches/status`: Estado del paquete de parche maestro y borradores.

---

## 5. 🧠 Base de Conocimiento Técnico & Wiki Modular (`docs/`)

Para profundizar en cualquier aspecto del motor, consulte la [**Wiki Técnica Modular**](docs/INDEX.md):

- **[01. Motor, JVM y Kahlua VM](docs/01-arquitectura-motor-kahlua-java.md):** Tipos Java vs Lua (List vs Table, 0 vs 1 based).
- **[02. Ciclo de Vida Lua y Eventos](docs/02-ciclo-vida-lua-y-eventos.md):** Fases `shared`/`client`/`server`, orden alfabético y Monkey Patching.
- **[03. Items, Crafting y Fluidos B42](docs/03-crafting-items-y-fluidos-b42.md):** `craftRecipe`, `Tags`, herencia física y `FluidContainer`.
- **[04. UI y Timed Actions](docs/04-ui-context-menu-y-timedactions.md):** `ISUIElement`, `OnFillWorldObjectContextMenu` y máquina de estados `ISBaseTimedAction`.
- **[05. Distribución de Botín](docs/05-distribucion-de-botin-y-spawns.md):** `ItemPickerJava`, `ProceduralDistributions.lua` y APIs de contenedores.
- **[06. ModData y Networking](docs/06-networking-moddata-y-seguridad.md):** Persistencia, sincronización de red y atestación CHAP.
- **[07. Sonido, Traducciones JSON y Espacio 3D](docs/07-sonido-traducciones-y-espacio-b42.md):** FMOD, formato JSON (B42.15+) y coordenadas Z (-32 a +32).
- **[08. Diagnóstico de Crashes y VFS](docs/08-diagnostico-de-crashes-y-vfs.md):** Taxonomía de errores en `console.txt` y 3-way AST merge.
- **[09. Control del Proceso y Bridge IPC](docs/09-control-del-juego-y-bridge-ipc.md):** Control de `ProjectZomboid64.exe` y ejecución de comandos en vivo.

---

## 6. 💻 Comandos de Desarrollo y Compilación

```powershell
# Compilar el servidor MCP independiente (Rápido, sin GUI):
cargo build --bin pz-mcp-server --manifest-path "src-tauri/Cargo.toml"

# Compilar y ejecutar la aplicación gráfica completa:
npm run tauri dev

# Compilar frontend para producción:
npm run build
```

