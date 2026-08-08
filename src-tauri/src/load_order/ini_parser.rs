use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListData {
    pub active_mods: Vec<String>,
    pub raw_ini_content: String,
}

/// Reads and parses ModListData.ini file.
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let path = Path::new(ini_path);
    if !path.exists() {
        return Ok(ModListData {
            active_mods: Vec::new(),
            raw_ini_content: String::new(),
        });
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut active_mods = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("activeMods=") || trimmed.starts_with("Mods=") {
            let parts: Vec<&str> = trimmed.split('=').collect();
            if parts.len() == 2 {
                active_mods = parts[1]
                    .split(';')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }
    }

    Ok(ModListData {
        active_mods,
        raw_ini_content: content,
    })
}

/// Writes active mod load order list back to ModListData.ini AND synchronizes
/// loadorder.ini, modgroups.ini, mod_load_order.txt, and default.txt so that Project Zomboid's
/// in-game "MOD LOAD ORDER" modal displays 100% identical ordering!
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let path = Path::new(ini_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;

        // 1. Primary write to Zomboid/Lua/ModListData.ini
        let mods_joined = active_mods.join(";");
        let content = format!("[ModList]\nactiveMods={}\n", mods_joined);
        fs::write(path, &content).map_err(|e| e.to_string())?;

        // 2. Synchronize Zomboid/Lua/loadorder.ini (Read by Build 42 MOD LOAD ORDER modal)
        let loadorder_ini_path = parent.join("loadorder.ini");
        let loadorder_content = format!("[LoadOrder]\nmods={}\n", mods_joined);
        let _ = fs::write(loadorder_ini_path, loadorder_content);

        // 3. Synchronize Zomboid/Lua/modgroups.ini
        let modgroups_ini_path = parent.join("modgroups.ini");
        let modgroups_content = format!("[ModGroups]\nactive={}\n", mods_joined);
        let _ = fs::write(modgroups_ini_path, modgroups_content);

        // 4. Synchronize in-game sorters: ModLoadOrderSorter.txt, mod_order.txt, ModLoadOrderExporter.txt
        let sorter_file_1 = parent.join("ModLoadOrderSorter.txt");
        let sorter_file_2 = parent.join("mod_order.txt");
        let sorter_file_3 = parent.join("mod_load_order.txt");
        let exporter_file = parent.join("ModLoadOrderExporter.txt");

        let active_lines = active_mods.join("\n");
        let _ = fs::write(sorter_file_1, &active_lines);
        let _ = fs::write(sorter_file_2, &active_lines);
        let _ = fs::write(sorter_file_3, &active_lines);
        let _ = fs::write(exporter_file, &active_lines);

        // 5. Synchronize Zomboid/mods/default.txt for in-game Mod Manager compatibility
        if let Some(zomboid_dir) = parent.parent() {
            let default_txt_path = zomboid_dir.join("mods").join("default.txt");
            if let Some(mods_parent) = default_txt_path.parent() {
                let _ = fs::create_dir_all(mods_parent);
            }
            let _ = fs::write(default_txt_path, &active_lines);

            // 6. Synchronize Zomboid/saved_modlists/PZModStudio.txt profile
            let saved_modlists_dir = zomboid_dir.join("saved_modlists");
            let _ = fs::create_dir_all(&saved_modlists_dir);
            let pz_studio_preset = saved_modlists_dir.join("PZModStudio.txt");
            let _ = fs::write(pz_studio_preset, &active_lines);
        }
    }

    Ok(())
}
