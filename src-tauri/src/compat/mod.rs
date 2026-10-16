//! "Make a compatible copy": adapts a mod that the installed build will not load (B41-only, a
//! too-low versionMax, only folders for newer builds) by copying it to `Zomboid/mods` and fixing
//! what can be fixed safely. The original (usually a Workshop item) is never modified.
//!
//! The copy keeps the original mod id, so mods that require it keep working. Because the game
//! normally prefers Workshop copies over `Zomboid/mods` (first copy of an id wins, search order
//! "workshop,steam,mods"), the Studio starts the game with `-modfolders mods,workshop,steam`
//! while compatible copies exist, and the catalog follows the same order.

use crate::catalog::modinfo::{format_game_version, parse_game_mod_info};
use crate::load_order::mod_info::{get_existing_user_zomboid_dirs, select_mod_info_for_build, version_dir_int};
use crate::origins::{self, ModOrigin};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Launch argument that makes the game read Zomboid/mods before Workshop folders.
pub const LOCAL_FIRST_ARG: [&str; 2] = ["-modfolders", "mods,workshop,steam"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatResult {
    pub mod_id: String,
    pub folder: String,
    pub destination: String,
    /// What was changed to make it load.
    pub changes: Vec<String>,
    /// What could not be fixed automatically and may still break in game.
    pub warnings: Vec<String>,
}

/// True when compatible copies exist in this Zomboid folder, so the game must read
/// Zomboid/mods first (see `LOCAL_FIRST_ARG`).
pub fn local_first(zomboid_dir: &Path) -> bool {
    origins::load(zomboid_dir)
        .iter()
        .any(|(folder, r)| matches!(r.origin, ModOrigin::Compat { .. }) && zomboid_dir.join("mods").join(folder).is_dir())
}

/// Launch arguments to add for this Zomboid folder.
pub fn launch_args(user_zomboid_dir: &str) -> Vec<String> {
    match get_existing_user_zomboid_dirs(user_zomboid_dir).first() {
        Some(dir) if local_first(dir) => LOCAL_FIRST_ARG.iter().map(|s| s.to_string()).collect(),
        _ => Vec::new(),
    }
}

/// Rewrites (or adds) `key=value` in a mod.info, keeping every other line as it is.
fn set_mod_info_value(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let prefix = format!("{}=", key);
    let mut found = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                found = true;
                format!("{}{}", prefix, value)
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(format!("{}{}", prefix, value));
    }
    fs::write(path, lines.join(eol) + eol).map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}

fn files_under(dir: &Path, ext: &str) -> Vec<PathBuf> {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case(ext)))
        .map(|e| e.into_path())
        .collect()
}

/// Things in the folders the game will read that typically break when a B41 mod runs on B42.
fn scan_for_problems(roots: &[PathBuf], target_is_b42: bool) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut old_recipes = 0usize;
    let mut old_item_fields = 0usize;
    let mut txt_translations = 0usize;
    let mut lua_errors: Vec<String> = Vec::new();
    for root in roots {
        let media = root.join("media");
        for script in files_under(&media.join("scripts"), "txt") {
            let text = String::from_utf8_lossy(&fs::read(&script).unwrap_or_default()).to_string();
            for line in text.lines() {
                let t = line.trim_start();
                if t.starts_with("recipe ") || t.starts_with("recipe\t") {
                    old_recipes += 1;
                }
                if t.starts_with("Type") && t[4..].trim_start().starts_with('=') {
                    old_item_fields += 1;
                }
            }
        }
        let translate = media.join("lua").join("shared").join("Translate");
        txt_translations += files_under(&translate, "txt").len();
        for lua in files_under(&media.join("lua"), "lua") {
            let text = String::from_utf8_lossy(&fs::read(&lua).unwrap_or_default()).to_string();
            if !crate::diff_engine::lua::validate_lua_syntax(&text).is_valid {
                lua_errors.push(lua.file_name().unwrap_or_default().to_string_lossy().to_string());
            }
        }
    }
    if target_is_b42 {
        if old_recipes > 0 {
            warnings.push(format!(
                "{} old-style recipe(s): Build 42 replaced crafting (craftRecipe), so these will not work until ported by hand.",
                old_recipes
            ));
        }
        if old_item_fields > 0 {
            warnings.push(format!(
                "{} item(s) use the Build 41 \"Type =\" field; Build 42 uses \"ItemType =\". Those items may not appear or may error.",
                old_item_fields
            ));
        }
        if txt_translations > 0 {
            warnings.push(format!(
                "{} translation file(s) are .txt; Build 42.15+ reads JSON translations, so texts may show as raw keys.",
                txt_translations
            ));
        }
    }
    if !lua_errors.is_empty() {
        warnings.push(format!("Lua syntax errors in: {}.", lua_errors.join(", ")));
    }
    warnings
}

/// Creates (or, with `replace_existing`, recreates) a compatible copy of the mod folder
/// `source_root` in `<Zomboid>/mods`, adapted to `game_version` (major*1000+minor).
pub fn make_compatible_copy(
    source_root: &Path,
    user_zomboid_dir: &str,
    game_version: u32,
    workshop_id: Option<String>,
    replace_existing: bool,
) -> Result<CompatResult, String> {
    let zomboid = get_existing_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .next()
        .ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    let folder = source_root.file_name().ok_or("Invalid mod folder")?.to_string_lossy().to_string();
    let dest = zomboid.join("mods").join(&folder);
    if source_root.starts_with(zomboid.join("mods")) {
        return Err("This mod is already in Zomboid/mods; edit it there instead of copying it.".to_string());
    }

    if dest.exists() {
        let is_compat = matches!(origins::load(&zomboid).get(&folder).map(|r| &r.origin), Some(ModOrigin::Compat { .. }));
        if !is_compat || !replace_existing {
            return Err(format!(
                "Zomboid/mods/{} already exists{}.",
                folder,
                if is_compat { " (an earlier compatible copy): replace it to make a fresh one" } else { " and is not a compatible copy made by the Studio" }
            ));
        }
        let backup = zomboid.join("PZModStudio_Backups").join("mods").join(format!("{}-{}", folder, chrono::Local::now().format("%Y%m%d-%H%M%S")));
        fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::rename(&dest, &backup).map_err(|e| format!("Cannot move the old copy aside: {}", e))?;
    }

    crate::mod_install::copy_tree(source_root, &dest).map_err(|e| {
        let _ = fs::remove_dir_all(&dest);
        format!("Copying the mod failed: {}", e)
    })?;

    let result = adapt(&dest, game_version);
    let (changes, warnings, mod_id) = match result {
        Ok(v) => v,
        Err(e) => {
            let _ = fs::remove_dir_all(&dest);
            return Err(e);
        }
    };

    origins::record(
        &zomboid,
        std::slice::from_ref(&folder),
        &ModOrigin::Compat { workshop_id, source_dir: source_root.to_string_lossy().to_string(), changes: changes.clone() },
    )?;

    Ok(CompatResult { mod_id, folder, destination: dest.to_string_lossy().to_string(), changes, warnings })
}

/// Adapts the copied folder in place. Returns (changes, warnings, mod id).
fn adapt(dest: &Path, game_version: u32) -> Result<(Vec<String>, Vec<String>, String), String> {
    let mut changes = Vec::new();
    let target = format_game_version(game_version);
    let is_b42 = game_version >= 42_000;

    // 1. Make sure the build has a folder (and mod.info) it reads.
    if select_mod_info_for_build(dest, Some(game_version)).is_none() {
        let root_info = dest.join("mod.info");
        if is_b42 && root_info.is_file() {
            // Build 41 layout: B42 needs common/ + a version folder.
            let v42 = dest.join("42");
            fs::create_dir_all(&v42).map_err(|e| e.to_string())?;
            fs::copy(&root_info, v42.join("mod.info")).map_err(|e| e.to_string())?;
            if dest.join("media").is_dir() {
                crate::mod_install::copy_tree(&dest.join("media"), &v42.join("media")).map_err(|e| e.to_string())?;
            }
            for extra in ["poster.png", "icon.png", "preview.png"] {
                if dest.join(extra).is_file() {
                    let _ = fs::copy(dest.join(extra), v42.join(extra));
                }
            }
            fs::create_dir_all(dest.join("common")).map_err(|e| e.to_string())?;
            changes.push("Created the Build 42 layout (42/ and common/) from the Build 41 files.".to_string());
        } else {
            // Only folders for newer builds: offer the oldest of them to this build.
            let oldest = fs::read_dir(dest)
                .map_err(|e| e.to_string())?
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let v = version_dir_int(&name)?;
                    (v > game_version && e.path().join("mod.info").is_file()).then_some((v, name))
                })
                .min();
            let Some((_, name)) = oldest else {
                return Err("No mod.info found that could be adapted.".to_string());
            };
            let new_dir = dest.join(&target);
            crate::mod_install::copy_tree(&dest.join(&name), &new_dir).map_err(|e| e.to_string())?;
            changes.push(format!("This mod only had files for build {}: made them available as {}/ for your build.", name, target));
        }
    }

    let info_path = select_mod_info_for_build(dest, Some(game_version)).ok_or("The adapted copy still has no usable mod.info.")?;
    let info = parse_game_mod_info(&String::from_utf8_lossy(&fs::read(&info_path).map_err(|e| e.to_string())?));
    let mod_id = info.id.clone().ok_or("The mod.info has no id= line, so the game cannot use this mod.")?;

    // 2. Version range the game checks (major.minor only).
    let text = String::from_utf8_lossy(&fs::read(&info_path).unwrap_or_default()).to_string();
    for (key, current) in [("versionMax", info.version_max), ("versionMin", info.version_min)] {
        let raw = text.lines().find_map(|l| l.strip_prefix(&format!("{}=", key))).map(|v| v.trim().to_string());
        let Some(raw) = raw.filter(|r| !r.is_empty()) else { continue };
        let needs_fix = match (key, current) {
            (_, None) => true, // invalid string like "42": the game rejects the whole mod.info
            ("versionMax", Some(v)) => v < game_version,
            (_, Some(v)) => v > game_version,
        };
        if needs_fix {
            set_mod_info_value(&info_path, key, &target)?;
            changes.push(format!(
                "{}={} -> {} (the game only compares major.minor, so {} blocked build {}).",
                key, raw, target, raw, target
            ));
        }
    }
    if info.invalid_reason.is_some() && changes.iter().all(|c| !c.starts_with("version")) {
        changes.push("Fixed an invalid version value in mod.info.".to_string());
    }
    if changes.is_empty() {
        changes.push("Nothing needed changing: the copy is identical to the original.".to_string());
    }

    // 3. What may still break.
    let mut roots = vec![info_path.parent().unwrap().to_path_buf()];
    if dest.join("common").is_dir() {
        roots.push(dest.join("common"));
    }
    let warnings = scan_for_problems(&roots, is_b42);
    Ok((changes, warnings, mod_id))
}

/// Removes a compatible copy (moved to Zomboid/PZModStudio_Backups/mods, not deleted).
pub fn remove_compatible_copy(user_zomboid_dir: &str, folder: &str) -> Result<(), String> {
    let zomboid = get_existing_user_zomboid_dirs(user_zomboid_dir).into_iter().next().ok_or("Zomboid folder not found")?;
    if !matches!(origins::load(&zomboid).get(folder).map(|r| &r.origin), Some(ModOrigin::Compat { .. })) {
        return Err(format!("{} is not a compatible copy made by the Studio.", folder));
    }
    let dir = zomboid.join("mods").join(folder);
    if dir.is_dir() {
        let backup = zomboid.join("PZModStudio_Backups").join("mods").join(format!("{}-removed-{}", folder, chrono::Local::now().format("%Y%m%d-%H%M%S")));
        fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::rename(&dir, &backup).map_err(|e| format!("Cannot move the copy away: {}", e))?;
    }
    origins::forget(&zomboid, folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn setup(tag: &str) -> (Tmp, PathBuf, String) {
        let t = Tmp(std::env::temp_dir().join(format!("pzms-compat-{}-{}", tag, std::process::id())));
        let _ = fs::remove_dir_all(&t.0);
        let ws = t.0.join("workshop/108600/123/mods");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(t.0.join("Zomboid/mods")).unwrap();
        let z = t.0.join("Zomboid").to_string_lossy().to_string();
        (t, ws, z)
    }

    #[test]
    fn fixes_a_too_low_version_max_like_one_building_one_key() {
        let (_t, ws, z) = setup("range");
        let src = ws.join("OneBuildingOneKey");
        fs::create_dir_all(src.join("42.0/media/lua/client")).unwrap();
        fs::create_dir_all(src.join("common")).unwrap();
        fs::write(src.join("42.0/mod.info"), "name=One Building, One Key\r\nid=OneBuildingOneKey\r\nversionMin=42.20\r\nversionMax=42.20.99\r\n").unwrap();
        fs::write(src.join("42.0/media/lua/client/a.lua"), "local x = 1").unwrap();

        let r = make_compatible_copy(&src, &z, 42_021, Some("123".into()), false).unwrap();
        assert_eq!(r.mod_id, "OneBuildingOneKey");
        let info = fs::read_to_string(Path::new(&r.destination).join("42.0/mod.info")).unwrap();
        assert!(info.contains("versionMax=42.21\r\n"), "{}", info);
        assert!(info.contains("versionMin=42.20\r\n"), "untouched when fine");
        assert!(r.changes.iter().any(|c| c.contains("42.20.99")));
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert_eq!(fs::read_to_string(src.join("42.0/mod.info")).unwrap().contains("42.20.99"), true, "original untouched");

        let zp = Path::new(&z);
        assert!(local_first(zp));
        assert_eq!(launch_args(&z), vec!["-modfolders", "mods,workshop,steam"]);
        // The catalog now prefers the copy, which loads.
        let cat = crate::catalog::build_catalog(&ws.parent().unwrap().parent().unwrap().to_string_lossy(), &z, Some(42_021));
        let used = cat.get("OneBuildingOneKey").unwrap();
        assert_eq!(used.source, crate::catalog::ModSource::Local);
        assert_eq!(used.loadability, crate::catalog::Loadability::Loadable);

        // Again: refused unless replacing; removing moves it to backups.
        assert!(make_compatible_copy(&src, &z, 42_021, None, false).is_err());
        make_compatible_copy(&src, &z, 42_021, None, true).unwrap();
        remove_compatible_copy(&z, "OneBuildingOneKey").unwrap();
        assert!(!zp.join("mods/OneBuildingOneKey").exists());
        assert!(!local_first(zp));
    }

    /// Dry run on a real mod folder into a temporary Zomboid folder (the real one is not touched).
    /// PZMS_COMPAT_SOURCE=<.../mods/SomeMod> PZMS_GAME_VERSION=42.21 cargo test compat_dry_run -- --ignored --nocapture
    #[test]
    #[ignore]
    fn compat_dry_run_on_real_mod() {
        let Ok(src) = std::env::var("PZMS_COMPAT_SOURCE") else { return };
        let game = std::env::var("PZMS_GAME_VERSION").ok().and_then(|v| version_dir_int(&v)).unwrap_or(42_021);
        let (_t, _ws, z) = setup("dryrun");
        let r = make_compatible_copy(Path::new(&src), &z, game, None, false).unwrap();
        println!("id {} -> {}", r.mod_id, r.destination);
        for c in &r.changes { println!("  change: {}", c); }
        for w in &r.warnings { println!("  warning: {}", w); }
    }

    #[test]
    fn builds_the_b42_layout_for_a_b41_mod_and_reports_what_may_break() {
        let (_t, ws, z) = setup("b41");
        let src = ws.join("OldMod");
        fs::create_dir_all(src.join("media/scripts")).unwrap();
        fs::create_dir_all(src.join("media/lua/shared/Translate/EN")).unwrap();
        fs::write(src.join("mod.info"), "name=Old\nid=OldMod\n").unwrap();
        fs::write(src.join("media/scripts/items.txt"), "module Base {\n  item Thing {\n    Type = Normal,\n  }\n  recipe Make Thing {\n  }\n}\n").unwrap();
        fs::write(src.join("media/lua/shared/Translate/EN/IG_UI_EN.txt"), "IGUI_EN = {}").unwrap();
        fs::write(src.join("media/lua/shared/broken.lua"), "local = 1").unwrap();

        let r = make_compatible_copy(&src, &z, 42_021, None, false).unwrap();
        let dest = Path::new(&r.destination);
        assert!(dest.join("42/mod.info").is_file() && dest.join("common").is_dir());
        assert!(dest.join("42/media/scripts/items.txt").is_file());
        assert!(r.changes.iter().any(|c| c.contains("Build 42 layout")));
        let joined = r.warnings.join(" | ");
        assert!(joined.contains("recipe"), "{}", joined);
        assert!(joined.contains("Type ="), "{}", joined);
        assert!(joined.contains("translation"), "{}", joined);
        assert!(joined.contains("broken.lua"), "{}", joined);
    }
}
