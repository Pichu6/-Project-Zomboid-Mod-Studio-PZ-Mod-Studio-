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
    pub poster_url: Option<String>,
    pub is_library: bool,
    pub is_map_mod: bool,
    pub enabled: bool,
}

/// Helper function to sanitize and clean raw mod ID strings (removes leading/trailing slashes, backslashes, quotes, spaces).
fn sanitize_mod_id(raw: &str) -> String {
    raw.trim()
        .trim_matches('\\')
        .trim_matches('/')
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
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
    let mut poster_file = String::new();
    let mut icon_file = String::new();
    let mut pack = false;
    let mut tiledef = false;

    let parent_dir = path.parent();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("id=") {
            id = sanitize_mod_id(&trimmed[3..]);
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
                .map(|s| sanitize_mod_id(s))
                .filter(|s| !s.is_empty())
                .collect();
        } else if trimmed.starts_with("poster=") {
            poster_file = trimmed[7..].trim().to_string();
        } else if trimmed.starts_with("icon=") {
            icon_file = trimmed[5..].trim().to_string();
        } else if trimmed.starts_with("pack=") {
            pack = true;
        } else if trimmed.starts_with("tiledef=") {
            tiledef = true;
        }
    }

    if id.is_empty() {
        return None;
    }

    // Resolve poster URL or icon path
    let mut poster_url = None;
    let mut icon_path = None;

    if let Some(dir) = parent_dir {
        let poster_p = if !poster_file.is_empty() {
            dir.join(&poster_file)
        } else {
            dir.join("poster.png")
        };

        if poster_p.exists() {
            poster_url = Some(poster_p.to_string_lossy().to_string());
        }

        let icon_p = if !icon_file.is_empty() {
            dir.join(&icon_file)
        } else {
            dir.join("icon.png")
        };

        if icon_p.exists() {
            icon_path = Some(icon_p.to_string_lossy().to_string());
        }
    }

    let is_library = require.is_empty() || id.to_lowercase().contains("lib") || id.to_lowercase().contains("manager") || id.to_lowercase().contains("framework");
    let is_map_mod = pack || tiledef || id.to_lowercase().contains("map");

    Some(ModManifest {
        id,
        name: if name.is_empty() { "Unnamed Mod".to_string() } else { name },
        description,
        workshop_id: None,
        require,
        icon_path,
        poster_url,
        is_library,
        is_map_mod,
        enabled: false,
    })
}

/// Scans all subscribed Workshop & local mods recursively without depth limits.
/// Preserves exact ModListData.ini load order for active mods, and sorts remaining mods deterministically.
pub fn scan_all_installed_mods(paths: &StudioPaths) -> Vec<ModManifest> {
    let mut all_mods_map: std::collections::HashMap<String, ModManifest> = std::collections::HashMap::new();

    // 1. Scan Steam Workshop mods (content/108600/) with depth 8
    let workshop_path = Path::new(&paths.workshop_dir);
    if workshop_path.exists() {
        for entry in WalkDir::new(workshop_path).max_depth(8).into_iter().filter_map(|e| e.ok()) {
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
        for entry in WalkDir::new(&user_mods_path).max_depth(8).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "mod.info" {
                if let Some(manifest) = parse_mod_info(entry.path()) {
                    all_mods_map.insert(manifest.id.clone(), manifest);
                }
            }
        }
    }

    // 3. Read active order deterministically from ModListData.ini
    let mut result_mods = Vec::new();
    let mut processed_ids = HashSet::new();

    if let Ok(ini_data) = read_mod_list_ini(&paths.mod_list_ini_path) {
        for raw_active_id in ini_data.active_mods {
            let active_id = sanitize_mod_id(&raw_active_id);

            // Case-insensitive & sanitized matching against scanned manifests
            let matched_key = all_mods_map
                .keys()
                .find(|k| k.to_lowercase() == active_id.to_lowercase())
                .cloned();

            if let Some(key) = matched_key {
                if let Some(mut manifest) = all_mods_map.remove(&key) {
                    manifest.enabled = true;
                    result_mods.push(manifest);
                    processed_ids.insert(key);
                }
            } else if !active_id.is_empty() {
                // Mod in ini not found on disk
                result_mods.push(ModManifest {
                    id: active_id.clone(),
                    name: active_id.clone(),
                    description: Some("Active in ModListData.ini".to_string()),
                    workshop_id: None,
                    require: Vec::new(),
                    icon_path: None,
                    poster_url: None,
                    is_library: false,
                    is_map_mod: false,
                    enabled: true,
                });
                processed_ids.insert(active_id);
            }
        }
    }

    // 4. Append remaining subscribed mods found on disk (disabled by default) in deterministic alphabetical order
    let mut remaining_mods: Vec<ModManifest> = all_mods_map
        .into_iter()
        .filter(|(id, _)| !processed_ids.contains(id))
        .map(|(_, mut manifest)| {
            manifest.enabled = false;
            manifest
        })
        .collect();

    // Sort remaining mods alphabetically by name and id so their position is 100% stable across refreshes!
    remaining_mods.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });

    result_mods.extend(remaining_mods);

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
