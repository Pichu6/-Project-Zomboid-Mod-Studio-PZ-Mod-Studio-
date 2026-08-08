use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListData {
    pub active_mods: Vec<String>,
    pub raw_ini_content: String,
}

/// Reads and parses ModListData.ini file.
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let path = Path::new(ini_path);
    if !path.exists() {
        return Ok(ModListData {
            active_mods: Vec::new(),
            raw_ini_content: String::new(),
        });
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut active_mods = Vec::new();

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

    Ok(ModListData {
        active_mods,
        raw_ini_content: content,
    })
}

/// Writes active mod load order list back to ModListData.ini.
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let path = Path::new(ini_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mods_joined = active_mods.join(";");
    let content = format!("[ModList]\nactiveMods={}\n", mods_joined);

    fs::write(path, content).map_err(|e| e.to_string())
}
