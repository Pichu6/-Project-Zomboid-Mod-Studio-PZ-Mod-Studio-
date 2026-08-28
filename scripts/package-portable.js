import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const releaseDir = path.join(rootDir, 'src-tauri', 'target', 'release');

// Files to copy directly to repository root
const appExeSrc = path.join(releaseDir, 'pz-mod-studio.exe');
const appExeDest = path.join(rootDir, 'Project-Zomboid-Mod-Studio.exe');

const mcpExeSrc = path.join(releaseDir, 'pz-mcp-server.exe');
const mcpExeDest = path.join(rootDir, 'pz-mcp-server.exe');

if (fs.existsSync(appExeSrc)) {
  fs.copyFileSync(appExeSrc, appExeDest);
  console.log(`[Packaging] Copied ${appExeDest}`);
} else {
  console.error(`[Packaging] Error: ${appExeSrc} not found.`);
}

if (fs.existsSync(mcpExeSrc)) {
  fs.copyFileSync(mcpExeSrc, mcpExeDest);
  console.log(`[Packaging] Copied ${mcpExeDest}`);
}

const readmeContent = `=============================================================================
  🧟 PROJECT ZOMBOID MOD STUDIO — PORTABLE EDITION (STANDALONE) 🧟
=============================================================================

Welcome to Project Zomboid Mod Studio!

This version is 100% PORTABLE: no prior installation or configuration required.

-----------------------------------------------------------------------------
🚀 USAGE INSTRUCTIONS:
-----------------------------------------------------------------------------
1. Run the executable file directly:
   👉 "Project-Zomboid-Mod-Studio.exe"

2. It will not open extra console (CMD) windows and features a built-in
   initial cinematic splash screen.

3. On launch, the application will automatically detect your Project Zomboid,
   Steam Workshop, and mod profile directories.

-----------------------------------------------------------------------------
🤖 AI AGENT INTEGRATION (MCP SERVER):
-----------------------------------------------------------------------------
If you use Claude Desktop, Antigravity, Cursor, or Windsurf, the included
"pz-mcp-server.exe" binary allows your AI assistant to control the game,
inspect live logs, sort load orders, and generate compatibility patches.

-----------------------------------------------------------------------------
System Requirements:
- Windows 10 / Windows 11 (64-bit)
- WebView2 Runtime (built-in by default on Windows 10/11)
=============================================================================
`;

fs.writeFileSync(path.join(rootDir, 'README_PORTABLE.txt'), readmeContent, 'utf-8');
const oldReadme = path.join(rootDir, 'LEEME_PORTABLE.txt');
if (fs.existsSync(oldReadme)) {
  fs.unlinkSync(oldReadme);
}
console.log(`[Packaging] Generated ${path.join(rootDir, 'README_PORTABLE.txt')}`);
console.log(`[Packaging] ✅ Portable executables created successfully in root directory: ${rootDir}`);
