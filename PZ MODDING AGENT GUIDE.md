# Project Zomboid Modding — Guía Operativa y Manual de Ingeniería para Agentes de IA

> **Objetivo:** Servir como marco técnico integral y contexto operativo de ingeniería para agentes de IA (Antigravity, Claude, Cursor, Cline, Windsurf, Roo Code, etc.) que deban crear, modificar, depurar, resolver conflictos y mantener mods de **Project Zomboid** con foco prioritario en **Build 42** y compatibilidad con **Build 41**.
>
> **Estado de referencia:** Build 42.x (y diferencias clave con Build 41.78+).

---

## 🗺️ Índice Temático

1. [Principio Fundamental y Arquitectura del Motor](#1-principio-fundamental-y-arquitectura-del-motor)
2. [Arquitectura Interna: JVM, Kahlua VM y Render Thread](#2-arquitectura-interna-jvm-kahlua-vm-y-render-thread)
3. [Interoperabilidad de Tipos: Colecciones Java vs Tablas Lua](#3-interoperabilidad-de-tipos-colecciones-java-vs-tablas-lua)
4. [Estructura del Proyecto y Sistema de Carpetas B42](#4-estructura-del-proyecto-y-sistema-de-carpetas-b42)
5. [Manifiestos y Configuración: `mod.info` y `workshop.txt`](#5-manifiestos-y-configuración-modinfo-y-workshoptxt)
6. [Ciclo de Vida de Scripts Lua y Dominios de Carga](#6-ciclo-de-vida-de-scripts-lua-y-dominios-de-carga)
7. [Bus Central de Eventos (`Events`)](#7-bus-central-de-eventos-events)
8. [Patrón Seguro de Monkey Patching (Function Wrapping)](#8-patrón-seguro-de-monkey-patching-function-wrapping)
9. [Arquitectura Data-Driven: Scripts Declarativos y ECS](#9-arquitectura-data-driven-scripts-declarativos-y-ecs)
10. [Sistema de Recetas: `Recipe` (B41) vs `craftRecipe` (B42)](#10-sistema-de-recetas-recipe-b41-vs-craftrecipe-b42)
11. [Sistema de Fluidos y Componente `FluidContainer`](#11-sistema-de-fluidos-y-componente-fluidcontainer)
12. [Jerarquía de UI, Menús Contextuales y Timed Actions](#12-jerarquía-de-ui-menús-contextuales-y-timed-actions)
13. [Distribución de Botín y Spawning Procedural](#13-distribución-de-botín-y-spawning-procedural)
14. [Persistencia con `ModData`, Redes Multiplayer y Seguridad](#14-persistencia-con-moddata-redes-multiplayer-y-seguridad)
15. [Audio FMOD, Traducciones JSON y Espacio Vertical 3D](#15-audio-fmod-traducciones-json-y-espacio-vertical-3d)
16. [Taxonomía de Errores y Diagnóstico de Crashes en `console.txt`](#16-taxonomía-de-errores-y-diagnóstico-de-crashes-en-consoletxt)
17. [Colisiones VFS y Fusión de Scripts Lua a 3 Bandas (AST Merge)](#17-colisiones-vfs-y-fusión-de-scripts-lua-a-3-bandas-ast-merge)
18. [Control de Procesos y Puente IPC en Vivo (`Z_PZModStudio_Bridge`)](#18-control-de-procesos-y-puente-ipc-en-vivo-z_pzmodstudio_bridge)
19. [Reglas Críticas de Seguridad y Protocolo de Archivos](#19-reglas-críticas-de-seguridad-y-protocolo-de-archivos)
20. [Pipeline de Ingeniería para el Agente](#20-pipeline-de-ingeniería-para-el-agente)
21. [Plantilla Recomendada de `AGENTS.md`](#21-plantilla-recomendada-de-agentsmd)
22. [Checklist Técnico de Calidad Pre-Entrega](#22-checklist-técnico-de-calidad-pre-entrega)
23. [Fuentes Técnicas Primarias y Recursos](#23-fuentes-técnicas-primarias-y-recursos)

---

## 1. Principio Fundamental y Arquitectura del Motor

Project Zomboid utiliza un motor propietario desarrollado en torno a la **Java Virtual Machine (JVM)** combinado con un intérprete de Lua puro llamado **Kahlua**.

El modding en Project Zomboid se articula en cinco capas concéntricas:

```
┌─────────────────────────────────────────────────────────────┐
│                      STEAM WORKSHOP                         │
├─────────────────────────────────────────────────────────────┤
│                 ESTRUCTURA DE ARCHIVOS (VFS)                │
├─────────────────────────────────────────────────────────────┤
│         SCRIPTS DECLARATIVOS (.txt) / ASSETS (2D/3D)        │
├─────────────────────────────────────────────────────────────┤
│                  LÓGICA DINÁMICA LUA (KAHLUA)               │
├─────────────────────────────────────────────────────────────┤
│                   MOTOR NATIVO JAVA (JVM)                   │
└─────────────────────────────────────────────────────────────┘
```

1. **Scripts declarativos (`media/scripts/*.txt`):** Definen items, armas, fluidos, recetas (`craftRecipe`), modelos y sonidos. No requieren lógica procedimental.
2. **Lua (`media/lua/`):** Lógica dinámica, interfaz gráfica (UI), control de eventos, máquinas de estado e interacciones complejas.
3. **Assets (`media/`):** Texturas PNG, modelos FBX/GLB/B3D, audios OGG/WAV de FMOD y fuentes.
4. **Java Core:** Núcleo de simulación, pathfinding, rendering OpenGL/LWJGL, red TCP/UDP y física Bullet.

> [!IMPORTANT]
> **Regla cardinal:** Si un requisito puede resolverse de forma declarativa mediante un script `.txt` (como un item o una receta con etiquetas `Tags`), **jamás** inyectes código Lua procedural para recrear la misma funcionalidad.

---

## 2. Arquitectura Interna: JVM, Kahlua VM y Render Thread

Project Zomboid no compila Lua con LuaJIT ni utiliza wrappers nativos C/C++ vía JNI para el modding cotidiano. En su lugar, ejecuta **Kahlua**, una implementación completa de **Lua 5.1 escrita 100% en Java**.

```
┌─────────────────────────────────────────────────────────────┐
│                   LUA LAYER (Scripts / Mods)                │
│   media/lua/shared  │   media/lua/client  │  media/lua/server  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Invocación bidireccional
┌──────────────────────────────▼──────────────────────────────┐
│                  KAHLUA VIRTUAL MACHINE                     │
│       Intérprete Lua 5.1 implementado en Java puro (JVM)    │
│  - Sin JNI / C FFI        - Exportación directa de métodos  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Manipulación de objetos Java
┌──────────────────────────────▼──────────────────────────────┐
│                      GAME CORE (JAVA)                       │
│  - zombie.iso (IsoWorld, IsoGridSquare, IsoObject)          │
│  - zombie.characters (IsoPlayer, IsoZombie)                 │
│  - zombie.inventory (InventoryItem, ItemContainer)          │
│  - LWJGL / OpenGL Render Thread, FMOD Sound Engine          │
└─────────────────────────────────────────────────────────────┘
```

### Características y Consecuencias de Kahlua

- **Instanciación Directa:** Lua puede llamar directamente a clases Java registradas y métodos públicos:
  ```lua
  local item = InventoryItemFactory.CreateItem("Base.Axe")
  player:getInventory():AddItem(item)
  ```
- **Sobrecarga de Garbage Collector (GC):** Cada tabla de Lua creada en Kahlua es un objeto Java (`KahluaTable`) en el Heap de la JVM. Crear miles de tablas efímeras en eventos como `OnTick` o `OnPlayerUpdate` provocará pausas perceptibles de recolección de basura (*GC micro-stutters*).
- **Aislamiento del Render Thread:** El renderizado gráfico se ejecuta en el hilo principal de OpenGL / LWJGL. Modificar texturas o invocar métodos de dibujo fuera de `prerender()` / `render()` o fuera del hilo de renderizado puede corromper el contexto gráfico.
- **Proyección Isométrica:** La transformación de coordenadas espaciales $(x, y, z)$ a pantalla $(sx, sy)$ responde a:
  $$sx = (x - y) \cdot (\text{tileWidth} / 2)$$
  $$sy = (x + y) \cdot (\text{tileHeight} / 2) - z \cdot \text{tileHeight}$$

---

## 3. Interoperabilidad de Tipos: Colecciones Java vs Tablas Lua

Kahlua **no convierte automáticamente** los objetos `java.util.List`, `java.util.ArrayList`, `java.util.Set` o `java.util.HashMap` en tablas Lua nativas.

### Tabla Comparativa de Estructuras

| Operación / Tipo | Tabla Nativa Lua | `java.util.List` / `ArrayList` (Java) |
| :--- | :--- | :--- |
| **Índice inicial** | **1-based** (`table[1]`) | **0-based** (`list:get(0)`) |
| **Longitud / Tamaño** | `#table` o `table.wipe(t)` | `list:size()` |
| **Iteración típica** | `for i, v in ipairs(table) do` | `for i = 0, list:size() - 1 do local v = list:get(i)` |
| **Búsqueda directa** | Búsqueda manual $O(n)$ o hash | `list:contains("item")` (optimizado en bytecode Java) |
| **Inserción** | `table.insert(table, item)` | `list:add(item)` |
| **Limpieza / Vaciado** | `table.wipe(table)` | `list:clear()` |

> [!CAUTION]
> **Error fatal frecuente:** Usar `ipairs()` o `#list` sobre una lista Java (`ArrayList`). Fallará silenciosamente o devolverá `nil`.

```lua
-- ❌ ERROR FATAL: player:getKnownRecipes() devuelve java.util.ArrayList
local recipes = player:getKnownRecipes()
for i, recipe in ipairs(recipes) do
    print(recipe) -- Nunca se ejecuta o genera nil
end

-- ✅ FORMA CORRECTA:
local recipes = player:getKnownRecipes()
for i = 0, recipes:size() - 1 do
    local recipe = recipes:get(i)
    print(recipe)
end
```

---

## 4. Estructura del Proyecto y Sistema de Carpetas B42

En **Build 42**, el motor introdujo una separación explícita para evitar que scripts incompatibles de versiones anteriores rompan el juego.

```text
MyMod/
├── workshop.txt              # Metadatos para Steam Workshop
├── preview.png               # Imagen de vista previa (256x256 o 512x512)
└── Contents/
    └── mods/
        └── MyMod/
            ├── common/       # Assets y definiciones compartidas
            │   └── media/
            │       ├── textures/
            │       └── ui/
            ├── 42/           # Contenido específico de Build 42 (Prioritario)
            │   ├── mod.info
            │   ├── poster.png
            │   └── media/
            │       ├── scripts/
            │       │   ├── items/
            │       │   ├── recipes/
            │       │   └── sounds/
            │       ├── lua/
            │       │   ├── shared/
            │       │   │   └── Translate/
            │       │   │       ├── EN/
            │       │   │       └── ES/
            │       │   ├── client/
            │       │   └── server/
            │       └── models_X/
            └── 41/           # (Opcional) Capa retrocompatible aislada para Build 41
                ├── mod.info
                └── media/
```

### Convenciones de Directorios
- `42/`: El juego ejecutado en Build 42 monta prioritariamente esta carpeta.
- `common/`: Recursos compartidos que no dependen de la versión de la API de scripts.
- `media/scripts/`: Archivos declarativos `.txt`.
- `media/lua/shared/Translate/`: Archivos de traducción en formato JSON (B42.15+).

---

## 5. Manifiestos y Configuración: `mod.info` y `workshop.txt`

### Formato de `mod.info` (Build 42)

```text
name=My Mod Name
id=MyModId
author=DeveloperName
description=Descripción detallada del mod y sus funcionalidades.
modversion=1.0.0
versionMin=42.0.0
poster=poster.png
icon=icon.png
require=\ModA,\ModB
url=https://github.com/tu-usuario/tu-mod
```

> [!WARNING]
> **Evitar `NullPointerException` en `ChooseGameInfo$Mod.getId()`:**
> En Build 42, `versionMin` debe especificarse en formato semántico decimal (ej. `42.0.0` o `42.00`). Si se especifica como un número entero sin puntos (`versionMin=42`), algunas versiones del parser Java lanzan una excepción de puntero nulo al listar mods.

### Formato de `workshop.txt`

```text
version=1
id=0
title=My Mod Name
description=Texto de descripción que aparecerá en la página de Steam Workshop.
tags=Build 42;Items;Crafting;Realistic
visibility=public
```

---

## 6. Ciclo de Vida de Scripts Lua y Dominios de Carga

Project Zomboid ejecuta los archivos Lua divididos en **tres dominios estrictos** y en **orden alfabético**:

```
media/lua/
├── shared/   ──> Fase 1: Se carga al iniciar el juego. Compartido por Cliente y Servidor.
├── client/   ──> Fase 2: Se carga tras shared. UI, rendering local y timed actions.
└── server/   ──> Fase 3: Se carga ÚNICAMENTE al entrar a una partida o servidor dedicado.
```

### Dominios de Carga

1. **`shared/` (Dominio Compartido):**
   - Se compila en la Kahlua VM tan pronto como el juego arranca.
   - Contiene clases base, tablas de configuración, definiciones Sandbox, utilidades matemáticas y registros de items.
2. **`client/` (Dominio del Cliente):**
   - Se evalúa secuencialmente después de `shared`.
   - Controla ventanas UI (`ISUIElement`), menús contextuales (`ISContextMenu`), cursor del ratón, indicadores de estado y acciones con progreso (`ISBaseTimedAction`).
   - Solo reside en la memoria del cliente local.
3. **`server/` (Dominio del Servidor):**
   - **Carga bajo demanda:** No se compila al abrir el menú principal, sino al pulsar "Iniciar Partida" (Singleplayer) o al lanzar el servidor dedicado (Multiplayer).
   - Posee la autoridad sobre el mundo: simulación de cultivos, clima, generación/respawn de botín y procesamiento de comandos de red (`OnClientCommand`).

### Orden Alfabético y el Prefijo `Z_`
- El código vanilla siempre se carga **antes** que los mods.
- Los scripts de los mods se ordenan alfabéticamente por su nombre de archivo `.lua`.
- Si `Mod_B` debe modificar una tabla o función definida en `Mod_A`, el archivo de parche debe comenzar con una letra posterior en el alfabeto (ej. `Z_ModB_Patch.lua`) para asegurar que la tabla original ya existe.

---

## 7. Bus Central de Eventos (`Events`)

El motor Java se comunica con la capa Lua enviando llamadas a través de `Events`:

```lua
-- Suscribir función a un evento
Events.OnGameStart.Add(MyMod_OnGameStart)

-- Desuscribir función cuando ya no sea necesaria (ahorra ciclos de CPU)
Events.OnTick.Remove(MyMod_OnTick)
```

> [!CAUTION]
> **Nunca uses funciones anónimas en eventos del motor:**
> Las funciones anónimas (`function(...) ... end`) no se pueden eliminar con `.Remove()`, provocando fugas de memoria (*memory leaks*) y acumulaciones de callbacks duplicados al recargar el mundo.

```lua
-- ❌ ANTI-PATRÓN: Callback huérfano no desuscribible
Events.OnPlayerUpdate.Add(function(player)
    -- Lógica
end)

-- ✅ FORMA CORRECTA: Puntero a función con nombre
local function MyMod_OnPlayerUpdate(player)
    -- Lógica con guardas de salida rápida
    if not player or player:isDead() then return end
end
Events.OnPlayerUpdate.Add(MyMod_OnPlayerUpdate)
```

### Catálogo de Eventos Principales del Motor

| Evento | Momento de Activación | Parámetros | Propósito Típico |
| :--- | :--- | :--- | :--- |
| `OnGameBoot` | Tras compilar todos los Lua de todos los mods. | Ninguno | Monkey Patching seguro entre mods. |
| `OnInitWorld` | Al inicializar las celdas del mapa. | Ninguno | Configurar metadatos del mundo. |
| `OnGameStart` | Cuando el jugador toma control físico de su personaje. | Ninguno | Inicializar UI o ModData del jugador. |
| `OnFillWorldObjectContextMenu` | Al hacer clic derecho sobre un objeto o suelo. | `playerNum, context, worldobjects, test` | Añadir opciones al menú contextual. |
| `OnFillInventoryObjectContextMenu` | Al hacer clic derecho sobre un item del inventario. | `playerNum, context, items` | Añadir acciones contextuales a items. |
| `OnPlayerUpdate` | En cada tick de la simulación del jugador (~60 Hz). | `player` | Monitorizar estado del jugador (requiere early returns). |
| `OnWeaponHitCharacter` | Cuando un arma golpea a un zombie o jugador. | `wielder, character, handWeapon, damage` | Efectos de combate personalizados. |
| `OnWaterAmountChange` | Cuando cambia el volumen de un `FluidContainer`. | `object` | Actualizar visuales de fluidos. |
| `OnClientCommand` | En el **servidor**, al recibir un paquete de cliente. | `module, command, player, args` | Validación autoritativa y cambios de estado. |
| `OnServerCommand` | En el **cliente**, al recibir respuesta del servidor. | `module, command, args` | Actualizar UI local tras confirmación del servidor. |

---

## 8. Patrón Seguro de Monkey Patching (Function Wrapping)

Cuando dos o más mods necesitan modificar la misma función vanilla sin destruirse mutuamente, el **Function Wrapping** es obligatorio:

```lua
-- 1. Capturar el puntero de la función original en una variable local
local original_ISInventoryPane_render = ISInventoryPane.render

-- 2. Redefinir el método preservando 'self' y los argumentos '...'
function ISInventoryPane:render(...)
    -- A. Lógica previa personalizada (opcional)
    if self.customHighlight then
        -- Código previo
    end

    -- B. OBLIGATORIO: Invocar la función original delegando 'self' y '...'
    local result = original_ISInventoryPane_render(self, ...)

    -- C. Lógica posterior personalizada (opcional)
    return result
end
```

> [!IMPORTANT]
> **Nunca rompas la cadena de delegación:** Si un mod sobrescribe un método sin invocar la función previa capturada (`original_func(self, ...)`), anula silenciosamente el trabajo de todos los mods cargados antes que él, generando bugs difíciles de rastrear.

---

## 9. Arquitectura Data-Driven: Scripts Declarativos y ECS

Build 42 adopta una arquitectura orientada a datos y un **Entity Component System (ECS)** bajo el paquete `zombie.entity.components.*`.

### Definición Declarativa de Items (`media/scripts/items/MyItems.txt`)

```text
module MyMod {
    item CustomKatana {
        Type = Weapon,
        DisplayName = Katana Reforzada,
        Icon = KatanaReforzada,
        MinDamage = 2.4,
        MaxDamage = 3.6,
        Weight = 1.4,
        Categories = Blade,
        SubCategory = Slash,
        AttachmentType = Sword,
        TwoHandWeapon = TRUE,
        CriticalChance = 35,
        CritDmgMultiplier = 4,
        Tags = SharpKnife;Katana;CutPlant,
    }
}
```

### Componentes ECS Principales en Build 42
- `zombie.entity.components.fluids.FluidContainer`: Gestión de fluidos, capacidades y mezclas.
- `zombie.entity.components.crafting.recipe`: Validación y parsing nativo de recetas.
- `zombie.entity.components.spriteconfig`: Configuración de sprites y tiles 3D dinámicos.

---

## 10. Sistema de Recetas: `Recipe` (B41) vs `craftRecipe` (B42)

### El Modelo Legacy (Build 41): `Recipe`
En Build 41, las recetas utilizaban la directiva `recipe` y requerían código Lua en `OnCreate` para copiar propiedades como estado de putrefacción, calor o nutrientes.

### El Modelo Moderno (Build 42): `craftRecipe`
Build 42 introduce `craftRecipe`, con soporte para estaciones de trabajo, consumo parcial de herramientas, etiquetas semánticas (`Tags`) y transferencia física de propiedades:

```text
module MyMod {
    craftRecipe CraftReinforcedKatana {
        category = Blacksmithing,
        Time = 120,
        Anim = SmithingHammer,
        Workstation = Anvil,
        Tags = Blacksmithing;WorkbenchCraft,

        inputs {
            item 1 tags[Hammer] mode:keep,
            item 1 Base.Katana mode:destroy,
            item 2 Base.SteelBar mode:destroy,
            item 1 Base.LeatherStrips mode:destroy,
        }

        outputs {
            item 1 MyMod.CustomKatana,
        }
    }
}
```

### Directivas de Herencia Física en B42

| Directiva | Efecto Físico en el Objeto Creado |
| :--- | :--- |
| `InheritFood` | Transfiere automáticamente calorías, proteínas, carbohidratos, grasas y nivel de descomposición. |
| `InheritCooked` | Preserva el estado de cocción (crudo, cocinado, quemado) y la temperatura térmica del ingrediente. |
| `mode:keep` | Indica que el item actúa como herramienta y no se consume durante el crafteo. |
| `mode:destroy` | Indica que el item se destruye/consume en la elaboración. |

---

## 11. Sistema de Fluidos y Componente `FluidContainer`

Build 42 reemplaza el sistema simple de agua con el componente `FluidContainer` para líquidos (agua potable, agua contaminada, gasolina, alcohol, leche, etc.).

```text
module MyMod {
    item Steel_Canteen {
        Type = Container,
        DisplayName = Cantimplora de Acero,
        Icon = SteelCanteen,
        Weight = 0.3,
        FluidContainer {
            Capacity = 1.5,
            ContainerProperties = CanBePure;CanBeClean,
        }
    }
}
```

> [!WARNING]
> **Nombres internos sin espacios:** El identificador interno del item (ej. `Steel_Canteen`) **nunca** debe contener espacios en blanco. Los espacios provocan fallos de sintaxis en el parser de scripts de B42.

### Prevención de Bucles de Retroalimentación en `OnWaterAmountChange`

```lua
local function Safe_OnWaterAmountChange(object)
    if not object or not object:getFluidContainer() then return end
    
    local container = object:getFluidContainer()
    local currentAmount = container:getAmount()
    local modData = object:getModData()
    
    -- Guarda contra bucle infinito por imprecisión de punto flotante
    if math.abs((modData.lastRecordedFluid or 0) - currentAmount) < 0.001 then
        return
    end
    
    modData.lastRecordedFluid = currentAmount
    -- Ejecutar lógica segura
end
Events.OnWaterAmountChange.Add(Safe_OnWaterAmountChange)
```

---

## 12. Jerarquía de UI, Menús Contextuales y Timed Actions

### 1. Jerarquía de Clases de UI (`ISUIElement`)

```
ISUIElement (Coordenadas base, Clics de ratón, Drag & Drop)
 └── ISPanel (Fondos, Bordes y Renderizado Alfa)
      ├── ISScrollingListBox (Listas desplegables y opciones)
      ├── ISContextMenu (Menús contextuales de clic derecho)
      └── ISInventoryPane (Vista visual del inventario y mochilas)
```

**Ciclo de vida de un widget UI:**
1. `:new(x, y, width, height)`: Define dimensiones y variables iniciales.
2. `:initialise()`: Inicializa el estado interno.
3. `:createChildren()`: Instancia widgets hijos con `self:addChild(widget)`.
4. `:prerender()`: Dibuja fondos y texturas base (cada frame).
5. `:render()`: Dibuja texto, iconos de primer plano y bordes (cada frame).

### 2. Inyección de Menú Contextual del Mundo (`OnFillWorldObjectContextMenu`)

```lua
local function OnFillCustomContextMenu(playerNum, context, worldobjects, test)
    -- ⚠️ EL PARÁMETRO 'test': Soporte para Mandos / Gamepads
    -- Si test == true, el motor solo consulta si hay acciones disponibles.
    -- Debes retornar true INMEDIATAMENTE sin crear widgets UI.
    if test then return true end

    local player = getSpecificPlayer(playerNum)
    local targetObject = nil

    for _, obj in ipairs(worldobjects) do
        if instanceof(obj, "IsoThumpable") and obj:getName() == "CustomStation" then
            targetObject = obj
            break
        end
    end

    if targetObject then
        local option = context:addOption("Operar Estación", targetObject, OnOperateStation, player)
        local tooltip = ISWorldObjectContextMenu.addToolTip()
        tooltip:setName("Operar Estación")
        tooltip.description = getText("ContextMenu_OperateStation_Tooltip")
        option.toolTip = tooltip
    end
end
Events.OnFillWorldObjectContextMenu.Add(OnFillCustomContextMenu)
```

### 3. Máquina de Estados de `ISBaseTimedAction`

```
┌──────────────┐
│    new()     │
└──────┬───────┘
       │
┌──────▼───────┐
│  isValid()   │ ◄─── Se evalúa en cada tick del juego
└──────┬───────┘
       │ (true)
┌──────▼───────┐
│waitToStart() │
└──────┬───────┘
       │ (false -> listo para arrancar)
┌──────▼───────┐
│   start()    │ ───> Configura animaciones/sonidos (self:setActionAnim)
└──────┬───────┘
       │
┌──────▼───────┐
│   update()   │ ◄─── Progreso frame a frame
└──────┬───────┘
       │
       ├─────────────────────────┬─────────────────────────┐
       │ (Cancelado por jugador) │ (Completa al 100%)       │
┌──────▼───────┐          ┌──────▼───────┐                 │
│    stop()    │          │  perform()   │                 │
│ MANDATORIO:  │          │ MANDATORIO:  │                 │
│ ISBaseTimed  │          │ ISBaseTimed  │                 │
│ Action.stop  │          │ Action.      │                 │
│ (self)       │          │ perform(self)│                 │
└──────────────┘          └──────────────┘                 │
```

> [!CAUTION]
> **The Frozen Queue Bug:** Omitir `ISBaseTimedAction.perform(self)` al final del método `:perform()` impide que `ISTimedActionQueue` reciba la señal de finalización. El personaje queda congelado permanentemente en la animación y todas las acciones siguientes en la cola quedan bloqueadas.

---

## 13. Distribución de Botín y Spawning Procedural

### Pipeline de Generación de Items

```
Jugador abre un contenedor (ItemContainer) por 1ª vez
                    │
                    ▼
       ItemPickerJava.fill(container)
                    │
                    ▼
          SuburbsDistributions.lua
 (Mapea tipo de habitación -> nombre de distribución)
                    │
                    ▼
        ProceduralDistributions.lua
   (Define rolls, items y pesos probabilísticos)
                    │
                    ▼
     Instanciación Java en ItemContainer
  (Aplica multiplicadores de Sandbox: Raro, Abundante)
```

### Inyección Segura de Items desde Mods

```lua
local function InjectCustomLoot()
    local dist = ProceduralDistributions.list["GunStoreDisplayCase"]
    if dist and dist.items then
        -- Añadir par: "NombreModulo.NombreItem", PesoProbabilidad
        table.insert(dist.items, "MyMod.CustomKatana")
        table.insert(dist.items, 4.0)
    end
end
Events.OnGameBoot.Add(InjectCustomLoot)
```

---

## 14. Persistencia con `ModData`, Redes Multiplayer y Seguridad

### Ámbitos de Persistencia de `ModData`

```
┌─────────────────────────────────────────────────────────────┐
│                       ÁMBITOS MODDATA                       │
├───────────────────┬───────────────────┬─────────────────────┤
│   Objeto / Item   │      Jugador      │    Mundo / Global   │
│ item:getModData() │player:getModData()│ModData.getOrCreate()│
│ Serializado en el │ Serializado en el │ Serializado en      │
│ guardado del item │ archivo del player│ map_meta.bin        │
└───────────────────┴───────────────────┴─────────────────────┘
```

### Sincronización Red: ModData NO se replica automáticamente

Modificar `player:getModData()` en un script de cliente (`media/lua/client/`) solo cambia la memoria local. El servidor y los demás clientes nunca se enterarán.

```
┌──────────────────┐                               ┌──────────────────┐
│     CLIENTE      │                               │     SERVIDOR     │
└────────┬─────────┘                               └────────┬─────────┘
         │                                                  │
         │  1. sendClientCommand(p, "Mod", "Action", args)  │
         ├─────────────────────────────────────────────────►│
         │                                                  │
         │                                                  │ 2. Events.OnClientCommand
         │                                                  │    - Valida rango y permisos
         │                                                  │    - Modifica ModData real
         │                                                  │    - Guarda a disco
         │                                                  │
         │  3. sendServerCommand("Mod", "Sync", stateData)  │
         │◄─────────────────────────────────────────────────┤
         │                                                  │
         │ 4. Events.OnServerCommand                        │
         │    - Actualiza UI y estado local                 │
         ▼                                                  ▼
```

> [!CAUTION]
> **Prohibido enviar objetos Java por red:** Jamás pases referencias directas a `InventoryItem`, `IsoPlayer` o `IsoGridSquare` en la tabla `args` de `sendClientCommand`. Solo se permiten tipos primitivos (`string`, `number`, `boolean`) y tablas anidadas. Para items, envía su identificador (`item:getID()`); para el mapa, envía coordenadas (`x, y, z`).

---

## 15. Audio FMOD, Traducciones JSON y Espacio Vertical 3D

### 1. Definición de Audio FMOD (`media/scripts/sounds/MySounds.txt`)

```text
module MyMod {
    sound CustomSlashSound {
        category = Weapon,
        clip {
            file = media/sound/CustomSlash.ogg,
            volume = 0.85,
            distanceMax = 25,
        }
    }
}
```

Reproducción en Lua:
```lua
getSoundManager():PlayWorldSound("CustomSlashSound", player:getCurrentSquare(), 0.2, 25, 1.0, true)
```

### 2. Formato de Traducciones JSON (B42.15+)

A partir de Build 42.15, las traducciones usan **JSON UTF-8** en `media/lua/shared/Translate/<LANG>/`:

```json
{
  "ContextMenu_OperateStation": "Operar Estación",
  "ContextMenu_OperateStation_Tooltip": "Requiere nivel 3 de herrería."
}
```

> [!WARNING]
> **Escape de caracteres de porcentaje (`UnknownFormatConversionException`):**
> Si una cadena de traducción incluye un símbolo de porcentaje literal (ej. `"Probabilidad +25%"`), los formateadores de Java lanzan `UnknownFormatConversionException`. Debe escaparse como `%%` (`"Probabilidad +25%%"`).

### 3. Espacio Vertical 3D en Build 42

| Dimensión Espacial | Build 41 (Legacy) | Build 42 (Unstable/Modern) |
| :--- | :--- | :--- |
| **Rango de Coordenadas Z** | De `0` a `7` | **De `-32` a `+32`** |
| **Sótanos y Búnkeres** | Simulados (islas en $Z=0$) | **Físicos reales** ($Z < 0$) |
| **Rascacielos / Edificios** | Máximo 7 plantas | **Hasta 32 plantas** |
| **Iluminación** | Lightmaps 2D estáticos | Sombras dinámicas y oclusión volumétrica |

---

## 16. Taxonomía de Errores y Diagnóstico de Crashes en `console.txt`

El archivo de log activo reside en `C:/Users/<User>/Zomboid/console.txt`.

```
┌─────────────────────────────────────────────────────────────┐
│                    TAXONOMÍA DE ERRORES                     │
├──────────────────────────┬──────────────────────────────────┤
│ Firma en console.txt     │ Causa Raíz & Acción Recomendada  │
├──────────────────────────┼──────────────────────────────────┤
│ KahluaThreadException    │ Error de ejecución en script Lua │
│ NoSuchMethodError        │ Incompatibilidad API B41 vs B42  │
│ ChooseGameInfo$Mod.getId │ versionMin mal formateado        │
│ attempted index of non-t │ Acceso prematuro a tabla global  │
│ UnknownFormatConversion  │ Símbolo % no escapado en JSON    │
└──────────────────────────┴──────────────────────────────────┘
```

---

## 17. Colisiones VFS y Fusión de Scripts Lua a 3 Bandas (AST Merge)

### El Problema: Sobrescritura Destructiva en VFS
Si dos mods proporcionan el mismo archivo relativo (ej. `media/lua/client/ISUI/ISInventoryPane.lua`), el motor de Project Zomboid solo carga el último según el orden de carga, destruyendo por completo las modificaciones del mod anterior.

### La Solución: Fusión AST a 3 Bandas
Mediante el analizador sintáctico `full_moon`, se combinan los árboles de sintaxis abstracta:

```
           [Script Base Vanilla]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
    [AST Mod A]             [AST Mod B]
         │                       │
         └───────────┬───────────┘
                     ▼
       [Motor de Fusión AST a 3 Bandas]
                     │
                     ▼
    [Z_PZModStudio_MasterPatch Script Unificado]
```

1. **Inserción de Nuevas Funciones:** Las funciones independientes de Mod A y Mod B se insertan sin conflicto.
2. **Fusión de Funciones Modificadas:** Si ambos editan la misma función, se tejen secuencialmente preservando `self` y la delegación de retorno.
3. **Paquete Master Patch:** El archivo unificado se exporta a `Z_PZModStudio_MasterPatch` para garantizar que cargue al final.

---

## 18. Control de Procesos y Puente IPC en Vivo (`Z_PZModStudio_Bridge`)

Para permitir que herramientas externas y agentes de IA interactúen con una sesión activa de Project Zomboid, se implementa un **Puente IPC basado en archivos**:

```
┌─────────────────────────┐                        ┌─────────────────────────┐
│     AGENTE DE IA        │                        │  PROJECT ZOMBOID (GAME) │
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
             │                                 │ 2. Events.OnTick (Cada 30 ticks)
             │                                 │    Procesa comandos
             │                                 ▼                │
             │                  ┌──────────────────────────────┐│
             │                  │    PZModStudio_Bridge.lua    │├┘
             │                  │  - AddItem / Equip / Teleport│
             │                  │  - loadstring(lua_code)()    │
             │                  └──────────────┬───────────────┘│
             │                                 │                │
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

### Comandos IPC Soportados en `pz_ipc_queue.json`
- `give_item`: Instancia y equipa un item en el jugador.
- `teleport`: Teletransporta al personaje a coordenadas `(x, y, z)`.
- `set_stat`: Modifica salud, hambre, sed o activa godmode.
- `eval_lua`: Ejecuta código Lua arbitrario en vivo en el contexto del juego.

---

## 19. Reglas Críticas de Seguridad y Protocolo de Archivos

> [!CAUTION]
> **REGLA ABSOLUTA DE NO-DESTRUCCIÓN:**
> 1. El agente tiene **estrictamente prohibido** ejecutar comandos destructivos de eliminación de archivos (`rm`, `del`, `Remove-Item`, borrados recursivos) en el sistema operativo del usuario.
> 2. Cualquier fusión, resolución de conflictos o refactorización debe escribir sus resultados en archivos nuevos, en un paquete de parche (`Z_PZModStudio_MasterPatch`) o proponer el diff al usuario.
> 3. Nunca asumir permiso para limpiar, vaciar o formatear directorios de mods existentes.

---

## 20. Pipeline de Ingeniería para el Agente

```
1. IDENTIFICAR VERSIÓN (Build 42 vs Build 41)
       ↓
2. DETERMINAR CAPA (Declarativo .txt vs Dinámico Lua)
       ↓
3. INSPECCIONAR APIS EN DOCUMENTACIÓN OFICIAL
       ↓
4. MANTENER NAMESPACES E IDENTIFICADORES ÚNICOS
       ↓
5. SEPARAR DOMINIOS (shared / client / server)
       ↓
6. IMPLEMENTAR GUARDAS EN EVENTOS DE ALTA FRECUENCIA
       ↓
7. ARQUITECTURA MULTIPLAYER CLIENT-SERVER AUTORITATIVA
       ↓
8. ASIGNAR LOCALIZACIÓN EN JSON (B42.15+) CON ESCAPE %%
       ↓
9. PRUEBA EN SINGLEPLAYER (-debug)
       ↓
10. REVISIÓN DE LOGS EN console.txt
```

---

## 21. Plantilla Recomendada de `AGENTS.md`

Todo mod de Project Zomboid debería incluir un archivo `AGENTS.md` en su raíz:

```markdown
# AGENTS.md

## Project
Project Zomboid Mod.

## Target Version
Build 42.x (Primary) / Build 41.78+ (Legacy layer in /41/).

## CRITICAL SAFETY RULES
- NEVER execute destructive file deletion commands on the host system.
- ALWAYS use non-destructive workflows (generate patches into Z_PZModStudio_MasterPatch).
- Keep client, server, and shared domains strictly separated.
- Server-authoritative logic for multiplayer synchronization.

## Architecture
- Module Name: MyCustomMod
- Script Definitions: media/scripts/
- Client UI: media/lua/client/
- Server Logic: media/lua/server/
- Translations: media/lua/shared/Translate/ (JSON UTF-8)
```

---

## 22. Checklist Técnico de Calidad Pre-Entrega

- [ ] **Build objetivo verificada:** Estructura `42/` o `common/` según corresponda.
- [ ] **Manifiesto `mod.info`:** `id` único y `versionMin=42.0.0` en formato decimal.
- [ ] **Declarativo primero:** Items y recetas creados en `media/scripts/*.txt` con `craftRecipe` y `Tags`.
- [ ] **Nombres sin espacios:** Todos los IDs de items y scripts usan CamelCase o guiones bajos (`Steel_Canteen`).
- [ ] **Kahlua Interop:** Listas Java (`ArrayList`) iteradas con bucle `for i = 0, size() - 1 do :get(i)`.
- [ ] **Event Bus Seguro:** No existen funciones anónimas registradas en `Events.*.Add()`.
- [ ] **Monkey Patching:** Todas las funciones sobrescritas delegan en `original_func(self, ...)`.
- [ ] **Timed Actions:** Todos los métodos `:perform()` y `:stop()` llaman a su clase padre `ISBaseTimedAction`.
- [ ] **Gamepad Support:** `OnFillWorldObjectContextMenu` comprueba el flag `test` y retorna inmediatamente.
- [ ] **Multiplayer:** Comandos de red usan solo tipos primitivos (sin objetos Java en `args`).
- [ ] **Fluidos:** Guardas delta en `OnWaterAmountChange` para evitar bucles infinitos.
- [ ] **Localización:** Cadenas en JSON UTF-8 con caracteres `%` escapados como `%%`.
- [ ] **Cero Errores en Logs:** `console.txt` verificado sin excepciones `KahluaThreadException`.

---

## 23. Fuentes Técnicas Primarias y Recursos

- **PZwiki Modding:** [https://pzwiki.net/wiki/Modding](https://pzwiki.net/wiki/Modding)
- **PZ API Documentation:** [https://pz-wiki-modding.github.io/PZ-API-Docs/](https://pz-wiki-modding.github.io/PZ-API-Docs/)
- **Build 42 Modding Guide:** [https://github.com/gotmayonase/pz-modding-guide](https://github.com/gotmayonase/pz-modding-guide)
- **Build 42 Mod Template:** [https://github.com/LabX1/ProjectZomboid-Build42-ModTemplate](https://github.com/LabX1/ProjectZomboid-Build42-ModTemplate)
- **The Indie Stone Official:** [https://projectzomboid.com/](https://projectzomboid.com/)
