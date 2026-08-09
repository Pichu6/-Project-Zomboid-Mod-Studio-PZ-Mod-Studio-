use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use crate::load_order::mod_info::{get_all_user_zomboid_dirs, parse_mod_info};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetModEntry {
    pub mod_id: String,
    pub name: String,
    pub workshop_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModPreset {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub created_at: String,
    pub mods: Vec<PresetModEntry>,
    pub load_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingModsReport {
    pub missing_mods: Vec<PresetModEntry>,
    pub installed_count: usize,
    pub total_count: usize,
}

#[tauri::command]
pub fn export_preset_file(preset: ModPreset, file_path: String) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&preset).map_err(|e| e.to_string())?;
    fs::write(Path::new(&file_path), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_preset_file(file_path: String) -> Result<ModPreset, String> {
    let content = fs::read_to_string(Path::new(&file_path)).map_err(|e| e.to_string())?;
    let preset: ModPreset = serde_json::from_str(&content).map_err(|e| format!("Formato .pzpack inválido: {}", e))?;
    Ok(preset)
}

#[tauri::command]
pub fn check_missing_preset_mods(preset: ModPreset, user_zomboid_dir: String, workshop_dir: String) -> Result<MissingModsReport, String> {
    let mut installed_mod_ids = std::collections::HashSet::new();

    // 1. Scan user zomboid directories
    for user_dir in get_all_user_zomboid_dirs(&user_zomboid_dir) {
        let mods_path = user_dir.join("mods");
        if mods_path.exists() {
            for entry in WalkDir::new(&mods_path).max_depth(8).into_iter().filter_map(|e| e.ok()) {
                if entry.file_name() == "mod.info" {
                    if let Some(manifest) = parse_mod_info(entry.path()) {
                        installed_mod_ids.insert(manifest.id.to_lowercase());
                    }
                }
            }
        }
    }

    // 2. Scan workshop directory
    let ws_path = Path::new(&workshop_dir);
    if ws_path.exists() {
        for entry in WalkDir::new(ws_path).max_depth(8).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "mod.info" {
                if let Some(manifest) = parse_mod_info(entry.path()) {
                    installed_mod_ids.insert(manifest.id.to_lowercase());
                }
            }
        }
    }

    let mut missing = Vec::new();
    let total = preset.mods.len();

    for m in &preset.mods {
        let clean_id = m.mod_id.to_lowercase();
        if !installed_mod_ids.contains(&clean_id) {
            missing.push(m.clone());
        }
    }

    let installed_count = total - missing.len();

    Ok(MissingModsReport {
        missing_mods: missing,
        installed_count,
        total_count: total,
    })
}
