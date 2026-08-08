use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use crate::load_order::ini_parser::read_mod_list_ini;
use crate::vfs::StudioPaths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModManifest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub workshop_id: Option<String>,
    pub require: Vec<String>,
    pub icon_path: Option<String>,
    pub is_library: bool,
    pub is_map_mod: bool,
    pub enabled: bool,
}

/// Parses a mod.info file into a structured ModManifest struct.
pub fn parse_mod_info(path: &Path) -> Option<ModManifest> {
    if !path.exists() {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    let mut id = String::new();
    let mut name = String::new();
    let mut description = None;
    let mut require = Vec::new();
    let mut pack = false;
    let mut tiledef = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("id=") {
            id = trimmed[3..].trim().to_string();
        } else if trimmed.starts_with("name=") {
            name = trimmed[5..].trim().to_string();
        } else if trimmed.starts_with("description=") {
            let desc_val = trimmed[12..].trim().to_string();
            if !desc_val.is_empty() {
                description = Some(desc_val);
            }
        } else if trimmed.starts_with("require=") {
            let req_str = trimmed[8..].trim();
            require = req_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if trimmed.starts_with("pack=") {
            pack = true;
        } else if trimmed.starts_with("tiledef=") {
            tiledef = true;
        }
    }

    if id.is_empty() {
        return None;
    }

    let is_library = require.is_empty() || id.to_lowercase().contains("lib") || id.to_lowercase().contains("manager");
    let is_map_mod = pack || tiledef || id.to_lowercase().contains("map");

    Some(ModManifest {
        id,
        name: if name.is_empty() { "Unnamed Mod".to_string() } else { name },
        description,
        workshop_id: None,
        require,
        icon_path: None,
        is_library,
        is_map_mod,
        enabled: false,
    })
}

/// Scans all subscribed Workshop & local mods, ordering active ones first according to ModListData.ini.
pub fn scan_all_installed_mods(paths: &StudioPaths) -> Vec<ModManifest> {
    let mut all_mods_map: std::collections::HashMap<String, ModManifest> = std::collections::HashMap::new();

    // 1. Scan Steam Workshop mods (content/108600/)
    let workshop_path = Path::new(&paths.workshop_dir);
    if workshop_path.exists() {
        for entry in WalkDir::new(workshop_path).max_depth(4).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "mod.info" {
                if let Some(mut manifest) = parse_mod_info(entry.path()) {
                    let workshop_id = extract_workshop_id_from_path(entry.path());
                    manifest.workshop_id = workshop_id;
                    all_mods_map.insert(manifest.id.clone(), manifest);
                }
            }
        }
    }

    // 2. Scan User Zomboid mods folder (Zomboid/mods/)
    let user_mods_path = Path::new(&paths.user_zomboid_dir).join("mods");
    if user_mods_path.exists() {
        for entry in WalkDir::new(&user_mods_path).max_depth(4).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "mod.info" {
                if let Some(manifest) = parse_mod_info(entry.path()) {
                    all_mods_map.insert(manifest.id.clone(), manifest);
                }
            }
        }
    }

    // 3. Read active order from ModListData.ini
    let mut result_mods = Vec::new();
    let mut processed_ids = HashSet::new();

    if let Ok(ini_data) = read_mod_list_ini(&paths.mod_list_ini_path) {
        for active_id in ini_data.active_mods {
            if let Some(mut manifest) = all_mods_map.remove(&active_id) {
                manifest.enabled = true;
                result_mods.push(manifest);
                processed_ids.insert(active_id);
            } else if !active_id.is_empty() {
                // Mod in ini not found on disk
                result_mods.push(ModManifest {
                    id: active_id.clone(),
                    name: active_id.clone(),
                    description: Some("Active in ModListData.ini".to_string()),
                    workshop_id: None,
                    require: Vec::new(),
                    icon_path: None,
                    is_library: false,
                    is_map_mod: false,
                    enabled: true,
                });
                processed_ids.insert(active_id);
            }
        }
    }

    // 4. Append remaining subscribed mods found on disk (disabled by default)
    for (id, mut manifest) in all_mods_map {
        if !processed_ids.contains(&id) {
            manifest.enabled = false;
            result_mods.push(manifest);
        }
    }

    result_mods
}

fn extract_workshop_id_from_path(path: &Path) -> Option<String> {
    let path_str = path.to_string_lossy();
    if let Some(idx) = path_str.find("108600\\") {
        let rest = &path_str[idx + 7..];
        if let Some(end_idx) = rest.find('\\') {
            return Some(rest[..end_idx].to_string());
        }
    }
    None
}
