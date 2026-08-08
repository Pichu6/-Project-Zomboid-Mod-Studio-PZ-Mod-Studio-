use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioPaths {
    pub pz_install_dir: String,
    pub workshop_dir: String,
    pub user_zomboid_dir: String,
    pub mod_list_ini_path: String,
    pub is_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetingFileRaw {
    pub mod_id: String,
    pub mod_name: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsConflictRaw {
    pub id: String,
    pub relative_path: String,
    pub file_type: String, // "LUA" or "SCRIPT_TXT"
    pub vanilla_path: Option<String>,
    pub competing_files: Vec<CompetingFileRaw>,
}

/// Auto-detects Project Zomboid installation and user directories on Windows.
pub fn auto_detect_paths() -> StudioPaths {
    let mut install_dir = String::new();
    let mut workshop_dir = String::new();

    // Standard Steam Library locations on Windows
    let candidate_drives = vec!["C", "D", "E", "F", "G"];
    for drive in candidate_drives {
        let pz_path = format!("{}:\\Program Files (x86)\\Steam\\steamapps\\common\\ProjectZomboid", drive);
        let lib_path = format!("{}:\\SteamLibrary\\steamapps\\common\\ProjectZomboid", drive);
        
        if Path::new(&pz_path).exists() {
            install_dir = pz_path;
            workshop_dir = format!("{}:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\108600", drive);
            break;
        } else if Path::new(&lib_path).exists() {
            install_dir = lib_path;
            workshop_dir = format!("{}:\\SteamLibrary\\steamapps\\workshop\\content\\108600", drive);
            break;
        }
    }

    // Detect User Zomboid Directory (C:\Users\<User>\Zomboid)
    let user_zomboid_dir = dirs_next::home_dir()
        .map(|h| h.join("Zomboid").to_string_lossy().into_owned())
        .unwrap_or_default();

    let mod_list_ini_path = if !user_zomboid_dir.is_empty() {
        format!("{}\\Lua\\ModManager\\ModListData.ini", user_zomboid_dir)
    } else {
        String::new()
    };

    let is_valid = !install_dir.is_empty() && Path::new(&install_dir).exists();

    StudioPaths {
        pz_install_dir: install_dir,
        workshop_dir,
        user_zomboid_dir,
        mod_list_ini_path,
        is_valid,
    }
}

/// Validates user custom or manually entered paths.
pub fn validate_paths(paths: StudioPaths) -> StudioPaths {
    let is_valid = Path::new(&paths.pz_install_dir).exists();
    StudioPaths {
        is_valid,
        ..paths
    }
}

/// Scans active Workshop mods & Vanilla directories for virtual path collisions.
pub fn scan_conflicts(paths: &StudioPaths) -> Vec<VfsConflictRaw> {
    let mut path_map: HashMap<String, Vec<CompetingFileRaw>> = HashMap::new();

    let workshop_path = Path::new(&paths.workshop_dir);
    if workshop_path.exists() {
        // Walk workshop mods
        for entry in WalkDir::new(workshop_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy();
                let is_lua = path_str.ends_with(".lua");
                let is_script = path_str.ends_with(".txt") && path_str.contains("media\\scripts");

                if is_lua || is_script {
                    // Extract relative virtual path (e.g. media/lua/client/UI.lua)
                    if let Some(rel_idx) = path_str.find("media\\") {
                        let rel_path = path_str[rel_idx..].replace('\\', "/");
                        
                        // Extract mod ID from workshop path structure: content/108600/<ModID>/...
                        let mod_id = extract_mod_id_from_path(&path_str);
                        
                        let competing_file = CompetingFileRaw {
                            mod_id: mod_id.clone(),
                            mod_name: format!("Workshop Mod ({})", mod_id),
                            absolute_path: path_str.to_string(),
                        };

                        path_map.entry(rel_path).or_default().push(competing_file);
                    }
                }
            }
        }
    }

    // Filter only relative paths that have 2 or more competing files (conflicts)
    let mut conflicts = Vec::new();
    let mut id_counter = 1;

    for (rel_path, competing_files) in path_map {
        if competing_files.len() > 1 {
            let file_type = if rel_path.ends_with(".lua") {
                "LUA".to_string()
            } else {
                "SCRIPT_TXT".to_string()
            };

            // Check if vanilla has a base version of this file
            let vanilla_file = PathBuf::from(&paths.pz_install_dir).join(&rel_path);
            let vanilla_path = if vanilla_file.exists() {
                Some(vanilla_file.to_string_lossy().to_string())
            } else {
                None
            };

            conflicts.push(VfsConflictRaw {
                id: format!("c{}", id_counter),
                relative_path: rel_path,
                file_type,
                vanilla_path,
                competing_files,
            });

            id_counter += 1;
        }
    }

    conflicts
}

fn extract_mod_id_from_path(path: &str) -> String {
    if let Some(idx) = path.find("108600\\") {
        let rest = &path[idx + 7..];
        if let Some(end_idx) = rest.find('\\') {
            return rest[..end_idx].to_string();
        }
    }
    "UnknownMod".to_string()
}
