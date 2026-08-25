# 08 — Diagnóstico de Crashes, VFS y Fusión AST

Uno de los mayores dolores de cabeza en el ecosistema de Project Zomboid es el diagnóstico de fallos silenciosos y conflictos entre modificaciones. Este capítulo detalla la taxonomía de errores del log `console.txt`, la resolución de colisiones en el Sistema de Archivos Virtual (VFS) y el motor de fusión AST (*Abstract Syntax Tree*).

---

## 1. Taxonomía de Errores y Firmas de Crash en `console.txt`

El archivo `C:/Users/<Usuario>/Zomboid/console.txt` registra toda la actividad de la JVM y de la máquina virtual Kahlua.

```
┌─────────────────────────────────────────────────────────────┐
│                    FIRMAS DE ERROR EN PZ                    │
├──────────────────────────┬──────────────────────────────────┤
│ Firma en console.txt     │ Causa Raíz & Solución            │
├──────────────────────────┼──────────────────────────────────┤
│ KahluaThreadException    │ Fallo de tiempo de ejecución Lua │
│ NoSuchMethodError        │ Incompatibilidad API B41 vs B42  │
│ ChooseGameInfo$Mod.getId │ Formato de versionMin inválido   │
│ attempted index of non-t │ Acceso a tabla global prematuro  │
│ UnknownFormatConversion  │ Símbolo % sin escapar en texto   │
└──────────────────────────┴──────────────────────────────────┘
```

### 1. `KahluaThreadException` / `se.krka.kahlua.vm.KahluaException`
- **Diagnóstico:** Se produjo una excepción no manejada dentro de la máquina virtual Lua.
- **Análisis del Callframe:**
  ```text
  STACK TRACE
  -----------------------------------------
  function: perform -- file: MyCustomAction.lua line # 42 | MOD: MyMod
  function: update -- file: ISTimedActionQueue.lua line # 78
  ```
- **Solución:** Inspeccionar la línea exacta señalada en el callframe del mod culpable (`MyCustomAction.lua:42`).

### 2. `java.lang.NoSuchMethodError` / `java.lang.ClassCastException`
- **Diagnóstico:** Un mod diseñado para Build 41 está intentando invocar un método Java cuya firma cambió o fue eliminada en Build 42 (por ejemplo, métodos de `ItemContainer` o `ItemPickerJava`).
- **Solución:** Refactorizar el código Lua para utilizar la nueva API o aislar el script en el directorio `/41/media/`.

### 3. `NullPointerException` en `ChooseGameInfo$Mod.getId()`
- **Diagnóstico:** En el manifiesto `mod.info`, se declaró `versionMin=42` como un número entero sin decimales.
- **Solución:** Cambiar a `versionMin=42.00` o eliminar la directiva y usar `versionMax=42.14.1`.

### 4. `attempt to index a nil value` / `attempted index of non-table`
- **Diagnóstico:** Un script de mod intentó acceder a una tabla antes de que fuera inicializada (condición de carrera por orden de carga alfabético).
- **Solución:** Envolver la inicialización dentro de `Events.OnGameBoot.Add()` o aplicar el polyfill `SAFE_GLOBAL_TABLE_ACCESS`.

---

## 2. Detección de Conflictos en el Virtual File System (VFS)

Cuando dos o más mods reemplazan el mismo archivo dentro de la jerarquía `media/` (por ejemplo, ambos suministran su propia versión de `media/lua/client/ISUI/ISInventoryPane.lua`), el motor de Project Zomboid ejecuta una **sobrescritura destructiva basada en el orden de carga**: el último mod en cargar destruye completamente las modificaciones del primero.

```
Mod A: media/lua/client/ISUI/ISInventoryPane.lua  ─┐
                                                   ├─► VFS COLLISION!
Mod B: media/lua/client/ISUI/ISInventoryPane.lua  ─┘
                               │
                               ▼ (El juego carga solo Mod B)
               ¡Mod A deja de funcionar por completo!
```

---

## 3. Motor de Fusión AST (3-Way Merge) en Rust

Para resolver colisiones VFS de forma no destructiva sin perder el trabajo de ninguno de los dos mods, **PZ Mod Studio** implementa un motor de fusión de 3 vías (*3-way merge*) basado en Árboles de Sintaxis Abstracta (AST) utilizando el crate `full_moon`:

```
           [Base Vanilla Script]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
    [Mod A AST]             [Mod B AST]
         │                       │
         └───────────┬───────────┘
                     ▼
       [3-Way AST Merge Engine (Rust)]
                     │
                     ▼
    [Z_PZModStudio_MasterPatch Unified Script]
```

### Principios del Merge AST:
1. **Preservación de Funciones Nuevas:** Si el Mod A añade una función `MyModA_Helper()` y el Mod B añade `MyModB_Helper()`, ambas se insertan en el AST unificado.
2. **Fusión de Bloques Modificados:** Si ambos mods modifican la misma función base, el motor detecta si las alteraciones son ortogonales y las combina secuencialmente preservando las referencias `self` y la cadena de retorno.
3. **Paquete de Parche Maestro (`Z_PZModStudio_MasterPatch`):** La resolución resultante se escribe automáticamente en la carpeta de parches del usuario, la cual lleva el prefijo `Z_` para garantizar su carga al final de la cadena de mods.
