use serde::{Deserialize, Serialize};
use std::fs;
use crate::load_order::mod_info::get_all_user_zomboid_dirs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInstance {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub is_active: bool,
    pub active_mod_ids: Vec<String>,
    pub load_order: Vec<String>,
}

fn get_instances_dir(user_zomboid_dir: &str) -> std::path::PathBuf {
    let user_dirs = get_all_user_zomboid_dirs(user_zomboid_dir);
    user_dirs[0].join("PZModStudio_Instances")
}

#[tauri::command]
pub fn list_instances(user_zomboid_dir: String) -> Result<Vec<AppInstance>, String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut instances = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(inst) = serde_json::from_str::<AppInstance>(&content) {
                        instances.push(inst);
                    }
                }
            }
        }
    }

    instances.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(instances)
}

#[tauri::command]
pub fn create_instance(
    user_zomboid_dir: String,
    name: String,
    description: Option<String>,
    active_mod_ids: Vec<String>,
    load_order: Vec<String>,
) -> Result<AppInstance, String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("El nombre de la instancia no puede estar vacío.".to_string());
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let id = format!("inst_{}", timestamp);
    let created_at = format!("{}", timestamp);

    let instance = AppInstance {
        id: id.clone(),
        name: clean_name.to_string(),
        description,
        created_at,
        is_active: false,
        active_mod_ids,
        load_order,
    };

    let file_path = dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;

    Ok(instance)
}

#[tauri::command]
pub fn activate_instance(user_zomboid_dir: String, instance_id: String) -> Result<(), String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    let instance_file = dir.join(format!("{}.json", instance_id));
    if !instance_file.exists() {
        return Err("La instancia seleccionada no existe.".to_string());
    }

    let content = fs::read_to_string(&instance_file).map_err(|e| e.to_string())?;
    let mut target_instance: AppInstance = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 1. Update active state across all instance JSON files
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(c) = fs::read_to_string(&path) {
                    if let Ok(mut inst) = serde_json::from_str::<AppInstance>(&c) {
                        inst.is_active = inst.id == instance_id;
                        let _ = fs::write(&path, serde_json::to_string_pretty(&inst).unwrap_or_default());
                    }
                }
            }
        }
    }

    target_instance.is_active = true;

    // 2. Write active mods directly into Zomboid/mods.txt and default.txt across all candidate Zomboid folders
    let user_dirs = get_all_user_zomboid_dirs(&user_zomboid_dir);
    for z_dir in &user_dirs {
        // Write mods.txt (PZ Build 42)
        let mods_txt_path = z_dir.join("mods.txt");
        let mods_txt_content = target_instance.active_mod_ids.join("\n");
        let _ = fs::write(mods_txt_path, &mods_txt_content);

        // Write default.txt (PZ Build 41 & legacy)
        let default_txt_dir = z_dir.join("mods");
        let _ = fs::create_dir_all(&default_txt_dir);
        let default_txt_path = default_txt_dir.join("default.txt");
        let mut default_lines = vec!["VERSION=1".to_string(), "mods {".to_string()];
        for mod_id in &target_instance.active_mod_ids {
            default_lines.push(format!("    mod = {},", mod_id));
        }
        default_lines.push("}".to_string());
        let _ = fs::write(default_txt_path, default_lines.join("\r\n"));
    }

    Ok(())
}

#[tauri::command]
pub fn delete_instance(user_zomboid_dir: String, instance_id: String) -> Result<(), String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    let instance_file = dir.join(format!("{}.json", instance_id));
    if instance_file.exists() {
        fs::remove_file(instance_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_instance(
    user_zomboid_dir: String,
    instance: AppInstance,
) -> Result<AppInstance, String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    let instance_file = dir.join(format!("{}.json", instance.id));
    if !instance_file.exists() {
        return Err("La instancia a actualizar no existe.".to_string());
    }

    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&instance_file, json).map_err(|e| e.to_string())?;

    Ok(instance)
}
