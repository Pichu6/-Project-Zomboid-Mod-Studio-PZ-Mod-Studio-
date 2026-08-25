# 04 — Interfaz de Usuario (UI) y Timed Actions

La experiencia interactiva en Project Zomboid se divide en dos grandes sistemas en la capa cliente: la **jerarquía de widgets visuales** (`ISUIElement`) y la **máquina de estados de acciones temporizadas** (`ISBaseTimedAction`).

---

## 1. La Jerarquía de Widgets (`ISUIElement` e `ISPanel`)

Toda ventana, botón, barra de progreso o menú en Project Zomboid hereda directa o indirectamente de `ISUIElement`.

```
ISUIElement (Base de Coordenadas, Clics, Drag & Drop)
 └── ISPanel (Paneles con Fondo, Bordes y Renderizado de Colores)
      ├── ISScrollingListBox (Listas con Scroll)
      ├── ISContextMenu (Menús desplegables de Clic Derecho)
      └── ISInventoryPane (Vista del Inventario de Mochilas y Contenedores)
```

### Ciclo de Vida de un Componente UI:
1. **`:new(x, y, width, height)`**: Asigna coordenadas iniciales y propiedades base.
2. **`:initialise()`**: Inicializa variables de estado internas.
3. **`:createChildren()`**: Instancia y añade botones, etiquetas y subelementos (`self:addChild(widget)`).
4. **`:prerender()`**: Dibuja el fondo y las capas inferiores (se ejecuta en cada frame).
5. **`:render()`**: Dibuja texto, iconos y elementos superiores (se ejecuta en cada frame).

---

## 2. Inyección en Menús Contextuales (`OnFillWorldObjectContextMenu`)

Para añadir botones al menú de clic derecho del mundo, los mods se suscriben al evento `OnFillWorldObjectContextMenu`:

```lua
local function OnFillCustomContextMenu(playerNum, context, worldobjects, test)
    -- ⚠️ EL PARÁMETRO 'test': Soporte de Mandos / Controllers
    -- Si test == true, el motor solo está comprobando si existen opciones disponibles.
    -- Debe retornar true inmediatamente si la acción es válida, SIN construir la UI.
    if test then return true end

    local player = getSpecificPlayer(playerNum)
    local targetTree = nil

    for _, obj in ipairs(worldobjects) do
        if instanceof(obj, "IsoTree") then
            targetTree = obj
            break
        end
    end

    if targetTree then
        -- Añadir opción al menú
        local option = context:addOption("Recolectar Resina", targetTree, OnHarvestResin, player)
        
        -- Añadir tooltip informativo si es necesario
        local tooltip = ISWorldObjectContextMenu.addToolTip()
        tooltip:setName("Recolectar Resina")
        tooltip.description = "Extrae savia útil para fabricación artesanal."
        option.toolTip = tooltip
    end
end

Events.OnFillWorldObjectContextMenu.Add(OnFillCustomContextMenu)
```

---

## 3. Máquina de Estados de `ISBaseTimedAction`

Cuando un jugador interactúa con un objeto, la acción no ocurre instantáneamente; entra en la cola de acciones temporizadas (`ISTimedActionQueue`).

```
                    ┌───────────────┐
                    │     new()     │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   isValid()   │ ◄─── Se evalúa en cada tick
                    └───────┬───────┘
                            │ (true)
                    ┌───────▼───────┐
                    │ waitToStart() │
                    └───────┬───────┘
                            │ (false -> listo)
                    ┌───────▼───────┐
                    │    start()    │ ───> Configura animaciones/sonidos
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
       ┌─────────── │   update()    │ ◄─── Tick de ejecución (progreso)
       │            └───────┬───────┘
 (Cancelado)                │ (Completo)
       │            ┌───────▼───────┐
       ├──────────> │   perform()   │ ───> OBLIGATORIO: ISBaseTimedAction.perform(self)
       │            └───────────────┘
┌──────▼──────┐
│   stop()    │ ───> OBLIGATORIO: ISBaseTimedAction.stop(self)
└─────────────┘
```

### Métodos Clave y Responsabilidades:

| Método | Propósito | Regla de Oro |
| :--- | :--- | :--- |
| `new(character, target, time)` | Constructor | Definir `self.stopOnWalk`, `self.stopOnRun`, `self.maxTime`. |
| `isValid()` | Comprueba si la acción sigue siendo físicamente válida. | Si el objeto fue destruido o el jugador se alejó demasiado, retorna `false`. |
| `waitToStart()` | Retrasa el inicio si el jugador debe girarse hacia el objetivo. | Retornar `self.character:shouldBeTurning()`. |
| `start()` | Inicia la animación visual y el sonido. | Llamar a `self:setActionAnim("Loot")` o similar. |
| `update()` | Se ejecuta en cada tick de la acción. | Ajustar progreso o aplicar consumo fraccional. |
| `stop()` | Se ejecuta si el jugador cancela la acción (ej: al moverse). | **OBLIGATORIO:** `ISBaseTimedAction.stop(self)` para limpiar la cola. |
| `perform()` | Se ejecuta cuando la barra de progreso llega al 100%. | **OBLIGATORIO:** `ISBaseTimedAction.perform(self)` para pasar a la siguiente acción. |

### ⚠️ El Error Crítico de la Cola Congelada
Si olvidas llamar a `ISBaseTimedAction.perform(self)` al final de tu método `:perform()`, la máquina virtual nunca notificará a `ISTimedActionQueue` que la tarea concluyó. Como resultado:
- El personaje quedará congelado en su animación.
- Todas las acciones posteriores encoladas por el jugador quedarán bloqueadas indefinidamente.
