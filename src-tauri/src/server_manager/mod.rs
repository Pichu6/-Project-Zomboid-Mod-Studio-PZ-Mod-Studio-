use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use crate::load_order::mod_info::get_all_user_zomboid_dirs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PZServerConfig {
    pub name: String,
    pub file_path: String,
    pub mods: Vec<String>,
    pub workshop_items: Vec<String>,
}

#[tauri::command]
pub fn list_server_configs(user_zomboid_dir: String) -> Result<Vec<PZServerConfig>, String> {
    let mut configs = Vec::new();

    for user_dir in get_all_user_zomboid_dirs(&user_zomboid_dir) {
        let server_dir = user_dir.join("Server");
        if server_dir.exists() {
            if let Ok(entries) = fs::read_dir(&server_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("ini") {
                        let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                        if let Ok(content) = fs::read_to_string(&path) {
                            let mut mods = Vec::new();
                            let mut workshop_items = Vec::new();

                            for line in content.lines() {
                                let trimmed = line.trim();
                                if trimmed.starts_with("Mods=") {
                                    mods = trimmed[5..]
                                        .split(';')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                } else if trimmed.starts_with("WorkshopItems=") {
                                    workshop_items = trimmed[14..]
                                        .split(';')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                }
                            }

                            configs.push(PZServerConfig {
                                name,
                                file_path: path.to_string_lossy().to_string(),
                                mods,
                                workshop_items,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(configs)
}

#[tauri::command]
pub fn sync_client_to_server(
    file_path: String,
    active_mod_ids: Vec<String>,
    active_workshop_ids: Vec<String>,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("El archivo .ini del servidor no existe.".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    // Ensure Master Patch and Carrier are included
    let mut final_mods = active_mod_ids.clone();
    if !final_mods.contains(&"PZModStudioCarrier".to_string()) {
        final_mods.push("PZModStudioCarrier".to_string());
    }
    if !final_mods.contains(&"Z_PZModStudio_MergedPatch".to_string()) {
        final_mods.push("Z_PZModStudio_MergedPatch".to_string());
    }

    let mods_str = format!("Mods={}", final_mods.join(";"));
    let ws_str = format!("WorkshopItems={}", active_workshop_ids.join(";"));

    let mut new_lines = Vec::new();
    let mut mods_found = false;
    let mut ws_found = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Mods=") {
            new_lines.push(mods_str.clone());
            mods_found = true;
        } else if trimmed.starts_with("WorkshopItems=") {
            new_lines.push(ws_str.clone());
            ws_found = true;
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !mods_found {
        new_lines.push(mods_str);
    }
    if !ws_found {
        new_lines.push(ws_str);
    }

    fs::write(path, new_lines.join("\r\n")).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn create_new_server_config(user_zomboid_dir: String, server_name: String) -> Result<PZServerConfig, String> {
    let clean_name = server_name.trim().replace(' ', "_");
    if clean_name.is_empty() {
        return Err("Nombre de servidor inválido.".to_string());
    }

    let user_dirs = get_all_user_zomboid_dirs(&user_zomboid_dir);
    let primary_dir = &user_dirs[0];
    let server_dir = primary_dir.join("Server");
    fs::create_dir_all(&server_dir).map_err(|e| e.to_string())?;

    let ini_path = server_dir.join(format!("{}.ini", clean_name));

    let default_content = format!(
        "PVP=true\r\n\
PauseEmpty=true\r\n\
GlobalChat=true\r\n\
Open=true\r\n\
Public=true\r\n\
PublicName={}\r\n\
PublicDescription=Server managed by Project Zomboid Mod Studio\r\n\
MaxPlayers=16\r\n\
Mods=PZModStudioCarrier;Z_PZModStudio_MergedPatch\r\n\
WorkshopItems=\r\n",
        clean_name
    );

    fs::write(&ini_path, default_content).map_err(|e| e.to_string())?;

    Ok(PZServerConfig {
        name: clean_name,
        file_path: ini_path.to_string_lossy().to_string(),
        mods: vec!["PZModStudioCarrier".to_string(), "Z_PZModStudio_MergedPatch".to_string()],
        workshop_items: Vec::new(),
    })
}
