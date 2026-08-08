# 🧟 Project Zomboid Mod Studio (PZ Mod Studio)

> **La suite definitiva de escritorio para la gestión, resolución de conflictos y compatibilidad de mods en Project Zomboid (Build 42+).**

---

## 📌 Descripción

**Project Zomboid Mod Studio (PZ Mod Studio)** es una aplicación de escritorio portátil de alto rendimiento diseñada para resolver los conflictos de mods y las roturas de versión en **Project Zomboid (Build 42+)**.

A diferencia de un simple *script merger*, **PZ Mod Studio** ofrece una solución integral de 4 módulos que permite a los jugadores y modders combinar de forma inteligente scripts y código Lua, inyectar capas de compatibilidad para mods desactualizados (Polyfills), administrar el orden de carga (`ModListData.ini`) y diagnosticar errores en un laboratorio de pruebas aislado.

---

## ✨ Características Principales

- **🔀 Detector de Conflictos Virtuales & 3-Way AST Merger:**
  Superpone las rutas de Vanilla (`media/lua/` y `media/scripts/`), Steam Workshop y Mods Locales. Fusiona automáticamente modificaciones no solapadas de código Lua y bloques de datos `.txt` (ítems, recetas, fluidos, vehículos).
- **🛡️ Motor de Polyfills (JSON-Driven B42 Compatibility):**
  Inyecta parches sintácticos estáticos y dinámicos para reparar llamadas obsoletas de la B41 (conversión de String a Enum, metatablas para globales no inicializados, redirección de `require` y sanitización de textos en Java).
- **📋 Gestor de Load Order y Dependencias:**
  Lee y modifica directamente `ModListData.ini` y manifiestos `mod.info`, ordenando topológicamente las dependencias y permitiendo guardar perfiles de mods personalizados.
- **🧪 Laboratorio Sandbox & Inspector de Logs (`console.txt`):**
  Prueba configuraciones en un proceso aislado (`-cachedir`, `-debug`) e intercepta crasheos en `console.txt`, traduciendo stacktraces de Java/Lua a lenguaje humano con recomendaciones con 1-clic.

---

## 🛠️ Stack Tecnológico

- **Frontend:** React + TypeScript + TailwindCSS + Monaco Editor (Engine de VS Code).
- **Backend:** Rust + Tauri (Escaneo de rutas virtuales ultrarrápido y diffing AST).
- **Formato:** Portable (sin instalador, compatible con GitHub Releases).

---

## 📄 Licencia

Licencia MIT - Libre para la comunidad de Project Zomboid.
