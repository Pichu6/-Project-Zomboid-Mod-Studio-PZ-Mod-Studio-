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
