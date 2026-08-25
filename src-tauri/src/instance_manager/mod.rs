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
        return Err("Instance name cannot be empty.".to_string());
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
        return Err("Selected instance does not exist.".to_string());
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

    // 2. Write active mods directly into Zomboid/mods.txt, default.txt, ModListData.ini, and PZModStudio_MasterLoadOrder.json
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

        // Write ModListData.ini
        let mod_list_data_path = z_dir.join("ModListData.ini");
        let _ = crate::load_order::ini_parser::write_mod_list_ini(
            &mod_list_data_path.to_string_lossy(),
            &target_instance.active_mod_ids,
        );

        // Write PZModStudio_MasterLoadOrder.json
        let master_order_path = z_dir.join("PZModStudio_MasterLoadOrder.json");
        let master_json = serde_json::json!({
            "load_order": target_instance.load_order,
            "active_mod_ids": target_instance.active_mod_ids,
            "active_profile_id": target_instance.id,
            "active_profile_name": target_instance.name
        });
        let _ = fs::write(master_order_path, serde_json::to_string_pretty(&master_json).unwrap_or_default());
    }

    Ok(())
}

#[tauri::command]
pub fn save_master_load_order(
    user_zomboid_dir: String,
    load_order: Vec<String>,
    active_mod_ids: Vec<String>,
) -> Result<(), String> {
    let user_dirs = get_all_user_zomboid_dirs(&user_zomboid_dir);
    for z_dir in &user_dirs {
        // 1. Write ModListData.ini
        let mod_list_data_path = z_dir.join("ModListData.ini");
        let _ = crate::load_order::ini_parser::write_mod_list_ini(
            &mod_list_data_path.to_string_lossy(),
            &active_mod_ids,
        );

        // 2. Write mods.txt
        let mods_txt_path = z_dir.join("mods.txt");
        let _ = fs::write(mods_txt_path, active_mod_ids.join("\n"));

        // 3. Write default.txt
        let default_txt_dir = z_dir.join("mods");
        let _ = fs::create_dir_all(&default_txt_dir);
        let default_txt_path = default_txt_dir.join("default.txt");
        let mut default_lines = vec!["VERSION=1".to_string(), "mods {".to_string()];
        for mod_id in &active_mod_ids {
            default_lines.push(format!("    mod = {},", mod_id));
        }
        default_lines.push("}".to_string());
        let _ = fs::write(default_txt_path, default_lines.join("\r\n"));

        // 4. Write PZModStudio_MasterLoadOrder.json
        let master_order_path = z_dir.join("PZModStudio_MasterLoadOrder.json");
        let master_json = serde_json::json!({
            "load_order": load_order,
            "active_mod_ids": active_mod_ids
        });
        let _ = fs::write(master_order_path, serde_json::to_string_pretty(&master_json).unwrap_or_default());
    }

    // 5. If there is an active profile, update its load_order and active_mod_ids
    let dir = get_instances_dir(&user_zomboid_dir);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(c) = fs::read_to_string(&path) {
                    if let Ok(mut inst) = serde_json::from_str::<AppInstance>(&c) {
                        if inst.is_active {
                            inst.load_order = load_order.clone();
                            inst.active_mod_ids = active_mod_ids.clone();
                            let _ = fs::write(&path, serde_json::to_string_pretty(&inst).unwrap_or_default());
                        }
                    }
                }
            }
        }
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
        return Err("The instance to update does not exist.".to_string());
    }

    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&instance_file, json).map_err(|e| e.to_string())?;

    // If updating active instance, also sync master load order
    if instance.is_active {
        let _ = save_master_load_order(user_zomboid_dir, instance.load_order.clone(), instance.active_mod_ids.clone());
    }

    Ok(instance)
}
