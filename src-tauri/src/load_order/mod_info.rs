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

/// Helper function to sanitize and clean raw mod ID strings.
pub fn sanitize_mod_id(raw: &str) -> String {
    raw.trim()
        .trim_matches('\\')
        .trim_matches('/')
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

/// Clean text encoding (fixes Windows-1252 / ANSI garbage characters like Ã±, Ã¡, etc.)
fn clean_text_encoding(text: &str) -> String {
    let mut cleaned = text.to_string();
    
    // Common UTF-8 misdecoded in Windows-1252 / Latin-1 replacements
    let replacements = [
        ("Ã¡", "á"), ("Ã©", "é"), ("Ã*", "í"), ("Ã³", "ó"), ("Ãº", "ú"),
        ("Ã±", "ñ"), ("Ã‘", "Ñ"), ("Ã?", "Á"), ("Ã‰", "É"), ("Ã?", "Í"),
        ("Ã“", "Ó"), ("Ãš", "Ú"), ("â€™", "'"), ("â€œ", "\""), ("â€", "\""),
        ("â€“", "-"), ("â€”", "—"), ("Â°", "°"), ("ï»¿", ""),
    ];

    for (from, to) in replacements {
        cleaned = cleaned.replace(from, to);
    }

    // Strip unprintable control characters
    cleaned.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect()
}

/// Helper to robustly read mod.info content handling UTF-8 with BOM, Latin-1, and Windows-1252
fn read_text_file_lossy(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    
    // Strip UTF-8 BOM if present
    let bytes_slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };

    let decoded = match String::from_utf8(bytes_slice.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            // Fallback to ISO-8859-1 / Windows-1252 lossy decoding
            bytes_slice.iter().map(|&b| b as char).collect()
        }
    };

    Some(clean_text_encoding(&decoded))
}

/// Parses a mod.info file into a structured ModManifest struct.
pub fn parse_mod_info(path: &Path) -> Option<ModManifest> {
    if !path.exists() {
        return None;
    }

    let content = read_text_file_lossy(path)?;
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
            name = clean_text_encoding(trimmed[5..].trim());
        } else if trimmed.starts_with("description=") {
            let desc_val = clean_text_encoding(trimmed[12..].trim());
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

    // Robust search for poster and icon images in mod directory
    let mut poster_url = None;
    let mut icon_path = None;

    if let Some(dir) = parent_dir {
        let mut dirs_to_check = vec![dir.to_path_buf()];
        if let Some(p) = dir.parent() {
            dirs_to_check.push(p.to_path_buf());
            if let Some(gp) = p.parent() {
                dirs_to_check.push(gp.to_path_buf());
            }
        }

        for search_dir in &dirs_to_check {
            let poster_candidates = vec![
                if !poster_file.is_empty() { Some(search_dir.join(&poster_file)) } else { None },
                Some(search_dir.join("poster.png")),
                Some(search_dir.join("Poster.png")),
                Some(search_dir.join("poster.jpg")),
                Some(search_dir.join("Poster.jpg")),
                Some(search_dir.join("preview.png")),
                Some(search_dir.join("preview.jpg")),
                Some(search_dir.join("icon.png")),
            ];

            for cand in poster_candidates.into_iter().flatten() {
                if cand.exists() {
                    poster_url = Some(cand.to_string_lossy().replace('\\', "/"));
                    break;
                }
            }
            if poster_url.is_some() {
                break;
            }
        }

        for search_dir in &dirs_to_check {
            let icon_candidates = vec![
                if !icon_file.is_empty() { Some(search_dir.join(&icon_file)) } else { None },
                Some(search_dir.join("icon.png")),
                Some(search_dir.join("Icon.png")),
            ];

            for cand in icon_candidates.into_iter().flatten() {
                if cand.exists() {
                    icon_path = Some(cand.to_string_lossy().replace('\\', "/"));
                    break;
                }
            }
            if icon_path.is_some() {
                break;
            }
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
    let path_str = path.to_string_lossy().replace('/', "\\");
    if let Some(idx) = path_str.find("108600\\") {
        let rest = &path_str[idx + 7..];
        if let Some(end_idx) = rest.find('\\') {
            return Some(rest[..end_idx].to_string());
        }
    }
    None
}
