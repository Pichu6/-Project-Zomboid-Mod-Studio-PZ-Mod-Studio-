# 📚 Wiki Técnica de Project Zomboid & Arquitectura de Modding

Bienvenido a la **Wiki Técnica de Project Zomboid**, una base de conocimiento exhaustiva y modular diseñada para ingenieros de software, desarrolladores de modificaciones (*modders*) y agentes de inteligencia artificial (*AI Agents* conectados vía MCP, Antigravity, Claude, Cursor, etc.).

Esta documentación desglosa con rigor matemático y arquitectónico el funcionamiento interno del motor de The Indie Stone, la máquina virtual **Kahlua (Lua-in-Java)**, las diferencias críticas entre **Build 41 (Legacy)** y **Build 42 (Unstable/Modern)**, el protocolo de red, y los sistemas de control de procesos en tiempo real.

---

## 🗺️ Mapa de Contenidos

| Módulo | Documento | Resumen Técnico |
| :--- | :--- | :--- |
| **01** | [**Arquitectura del Motor, JVM y Kahlua VM**](file:///e:/PZ%20Mod%20Studio/docs/01-arquitectura-motor-kahlua-java.md) | Integración Java-Lua, intérprete Kahlua, recolección de basura, conversión de tipos (List vs Table, índices 0 vs 1) y límites de renderizado OpenGL/LWJGL. |
| **02** | [**Ciclo de Vida de Scripts Lua y Bus de Eventos**](file:///e:/PZ%20Mod%20Studio/docs/02-ciclo-vida-lua-y-eventos.md) | Dominios `shared`, `client`, `server`. Orden alfabético y precedencia vanilla. Eventos principales, subscripciones seguras y técnicas avanzadas de *Monkey Patching* (Function Wrapping). |
| **03** | [**Definiciones de Items, Crafting y Fluidos (B42)**](file:///e:/PZ%20Mod%20Studio/docs/03-crafting-items-y-fluidos-b42.md) | Transición de `Recipe` a `craftRecipe`, sistema de indexación semántica (`Tags`), banderas de herencia física (`InheritCooked`, `InheritFood`) y la API `FluidContainer` (prevención de bucles armónicos). |
| **04** | [**Interfaz de Usuario (UI) y Timed Actions**](file:///e:/PZ%20Mod%20Studio/docs/04-ui-context-menu-y-timedactions.md) | Jerarquía `ISUIElement`, ciclo de renderizado, inyección segura en menús contextuales (`OnFillWorldObjectContextMenu` y flag `test`), y máquina de estados completa de `ISBaseTimedAction`. |
| **05** | [**Distribución de Botín y Procedural Spawning**](file:///e:/PZ%20Mod%20Studio/docs/05-distribucion-de-botin-y-spawns.md) | Cómo funciona `ItemPickerJava`, `SuburbsDistributions.lua`, `ProceduralDistributions.lua`, mapeo de habitaciones/contenedores y cambios de firmas de Java en B42 (`ArrayList` vs `Set`). |
| **06** | [**Persistencia ModData, Red y Anti-Cheat**](file:///e:/PZ%20Mod%20Studio/docs/06-networking-moddata-y-seguridad.md) | Ámbitos de `ModData` (Item, Player, IsoObject, Global). Sincronización cliente-servidor con `sendClientCommand`/`sendServerCommand`. Arquitectura de atestación CHAP y canarios anti-inyección. |
| **07** | [**Audio FMOD, Traducciones JSON y Espacio 3D**](file:///e:/PZ%20Mod%20Studio/docs/07-sonido-traducciones-y-espacio-b42.md) | Sistema de sonido (`media/scripts/*.txt`), migración obligatoria a `.json` en B42.15+, depuración con `-debugtranslation`, y alturas verticales ampliadas (coordenadas Z de -32 a +32). |
| **08** | [**Diagnóstico de Crashes, VFS y Fusión AST**](file:///e:/PZ%20Mod%20Studio/docs/08-diagnostico-de-crashes-y-vfs.md) | Taxonomía de errores en `console.txt` (`KahluaThreadException`, `NoSuchMethodError`, `UnknownFormatConversionException`), sistema de archivos virtual y algoritmos de 3-way AST merge. |
| **09** | [**Control del Proceso y Bridge IPC en Vivo**](file:///e:/PZ%20Mod%20Studio/docs/09-control-del-juego-y-bridge-ipc.md) | Control de `ProjectZomboid64.exe` (lanzar en `-debug`, terminar proceso), y el companion mod `Z_PZModStudio_Bridge` para ejecutar comandos Lua y equipar items en caliente desde un agente. |

---

## 🎯 Directrices de Uso para Agentes de IA

1. **Lectura Contextual:** Antes de generar o modificar scripts de Project Zomboid, consulte el capítulo relevante para validar la versión de destino (`Build 41` vs `Build 42`).
2. **Prioridad Declarativa:** Si una mecánica puede expresarse mediante definiciones `.txt` (`craftRecipe`, `item`, `sound`), evite inyectar código procedural Lua.
3. **Seguridad en Runtime:** Jamás use funciones anónimas en el bus `Events.*.Add()` ni rompa la cadena de retorno en *monkey patches*.
4. **Control en Vivo:** Utilice las herramientas MCP de `PZ Mod Studio` para monitorear `console.txt`, ejecutar el bridge IPC y validar sintaxis con el parser AST (`full_moon`).
