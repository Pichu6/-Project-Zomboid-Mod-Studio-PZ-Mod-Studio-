# 03 — Definiciones de Items, Crafting y Fluidos en Build 42

En Project Zomboid, las definiciones de objetos, recetas de fabricación, modelos y animaciones no se programan en Lua puro, sino que residen en archivos declarativos `.txt` dentro del directorio `media/scripts/`. 

Con la llegada de **Build 42**, The Indie Stone implementó una transición masiva hacia un diseño guiado por datos (*Data-Driven Design*), reduciendo la sobrecarga de la máquina virtual Kahlua y migrando la lógica a compiladores internos de Java y C++.

---

## 1. El Formato Declarativo `scripts/*.txt`

Los archivos de script utilizan una sintaxis de bloques tipo clave-valor:

```text
module Base {
    item CustomMachete {
        Type = Weapon,
        DisplayName = Custom Machete,
        Icon = MacheteCustom,
        MinDamage = 1.8,
        MaxDamage = 2.8,
        Weight = 2.0,
        Categories = Blade,
        SubCategory = Slash,
        AttachmentType = Knife,
        Tags = SharpKnife;ButcherTool,
    }
}
```

---

## 2. Transición Estructural: `Recipe` (B41) vs `craftRecipe` (B42)

### El Enfoque Heredado (Build 41):
En Build 41, las recetas se definían con el bloque `Recipe`. Cualquier lógica física no trivial (ej: transferir calorías de los ingredientes o preservar el estado podrido) requería obligatoriamente escribir extensas funciones `OnCreate` en Lua.

### El Nuevo Estándar (Build 42): `craftRecipe`
Build 42 introduce `craftRecipe`, que permite:
- Requisitos de estaciones de trabajo (`Workstation = Forge/Anvil/Workbench`).
- Tiempos de fabricación fraccionales y consumo gradual de herramientas.
- Integración nativa con fluidos y etiquetas semánticas.

```text
module Base {
    craftRecipe CraftCustomSpear {
        category = Survivalist,
        Time = 80,
        Anim = MakingSpear,
        Workstation = Workbench,

        inputs {
            item 1 tags[SharpKnife],
            item 1 WoodenStick,
            item 1 DuctTape { consume = 2 },
        }

        outputs {
            item 1 CustomSpear,
        }
    }
}
```

---

## 3. Sistema de Indexación Categórica (`Tags`)

En lugar de listar nombres absolutos de items individuales en cada receta (lo que requería duplicar código para admitir variantes), Build 42 utiliza etiquetas semánticas (`Tags`):

- **En la definición del Item:**
  ```text
  Tags = SharpKnife;CutPlant;OpenCan;ButcherAnimal,
  ```
- **En la Receta:**
  ```text
  inputs {
      item 1 tags[SharpKnife],
  }
  ```
Esto permite que cualquier mod añada nuevos cuchillos simplemente asignándoles la etiqueta `SharpKnife`, haciéndolos automáticamente compatibles con todas las recetas vanilla y de otros mods sin necesidad de parches de compatibilidad.

---

## 4. Banderas de Herencia Física (`InheritFood` e `InheritCooked`)

En Build 41, transformar alimentos requería manipular tablas de datos en Lua. En Build 42, el motor transfiere automáticamente todas las variables físicas mediante directivas declarativas:

| Directiva | Efecto Físico en el Producto Resultante |
| :--- | :--- |
| `InheritFood` | Transfiere automáticamente calorías, proteínas, carbohidratos, lípidos, nivel de putrefacción y toxicidad. |
| `InheritCooked` | Preserva el estado de cocción (crudo, cocinado, quemado) y la temperatura térmica del ingrediente original. |

---

## 5. Dinámica de Fluidos y la API `FluidContainer`

Build 42 introduce una arquitectura orientada a componentes para líquidos y gases a través de la clase `FluidContainer`:

```
┌────────────────────────────────────────┐
│             InventoryItem              │
│  - DisplayName: "Bidón de Combustible" │
│  - Weight: 1.5                         │
│  ┌──────────────────────────────────┐  │
│  │      FluidContainer (Component)  │  │
│  │  - Capacity: 10.0 L              │  │
│  │  - CurrentAmount: 7.5 L          │  │
│  │  - FluidType: "Gasoline"         │  │
│  │  - Properties: Density, Flammab. │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### Reglas para Modders en Vehículos y Contenedores:
- Para piezas de vehículos que contengan combustible, asigne siempre `category = "gastank"` y `contentType = "Gasoline"`.
- Los recipientes calculan dinámicamente el peso del personaje en función de la densidad y el volumen del líquido almacenado.

### ⚠️ Prevención de Bucles de Oscilación Armónica (*Feedback Loops*)
El evento `Events.OnWaterAmountChange` se dispara cada vez que el volumen de un contenedor cambia.

**El Error Típico:**
1. Una función escucha `OnWaterAmountChange`.
2. Calcula una propiedad visual y llama a `container:UpdateWaterLevel()`.
3. Java procesa la actualización y **vuelve a disparar** `OnWaterAmountChange`.
4. Si el fluido es exótico o no químico (ej: mezclas complejas), la convergencia falla y se genera un bucle infinito que satura los registros de `console.txt` e inunda los paquetes de red con `ChunkObjectState`.

**La Solución (Early Bail-Outs):**
```lua
local function Safe_OnWaterAmountChange(object)
    -- Válvula de escape: verificar si el objeto existe y si ya convergió
    if not object or not object:getFluidContainer() then return end
    
    local container = object:getFluidContainer()
    local currentAmount = container:getAmount()
    
    -- Evitar recalcular si el delta es infinitesimal
    if math.abs((object:getModData().lastAmount or 0) - currentAmount) < 0.001 then
        return
    end
    
    object:getModData().lastAmount = currentAmount
    -- Ejecutar lógica segura
end
Events.OnWaterAmountChange.Add(Safe_OnWaterAmountChange)
```
