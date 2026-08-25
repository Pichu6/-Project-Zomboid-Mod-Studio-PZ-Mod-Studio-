# 05 — Distribución de Botín y Procedural Spawning

La generación de objetos en contenedores, estanterías y vehículos está gobernada por un sistema híbrido: las **tablas de probabilidad en Lua** (`SuburbsDistributions.lua` y `ProceduralDistributions.lua`) y el **motor de resolución en Java** (`ItemPickerJava`).

---

## 1. Arquitectura de Distribución de Botín

Cuando un jugador abre por primera vez una habitación o un contenedor (`ItemContainer`), el motor de Java evalúa si la casilla ya fue explorada:

```
Jugador abre contenedor por 1ª vez
               │
               ▼
┌──────────────────────────────┐
│  ItemPickerJava.fill(cont)   │
└──────────────┬───────────────┘
               │ Consulta tipo de habitación y tipo de contenedor
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   SuburbsDistributions.lua                  │
│  Habitación: "bedroom" -> Contenedor: "wardrobe"            │
│  Apunta a -> ProceduralDistributions: "WardrobeManClassy"   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 ProceduralDistributions.lua                 │
│  - rolls: 4 (intentos de tirada)                            │
│  - items: { "Base.Shirt_FormalWhite", 20.0,                 │
│             "Base.Trousers_Suit", 15.0,                     │
│             "Base.Watch_Gold", 0.5 }                        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Instanciación en ItemContainer (Java)              │
│  - Verifica Sandbox: Multiplicadores de botín (Raro, Abund.)│
│  - Añade ítems generados al contenedor                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Estructura de `ProceduralDistributions.lua`

Cada entrada en `ProceduralDistributions.list` define una lista ponderada de probabilidades:

```lua
ProceduralDistributions.list["GunStoreDisplayCase"] = {
    rolls = 3,
    items = {
        "Base.Pistol", 10.0,
        "Base.Pistol2", 8.0,
        "Base.Shotgun", 4.0,
        "Base.9mmClip", 15.0,
        "Base.Bullets9mmBox", 20.0,
    },
    junk = {
        rolls = 1,
        items = {
            "Base.HolsterSimple", 10.0,
            "Base.CleaningKit", 5.0,
        }
    }
}
```

### Inyección Segura de Items desde Mods:
Para evitar sobrescribir las tablas de otros mods, nunca reemplace la tabla completa. Inserte los nuevos items directamente con `table.insert`:

```lua
local function InjectCustomLoot()
    local targetDist = ProceduralDistributions.list["GunStoreDisplayCase"]
    if targetDist and targetDist.items then
        table.insert(targetDist.items, "MyMod.CustomRevolver")
        table.insert(targetDist.items, 6.0) -- Probabilidad / Peso
    end
end
Events.OnGameBoot.Add(InjectCustomLoot)
```

---

## 3. Cambios Críticos en las APIs de Contenedores en Build 42

En Build 42, el departamento de programación de The Indie Stone refactorizó la arquitectura interna de `ItemContainer` y la clase `ItemPickerJava`:

### 1. Refactorización de Tipos de Colección:
- En Build 41, métodos de Java devolvían `java.util.ArrayList`.
- En Build 42 (versiones 42.13+), múltiples métodos pasaron a devolver colecciones basadas en `java.util.Set` o interfaces inmutables para optimizar la búsqueda de componentes.
- **Consecuencia:** Mods de Build 41 que invocaban llamadas directas de lista arrojan `java.lang.NoSuchMethodError` o `java.lang.ClassCastException`.

### 2. Contenedores con Soporte de Componentes:
- Los contenedores en Build 42 distinguen entre inventarios de sólidos, ranuras de fluidos (`FluidContainer`) y compartimentos modulares de vehículos.
- Los scripts que iteran sobre contenedores deben verificar si el objeto implementa la interfaz antes de asumir que contiene `InventoryItem`:
  ```lua
  if container:isItemAllowed(item) then
      container:AddItem(item)
  end
  ```
