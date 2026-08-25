# 07 — Audio FMOD, Traducciones JSON y Espacio 3D

Este capítulo cubre la evolución técnica en Build 42 para tres subsistemas fundamentales: el motor de audio **FMOD**, la transición al estándar **JSON de traducciones (B42.15+)**, y la expansión del **espacio tridimensional y vertical**.

---

## 1. Sistema de Audio y FMOD

Project Zomboid utiliza el motor de sonido profesional **FMOD**. Para los mods, los efectos de audio se registran de forma declarativa dentro de `media/scripts/` (ej: `media/scripts/MySounds.txt`):

```text
module MyMod {
    sound CustomGunshot {
        category = Weapon,
        clip {
            file = media/sound/CustomGunshot.ogg,
            volume = 0.8,
            distanceMax = 80,
        }
    }
}
```

### Reproducción desde Lua:
- **Sonido en el Mundo (Con Atenuación Espacial y Oclusión):**
  ```lua
  getSoundManager():PlayWorldSound("CustomGunshot", square, 0.2, 80, 1.0, true)
  ```
- **Sonido Anclado al Personaje:**
  ```lua
  character:playSound("CustomGunshot")
  ```

---

## 2. Sistema de Traducciones: La Transición a JSON (Build 42.15+)

A partir de **Build 42.15**, The Indie Stone migró el formato de archivos de internacionalización desde los antiguos `.txt` con sintaxis `Clave = "Valor",` hacia **archivos JSON estrictos codificados en UTF-8**:

```
media/lua/shared/Translate/
├── EN/
│   ├── ItemName_EN.json
│   ├── ContextMenu_EN.json
│   └── IG_UI_EN.json
└── ES/
    ├── ItemName_ES.json
    ├── ContextMenu_ES.json
    └── IG_UI_ES.json
```

### Estructura del Archivo JSON (`ContextMenu_ES.json`):
```json
{
  "ContextMenu_CustomOption": "Fabricar Refuerzo Avanzado",
  "ContextMenu_CustomOption_Tooltip": "Requiere nivel 4 de Carpintería y clavos de acero."
}
```

### Recuperación en Lua:
```lua
local localizedText = getText("ContextMenu_CustomOption")
```

### 🛠️ Depuración de Traducciones con `-debugtranslation`:
Al iniciar el juego con el argumento `-debugtranslation` en las opciones de lanzamiento de Steam, Project Zomboid genera automáticamente un archivo `translationProblems.txt` en la carpeta `C:/Users/<Usuario>/Zomboid/`, listando todas las claves faltantes o mal formateadas.

### ⚠️ El Error `UnknownFormatConversionException`:
Si una cadena traducida contiene el carácter de porcentaje `%` (ej: `"Daño +15% de crítico"`) y se procesa mediante funciones de formato en Java, la JVM lanzará `UnknownFormatConversionException`. En cadenas que no sean plantillas de formato (`%s`, `%d`), el símbolo de porcentaje debe escaparse como `%%` (`"Daño +15%% de crítico"`).

---

## 3. Espacio Tridimensional y Coordenadas Verticales en Build 42

Build 42 reescribió por completo la gestión del espacio físico en el motor de renderizado:

| Parámetro Espacial | Build 41 (Legacy) | Build 42 (Unstable/Modern) |
| :--- | :--- | :--- |
| **Rango de Coordenadas Z** | De `0` a `7` niveles | De **`-32` a `+32`** niveles |
| **Sótanos y Búnkeres** | Falsos (en tiles aislados en $Z=0$) | **Sótanos Físicos Reales** (coordenadas $Z < 0$) |
| **Rascacielos / Edificios Altos** | Máximo 7 pisos | **Hasta 32 pisos** en centros urbanos |
| **Iluminación** | Luz estática en 2D | Sombras vectoriales y oclusión volumétrica |
| **Tejados** | Planos a 45 grados fijos | Techos angulares paramétricos a 30° |

### Bucle Seguro de Búsqueda de Casillas (`IsoGridSquare`):
Cuando un mod busca casillas adyacentes en el eje vertical, ahora debe considerar los niveles subterráneos:

```lua
local currentZ = player:getZ()
-- Comprobar si el jugador está bajo tierra (sótano)
if currentZ < 0 then
    -- Aplicar modificadores de oscuridad o temperatura subterránea
end
```
