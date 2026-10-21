# Brief 2026-10-21: asistente IA, Discord, errores desde el juego, recarga rápida de Lua

Ideas desarrolladas en una sesión de diseño, para que otra sesión las implemente. Nada de esto está hecho todavía.

**Antes de empezar:** leer `AGENTS.md` y `docs/ROADMAP.md`, y sumar estos cuatro puntos al ROADMAP como una fase nueva. Reglas del repo: todo en `main` con push, sin ramas; reconstruir y commitear el `.exe` de la raíz en cada mejora; los links se abren siempre en el navegador (nunca `steam://`); cada tarea empieza con un nombre corto y una estimación.

**Quién ve qué:**
- Punto 1 (asistente IA) y punto 4 (recarga de Lua): **solo con el modo developer** (`pz_show_advanced`).
- Punto 2 (Discord) y punto 3 (errores): **para todos**.

**Licencias de los mods de terceros que se mencionan:** fingerPrint es AGPL-3.0; Error Magnifier y Mod Update and Alert System (de Chuckleberry Finn) no declaran licencia, o sea, todos los derechos reservados. **No se copia ni se incluye nada de su código.** Las funciones de la API del juego no son de ellos y se pueden usar; los formatos de archivo (por ejemplo, sus changelogs) se pueden leer. Para estudiar el juego: `D:\Proyectos\pz-decompiled` (solo para estudiar, no se copia).

---

## 1. Asistente IA (modo developer) · ~2–3 días

### Dónde vive
- La pestaña MCP sale de Settings (`src/components/settings/SettingsModule.tsx`, sub-tab `MCP`) y pasa a ser una entrada propia del menú lateral (`src/components/layout/StudioSidebar.tsx`), visible solo con `pz_show_advanced`, igual que `DEVELOPER`. Nombre sugerido: "Assistant".
- Tiene tres secciones:
  1. **Proveedor**
     - API de una compañía: Anthropic, OpenAI o cualquiera compatible con la API de OpenAI (OpenRouter, Groq…).
     - Modelo local: Ollama (`localhost:11434`) o LM Studio (`localhost:1234`), ambos compatibles con la API de OpenAI. El Studio detecta si están corriendo y qué modelos tienen.
     - Claves en el Credential Manager, reutilizando `src-tauri/src/secrets`. Nunca en archivos ni en localStorage.
     - "Usar mi cuenta": las suscripciones de consumidor (Claude Pro, ChatGPT Plus) no se pueden usar desde apps de terceros. Las opciones reales son una API key o un modelo local, y la interfaz tiene que decirlo con claridad.
     - Para los IDs de modelo y los parámetros de Anthropic, consultar la skill `claude-api`, no escribirlos de memoria.
  2. **MCP:** todo lo que ya existe (las guías por cliente, el snippet con la ruta real del exe y el catálogo de herramientas), movido sin cambios.
  3. **Uso:** tokens y costo aproximado por conversación, y un botón para probar la conexión.

### El chat
- **Panel acoplable y persistente:** un drawer a la derecha que se abre con un botón en `StudioHeader` o con un atajo. Se monta en `App.tsx` por encima de los módulos, así que **sigue visible y conserva la conversación al cambiar de pestaña**. Se puede minimizar a una burbuja. El historial se guarda en `Zomboid/PZModStudio_Chat/`.
- **Sabe dónde estás:** cada mensaje lleva la pestaña activa, el mod o la tarjeta de error seleccionados y el perfil activo.
- **Herramientas:** el chat usa las mismas herramientas del catálogo MCP (`src-tauri/src/mcp/tools.rs`), llamadas dentro del mismo proceso como tool use del proveedor.
  - Las de solo lectura (`get_mod_health`, `get_error_report`, `scan_mod_conflicts`…) se ejecutan directo.
  - **Todo lo que escribe** (activar o desactivar mods, publicar un patch, ordenar, lanzar el juego) muestra una tarjeta de confirmación con lo que va a hacer, con el mismo patrón que Mod Health.
  - Con modelos locales sin soporte de tool use, el chat queda solo en modo pregunta.
  - Un límite de pasos de herramienta por turno.
- **Documentación como contexto:**
  - Crear `docs/app/`, con una página por módulo (Mod List, Health, Merger, Monitor, Servers, Maps, Browse, What's new, Developer…) que explique qué hace cada control y cómo se usa, escrita para el jugador.
  - Se compila dentro del exe con `include_str!`.
  - El modelo recibe siempre un índice corto más la página de la pestaña actual, y tiene una herramienta `read_app_doc(page)` para leer las demás.
  - La wiki técnica (`docs/01–09`) queda disponible por la misma vía.
  - Estas páginas son además la ayuda en línea del app para cualquiera, no solo para el chat.
- **Atajos desde otras pantallas:** "Ask the assistant" en las tarjetas de error del Monitor (le pasa el reporte de `error_report`), en las filas de Mod Health y en el Merger para un conflicto.
- **Técnico:** las llamadas al proveedor se hacen desde Rust, no desde el webview, para que la clave no pase por el frontend. Respuestas con streaming y con botón para detenerlas.

### Orden
1. Mover la pestaña y configurar el proveedor (~3h).
2. Chat persistente sin herramientas (~4h).
3. Documentación de `docs/app/` (~4h).
4. Herramientas con confirmación (~6h).
5. Atajos desde Monitor, Health y Merger (~2h).

---

## 2. Discord conectado al servidor (para todos, pestaña Servers) · ~1,5–2 días

Se apoya en lo que ya existe: `src-tauri/src/server_manager` (lanzar y parar el servidor, logs, jugadores, `send_server_command`) y `rcon.rs`.

1. **Solo webhook, de una vía (~3h).** El usuario pega la URL del webhook de su canal y el Studio publica:
   - servidor encendido o apagado, y si se cayó;
   - entradas y salidas de jugadores;
   - avisos de reinicio;
   - "hay mods con actualización, hace falta reiniciar", cruzando con What's new.
2. **Bot de dos vías (~1 día).** El usuario crea **su propio** bot en el Developer Portal de Discord y pega el token, que va al Credential Manager. Eso no registra el Studio en ningún lado, así que respeta la decisión del 2026-10-18 de no registrar el app hasta que esté listo para el lanzamiento.
   - **Del juego a Discord:** se sigue el chat del servidor (el log de chat en `Zomboid/Logs/` o la consola del servidor dedicado).
   - **De Discord al juego:** con `servermsg "[Discord] nombre: texto"` por RCON.
   - **Comandos:** `!players`, `!restart N` (con avisos en el juego a N, 5 y 1 minutos), `!status` y `!mods`. Los que cambian algo solo los pueden usar los roles que elija el host.
   - Para la conexión con Discord, usar una crate liviana (twilight) o un cliente WebSocket mínimo; decidir según el peso que agrega.
3. **Interfaz:** un sub-tab "Discord" dentro de la ficha de cada servidor, con el canal, el estado de la conexión, un interruptor por tipo de evento, los roles permitidos y un botón para probar. El chat de Discord se refleja en la consola del Studio con la etiqueta `[Discord]`.

**Limitación que la interfaz tiene que decir:** el puente funciona mientras el Studio está abierto y alojando el servidor.

---

## 3. Errores capturados desde el juego (para todos) · ~3–4 días en total

**Referencias estudiadas** (sin copiar nada):
- **Error Magnifier** (Workshop 2896041179) compara en cada tick la cantidad de `getLuaDebuggerErrors()` (la lista de errores con stack completo que guarda el propio juego), muestra un popup agrupado por mod y permite copiar. Expone `errorMagnifier.registerDebugReport(modId, fn)` para que cada mod registre un volcado de su estado.
- **fingerPrint** (incluido dentro de Error Magnifier) reemplaza `print()` y averigua qué mod llamó recorriendo la pila con funciones del juego: `getCurrentCoroutine`, `getCallframeTop`, `getCoroutineCallframeStack`, `getFilenameOfCallframe`.
- **Mod Update and Alert System** (Workshop 3077900375) lee el `ChangeLog.txt`, `.md` o `.bbcode` de cada mod activo y muestra en el menú principal las entradas que no viste (las vistas las guarda en `Zomboid/Lua/chuckleberryFinn_moddingAlerts.txt`). Un bloque `[ALERT_CONFIG]` agrega botones de apoyo al autor (Ko-fi, Patreon, GitHub, Discord…). 8 de los mods instalados ya usan este formato.

### Captura y atribución
1. **Errores exactos desde el juego (~4h).** El mod Studio Link (`mods/Z_StudioLink`, `src-tauri/src/studio_link`) lee `getLuaDebuggerErrors()` cuando cambia la cantidad y escribe las entradas nuevas en `Zomboid/Lua/PZModStudio_Errors.json`, con el stack completo y la hora. El app vigila el archivo y el Monitor crea la tarjeta al instante. Llega el stack entero, sin el nombre del mod cortado ni la ventana de 3 líneas de `ModBlame`.
2. **Culpable exacto (~3h).** Para cada error, recorrer la pila, sacar la ruta del archivo de cada nivel y cruzarla con el mapa "ruta → mod" que ya arma `sandbox::ModBlame` (líneas `mod "X" overrides <ruta>`). Así se terminan los errores mal atribuidos, como el caso de `KahluaThread.call > require(...)`, donde ISPathFindAction era de NeatLockpicking y se lo culpaba a FR Used Cars. La tarjeta muestra la cadena: "error en el mod A, llamado desde el mod B".
3. **Consola filtrable por mod (~3h, opcional).** Cada `print` lleva el mod que lo generó, y el Monitor gana un filtro y una columna "mod".
   - Va con un interruptor, porque recorrer la pila en cada `print` cuesta rendimiento.
   - Si fingerPrint o Error Magnifier ya reemplazaron `print`, el Studio encadena el anterior en lugar de pisarlo, o no se activa y lee el prefijo que ellos ponen.
4. **Detector de spam en la consola (~2h).** Contar las líneas por mod y por minuto. Mod Health suma el aviso "inunda la consola", con el conteo y la opción de desactivarlo. Caso real: 990 de 1.392 líneas de error venían del manejador de teclas de un solo mod.

### Dentro del juego
5. **Aviso discreto (~3h).** "2 errores nuevos · NombreDelMod", con:
   - "Ver en el Studio", que trae al frente la ventana del app con la tarjeta abierta;
   - "Desactivar este mod en el próximo inicio", por medio del archivo de Link;
   - "Copiar reporte", con el Markdown de `error_report`.
   - Todo traducido con los `Translate/EN|ES/UI.json` del Link.
6. **Del app al juego (~2h).** Cuando el Studio publica un arreglo ("Fix the path", un patch en el paquete), avisa dentro del juego: "Arreglo listo para X, reinicia para aplicarlo". Si es Lua y el juego está en debug, ofrece recargarlo en caliente (ver el punto 4).
7. **Panel "quién hace ruido" (~2h, opcional).** Los 5 mods que más errores y líneas generaron en esta sesión, con un botón para abrirlos en el Studio.
8. **Avisos del Studio en el menú principal (~3h).** Implementación propia de la idea del sistema de alertas:
   - "3 mods se actualizaron, uno puede romper esta partida";
   - "hay un arreglo listo para X";
   - "este perfil no coincide con la build instalada".
   - Si el sistema de alertas está activo, se ubica en otro lugar de la pantalla para no taparlo.
9. **Convivir con Error Magnifier (~1h).** Si `errorMagnifier` está activo, el Studio no muestra su propio popup, pero sigue recolectando los errores. Opcionalmente, si el mod culpable registró un `registerDebugReport`, llamar a esa función pública en ejecución y sumar su salida al reporte.

### Historial y What's new
10. **Historial (~3h).** Los errores se guardan por sesión. "Nuevo desde la actualización del día X", cruzando con What's new y los snapshots. "Este error apareció al activar Y." Con un clic se pasa a bisect ("Find the mod that does it"). Con el modo developer activado, aparece además "Ask the assistant".
11. **Changelogs que vienen dentro del mod (~3h).** What's new lee los `ChangeLog.*` del disco, además de las notas del Workshop. Funcionan sin internet y sirven para mods locales o de Nexus. Las palabras clave ("save", "wipe", "new game", "breaking") alimentan la etiqueta "puede romper partidas".
12. **"Apoyar al autor" (~2h).** Los botones de `[ALERT_CONFIG]` aparecen en la ficha del mod, en What's new y en Browse, y abren el navegador. Opcionalmente, una sección "Autores de tus mods".
13. **Respetar lo que ya leíste (~1h).** El Studio lee, sin escribir, `chuckleberryFinn_moddingAlerts.txt` para no marcar como nuevo algo que ya leíste en el juego.
14. **Multijugador.** En el cliente funciona igual. Los errores del servidor dedicado vienen de su consola (`server_manager`) y se muestran en la misma vista con la etiqueta "server".

### Para el modo developer
15. **El template de mod nuevo trae un `ChangeLog.txt` en ese formato (~1h)** (`devtools::create_mod`), compatible desde el primer día con el sistema de alertas y con What's new.
16. **Editor de changelog (~3h)** en Developer: agrega la entrada con la fecha, edita los enlaces de `[ALERT_CONFIG]` y opcionalmente genera el texto para la nota de cambio del Workshop.

**A verificar en 42.21:** que `getLuaDebuggerErrors()` y las funciones de pila funcionen sin `-debug` y en el cliente de multijugador. La versión de fingerPrint que trae Error Magnifier funciona en B42.15+, lo que sugiere que sí.

---

## 4. Recarga rápida de Lua (modo developer) · ~2 días

### Cómo funciona hoy
| Paso | Hoy | Demora |
|---|---|---|
| Detectar que guardaste | El frontend revisa los archivos cada 2 s (`src/components/dev/DeveloperModule.tsx`, `devtools::changed_lua_files`) | 0–2 s |
| Llevar la orden al juego | Rust escribe `Zomboid/Lua/pz_ipc_queue.json`; el bridge lo lee cada 10 ticks desde `OnTick` (`mods/Z_PZModStudio_Bridge/media/lua/client/PZModStudio_Bridge.lua`) | ~0,15 s |
| Recargar | `reloadLuaFile` dentro de un `pcall` (`devtools::reload_request_code`) | rápido |
| Mostrar el resultado | El frontend lee `pz_dev_reload.json` cada 500 ms | 0–0,5 s |

En total, ~1,3 s de promedio y hasta ~2,7 s. Además, `Bridge.OnTick` se corta si no hay jugador, así que **no funciona en el menú principal ni con el juego en pausa**. La vuelta completa nunca se probó con un jugador en el juego.

### A. Velocidad: de ~1,3 s a ~0,2 s (~4h)
1. **Vigilar los archivos desde el sistema operativo**, con la crate `notify` (`ReadDirectoryChangesW`) y un debounce de ~100 ms. Rust escribe la orden directamente, sin pasar por el frontend.
2. **El juego revisa en cada tick mientras haya una recarga pendiente**, y escucha también `OnTickEvenPaused` y `OnFETick`, como `ClaudeAgent`, para que funcione en pausa y en el menú.
3. **La respuesta se vigila con `notify`** y llega al frontend como evento, en lugar de leerla cada 500 ms.
4. **El log muestra los tiempos de cada etapa:** "detectado → enviado → aplicado: 180 ms".

### B. Recargas que no rompen el estado (~1 día)
5. **Eventos duplicados.** Recargar un archivo vuelve a ejecutar sus `Events.X.Add(fn)`; después de 10 recargas, el handler corre 10 veces. El mod registra qué handlers agregó cada archivo mientras lo carga (identificando el archivo con la pila, implementación propia) y, antes de recargar, los quita con `Events.X.Remove(fn)`.
6. **Recarga "en el lugar".** Si `B.lua` hace `return M`, quien hizo `require "B"` sigue usando la tabla vieja; las ventanas abiertas (`ISPanel:derive`) siguen con los métodos viejos. El mod guarda la tabla vieja, recarga, copia las funciones nuevas *dentro* de la tabla vieja y conserva su identidad.
7. **Recargar también a quien depende.** El grafo de `require` del mod se arma con full_moon, y el Studio ofrece recargar también los archivos que dependen del que cambió.
8. **Hook después de recargar.** Una API mínima en el mod, por ejemplo `PZStudio.onReload(fn)`, para que el modder vuelva a inicializar su estado (`OnGameStart` no vuelve a dispararse).

### C. Seguridad (~1h)
9. **Validar con el parser antes de enviar.** Si hay un error de sintaxis, no se manda: se muestra la línea y la columna. Combinarlo con `UIManager.setShowLuaDebuggerOnError(false)` durante la recarga bajo `-debug`, que es lo que ya hace ClaudeAgent.

### D. Investigar (~2h)
10. Buscar en el juego descompilado si existen funciones de debug para recargar scripts (`media/scripts`), traducciones o texturas. Si existen, la recarga cubre también ítems, recetas y textos.

**A verificar en 42.21 antes de construir la parte B:**
- que Kahlua tenga `package.loaded`, o cómo guarda los módulos ya cargados por `require`;
- que `Events.X.Remove` funcione con la misma función;
- que las funciones de pila funcionen sin `-debug`.

Las partes A y C solas (~5h) ya dan casi toda la mejora de velocidad.

---

## Revisión (2026-10-21)

Verificado contra el juego instalado (42.21) y contra el código actual del Studio antes de construir nada.

### Lo que ya está confirmado
- **Las funciones existen en 42.21:** `getLuaDebuggerErrors`, `getCurrentCoroutine`, `getCallframeTop`, `getCoroutineCallframeStack`, `getFilenameOfCallframe`, `getFilenameOfClosure`, `getLuaStackTrace`, `reloadLuaFile` y `isDebugEnabled` están en `LuaManager$GlobalObject`. `getLuaDebuggerErrors()` devuelve una copia de `KahluaThread.m_errors_list`. Que se llene sin `-debug` hay que probarlo en vivo: está en la librería Kahlua, que no está descompilada. Error Magnifier funciona para jugadores comunes, lo que sugiere que sí.
- **El canal juego ↔ app ya existe y está probado:** Link 1.13.0, con pedidos y respuestas (`LinkRequests`/`LinkAcks`), el pedido `show` que trae la ventana al frente, la copia de la lista activa y la sincronización en el menú. Varios puntos del brief salen casi gratis de ahí (ver abajo).
- **Contexto que el brief no tenía:**
  - **Abrir el Studio desde el juego solo funciona si está abierto** (o en la bandeja). Con Steam, `openUrl` va al overlay de Steam, y Lua no tiene otra forma de lanzar un programa (`showFolderInDesktop` no ejecuta un exe). Los "Ver en el Studio" del punto 3 tienen que decir eso cuando la app está cerrada, como ya hace "Open PZ Mod Studio".
  - **Ya está hecho:** errores por mod de la última sesión ("413× threw" en la Mod List) y tiempos de carga por mod (Phase 4).
  - **No hay `notify` ni WebSocket en `Cargo.toml`.**

### Mejoras propuestas

**3. Errores (empezar por acá: es para todos y reutiliza el Link)**
- **3.1 y 3.2: la pila completa ya está en `console.txt`.** Verificado en los logs: cada error trae un bloque `STACK TRACE` con todos los niveles, y cada nivel con su mod: `Lua((MOD:Take A Bath And Shower [SP/MP])).isValid(TABAS_ISPlace3DItemCursor.lua:48)`, después `Lua(Vanilla).DoTileBuilding(...)`, después `Lua((MOD:Project Viewpoint: Visible Construction))...`.
  - **La atribución por cadena se hace del lado del app**, leyendo ese bloque entero en lugar de la ventana de 3 líneas de `ModBlame`: "error en A, llamado desde B". No hace falta tocar el juego, y funciona también con logs viejos y con el servidor dedicado (3.14).
  - Los niveles sin `MOD:` (`KahluaThread.call`, `require`) se resuelven con el mapa de rutas que ya existe.
  - **Leer `getLuaDebuggerErrors()` desde el Link queda solo para el aviso dentro del juego (3.5):** el juego sabe al instante que hubo un error nuevo, sin esperar a que el app lea el log.
- **3.4 (detector de spam) se puede hacer ya, solo del lado del app**, leyendo `console.txt` con la atribución que ya existe. No necesita el juego. Es la mejora más rápida (~2h).
- **3.3 (`print` por mod): no hacerlo, o dejarlo al final.** Cuesta rendimiento en cada `print` y choca con fingerPrint y Error Magnifier (el usuario tiene `errorMagnifier` activo). El detector de spam cubre el caso real (un mod que inunda la consola).
- **3.5 "Desactivar este mod" ya no necesita esperar al próximo inicio** en el menú: el Link pide `disable <id>` al app, el app cambia el perfil y `default.txt`, y la sincronización nueva hace que el juego lo tome en segundos. En partida sí queda para la próxima vez que se vuelva al menú.
- **3.6 "Arreglo listo"** sale del mismo canal: el app escribe una línea en un archivo de avisos del Link.
- **3.8 Avisos en el menú:** conviene integrarlos a la tarjeta del Studio que ya está en el menú (perfil, Mod Health) en lugar de crear otro panel, para no tapar el sistema de alertas de Chuckleberry ni la invitación.
- **3.9 Error Magnifier:** si está activo, no mostrar popup propio. Se detecta con `getActivatedMods():contains(...)`, que es más confiable que buscar la variable global.

**4. Recarga de Lua (modo developer)**
- **A (velocidad):** en lugar de la crate `notify`, `ReadDirectoryChangesW` de `windows-sys`, que ya es dependencia. Agrega menos peso, y el app es solo para Windows.
- **El juego no puede saber que hay una recarga pendiente sin leer el archivo.** Leerlo en cada tick (60 por segundo) es caro: mejor cada 3 ticks (~50 ms), y con `OnFETick`/`OnTickEvenPaused` para que funcione en el menú y en pausa.
- **B5 (eventos duplicados), más simple:** durante `reloadLuaFile(F)`, reemplazar temporalmente `Events[X].Add` por una versión que anota `(X, fn)` para F, y quitar esos handlers antes de la próxima recarga de F. No hace falta recorrer la pila.
  - El problema es la **primera** recarga, porque los `Add` del arranque no quedaron anotados. Hay que anotar desde el arranque con un archivo `media/lua/shared/!PZStudio_DevHooks.lua` en el bridge: el juego carga los archivos de Lua por ruta en orden alfabético, y "!" va primero. Hay que verificarlo en 42.21.
- **C (validar antes de enviar)** ya existe en el app (`validate_lua_syntax`). Solo falta usarlo en ese paso.

**2. Discord**
- **Para los comandos, comandos de barra (`/players`, `/restart`) en lugar de `!players`.** No necesitan el intent privilegiado "Message Content", y los permisos por rol los maneja el propio Discord (Integraciones del servidor), así que el Studio no necesita su propia lista de roles.
- **El puente de chat Discord → juego sí necesita "Message Content":** la interfaz tiene que indicar que hay que activarlo en el Developer Portal.
- **Webhooks:** Discord limita a ~30 mensajes por minuto por webhook. Las entradas y salidas se agrupan ("3 jugadores entraron") para no cortarse en un reinicio.
- **WebSocket:** `tungstenite` (sincrónico, con el `native-tls` que ya usa `ureq`) en lugar de twilight, que trae tokio y es mucho más pesado.

**1. Asistente IA**
- **Antes del chat, `docs/app/`:** es ayuda en línea para todos y la base del contexto del asistente. Tiene valor aunque el chat nunca se haga.
- **Un paso intermedio barato y para todos: "Copiar para un asistente"** en las tarjetas de error y en Mod Health. Copia el reporte de `get_error_report` con una consigna lista para pegar en cualquier chat, sin API key.
- **Antes de tener una UI propia, el MCP ya permite** usar Claude Desktop, Cursor y otros clientes con todas las herramientas. El chat integrado suma comodidad, no capacidad nueva: dejarlo para el final.
- **Streaming desde Rust con `ureq`** (líneas SSE) alcanza: no hace falta tokio.

### Orden recomendado
| # | Tarea | Estimación |
|---|---|---|
| 1 | Detector de spam en la consola (3.4), solo app | ~2h |
| 2 | Atribución por la pila completa del log, "error en A, llamado desde B" (3.1 + 3.2), solo app | ~4h |
| 3 | Aviso en el juego desde `getLuaDebuggerErrors()`: Ver / Desactivar / Copiar reporte (3.5), y no mostrar si está Error Magnifier (3.9) | ~5h |
| 4 | Recarga de Lua: velocidad + validación (4A + 4C) | ~5h |
| 5 | Discord por webhook (2.1) | ~3h |
| 6 | `docs/app/` + "Copiar para un asistente" | ~5h |
| 7 | Changelogs dentro del mod + "Apoyar al autor" + respetar lo leído (3.11–3.13) | ~6h |
| 8 | Recarga sin romper el estado (4B) | ~1 día |
| 9 | Bot de Discord de dos vías (2.2) | ~1 día |
| 10 | Chat del asistente con proveedor y herramientas (1) | ~2 días |
| — | `print` por mod (3.3) | no por ahora |
