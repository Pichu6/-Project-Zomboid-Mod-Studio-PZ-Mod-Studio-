# 02 — Ciclo de Vida de Scripts Lua y Bus de Eventos

Project Zomboid no cuenta con un sistema de inyección de dependencias moderno basado en grafos dinámicos. En su lugar, el motor evalúa los scripts a través de **fases estrictas de ciclo de vida** y un **orden alfabético estricto**, comunicando los subsistemas mediante un bus de eventos central (`Events`).

---

## 1. Las Tres Fases de Carga del Motor

La ubicación física de un archivo dentro del directorio `media/lua/` determina en qué momento exacto de la vida de la aplicación se ejecuta su código:

```
media/lua/
├── shared/   ──> Fase 1: Se carga al iniciar el juego. Compartido por Cliente y Servidor.
├── client/   ──> Fase 2: Se carga después de shared. Interfaz, rendering y timed actions.
└── server/   ──> Fase 3: Se carga ÚNICAMENTE al iniciar/unirse a una partida o servidor dedicado.
```

### Detalle de cada Dominio:

1. **`media/lua/shared/` (Fase Compartida):**
   - Se compila e inyecta en la VM Kahlua en el arranque inmediato de Project Zomboid.
   - Contiene la lógica fundacional: clases base, tablas de configuración global, librerías matemáticas, definiciones de zonas (`VehicleZoneDefinition.lua`), preajustes de Sandbox y registro de recetas base.
2. **`media/lua/client/` (Fase del Cliente):**
   - Se ejecuta secuencialmente inmediatamente tras la fase compartida.
   - Gobierna todo lo visual: paneles UI (`ISUIElement`), menús contextuales tras clic derecho (`ISContextMenu`), cursor en el mapa, barras de estado y acciones temporizadas (`ISBaseTimedAction`).
   - Reside únicamente en la memoria local del jugador.
3. **`media/lua/server/` (Fase del Servidor):**
   - Se carga de forma **asíncrona diferida**: no se ejecuta al abrir el juego, sino cuando se presiona "Iniciar Partida" (Singleplayer) o cuando arranca el servidor dedicado (Multiplayer).
   - Posee autoridad absoluta: motores de agricultura, ciclo climático, generación y reposición de botín, y procesamiento autoritativo de comandos de red (`sendClientCommand`).

---

## 2. Regla del Orden Alfabético y Precedencia Vanilla

Dentro de cada fase (`shared`, `client`, `server`), el motor indexa y ejecuta los archivos en **estricto orden alfabético por nombre de archivo**:

1. **Precedencia Inalterable del Juego Base (*Vanilla*):**
   Los scripts originales de Project Zomboid siempre se cargan y evalúan **antes** que cualquier archivo de cualquier mod de terceros.
2. **Orden entre Mods:**
   Los archivos de los mods se evalúan en orden alfabético según el nombre de cada archivo `.lua`.
3. **El Patrón del Prefijo `Z_`:**
   Si el Mod B necesita modificar o extender una función definida en el Mod A (ej: `ModA_Core.lua`), el archivo del Mod B debe nombrarse con una letra posterior en el abecedario (ej: `Z_ModB_Patch.lua`) para asegurar que cuando se ejecute, las tablas del Mod A ya existan en la memoria global.

---

## 3. El Bus de Eventos (`Events`)

El núcleo Java de Project Zomboid interactúa con la capa Lua enviando delegados a eventos registrados.

### Sintaxis Universal de Suscripción:
```lua
-- Suscribir función al evento
Events.OnGameStart.Add(MyMod_OnGameStart)

-- Desuscribir función cuando ya no se necesite (ahorra ciclos de CPU)
Events.OnTick.Remove(MyMod_OnTick)
```

### ⚠️ Regla de Oro: ¡Prohibido usar Funciones Anónimas en Eventos Críticos!
Si se registra una función anónima, es **imposible removerla** con `.Remove()` desde otro script:
```lua
-- ❌ ANTIPATRÓN: Fuga de memoria y no removible
Events.OnPlayerUpdate.Add(function(player)
    -- Lógica
end)

-- ✅ CORRECTO: Función nominal con puntero rastreable
local function MyMod_Update(player)
    -- Lógica
end
Events.OnPlayerUpdate.Add(MyMod_Update)
```

### Catálogo de Eventos Principales del Motor

| Evento | Cuándo se Dispara | Parámetros Recibidos | Uso Típico |
| :--- | :--- | :--- | :--- |
| `OnGameBoot` | Tras indexar y compilar todos los archivos Lua de todos los mods. | Ninguno | *Monkey patching* seguro entre mods. |
| `OnGameStart` | Cuando el jugador entra al mundo y toma el control de su personaje. | Ninguno | Inicializar datos de jugador o UI inicial. |
| `OnFillWorldObjectContextMenu` | Al hacer clic derecho sobre una casilla o entidad del mundo. | `player, context, worldobjects, test` | Inyectar opciones de menú contextual. |
| `OnPlayerUpdate` | En cada tick del bucle de simulación del jugador (~60 veces/seg). | `player` | Monitoreo de estados (¡usar early returns!). |
| `OnClientCommand` | En el servidor, al recibir un paquete de un cliente vía `sendClientCommand`. | `module, command, player, args` | Validación y ejecución de acciones multijugador. |
| `OnServerCommand` | En el cliente, al recibir un broadcast del servidor vía `sendServerCommand`. | `module, command, args` | Actualizar UI/estado local tras confirmación del server. |

---

## 4. Monkey Patching Seguro (*Function Wrapping*)

Cuando múltiples mods necesitan alterar la misma función nativa del juego sin destruirse entre sí, es obligatorio aplicar la técnica de **Envolvimiento de Funciones (Function Wrapping)**:

### Algoritmo de Wrapping Paso a Paso:

```lua
-- 1. Capturar el puntero original antes de redefinir
local original_ISInventoryPane_render = ISInventoryPane.render

-- 2. Redefinir la función preservando 'self' y todos los argumentos
function ISInventoryPane:render(...)
    -- A. Ejecutar lógica personalizada previa (opcional)
    if self.myCustomFlag then
        -- Inyectar comportamiento
    end

    -- B. Invocar OBLIGATORIAMENTE la función original con 'self' y argumentos
    local result = original_ISInventoryPane_render(self, ...)

    -- C. Ejecutar lógica posterior (opcional)
    return result
end
```

### Por qué omitir `original_function(self, ...)` es catastrófico:
Si un mod sobrescribe directamente una función sin llamar a la original ("romper el chain"), anula silenciosamente los parches de todos los mods cargados anteriormente y rompe el comportamiento nativo del motor, causando errores asíncronos y desincronizaciones en multijugador.
