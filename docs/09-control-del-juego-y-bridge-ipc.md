# 09 — Control del Proceso y Bridge IPC en Vivo

Este capítulo describe cómo un agente de inteligencia artificial o una herramienta externa (como **PZ Mod Studio**) puede controlar el ciclo de vida del ejecutable `ProjectZomboid64.exe` y comunicarse bidireccionalmente con una partida en vivo mediante un **puente IPC (*Inter-Process Communication*)**.

---

## 1. Control del Proceso de Project Zomboid

### Argumentos de Línea de Comandos Clave:
| Flag CLI | Propósito |
| :--- | :--- |
| `-debug` | Habilita el menú de depuración en el juego, panel de trucos, recarga de Lua y visor de excepciones en pantalla. |
| `-windowed` | Fuerza la ejecución en modo ventana (ideal para pruebas automatizadas). |
| `-nosteam` | Inicia el juego sin autenticación activa de Steam (permite instancias locales rápidas). |
| `-debugtranslation` | Genera `translationProblems.txt` para validar claves de idioma. |

### Ciclo de Control desde Rust / Backend:
1. **Detección:** Escaneo del árbol de procesos del sistema operativo (`tasklist` en Windows) buscando `ProjectZomboid64.exe` y capturando su Process ID (PID).
2. **Lanzamiento:** Creación del proceso hijo con `std::process::Command::new("ProjectZomboid64.exe").arg("-debug").spawn()`.
3. **Terminación:** Envío de señal de cierre o terminación forzosa con `taskkill /PID <pid> /F`.

---

## 2. Arquitectura del Companion Mod: `Z_PZModStudio_Bridge`

Dado que el motor no expone un socket REPL por defecto en partidas de un solo jugador, implementamos un **Bridge IPC basado en archivo de intercambio sincronizado**:

```
┌─────────────────────────┐                        ┌─────────────────────────┐
│     AI AGENT / MCP      │                        │  PROJECT ZOMBOID (GAME) │
└────────────┬────────────┘                        └────────────┬────────────┘
             │                                                  │
             │ 1. Escribe pz_ipc_queue.json                     │
             ├─────────────────────────────────┐                │
             │                                 │                │
             │                                 ▼                │
             │                  ┌──────────────────────────────┐│
             │                  │  Zomboid/pz_ipc_queue.json   ││
             │                  └──────────────┬───────────────┘│
             │                                 │                │
             │                                 │ 2. Events.OnTick (Cada 30 frames)
             │                                 │    Lee y procesa comandos
             │                                 ▼                │
             │                  ┌──────────────────────────────┐│
             │                  │    PZModStudio_Bridge.lua    │├┘
             │                  │  - getPlayer()               │
             │                  │  - AddItem / Equip / Teleport│
             │                  │  - loadstring(lua_code)()    │
             │                  └──────────────┬───────────────┘
             │                                 │
             │                                 │ 3. Escribe resultado
             │                                 ▼
             │                  ┌──────────────────────────────┐
             │                  │   Zomboid/pz_ipc_resp.json   │
             │                  └──────────────┬───────────────┘
             │                                 │
             │ 4. Lee respuesta y confirma     │
             │◄────────────────────────────────┘
             ▼
```

---

## 3. Especificación del Protocolo JSON IPC

El archivo `C:/Users/<Usuario>/Zomboid/pz_ipc_queue.json` contiene una lista de comandos a ejecutar:

### 1. Comando: Equipar / Dar Ítems (`give_item`)
```json
{
  "id": "cmd_001",
  "action": "give_item",
  "item": "Base.Axe",
  "count": 1,
  "equip": "primary"
}
```
*Efecto en el juego:* Añade un hacha al inventario del jugador y la equipa en su mano principal de forma instantánea.

### 2. Comando: Teletransporte (`teleport`)
```json
{
  "id": "cmd_002",
  "action": "teleport",
  "x": 10520,
  "y": 9410,
  "z": 0
}
```
*Efecto en el juego:* Mueve al jugador a las coordenadas indicadas en el mapa.

### 3. Comando: Modificación de Estados (`set_stat`)
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
*Efecto en el juego:* Activa el modo dios y restablece los niveles de salud, hambre y sed.

### 4. Comando: Ejecución de Código Lua Dinámico (`eval_lua`)
```json
{
  "id": "cmd_004",
  "action": "eval_lua",
  "code": "local p = getPlayer(); p:Say('¡Comando ejecutado desde el Agente!'); HaloTextHelper.addText(p, 'AI Link Active', 0, 255, 0);"
}
```
*Efecto en el juego:* Ejecuta cualquier fragmento de código Lua en tiempo real dentro del entorno de la partida.

---

## 4. Estructura del Script del Companion Mod

El mod `Z_PZModStudio_Bridge` se ubica en la carpeta de mods del usuario (`Zomboid/mods/Z_PZModStudio_Bridge/`):

```lua
-- media/lua/client/PZModStudio_Bridge.lua
local Bridge = {}
Bridge.tickCounter = 0
Bridge.IPC_PATH = "pz_ipc_queue.json"
Bridge.RESP_PATH = "pz_ipc_resp.json"

function Bridge.OnTick()
    Bridge.tickCounter = Bridge.tickCounter + 1
    -- Sondea el archivo cada 30 ticks (aproximadamente cada 0.5s)
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
        -- Procesar comando JSON
        Bridge.ProcessCommand(content, player)
        
        -- Limpiar cola
        local fileWriter = getFileWriter(Bridge.IPC_PATH, true, false)
        if fileWriter then
            fileWriter:write("{}")
            fileWriter:close()
        end
    end
end

function Bridge.ProcessCommand(jsonStr, player)
    -- Parsear comando y ejecutar acción (AddItem, Teleport, eval_lua)
end

Events.OnTick.Add(Bridge.OnTick)
```
