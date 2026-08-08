use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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
            description = Some(trimmed[12..].trim().to_string());
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
    })
}
