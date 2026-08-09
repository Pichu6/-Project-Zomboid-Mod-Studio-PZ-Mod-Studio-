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

/// Reads active mods from Zomboid/mods/default.txt (Project Zomboid's primary active mods file)
/// supporting all syntax variants (`mod = FH,`, `mod "FH",`, `mod = "FH",`, `mod 'FH',`).
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let default_txt = resolve_default_txt_path(ini_path);
    let mut active_mods = Vec::new();

    // 0. Check Zomboid/mods.txt first (Project Zomboid Build 42 primary active mods list)
    if let Some(mods_dir) = default_txt.parent() {
        if let Some(z_dir) = mods_dir.parent() {
            let mods_txt_path = z_dir.join("mods.txt");
            if mods_txt_path.exists() {
                if let Ok(content) = fs::read_to_string(&mods_txt_path) {
                    for line in content.lines() {
                        let clean = sanitize_mod_id(line);
                        if !clean.is_empty() {
                            active_mods.push(clean);
                        }
                    }
                }
            }
        }
    }

    // 1. Check Zomboid/mods/default.txt second if mods.txt yielded 0 active mods
    if active_mods.is_empty() && default_txt.exists() {
        if let Ok(content) = fs::read_to_string(&default_txt) {
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
                        active_mods.push(clean_id);
                    }
                }
            }
        }
    }

    // 2. Fallback to ModListData.ini if default.txt yielded 0 active mods and ini_path exists
    let ini_p = Path::new(ini_path);
    if active_mods.is_empty() && !ini_path.is_empty() && ini_p.exists() {
        if let Ok(content) = fs::read_to_string(ini_p) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("activeMods=") || trimmed.starts_with("Mods=") {
                    let parts: Vec<&str> = trimmed.split('=').collect();
                    if parts.len() == 2 {
                        active_mods = parts[1]
                            .split(';')
                            .map(|s| sanitize_mod_id(s.trim()))
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
            }
        }
    }

    Ok(ModListData {
        active_mods,
        raw_ini_content: String::new(),
    })
}

/// Writes active mod load order list back to Zomboid/mods/default.txt (Project Zomboid's actual primary active mods file)
/// in exact Project Zomboid Lua table format (`mod = ModID,` sanitized without quotes), as well as ModListData.ini, loadorder.ini, and modgroups.ini.
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let default_txt_path = resolve_default_txt_path(ini_path);

    if let Some(mods_dir) = default_txt_path.parent() {
        let _ = fs::create_dir_all(mods_dir);
        // Ensure Build 42 migration lock file reset-mods-42_00.txt exists so game never wipes default.txt!
        let lock_file = mods_dir.join("reset-mods-42_00.txt");
        if !lock_file.exists() {
            let _ = fs::write(&lock_file, "If this file does not exist, default.txt will be reset to empty (no mods active).");
        }
    }

    // 1. Primary write to Zomboid/mods/default.txt in exact native Project Zomboid Lua format (NO QUOTES)
    let mut default_txt_content = String::from("VERSION = 1,\n\nmods\n{\n");
    for mod_id in active_mods {
        let clean_id = sanitize_mod_id(mod_id);
        if !clean_id.is_empty() {
            default_txt_content.push_str(&format!("    mod = {},\n", clean_id));
        }
    }
    default_txt_content.push_str("}\n\nmaps\n{\n}\n");

    fs::write(&default_txt_path, &default_txt_content).map_err(|e| e.to_string())?;

    // Synchronize to secondary default.txt locations & write Zomboid/mods.txt
    if let Some(mods_dir) = default_txt_path.parent() {
        if let Some(zomboid_dir) = mods_dir.parent() {
            let clean_mods: Vec<String> = active_mods.iter().map(|id| sanitize_mod_id(id)).filter(|s| !s.is_empty()).collect();
            let active_lines = clean_mods.join("\n");

            // Write Zomboid/mods.txt directly (Native Project Zomboid engine active mods list)
            let _ = fs::write(zomboid_dir.join("mods.txt"), &active_lines);

            let lua_mods_dir = zomboid_dir.join("Lua").join("mods");
            let _ = fs::create_dir_all(&lua_mods_dir);
            let _ = fs::write(lua_mods_dir.join("default.txt"), &default_txt_content);

            let saved_modlists_dir = zomboid_dir.join("saved_modlists");
            let _ = fs::create_dir_all(&saved_modlists_dir);
            let _ = fs::write(saved_modlists_dir.join("default.txt"), &default_txt_content);

            let lua_saved_dir = zomboid_dir.join("Lua").join("saved_modlists");
            let _ = fs::create_dir_all(&lua_saved_dir);
            let _ = fs::write(lua_saved_dir.join("default.txt"), &default_txt_content);

            let mods_joined = clean_mods.join(";");
            let lua_dir = zomboid_dir.join("Lua");
            let _ = fs::create_dir_all(&lua_dir);

            let ini_content = format!("[ModList]\nactiveMods={}\n", mods_joined);
            let _ = fs::write(lua_dir.join("ModListData.ini"), &ini_content);

            let loadorder_content = format!("[LoadOrder]\nmods={}\n", mods_joined);
            let _ = fs::write(lua_dir.join("loadorder.ini"), loadorder_content);

            let modgroups_content = format!("[ModGroups]\nactive={}\n", mods_joined);
            let _ = fs::write(lua_dir.join("modgroups.ini"), modgroups_content);

            let _ = fs::write(lua_dir.join("ModLoadOrderSorter.txt"), &active_lines);
            let _ = fs::write(lua_dir.join("mod_order.txt"), &active_lines);
            let _ = fs::write(lua_dir.join("mod_load_order.txt"), &active_lines);
            let _ = fs::write(lua_dir.join("ModLoadOrderExporter.txt"), &active_lines);
            let _ = fs::write(saved_modlists_dir.join("PZModStudio.txt"), &active_lines);

            // Also sync active mods to all existing save game folders (Zomboid/Saves/*/*/mods.txt and default.txt)
            let saves_dir = zomboid_dir.join("Saves");
            if saves_dir.exists() {
                for entry in walkdir::WalkDir::new(&saves_dir).max_depth(4).into_iter().filter_map(|e| e.ok()) {
                    if entry.file_name() == "mods.txt" {
                        let _ = fs::write(entry.path(), &default_txt_content);
                    }
                }
            }
        }
    }

    Ok(())
}
