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
    /// The game build this profile was last played on from the Studio ("42.21"), if ever.
    /// Saves do not cross builds, so a profile played on one build is worth a word when the
    /// installed game is another.
    #[serde(default)]
    pub last_played_build: Option<String>,
    /// The major build this profile is meant for ("41", "42"), set by hand for a profile not yet
    /// played; None means "whatever it was last played on".
    #[serde(default)]
    pub target_build: Option<String>,
}

impl AppInstance {
    /// The major build the profile is for: the one set by hand, else the one it was last played on.
    pub fn build_major(&self) -> Option<String> {
        self.target_build
            .clone()
            .or_else(|| self.last_played_build.as_ref().map(|b| b.split('.').next().unwrap_or(b).to_string()))
    }
}

/// Path of a profile's JSON file. Profile IDs come from the UI and are joined onto a folder
/// path, so anything other than a plain identifier is refused.
fn instance_file_path(dir: &std::path::Path, instance_id: &str) -> Result<std::path::PathBuf, String> {
    let valid = !instance_id.is_empty()
        && instance_id.len() <= 64
        && instance_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(format!("Invalid profile id: '{}'", instance_id));
    }
    Ok(dir.join(format!("{}.json", instance_id)))
}

fn get_instances_dir(user_zomboid_dir: &str) -> std::path::PathBuf {
    let user_dirs = get_all_user_zomboid_dirs(user_zomboid_dir);
    user_dirs[0].join("PZModStudio_Instances")
}

#[tauri::command(async)]
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

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let timestamp = now.as_secs();
    // Milliseconds so two profiles created in the same second do not overwrite each other.
    let id = format!("inst_{}", now.as_millis());
    let created_at = format!("{}", timestamp);

    let instance = AppInstance {
        id: id.clone(),
        name: clean_name.to_string(),
        description,
        created_at,
        is_active: false,
        active_mod_ids,
        load_order,
        last_played_build: None,
        target_build: None,
    };

    let file_path = dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;

    Ok(instance)
}

#[tauri::command(async)]
pub fn activate_instance(user_zomboid_dir: String, instance_id: String) -> Result<(), String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    let instance_file = instance_file_path(&dir, &instance_id)?;
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

    // 2. Write the active mods into mods/default.txt and PZModStudio_MasterLoadOrder.json
    let z_dir = crate::load_order::mod_info::get_existing_user_zomboid_dirs(&user_zomboid_dir)
        .into_iter()
        .next()
        .ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    {
        crate::load_order::ini_parser::write_mod_list_ini(
            &z_dir.join("ModListData.ini").to_string_lossy(),
            &target_instance.active_mod_ids,
        )?;

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
    // Runs on every toggle/reorder: only the Zomboid folder in use, and no Workshop scans.
    let z_dir = crate::load_order::mod_info::get_existing_user_zomboid_dirs(&user_zomboid_dir)
        .into_iter()
        .next()
        .ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    {
        // 1. mods/default.txt, the list the game reads
        crate::load_order::ini_parser::write_mod_list_ini(
            &z_dir.join("ModListData.ini").to_string_lossy(),
            &active_mod_ids,
        )?;

        // 2. Write PZModStudio_MasterLoadOrder.json
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
                            // `load_order` only holds what is installed right now. Anything the
                            // profile knew about and cannot see — a mod temporarily
                            // unsubscribed, or one the machine never had — is kept, otherwise
                            // the profile quietly forgets it and can never be taken elsewhere.
                            let installed: std::collections::HashSet<&String> = load_order.iter().collect();
                            let remembered: Vec<String> = inst
                                .load_order
                                .iter()
                                .filter(|id| !installed.contains(id))
                                .cloned()
                                .collect();
                            let still_wanted: Vec<String> = inst
                                .active_mod_ids
                                .iter()
                                .filter(|id| !installed.contains(id))
                                .cloned()
                                .collect();

                            inst.load_order = load_order.clone();
                            inst.load_order.extend(remembered);
                            inst.active_mod_ids = active_mod_ids.clone();
                            inst.active_mod_ids.extend(still_wanted);
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
    let instance_file = instance_file_path(&dir, &instance_id)?;
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
    let instance_file = instance_file_path(&dir, &instance.id)?;
    if !instance_file.exists() {
        return Err("The instance to update does not exist.".to_string());
    }
    if let Some(b) = instance.target_build.as_deref() {
        if b.len() != 2 || !b.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("A target build is a major build like 41 or 42, not \"{}\".", b));
        }
    }

    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&instance_file, json).map_err(|e| e.to_string())?;

    // If updating active instance, also sync master load order
    if instance.is_active {
        let _ = save_master_load_order(user_zomboid_dir, instance.load_order.clone(), instance.active_mod_ids.clone());
    }

    Ok(instance)
}


/// Notes the build a profile was just played on: the one in Zomboid/version.txt now.
pub fn mark_instance_played(user_zomboid_dir: String, instance_id: String) -> Result<Option<String>, String> {
    let dir = get_instances_dir(&user_zomboid_dir);
    let instance_file = instance_file_path(&dir, &instance_id)?;
    let text = fs::read_to_string(&instance_file).map_err(|e| e.to_string())?;
    let mut instance: AppInstance = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let build = crate::load_order::mod_info::read_installed_game_version(&user_zomboid_dir)
        .map(crate::catalog::modinfo::format_game_version);
    instance.last_played_build = build.clone();
    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&instance_file, json).map_err(|e| e.to_string())?;
    Ok(build)
}

#[cfg(test)]
mod build_tests {
    use super::*;

    #[test]
    fn a_profile_file_without_the_new_field_still_reads_and_the_build_is_target_or_played() {
        let text = r#"{"id":"a","name":"A","created_at":"","is_active":false,"active_mod_ids":[],"load_order":[],"last_played_build":"42.21"}"#;
        let mut p: AppInstance = serde_json::from_str(text).unwrap();
        assert_eq!(p.target_build, None);
        assert_eq!(p.build_major().as_deref(), Some("42"));
        p.target_build = Some("41".into());
        assert_eq!(p.build_major().as_deref(), Some("41"), "set by hand wins over played");
        p.last_played_build = None;
        p.target_build = None;
        assert_eq!(p.build_major(), None);
    }
}
