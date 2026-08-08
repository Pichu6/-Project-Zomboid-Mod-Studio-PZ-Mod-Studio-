use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::load_order::mod_info::parse_mod_info;

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
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsConflictRaw {
    pub id: String,
    pub relative_path: String,
    pub file_type: String, // "LUA" or "SCRIPT_TXT"
    pub start_line: usize,
    pub end_line: usize,
    pub conflict_line: usize,
    pub total_file_lines: usize,
    pub base_content: String,
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
    let mut mod_name_cache: HashMap<String, String> = HashMap::new();

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
                    if let Some(rel_idx) = path_str.find("media\\") {
                        let rel_path = path_str[rel_idx..].replace('\\', "/");
                        let mod_id = extract_mod_id_from_path(&path_str);
                        
                        // Resolve human-readable mod name from mod.info
                        let mod_name = mod_name_cache.entry(mod_id.clone()).or_insert_with(|| {
                            find_and_parse_mod_name(workshop_path, &mod_id)
                        }).clone();

                        // Read actual file content
                        let content = fs::read_to_string(path).unwrap_or_default();

                        let competing_file = CompetingFileRaw {
                            mod_id: mod_id.clone(),
                            mod_name,
                            absolute_path: path_str.to_string(),
                            content,
                        };

                        path_map.entry(rel_path).or_default().push(competing_file);
                    }
                }
            }
        }
    }

    // Filter relative paths with 2+ competing files
    let mut conflicts = Vec::new();
    let mut id_counter = 1;

    for (rel_path, competing_files) in path_map {
        if competing_files.len() > 1 {
            let file_type = if rel_path.ends_with(".lua") {
                "LUA".to_string()
            } else {
                "SCRIPT_TXT".to_string()
            };

            // Read base Vanilla file content if it exists
            let vanilla_file = PathBuf::from(&paths.pz_install_dir).join(&rel_path);
            let base_content = if vanilla_file.exists() {
                fs::read_to_string(&vanilla_file).unwrap_or_default()
            } else {
                "-- Vanilla file not present for this path".to_string()
            };

            let total_file_lines = base_content.lines().count().max(1);

            // Compute actual conflicting line index
            let conflict_line = find_first_conflict_line(&base_content, &competing_files);
            let start_line = conflict_line.saturating_sub(5).max(1);
            let end_line = (conflict_line + 5).min(total_file_lines);

            conflicts.push(VfsConflictRaw {
                id: format!("c{}", id_counter),
                relative_path: rel_path,
                file_type,
                start_line,
                end_line,
                conflict_line,
                total_file_lines,
                base_content,
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

fn find_and_parse_mod_name(workshop_root: &Path, mod_id: &str) -> String {
    let mod_folder = workshop_root.join(mod_id);
    for entry in WalkDir::new(&mod_folder).max_depth(3).into_iter().filter_map(|e| e.ok()) {
        if entry.file_name() == "mod.info" {
            if let Some(manifest) = parse_mod_info(entry.path()) {
                if !manifest.name.is_empty() {
                    return manifest.name;
                }
            }
        }
    }
    format!("Workshop Mod ({})", mod_id)
}

fn find_first_conflict_line(base: &str, competing: &[CompetingFileRaw]) -> usize {
    let base_lines: Vec<&str> = base.lines().collect();
    if competing.is_empty() {
        return 1;
    }

    let first_mod_lines: Vec<&str> = competing[0].content.lines().collect();
    let max_lines = base_lines.len().max(first_mod_lines.len());

    for i in 0..max_lines {
        let base_l = base_lines.get(i).copied().unwrap_or("");
        for mod_file in competing {
            let mod_l = mod_file.content.lines().nth(i).unwrap_or("");
            if base_l != mod_l {
                return i + 1; // 1-indexed
            }
        }
    }
    1
}
