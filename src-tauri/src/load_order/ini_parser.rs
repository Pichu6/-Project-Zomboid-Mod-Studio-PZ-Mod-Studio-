use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::load_order::mod_info::sanitize_mod_id;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListData {
    pub active_mods: Vec<String>,
    pub raw_ini_content: String,
}

/// Helper function to reliably resolve Zomboid/mods/default.txt path regardless of ini_path state
fn resolve_default_txt_path(ini_path: &str) -> PathBuf {
    if !ini_path.is_empty() {
        let p = Path::new(ini_path);
        if let Some(parent) = p.parent() {
            if parent.file_name().map_or(false, |n| n == "mods") {
                return parent.join("default.txt");
            } else if parent.file_name().map_or(false, |n| n == "Lua") {
                if let Some(pz_dir) = parent.parent() {
                    return pz_dir.join("mods").join("default.txt");
                }
            }
        }
    }
    // Fallback to standard user home Zomboid/mods/default.txt
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("C:\\"));
    home.join("Zomboid").join("mods").join("default.txt")
}

fn parse_ini_file(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("activeMods=") || trimmed.starts_with("Mods=") || trimmed.starts_with("mods=") {
                let parts: Vec<&str> = trimmed.split('=').collect();
                if parts.len() == 2 {
                    active = parts[1]
                        .split(';')
                        .map(|s| sanitize_mod_id(s.trim()))
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }
    }
    active
}

fn parse_default_txt(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        let mut in_mods_block = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "mods" || trimmed.starts_with("mods") {
                in_mods_block = true;
                continue;
            }
            if in_mods_block && (trimmed == "maps" || trimmed.starts_with("maps")) {
                break;
            }

            if in_mods_block && trimmed.starts_with("mod") {
                let raw_id = trimmed[3..]
                    .trim()
                    .trim_start_matches('=')
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim_end_matches(',')
                    .trim();

                let clean_id = sanitize_mod_id(raw_id);
                if !clean_id.is_empty() && clean_id != "{" && clean_id != "}" {
                    active.push(clean_id);
                }
            }
        }
    }
    active
}

fn parse_plain_list_file(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let clean = sanitize_mod_id(line);
            if !clean.is_empty() {
                active.push(clean);
            }
        }
    }
    active
}

/// Reads active mods from Project Zomboid's most recently modified load order file on disk
/// (checking ModListData.ini, mods/default.txt, mods.txt, and loadorder.ini)
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let default_txt_path = resolve_default_txt_path(ini_path);
    let ini_p = Path::new(ini_path);

    let mut candidate_paths: Vec<(PathBuf, std::time::SystemTime, &str)> = Vec::new();

    // 1. ModListData.ini
    if !ini_path.is_empty() && ini_p.exists() {
        if let Ok(meta) = fs::metadata(ini_p) {
            if let Ok(mtime) = meta.modified() {
                candidate_paths.push((ini_p.to_path_buf(), mtime, "ini"));
            }
        }
    }

    // 2. mods/default.txt
    if default_txt_path.exists() {
        if let Ok(meta) = fs::metadata(&default_txt_path) {
            if let Ok(mtime) = meta.modified() {
                candidate_paths.push((default_txt_path.clone(), mtime, "default_txt"));
            }
        }
    }

    // 3. mods.txt
    if let Some(mods_dir) = default_txt_path.parent() {
        if let Some(z_dir) = mods_dir.parent() {
            let mods_txt_path = z_dir.join("mods.txt");
            if mods_txt_path.exists() {
                if let Ok(meta) = fs::metadata(&mods_txt_path) {
                    if let Ok(mtime) = meta.modified() {
                        candidate_paths.push((mods_txt_path, mtime, "plain"));
                    }
                }
            }

            // 4. loadorder.ini
            let loadorder_ini = z_dir.join("Lua").join("loadorder.ini");
            if loadorder_ini.exists() {
                if let Ok(meta) = fs::metadata(&loadorder_ini) {
                    if let Ok(mtime) = meta.modified() {
                        candidate_paths.push((loadorder_ini, mtime, "ini"));
                    }
                }
            }
        }
    }

    // Sort candidates by modification time DESCENDING (newest file modified on disk wins!)
    candidate_paths.sort_by(|a, b| b.1.cmp(&a.1));

    let mut active_mods = Vec::new();

    for (path, _mtime, file_type) in candidate_paths {
        let parsed = match file_type {
            "ini" => parse_ini_file(&path),
            "default_txt" => parse_default_txt(&path),
            "plain" => parse_plain_list_file(&path),
            _ => Vec::new(),
        };

        if !parsed.is_empty() {
            active_mods = parsed;
            break;
        }
    }

    Ok(ModListData {
        active_mods,
        raw_ini_content: String::new(),
    })
}

/// Writes active mod load order list back to Zomboid/mods/default.txt (Project Zomboid's actual primary active mods file)
/// in exact Project Zomboid Lua table format (safely quoting IDs with spaces or brackets), as well as ModListData.ini, loadorder.ini, ModManager, and modgroups.ini.
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let default_txt_path = resolve_default_txt_path(ini_path);
    let mut target_zomboid_dirs = Vec::new();

    if let Some(mods_dir) = default_txt_path.parent() {
        if let Some(z_dir) = mods_dir.parent() {
            target_zomboid_dirs.push(z_dir.to_path_buf());
        }
    }

    let user_zomboid_str = if !ini_path.is_empty() {
        if let Some(parent) = Path::new(ini_path).parent() {
            if parent.file_name().map_or(false, |n| n == "mods") {
                parent.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
            } else if parent.file_name().map_or(false, |n| n == "Lua") {
                parent.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
            } else {
                parent.to_string_lossy().to_string()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    for u_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(&user_zomboid_str) {
        if !target_zomboid_dirs.contains(&u_dir) {
            target_zomboid_dirs.push(u_dir);
        }
    }

    // 1. Build default.txt content in exact Project Zomboid native format (mod = <id>,)
    let mut default_txt_content = String::from("VERSION = 1,\n\nmods\n{\n");
    for mod_id in active_mods {
        let clean_id = sanitize_mod_id(mod_id);
        if !clean_id.is_empty() {
            default_txt_content.push_str(&format!("    mod = {},\n", clean_id));
        }
    }
    default_txt_content.push_str("}\n\nmaps\n{\n}\n");

    let clean_mods: Vec<String> = active_mods.iter().map(|id| sanitize_mod_id(id)).filter(|s| !s.is_empty()).collect();
    let active_lines = clean_mods.join("\n");
    let mods_joined = clean_mods.join(";");

    let ini_content = format!("[ModList]\nactiveMods={}\n", mods_joined);
    let loadorder_content = format!("[LoadOrder]\nmods={}\n", mods_joined);
    let modgroups_content = format!("[ModGroups]\nactive={}\n", mods_joined);

    for zomboid_dir in target_zomboid_dirs {
        // A. Primary Zomboid/mods/default.txt & lock file
        let mods_dir = zomboid_dir.join("mods");
        let _ = fs::create_dir_all(&mods_dir);
        let _ = fs::write(mods_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(mods_dir.join("reset-mods-42_00.txt"), "If this file does not exist, default.txt will be reset to empty (no mods active).");

        // B. Root Zomboid/mods.txt
        let _ = fs::write(zomboid_dir.join("mods.txt"), &active_lines);

        // C. Zomboid/Lua/mods/default.txt
        let lua_mods_dir = zomboid_dir.join("Lua").join("mods");
        let _ = fs::create_dir_all(&lua_mods_dir);
        let _ = fs::write(lua_mods_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(lua_mods_dir.join("reset-mods-42_00.txt"), "If this file does not exist, default.txt will be reset to empty.");

        // D. Zomboid/saved_modlists/ and Zomboid/Lua/saved_modlists/
        let saved_modlists_dir = zomboid_dir.join("saved_modlists");
        let _ = fs::create_dir_all(&saved_modlists_dir);
        let _ = fs::write(saved_modlists_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(saved_modlists_dir.join("PZModStudio.txt"), &default_txt_content);
        let _ = fs::write(saved_modlists_dir.join("PZ Mod Studio.txt"), &default_txt_content);

        let lua_saved_dir = zomboid_dir.join("Lua").join("saved_modlists");
        let _ = fs::create_dir_all(&lua_saved_dir);
        let _ = fs::write(lua_saved_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(lua_saved_dir.join("PZModStudio.txt"), &default_txt_content);
        let _ = fs::write(lua_saved_dir.join("PZ Mod Studio.txt"), &default_txt_content);

        // E. Zomboid/Lua config files
        let lua_dir = zomboid_dir.join("Lua");
        let _ = fs::create_dir_all(&lua_dir);
        let _ = fs::write(lua_dir.join("ModListData.ini"), &ini_content);
        let _ = fs::write(lua_dir.join("loadorder.ini"), &loadorder_content);
        let _ = fs::write(lua_dir.join("modgroups.ini"), &modgroups_content);
        let _ = fs::write(lua_dir.join("ModLoadOrderSorter.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("mod_order.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("mod_load_order.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("ModLoadOrderExporter.txt"), &active_lines);

        // F. Zomboid/Lua/ModManager/ (In-game Mod Manager mod support)
        let mm_dir = lua_dir.join("ModManager");
        let mm_mods_dir = mm_dir.join("mods");
        let _ = fs::create_dir_all(&mm_mods_dir);
        let _ = fs::write(mm_mods_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(mm_mods_dir.join("reset-mods-42_00.txt"), "If this file does not exist, default.txt will be reset to empty.");

        let mm_saved_dir = mm_dir.join("saved_modlists");
        let _ = fs::create_dir_all(&mm_saved_dir);
        let _ = fs::write(mm_saved_dir.join("default.txt"), &default_txt_content);
        let _ = fs::write(mm_saved_dir.join("PZModStudio.txt"), &default_txt_content);
        let _ = fs::write(mm_saved_dir.join("PZ Mod Studio.txt"), &default_txt_content);

        let _ = fs::write(mm_dir.join("loadorder.ini"), &loadorder_content);
        let _ = fs::write(mm_dir.join("modgroups.ini"), &modgroups_content);
        let _ = fs::write(mm_dir.join("ModLoadOrderSorter.txt"), &active_lines);
        let _ = fs::write(mm_dir.join("mod_order.txt"), &active_lines);
        let _ = fs::write(mm_dir.join("mod_load_order.txt"), &active_lines);
        let _ = fs::write(mm_dir.join("ModLoadOrderExporter.txt"), &active_lines);

        // G. Sync active mods to existing save game folders (Zomboid/Saves/*/*/mods.txt and default.txt)
        let saves_dir = zomboid_dir.join("Saves");
        if saves_dir.exists() {
            for entry in walkdir::WalkDir::new(&saves_dir).max_depth(4).into_iter().filter_map(|e| e.ok()) {
                if entry.file_name() == "mods.txt" {
                    let _ = fs::write(entry.path(), &default_txt_content);
                }
            }
        }
    }

    Ok(())
}
