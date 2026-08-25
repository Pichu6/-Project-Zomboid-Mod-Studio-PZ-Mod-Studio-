# 01 — Arquitectura del Motor, JVM y Máquina Virtual Kahlua

Project Zomboid utiliza una arquitectura de doble capa altamente estratificada: un **núcleo nativo en Java** (ejecutado sobre la JVM) combinado con una **máquina virtual Lua** implementada en Java puro llamada **Kahlua**.

```
┌─────────────────────────────────────────────────────────────┐
│                 CAPA LUA (Scripts / Mods)                   │
│   media/lua/shared  │   media/lua/client  │  media/lua/server  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Invocación bidireccional
┌──────────────────────────────▼──────────────────────────────┐
│                  MÁQUINA VIRTUAL KAHLUA                     │
│    Intérprete Lua 5.1 implementado en Java puro (JVM)      │
│  - Sin puentes JNI / C    - Exportación directa de métodos  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Manipulación de objetos Java
┌──────────────────────────────▼──────────────────────────────┐
│                    NÚCLEO DEL JUEGO (JAVA)                  │
│  - IsoWorld, IsoGridSquare, InventoryItem, IsoPlayer        │
│  - Renderizado LWJGL / OpenGL, Sonido FMOD, Física Bullet    │
│  - Recolector de Basura (Java GC)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. La Máquina Virtual Kahlua y sus Implicaciones

A diferencia de la mayoría de los motores de videojuegos que integran LuaJIT o Lua escrito en C (vía FFI/JNI), Project Zomboid ejecuta **Kahlua**, un intérprete de Lua 5.1 implementado íntegramente en Java por The Indie Stone y la comunidad open source de Java.

### Ventajas del diseño:
- **Transparencia total:** Los scripts en Lua pueden instanciar clases de Java y consumir métodos nativos directamente:
  ```lua
  local invItem = InventoryItemFactory.CreateItem("Base.Axe")
  player:getInventory():AddItem(invItem)
  ```
- **Portabilidad:** No requiere compilar binarios `.dll` o `.so` para cada plataforma (Windows/Linux/macOS).

### Desventajas y Costos de Rendimiento:
1. **Sobrecarga del Garbage Collector (GC) de Java:** Las tablas de Lua son internamente instancias de `KahluaTable` en Java. Cada asignación en bucles de alta frecuencia crea objetos en el *Heap* de Java, provocando pausas de microsegundos (*GC pauses*) cuando la memoria acumulada es limpiada.
2. **Penalización en Iteraciones:** Acceder a métodos de Java desde Lua requiere resolución reflexiva y desempaquetado de argumentos en cada llamada.

---

## 2. Interoperabilidad de Tipos de Datos (Java vs. Lua)

El puente entre Java y Kahlua no convierte automáticamente las colecciones de Java en tablas nativas de Lua. Esto genera fricciones críticas de sintaxis:

### Tabla Comparativa de Estructuras

| Operación / Tipo | Tabla Nativa de Lua | Objeto `java.util.List` / `ArrayList` (Java) |
| :--- | :--- | :--- |
| **Índice Inicial** | **1-based** (`tabla[1]`) | **0-based** (`lista:get(0)`) |
| **Longitud / Tamaño** | `#tabla` o `table.wipe(t)` | `lista:size()` |
| **Iteración Estándar** | `for i, v in ipairs(tabla) do` | `for i = 0, lista:size() - 1 do local v = lista:get(i)` |
| **Búsqueda Directa** | Requiere iterar $O(n)$ o indexar por clave | `lista:contains("cadena")` $O(n)$ optimizado en Java |
| **Adición de Elementos** | `table.insert(tabla, item)` | `lista:add(item)` |
| **Limpieza / Vaciado** | `table.wipe(tabla)` | `lista:clear()` |

### ⚠️ Antipatrón Común: Usar `ipairs()` en Listas de Java
```lua
-- ❌ ERROR FATAL: lista es un java.util.ArrayList
local recipes = player:getKnownRecipes()
for i, recipe in ipairs(recipes) do -- Fallará silenciosamente o devolverá nil
    print(recipe)
end

-- ✅ CORRECTO:
local recipes = player:getKnownRecipes()
for i = 0, recipes:size() - 1 do
    local recipe = recipes:get(i)
    print(recipe)
end
```

---

## 3. Renderizado y el Envoltorio LWJGL / OpenGL

Project Zomboid utiliza **LWJGL (Lightweight Java Game Library)** como wrapper sobre OpenGL:
- **Ejecución Monohilo de Render:** Las llamadas de dibujo isométrico ocurren en el hilo principal de renderizado (`MainThread`). Intentar invocar funciones de renderizado o manipulación de texturas desde hilos asíncronos o eventos no sincronizados producirá excepciones `OpenGLException` o corrupciones de contexto de pantalla.
- **Coordenadas de Pantalla Isométricas:** El mundo se proyecta desde coordenadas tridimensionales de cuadrícula $(x, y, z)$ a coordenadas de pantalla 2D $(sx, sy)$ mediante la transformación isométrica del motor:
  $$sx = (x - y) \cdot (\text{tileWidth} / 2)$$
  $$sy = (x + y) \cdot (\text{tileHeight} / 2) - z \cdot \text{tileHeight}$$

---

## 4. Mejores Prácticas de Rendimiento para Kahlua

1. **Reutilizar Tablas (Evitar Alocaciones en Bucles):** En eventos como `OnPlayerUpdate` o `OnTick`, declare tablas de trabajo como variables locales a nivel de archivo (`file-scoped`) y límpielas con `table.wipe(t)` en lugar de instanciar `t = {}` repetidamente.
2. **Aprovechar Métodos Nativos de Java:** Métodos como `ArrayList:contains()` o `HashMap:get()` se ejecutan en bytecode Java puro sin pasar por la evaluación léxica de Lua, siendo notablemente más veloces.
3. **Cuidado con las Cadenas de Texto (`string`):** Las concatenaciones intensivas (`"a" .. "b" .. "c"`) dentro de bucles generan múltiples objetos `java.lang.String` efímeros en la JVM. Use buffers o llamadas directas formateadas.
