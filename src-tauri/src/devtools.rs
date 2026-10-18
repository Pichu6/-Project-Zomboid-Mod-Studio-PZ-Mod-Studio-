//! For the people who make the mods: check a whole mod before the game does, and open the
//! file that is wrong in their editor.
//!
//! Every `.lua` under the mod goes through the same parser the Merger uses (full_moon, on a
//! big stack), and every `media/scripts/*.txt` through a brace check — the game's script reader
//! stops at the first unbalanced block and the whole file is silently lost. What comes back is
//! one row per problem: file, line, column, what the parser said.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileProblem {
    /// From the mod's root, with forward slashes.
    pub path: String,
    pub line: Option<u32>,
    pub col: Option<u32>,
    pub message: String,
    /// `lua` or `script`.
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModValidation {
    pub root: String,
    pub lua_files: usize,
    pub script_files: usize,
    pub problems: Vec<FileProblem>,
}

/// The parser's message split into one problem per error, each with its line and column.
/// full_moon writes "error occurred while creating ast: unexpected token `end`. (starting from
/// line 4, character 1 and ending on line 4, character 4)\nadditional information: ..." and joins
/// several with "; ".
pub fn lua_problems(path: &str, message: &str) -> Vec<FileProblem> {
    let message = message.trim_start_matches("Lua AST Syntax Error: ");
    let mut out = Vec::new();
    for part in message.split("error occurred while creating ast: ") {
        let part = part.trim().trim_end_matches(';').trim();
        if part.is_empty() {
            continue;
        }
        let (text, rest) = part.split_once(" (starting from line ").unwrap_or((part, ""));
        let line = rest.split(',').next().and_then(|n| n.trim().parse::<u32>().ok());
        let col = rest.split_once("character ").and_then(|(_, c)| c.split(|ch: char| !ch.is_ascii_digit()).next()?.parse::<u32>().ok());
        let extra = part.split_once("additional information: ").map(|(_, e)| e.trim_end_matches(';').trim());
        let mut text = text.trim_end_matches('.').to_string();
        if let Some(e) = extra {
            text = format!("{} ({})", text, e);
        }
        out.push(FileProblem { path: path.to_string(), line, col, message: text, kind: "lua".into() });
    }
    if out.is_empty() {
        out.push(FileProblem { path: path.to_string(), line: None, col: None, message: message.to_string(), kind: "lua".into() });
    }
    out
}

/// A script file's braces, block by block: an extra `}` and an unclosed `{` are each a problem
/// with the line it happened on. Comments (`/* */` and `//`) and quotes are skipped the way the
/// game skips them.
pub fn script_problems(path: &str, text: &str) -> Vec<FileProblem> {
    let mut out = Vec::new();
    let mut open: Vec<u32> = Vec::new();
    let mut line: u32 = 1;
    let mut chars = text.chars().peekable();
    let mut in_block_comment = false;
    let mut in_line_comment = false;
    while let Some(c) = chars.next() {
        if c == '\n' {
            line += 1;
            in_line_comment = false;
            continue;
        }
        if in_block_comment {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }
        if in_line_comment {
            continue;
        }
        match c {
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                in_block_comment = true;
            }
            '/' if chars.peek() == Some(&'/') => {
                chars.next();
                in_line_comment = true;
            }
            '{' => open.push(line),
            '}' => {
                if open.pop().is_none() {
                    out.push(FileProblem { path: path.to_string(), line: Some(line), col: None, message: "a `}` with no block open; the game's script reader stops here".into(), kind: "script".into() });
                }
            }
            _ => {}
        }
    }
    for opened in open {
        out.push(FileProblem { path: path.to_string(), line: Some(opened), col: None, message: "a `{` never closed; the rest of the file is lost to the game".into(), kind: "script".into() });
    }
    out
}

fn relative(root: &Path, file: &Path) -> String {
    file.strip_prefix(root).unwrap_or(file).to_string_lossy().replace('\\', "/")
}

/// Every Lua and script file of the mod, checked.
pub fn validate_mod(root: &Path) -> Result<ModValidation, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder.", root.display()));
    }
    let mut v = ModValidation { root: root.to_string_lossy().to_string(), ..Default::default() };
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let rel = relative(root, path);
        let lower = rel.to_lowercase();
        if lower.ends_with(".lua") {
            v.lua_files += 1;
            let Ok(text) = std::fs::read_to_string(path) else {
                v.problems.push(FileProblem { path: rel, line: None, col: None, message: "not UTF-8 text; the game reads it, this check cannot".into(), kind: "lua".into() });
                continue;
            };
            let result = crate::diff_engine::lua::validate_lua_syntax(&text);
            if let Some(msg) = result.error_message {
                v.problems.extend(lua_problems(&rel, &msg));
            }
        } else if lower.ends_with(".txt") && (lower.contains("/media/scripts/") || lower.starts_with("media/scripts/")) {
            v.script_files += 1;
            let Ok(text) = std::fs::read_to_string(path) else { continue };
            v.problems.extend(script_problems(&rel, &text));
        }
    }
    v.problems.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    Ok(v)
}

/// Opens a file at a line in VS Code when it is on the PATH (`code --goto file:line:col`), else
/// in whatever Windows opens the file with.
pub fn open_in_editor(file: &Path, line: Option<u32>, col: Option<u32>) -> Result<String, String> {
    if !file.is_file() {
        return Err(format!("{} is not there.", file.display()));
    }
    let target = match (line, col) {
        (Some(l), Some(c)) => format!("{}:{}:{}", file.display(), l, c),
        (Some(l), None) => format!("{}:{}", file.display(), l),
        _ => file.display().to_string(),
    };
    let code = if cfg!(windows) {
        std::process::Command::new("cmd").args(["/C", "code", "--goto", &target]).spawn()
    } else {
        std::process::Command::new("code").args(["--goto", &target]).spawn()
    };
    if code.is_ok() {
        return Ok("VS Code".to_string());
    }
    open::that(file).map_err(|e| format!("Windows could not open that file: {}", e))?;
    Ok("the file's own program".to_string())
}

/// A folder is a mod's when it holds a mod.info, at its root or in a build folder.
pub fn looks_like_a_mod(root: &Path) -> bool {
    root.join("mod.info").is_file()
        || std::fs::read_dir(root).ok().into_iter().flatten().flatten().any(|e| e.path().join("mod.info").is_file())
}

pub fn mod_root(p: &str) -> PathBuf {
    PathBuf::from(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_parser_message_becomes_one_problem_per_error_with_its_place() {
        let msg = "Lua AST Syntax Error: error occurred while creating ast: unexpected token `return`. (starting from line 3, character 3 and ending on line 3, character 9)\nadditional information: expected a parameter name or `)`; error occurred while creating ast: unexpected token `end`. (starting from line 4, character 1 and ending on line 4, character 4)\nadditional information: unexpected token, this needs to be a statement";
        let p = lua_problems("media/lua/client/x.lua", msg);
        assert_eq!(p.len(), 2, "{:#?}", p);
        assert_eq!((p[0].line, p[0].col), (Some(3), Some(3)));
        assert_eq!(p[0].message, "unexpected token `return` (expected a parameter name or `)`)");
        assert_eq!((p[1].line, p[1].col), (Some(4), Some(1)));
    }

    #[test]
    fn braces_are_checked_outside_comments() {
        let text = "module Base {\n  item Axe { Type = Weapon, } // a } in a comment\n  /* { */\n  recipe X {\n}\n";
        let p = script_problems("media/scripts/x.txt", text);
        assert_eq!(p.len(), 1, "{:#?}", p);
        assert_eq!(p[0].line, Some(1), "the module block is the one left open");
        let extra = script_problems("x.txt", "a { } }");
        assert_eq!(extra[0].line, Some(1));
        assert!(script_problems("x.txt", "module Base { item A { } }").is_empty());
    }

    #[test]
    fn a_mod_folder_is_walked_and_its_problems_named_by_relative_path() {
        let dir = std::env::temp_dir().join(format!("pzms-devtools-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("42/media/lua/client")).unwrap();
        std::fs::create_dir_all(dir.join("42/media/scripts")).unwrap();
        std::fs::write(dir.join("42/mod.info"), "id=X\n").unwrap();
        std::fs::write(dir.join("42/media/lua/client/ok.lua"), "local a = 1\n").unwrap();
        std::fs::write(dir.join("42/media/lua/client/bad.lua"), "function f(\n").unwrap();
        std::fs::write(dir.join("42/media/scripts/items.txt"), "module Base {\n").unwrap();
        let v = validate_mod(&dir).unwrap();
        assert!(looks_like_a_mod(&dir));
        assert_eq!((v.lua_files, v.script_files), (2, 1));
        let paths: Vec<&str> = v.problems.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, vec!["42/media/lua/client/bad.lua", "42/media/scripts/items.txt"], "{:#?}", v.problems);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ------------------------------------------------------------------------------------------
// Reload a changed Lua file in the running game, through the bridge.
//
// The game's own debug windows call `reloadLuaFile(path)`; the bridge runs any Lua the Studio
// hands it (`eval_lua`). So: find the files of the mod that changed since the last look, hand the
// game a few lines that reload each one in a pcall, and have them write what happened to a file
// of their own (`Zomboid/Lua/pz_dev_reload.json`), since the bridge overwrites its response file
// with its own status after every command.
// ------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChangedFile {
    /// From the mod's root, with forward slashes.
    pub path: String,
    /// On disk, with forward slashes: what `reloadLuaFile` is given.
    pub absolute: String,
    pub modified_ms: u64,
}

fn modified_ms(path: &Path) -> Option<u64> {
    path.metadata().ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

/// The mod's `.lua` files changed after `since_ms` (unix milliseconds); all of them for 0.
pub fn changed_lua_files(root: &Path, since_ms: u64) -> Vec<ChangedFile> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || !path.extension().map(|e| e.eq_ignore_ascii_case("lua")).unwrap_or(false) {
            continue;
        }
        let Some(modified) = modified_ms(path) else { continue };
        if modified > since_ms {
            out.push(ChangedFile {
                path: relative(root, path),
                absolute: path.to_string_lossy().replace('\\', "/"),
                modified_ms: modified,
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

const RELOAD_RESULT_FILE: &str = "pz_dev_reload.json";

/// A Lua string literal: backslashes and quotes escaped.
fn lua_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The Lua the game runs: one `reloadLuaFile` per file, each in a pcall, the outcome printed to
/// the console (where the Monitor sees it) and written to the result file with the request id.
/// The JSON is built by hand because the game's Lua has no JSON library.
pub fn reload_request_code(id: &str, files: &[String]) -> String {
    let list: Vec<String> = files.iter().map(|f| lua_string(f)).collect();
    let mut code = String::new();
    code.push_str(&format!("local files = {{ {} }}\n", list.join(", ")));
    code.push_str("local results = {}\n");
    code.push_str("for _, f in ipairs(files) do\n");
    code.push_str("  local ok, err = pcall(reloadLuaFile, f)\n");
    code.push_str("  local line = (ok and 'ok ' or 'failed ') .. f .. (ok and '' or (': ' .. tostring(err)))\n");
    code.push_str("  table.insert(results, line)\n");
    code.push_str("  print('[PZModStudio] reload ' .. line)\n");
    code.push_str("end\n");
    code.push_str(&format!("local w = getFileWriter({}, true, false)\n", lua_string(RELOAD_RESULT_FILE)));
    code.push_str("if w then\n");
    // JSON-escape each result: a backslash becomes two, a quote gets one in front.
    code.push_str("  local parts = {}\n");
    code.push_str("  for _, r in ipairs(results) do\n");
    code.push_str("    local s = string.gsub(tostring(r), '\\\\', '\\\\\\\\')\n");
    code.push_str("    s = string.gsub(s, '\"', '\\\\\"')\n");
    code.push_str("    table.insert(parts, '\"' .. s .. '\"')\n");
    code.push_str("  end\n");
    code.push_str(&format!("  w:write('{{\"id\":\"{}\",\"results\":[' .. table.concat(parts, ',') .. ']}}')\n", id));
    code.push_str("  w:close()\n");
    code.push_str("end\n");
    code
}

/// Asks the running game to reload these files; returns the request id to wait for.
pub fn reload_lua_in_game(user_zomboid_dir: &str, files: &[String]) -> Result<String, String> {
    if files.is_empty() {
        return Err("Nothing to reload.".to_string());
    }
    let id = format!("reload_{}", chrono::Utc::now().timestamp_millis());
    // The result file from the last time would answer for this one.
    for dir in [Path::new(user_zomboid_dir).join("Lua"), PathBuf::from(user_zomboid_dir)] {
        let _ = std::fs::remove_file(dir.join(RELOAD_RESULT_FILE));
    }
    let command = serde_json::json!({ "id": id, "action": "eval_lua", "code": reload_request_code(&id, files) });
    crate::sandbox::write_game_ipc_command(user_zomboid_dir, command)?;
    Ok(id)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReloadResult {
    pub id: String,
    /// "ok <file>" or "failed <file>: <error>", one per file.
    pub results: Vec<String>,
}

/// What the game wrote back, when it has.
pub fn read_reload_result(user_zomboid_dir: &str) -> Option<ReloadResult> {
    for dir in [Path::new(user_zomboid_dir).join("Lua"), PathBuf::from(user_zomboid_dir)] {
        if let Ok(text) = std::fs::read_to_string(dir.join(RELOAD_RESULT_FILE)) {
            if let Ok(r) = serde_json::from_str::<ReloadResult>(&text) {
                return Some(r);
            }
        }
    }
    None
}

#[cfg(test)]
mod reload_tests {
    use super::*;

    #[test]
    fn the_request_names_each_file_and_the_result_file_and_carries_its_id() {
        let code = reload_request_code("reload_1", &["C:/Users/x/Zomboid/mods/My/42/media/lua/client/a.lua".into(), "D:/q\"uote.lua".into()]);
        assert!(code.contains("\"C:/Users/x/Zomboid/mods/My/42/media/lua/client/a.lua\""));
        assert!(code.contains("\"D:/q\\\"uote.lua\""), "{}", code);
        assert!(code.contains("pcall(reloadLuaFile, f)"));
        assert!(code.contains("getFileWriter(\"pz_dev_reload.json\""));
        assert!(code.contains("\"id\":\"reload_1\""), "{}", code);
        // The Lua escapes a backslash in a result as two, and a quote with one in front.
        assert!(code.contains("string.gsub(tostring(r), '\\\\', '\\\\\\\\')"), "{}", code);
        let r: ReloadResult = serde_json::from_str(r#"{"id":"reload_1","results":["ok a.lua","failed b.lua: nope"]}"#).unwrap();
        assert_eq!(r.results.len(), 2);
    }

    #[test]
    fn changed_files_are_those_touched_after_the_mark() {
        let dir = std::env::temp_dir().join(format!("pzms-reload-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("media/lua/client")).unwrap();
        std::fs::write(dir.join("media/lua/client/a.lua"), "x=1").unwrap();
        let all = changed_lua_files(&dir, 0);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].path, "media/lua/client/a.lua");
        assert!(changed_lua_files(&dir, all[0].modified_ms + 1).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// ------------------------------------------------------------------------------------------
// A new mod, laid out the way Build 42 reads it.
//
// `Zomboid/mods/<folder>/42/mod.info` is what the installed game reads; `common/` holds what
// every build shares; a root `mod.info` is only there when Build 41 is wanted too. The poster
// is a plain PNG to replace. One Lua file prints the mod's name when the game loads it, so the
// Monitor shows it is alive on the first launch.
// ------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewMod {
    /// The `id=` line: letters, digits, `_` and `-` only, since the game writes it into paths and the list.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// "42" always; "41" too when the root mod.info is wanted.
    #[serde(default)]
    pub builds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedMod {
    pub folder: String,
    pub files: Vec<String>,
}

/// The mod.info lines the game reads, in the order modders write them.
pub fn mod_info_text(m: &NewMod, build: &str) -> String {
    let mut lines = vec![format!("name={}", m.name.trim()), format!("id={}", m.id.trim())];
    for d in m.description.lines().map(str::trim).filter(|l| !l.is_empty()) {
        lines.push(format!("description={}", d));
    }
    lines.push("modversion=0.1".to_string());
    if !m.author.trim().is_empty() {
        lines.push(format!("authors={}", m.author.trim()));
    }
    lines.push("poster=poster.png".to_string());
    if build == "42" {
        lines.push("versionMin=42.0.0".to_string());
    }
    lines.join("\r\n") + "\r\n"
}

/// A plain dark PNG, `w` by `h`, for the poster until the modder has one.
fn plain_png(path: &Path, w: u32, h: u32) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    let mut data = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h {
        for x in 0..w {
            // A frame of green around slate, so it reads as "a poster goes here" in the list.
            let edge = x < 8 || y < 8 || x + 8 >= w || y + 8 >= h;
            data.extend_from_slice(if edge { &[16, 185, 129] } else { &[15, 23, 42] });
        }
    }
    writer.write_image_data(&data).map_err(|e| e.to_string())
}

/// Makes the mod under `Zomboid/mods`, refusing an id that is not a plain name or a folder that exists.
pub fn create_mod(user_zomboid_dir: &str, m: &NewMod) -> Result<CreatedMod, String> {
    let id = m.id.trim();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("The id is the folder and the list entry: letters, digits, _ and - only.".to_string());
    }
    if m.name.trim().is_empty() {
        return Err("The mod needs a name.".to_string());
    }
    let mods_dir = crate::load_order::mod_info::get_existing_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .next()
        .map(|d| d.join("mods"))
        .ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    let root = mods_dir.join(id);
    if root.exists() {
        return Err(format!("There is already a folder {} in Zomboid/mods.", id));
    }
    let want_41 = m.builds.iter().any(|b| b == "41");
    let mut files = Vec::new();
    let mut put = |rel: &str, text: &str| -> Result<(), String> {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, text).map_err(|e| format!("{}: {}", path.display(), e))?;
        files.push(rel.replace('\\', "/"));
        Ok(())
    };
    put("42/mod.info", &mod_info_text(m, "42"))?;
    let hello = format!(
        "-- {name}: loaded on every client (and in single player). Shared code goes in\r\n\
         -- common/media/lua/shared, server-side code in 42/media/lua/server.\r\n\
         print(\"[{id}] {name} loaded\")\r\n",
        name = m.name.trim(),
        id = id
    );
    put(&format!("42/media/lua/client/{}_Client.lua", id), &hello)?;
    put("42/media/scripts/README.txt", "Item, recipe and vehicle scripts go here, as <name>.txt files in `module Base { ... }` blocks.\r\n")?;
    put("common/media/lua/shared/README.txt", "What every build shares: Lua loaded before client and server code, translations under translate/.\r\n")?;
    if want_41 {
        put("mod.info", &mod_info_text(m, "41"))?;
        put(&format!("media/lua/client/{}_Client.lua", id), &hello)?;
    }
    for dir in ["42/media/lua/shared", "42/media/lua/server", "common/media/lua/client", "common/media/lua/server"] {
        std::fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?;
    }
    for rel in ["42/poster.png", "poster.png"] {
        plain_png(&root.join(rel), 256, 256)?;
        files.push(rel.to_string());
    }
    Ok(CreatedMod { folder: root.to_string_lossy().to_string(), files })
}

#[cfg(test)]
mod template_tests {
    use super::*;

    #[test]
    fn a_new_mod_has_the_build_42_layout_and_a_root_mod_info_only_with_41() {
        let dir = std::env::temp_dir().join(format!("pzms-template-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        let z = dir.to_string_lossy().to_string();
        let m = NewMod { id: "MyMod".into(), name: "My Mod".into(), author: "Me".into(), description: "Line one\n\nLine two".into(), builds: vec!["42".into()] };
        let made = create_mod(&z, &m).unwrap();
        let root = dir.join("mods/MyMod");
        let info = std::fs::read_to_string(root.join("42/mod.info")).unwrap();
        assert!(info.starts_with("name=My Mod\r\nid=MyMod\r\ndescription=Line one\r\ndescription=Line two\r\n"), "{}", info);
        assert!(info.contains("authors=Me\r\n") && info.contains("versionMin=42.0.0\r\n"));
        assert!(!root.join("mod.info").exists(), "no root mod.info for a 42-only mod");
        assert!(root.join("42/media/lua/client/MyMod_Client.lua").is_file());
        assert!(root.join("common/media/lua/shared").is_dir());
        assert!(root.join("42/poster.png").metadata().unwrap().len() > 100);
        assert!(made.files.contains(&"42/mod.info".to_string()));
        assert!(looks_like_a_mod(&root));
        assert!(create_mod(&z, &m).is_err(), "the same folder twice is refused");
        assert!(create_mod(&z, &NewMod { id: "bad id".into(), ..m.clone() }).is_err());
        let both = NewMod { id: "Both".into(), builds: vec!["41".into(), "42".into()], ..m.clone() };
        create_mod(&z, &both).unwrap();
        let root41 = std::fs::read_to_string(dir.join("mods/Both/mod.info")).unwrap();
        assert!(!root41.contains("versionMin"), "the Build 41 mod.info carries no versionMin");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
