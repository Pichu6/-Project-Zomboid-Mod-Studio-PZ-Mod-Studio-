use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
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
pub struct CompetingModFileRaw {
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
    pub competing_files: Vec<CompetingModFileRaw>,
}

/// Auto-detects default Project Zomboid installation and user data paths across drives.
pub fn auto_detect_paths() -> StudioPaths {
    let user_home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("C:\\"));
    let user_zomboid = user_home.join("Zomboid");
    let mod_list_ini = user_zomboid.join("mods").join("ModListData.ini");

    let pz_install_candidates = vec![
        r"C:\Program Files (x86)\Steam\steamapps\common\ProjectZomboid",
        r"C:\Program Files\Steam\steamapps\common\ProjectZomboid",
        r"D:\SteamLibrary\steamapps\common\ProjectZomboid",
        r"E:\SteamLibrary\steamapps\common\ProjectZomboid",
        r"F:\SteamLibrary\steamapps\common\ProjectZomboid",
        r"G:\SteamLibrary\steamapps\common\ProjectZomboid",
    ];

    let workshop_candidates = vec![
        r"C:\Program Files (x86)\Steam\steamapps\workshop\content\108600",
        r"C:\Program Files\Steam\steamapps\workshop\content\108600",
        r"D:\SteamLibrary\steamapps\workshop\content\108600",
        r"E:\SteamLibrary\steamapps\workshop\content\108600",
        r"F:\SteamLibrary\steamapps\workshop\content\108600",
        r"G:\SteamLibrary\steamapps\workshop\content\108600",
    ];

    let pz_install_dir = pz_install_candidates
        .into_iter()
        .find(|p| Path::new(p).exists())
        .unwrap_or("")
        .to_string();

    let workshop_dir = workshop_candidates
        .into_iter()
        .find(|p| Path::new(p).exists())
        .unwrap_or("")
        .to_string();

    let user_zomboid_dir = if user_zomboid.exists() {
        user_zomboid.to_string_lossy().to_string()
    } else {
        String::new()
    };

    let mod_list_ini_path = if mod_list_ini.exists() {
        mod_list_ini.to_string_lossy().to_string()
    } else {
        String::new()
    };

    let is_valid = !pz_install_dir.is_empty() && !user_zomboid_dir.is_empty();

    StudioPaths {
        pz_install_dir,
        workshop_dir,
        user_zomboid_dir,
        mod_list_ini_path,
        is_valid,
    }
}

/// Validates provided paths.
pub fn validate_paths(mut paths: StudioPaths) -> StudioPaths {
    let pz_ok = !paths.pz_install_dir.is_empty() && Path::new(&paths.pz_install_dir).exists();
    let user_ok = !paths.user_zomboid_dir.is_empty() && Path::new(&paths.user_zomboid_dir).exists();

    if pz_ok && (paths.workshop_dir.is_empty() || !Path::new(&paths.workshop_dir).exists()) {
        let install_path = Path::new(&paths.pz_install_dir);
        if let Some(parent) = install_path.parent().and_then(|p| p.parent()) {
            let candidate = parent.join("workshop").join("content").join("108600");
            if candidate.exists() {
                paths.workshop_dir = candidate.to_string_lossy().to_string();
            }
        }
    }

    if user_ok && (paths.mod_list_ini_path.is_empty() || !Path::new(&paths.mod_list_ini_path).exists()) {
        let candidate = Path::new(&paths.user_zomboid_dir).join("mods").join("ModListData.ini");
        if candidate.exists() {
            paths.mod_list_ini_path = candidate.to_string_lossy().to_string();
        }
    }

    paths.is_valid = pz_ok && user_ok;
    paths
}

/// Scans active mods to detect relative file path collisions.
/// Filters out conflicts that have already been resolved by Master Patch (Z_PZModStudio_MergedPatch).
pub fn scan_conflicts(paths: &StudioPaths) -> Vec<VfsConflictRaw> {
    let mut file_map: HashMap<String, Vec<CompetingModFileRaw>> = HashMap::new();
    let mut active_mods: Vec<String> = Vec::new();

    // Collect relative paths already patched inside Z_PZModStudio_MergedPatch
    let mut master_patched_files: HashSet<String> = HashSet::new();
    let master_patch_dir = Path::new(&paths.user_zomboid_dir).join("mods").join("Z_PZModStudio_MergedPatch");

    if master_patch_dir.exists() {
        for entry in WalkDir::new(&master_patch_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                if let Some(rel) = extract_relative_media_path(entry.path()) {
                    master_patched_files.insert(rel);
                }
            }
        }
    }

    if !paths.mod_list_ini_path.is_empty() && Path::new(&paths.mod_list_ini_path).exists() {
        if let Ok(content) = fs::read_to_string(&paths.mod_list_ini_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("activeMods=") {
                    active_mods = trimmed[11..]
                        .split(';')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty() && s != "Z_PZModStudio_MergedPatch")
                        .collect();
                    break;
                }
            }
        }
    }

    let workshop_dir = Path::new(&paths.workshop_dir);
    if workshop_dir.exists() {
        for entry in WalkDir::new(workshop_dir).max_depth(8).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy();
                if path_str.ends_with(".lua") || path_str.ends_with(".txt") {
                    if let Some(rel_path) = extract_relative_media_path(path) {
                        // Skip if this file has already been merged into Master Patch
                        if master_patched_files.contains(&rel_path) {
                            continue;
                        }

                        let mod_id = extract_mod_id_from_path(path).unwrap_or_else(|| "workshop_mod".to_string());
                        if active_mods.is_empty() || active_mods.contains(&mod_id) {
                            let mod_name = resolve_specific_mod_name(path, &mod_id);
                            if let Ok(content) = fs::read_to_string(path) {
                                file_map.entry(rel_path).or_default().push(CompetingModFileRaw {
                                    mod_id,
                                    mod_name,
                                    absolute_path: path_str.to_string(),
                                    content,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let user_mods_dir = Path::new(&paths.user_zomboid_dir).join("mods");
    if user_mods_dir.exists() {
        for entry in WalkDir::new(&user_mods_dir).max_depth(8).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let path_str = path.to_string_lossy();
                if (path_str.ends_with(".lua") || path_str.ends_with(".txt")) && !path_str.contains("Z_PZModStudio_MergedPatch") {
                    if let Some(rel_path) = extract_relative_media_path(path) {
                        // Skip if this file has already been merged into Master Patch
                        if master_patched_files.contains(&rel_path) {
                            continue;
                        }

                        let mod_id = extract_local_mod_id(path).unwrap_or_else(|| "local_mod".to_string());
                        if active_mods.is_empty() || active_mods.contains(&mod_id) {
                            let mod_name = resolve_specific_mod_name(path, &mod_id);
                            if let Ok(content) = fs::read_to_string(path) {
                                file_map.entry(rel_path).or_default().push(CompetingModFileRaw {
                                    mod_id,
                                    mod_name,
                                    absolute_path: path_str.to_string(),
                                    content,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let pz_media_dir = Path::new(&paths.pz_install_dir).join("media");

    let mut conflicts = Vec::new();
    let mut id_counter = 1;

    for (rel_path, mut competing_files) in file_map {
        if competing_files.len() > 1 {
            let mut unique_mods = Vec::new();
            let mut seen_mods = HashSet::new();

            for file in competing_files.drain(..) {
                if !seen_mods.contains(&file.mod_id) {
                    seen_mods.insert(file.mod_id.clone());
                    unique_mods.push(file);
                }
            }

            if unique_mods.len() > 1 {
                let vanilla_file_path = pz_media_dir.join(&rel_path);
                let base_content = if vanilla_file_path.exists() {
                    fs::read_to_string(&vanilla_file_path).unwrap_or_else(|_| "-- vanilla file unreadable".to_string())
                } else {
                    "-- vanilla file not present for this path".to_string()
                };

                let file_type = if rel_path.ends_with(".lua") { "LUA" } else { "SCRIPT_TXT" };
                let total_file_lines = base_content.lines().count().max(1);
                let conflict_line = find_first_differing_line(&base_content, &unique_mods);

                conflicts.push(VfsConflictRaw {
                    id: format!("conflict_{}", id_counter),
                    relative_path: rel_path,
                    file_type: file_type.to_string(),
                    start_line: 1,
                    end_line: total_file_lines,
                    conflict_line,
                    total_file_lines,
                    base_content,
                    competing_files: unique_mods,
                });

                id_counter += 1;
            }
        }
    }

    conflicts
}

/// Finds the EXACT 1-based line index where content actually differs between Vanilla and competing mods.
fn find_first_differing_line(base: &str, files: &[CompetingModFileRaw]) -> usize {
    let base_lines: Vec<&str> = base.lines().collect();
    let file_lines_list: Vec<Vec<&str>> = files.iter().map(|f| f.content.lines().collect()).collect();

    let max_lines = base_lines.len().max(
        file_lines_list.iter().map(|l| l.len()).max().unwrap_or(0)
    );

    for idx in 0..max_lines {
        let base_line = base_lines.get(idx).copied().unwrap_or("");
        
        for file_lines in &file_lines_list {
            let mod_line = file_lines.get(idx).copied().unwrap_or("");
            if base_line != mod_line {
                return idx + 1; // Return exact 1-based line number of difference
            }
        }
    }

    1
}

fn resolve_specific_mod_name(file_path: &Path, fallback_mod_id: &str) -> String {
    let mut current = file_path.parent();
    while let Some(dir) = current {
        let info_path = dir.join("mod.info");
        if info_path.exists() {
            if let Ok(content) = fs::read_to_string(&info_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("name=") {
                        let name_val = trimmed[5..].trim().to_string();
                        if !name_val.is_empty() {
                            return name_val;
                        }
                    }
                }
            }
            break;
        }
        current = dir.parent();
    }
    fallback_mod_id.to_string()
}

fn extract_relative_media_path(path: &Path) -> Option<String> {
    let path_str = path.to_string_lossy().replace('\\', "/");
    if let Some(idx) = path_str.find("/media/") {
        return Some(path_str[idx + 1..].to_string());
    }
    None
}

fn extract_mod_id_from_path(path: &Path) -> Option<String> {
    let path_str = path.to_string_lossy();
    if let Some(idx) = path_str.find("108600\\") {
        let rest = &path_str[idx + 7..];
        if let Some(end_idx) = rest.find('\\') {
            return Some(rest[..end_idx].to_string());
        }
    }
    None
}

fn extract_local_mod_id(path: &Path) -> Option<String> {
    let path_str = path.to_string_lossy();
    if let Some(idx) = path_str.find("mods\\") {
        let rest = &path_str[idx + 5..];
        if let Some(end_idx) = rest.find('\\') {
            return Some(rest[..end_idx].to_string());
        }
    }
    None
}
