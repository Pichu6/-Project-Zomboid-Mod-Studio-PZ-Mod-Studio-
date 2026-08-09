use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListData {
    pub active_mods: Vec<String>,
    pub raw_ini_content: String,
}

/// Reads active mods from Zomboid/mods/default.txt (Project Zomboid's primary active mods file)
/// with fallback to ModListData.ini.
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let ini_p = Path::new(ini_path);
    let mut active_mods = Vec::new();

    // 1. Check Zomboid/mods/default.txt first
    if let Some(parent) = ini_p.parent() {
        let default_txt = if parent.file_name().map_or(false, |n| n == "mods") {
            parent.join("default.txt")
        } else if parent.file_name().map_or(false, |n| n == "Lua") {
            parent.parent().map(|p| p.join("mods").join("default.txt")).unwrap_or_else(|| PathBuf::from(""))
        } else {
            parent.join("mods").join("default.txt")
        };

        if default_txt.exists() {
            if let Ok(content) = fs::read_to_string(&default_txt) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("mod \"") {
                        if let Some(start_quote) = trimmed.find('"') {
                            if let Some(end_quote) = trimmed[start_quote + 1..].find('"') {
                                let mod_id = &trimmed[start_quote + 1..start_quote + 1 + end_quote];
                                if !mod_id.is_empty() {
                                    active_mods.push(mod_id.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to ModListData.ini if default.txt yielded 0 active mods
    if active_mods.is_empty() && ini_p.exists() {
        if let Ok(content) = fs::read_to_string(ini_p) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("activeMods=") || trimmed.starts_with("Mods=") {
                    let parts: Vec<&str> = trimmed.split('=').collect();
                    if parts.len() == 2 {
                        active_mods = parts[1]
                            .split(';')
                            .map(|s| s.trim().to_string())
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
/// in exact Lua table syntax, as well as ModListData.ini, loadorder.ini, and modgroups.ini.
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let path = Path::new(ini_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;

        // Resolve Zomboid/mods/default.txt
        let default_txt_path = if parent.file_name().map_or(false, |n| n == "mods") {
            parent.join("default.txt")
        } else if parent.file_name().map_or(false, |n| n == "Lua") {
            parent.parent().map(|p| p.join("mods").join("default.txt")).unwrap_or_else(|| parent.join("default.txt"))
        } else {
            parent.join("mods").join("default.txt")
        };

        if let Some(mods_dir) = default_txt_path.parent() {
            let _ = fs::create_dir_all(mods_dir);
        }

        // 1. Primary write to Zomboid/mods/default.txt in exact Project Zomboid Lua table format!
        let mut default_txt_content = String::from("VERSION = 1,\n\nmods\n{\n");
        for mod_id in active_mods {
            default_txt_content.push_str(&format!("\tmod \"{}\",\n", mod_id));
        }
        default_txt_content.push_str("}\n\nmaps\n{\n}\n");

        fs::write(&default_txt_path, &default_txt_content).map_err(|e| e.to_string())?;

        // 2. Write Zomboid/Lua/ModListData.ini for backwards compatibility
        let lua_dir = if parent.file_name().map_or(false, |n| n == "Lua") {
            parent.to_path_buf()
        } else {
            parent.parent().map(|p| p.join("Lua")).unwrap_or_else(|| parent.join("Lua"))
        };
        let _ = fs::create_dir_all(&lua_dir);

        let mods_joined = active_mods.join(";");
        let ini_content = format!("[ModList]\nactiveMods={}\n", mods_joined);
        let _ = fs::write(lua_dir.join("ModListData.ini"), &ini_content);

        // 3. Write loadorder.ini and modgroups.ini in Zomboid/Lua/
        let loadorder_content = format!("[LoadOrder]\nmods={}\n", mods_joined);
        let _ = fs::write(lua_dir.join("loadorder.ini"), loadorder_content);

        let modgroups_content = format!("[ModGroups]\nactive={}\n", mods_joined);
        let _ = fs::write(lua_dir.join("modgroups.ini"), modgroups_content);

        // 4. Synchronize in-game sorters & presets
        let active_lines = active_mods.join("\n");
        let _ = fs::write(lua_dir.join("ModLoadOrderSorter.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("mod_order.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("mod_load_order.txt"), &active_lines);
        let _ = fs::write(lua_dir.join("ModLoadOrderExporter.txt"), &active_lines);

        if let Some(zomboid_dir) = lua_dir.parent() {
            let saved_modlists_dir = zomboid_dir.join("saved_modlists");
            let _ = fs::create_dir_all(&saved_modlists_dir);
            let pz_studio_preset = saved_modlists_dir.join("PZModStudio.txt");
            let _ = fs::write(pz_studio_preset, &active_lines);
        }
    }

    Ok(())
}
