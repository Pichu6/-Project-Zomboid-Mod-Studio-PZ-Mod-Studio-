# Tomas para la página del Workshop

Las imágenes de [workshop.txt](workshop.txt) se cargan desde GitHub (`workshop/Z_StudioLink/media/`).
Grabás cada toma, la guardás en `workshop/Z_StudioLink/recordings/` con el nombre de la tabla y corrés:

```
node scripts/make-workshop-gifs.cjs
```

Eso deja los gifs en `media/` (menos de 5 MB cada uno). Después: commit y push, y las imágenes
aparecen en la página de Steam (la descripción ya apunta ahí; no hace falta volver a subir el mod).

## Cómo grabar

- **Con qué:** OBS (captura de ventana) o la barra de juego de Windows (`Win+Alt+R` empieza y para;
  guarda en `Videos\Capturas`). Cualquier mp4 sirve.
- **El juego en ventana**, 1600x900 o 1920x1080. El gif se achica a 800 px de ancho, así que la letra
  tiene que verse grande: si se puede, subí la escala de la interfaz (Opciones > Pantalla > tamaño de fuente).
- **Mové el mouse despacio** y quedate quieto 1 segundo antes y después de cada clic: en un gif lo que
  pasa rápido no se ve.
- **Cortas:** 6 a 12 segundos por toma. Si te sobra al principio o al final, renombrá con el corte:
  `03-requirements@2-11.mp4` guarda del segundo 2 al 11.
- **Sin la app abierta** para las tomas 01 a 06 (así se ve lo que tiene alguien que solo se suscribe).
  Con la app abierta para 07 y 08.

## Lista

| Archivo | Qué mostrar | Duración |
| --- | --- | --- |
| `01-mods-screen` | Menú principal → **MODS**. Se abre la pantalla nueva; bajá un poco por la lista y hacé clic en un mod con póster para ver su detalle. | ~8 s |
| `02-search-filters` | Escribí algo en la búsqueda (un autor, por ejemplo), borrá; clic en **Problems**, después **Maps**, después **All**. Si da, **Groups: author** y plegá un grupo. | ~10 s |
| `03-requirements` | Activá un mod que necesite una librería apagada → aparece el aviso "needs these… they come on with it" → aceptá. Después apagá una librería que otros usan → aviso "these go off with it" → volvé atrás. | ~12 s |
| `04-load-order` | **Sort: load order**. Arrastrá un mod hacia arriba hasta que se frene en lo que requiere (se ve el aviso). Después **Undo**. | ~10 s |
| `05-many-mods` | Ctrl+clic en 3 o 4 mods → **Turn all on**. Después abrí **Mod options** de un mod con opciones. | ~10 s |
| `06-error-notice` (**png**) | Captura (no video) del aviso de error de Lua en el menú, con **Copy report** a la vista. Hace falta un mod que tire error; guardalo como `media/06-error-notice.png` directo. | foto |
| `07-profiles` | Con la app abierta: cambiá de perfil en la app, pasá al juego y abrí **MODS**: se ve el perfil nuevo arriba. Si tenés mods fuera del perfil, que se vea el botón **+N new**. | ~12 s |
| `08-save-check` (**png**) | Captura del aviso "What changed since its last session" al cargar una partida (con **Back / Play on a copy / Load it**). Aparece en una partida cuyos mods cambiaron. Guardalo como `media/08-save-check.png`. | foto |

Las capturas de Mod Health y del Monitor ya están (`docs/forum/images/`). Si querés renovarlas,
reemplazá esos png.

## Video

Uno solo, **grabado de corrido** (sin zoom ni movimiento de cámara, que es lo que hacía temblar
el anterior), 60-90 s: abrir MODS, buscar, activar un mod con requisitos, ordenar, y después la
app (cambiar de perfil, Mod Health). Subilo a **YouTube** (puede ser "No listado") y en la página
del Workshop: **Add/edit images & videos** → pegá el link. Ahí mismo podés subir también los png
como capturas de la galería.
