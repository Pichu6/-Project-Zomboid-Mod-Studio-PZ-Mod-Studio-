use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use crate::load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedFilePayload {
    pub relative_path: String, // e.g. "media/lua/client/ISUI/ISInventoryPane.lua"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchRequest {
    pub carrier_workshop_id: Option<String>,
    pub workshop_dir: Option<String>,
    pub pz_install_dir: Option<String>,
    pub user_zomboid_dir: String,
    pub mod_list_ini_path: String,
    pub merged_files: Vec<MergedFilePayload>,
    pub active_polyfill_ids: Vec<String>,
    pub package_folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedPackageInfo {
    pub folder_name: String,
    pub display_name: String,
    pub mod_id: String,
    pub is_packaged: bool,
    pub created_at: Option<String>,
    pub packaged_mods: Vec<String>,
    pub merged_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchMetadata {
    pub is_packaged: bool,
    pub created_at: String,
    pub packaged_mod_ids: Vec<String>,
    pub merged_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchStatusInfo {
    pub is_packaged: bool,
    pub created_at: Option<String>,
    pub packaged_mods: Vec<String>,
    pub merged_files: Vec<String>,
    pub missing_active_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchResult {
    pub success: bool,
    pub patch_mod_dir: String,
    pub files_written: usize,
    pub polyfills_injected: usize,
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let mut s1: u32 = 1;
    let mut s2: u32 = 0;
    for &b in data {
        s1 = (s1 + b as u32) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    (s2 << 16) | s1
}

pub fn generate_256x256_png_bytes() -> Vec<u8> {
    let mut png = Vec::new();
    png.extend_from_slice(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let mut ihdr_data = Vec::new();
    ihdr_data.extend_from_slice(&256u32.to_be_bytes());
    ihdr_data.extend_from_slice(&256u32.to_be_bytes());
    ihdr_data.push(8);
    ihdr_data.push(6);
    ihdr_data.push(0);
    ihdr_data.push(0);
    ihdr_data.push(0);

    let mut ihdr_chunk = Vec::new();
    ihdr_chunk.extend_from_slice(b"IHDR");
    ihdr_chunk.extend_from_slice(&ihdr_data);
    let ihdr_crc = crc32(&ihdr_chunk);

    png.extend_from_slice(&(ihdr_data.len() as u32).to_be_bytes());
    png.extend_from_slice(&ihdr_chunk);
    png.extend_from_slice(&ihdr_crc.to_be_bytes());

    let mut raw_data = Vec::with_capacity(262400);
    for _ in 0..256 {
        raw_data.push(0);
        for _ in 0..256 {
            raw_data.extend_from_slice(&[16, 185, 129, 255]);
        }
    }

    let adler = adler32(&raw_data);

    let mut zlib_stream = Vec::new();
    zlib_stream.extend_from_slice(&[0x78, 0x01]);

    let block_size = 65535;
    let mut offset = 0;
    while offset < raw_data.len() {
        let chunk_size = (raw_data.len() - offset).min(block_size);
        let is_final = (offset + chunk_size) == raw_data.len();
        let bfinal_btype = if is_final { 0x01 } else { 0x00 };

        zlib_stream.push(bfinal_btype);
        let len_u16 = chunk_size as u16;
        let nlen_u16 = !len_u16;

        zlib_stream.extend_from_slice(&len_u16.to_le_bytes());
        zlib_stream.extend_from_slice(&nlen_u16.to_le_bytes());
        zlib_stream.extend_from_slice(&raw_data[offset..offset + chunk_size]);

        offset += chunk_size;
    }

    zlib_stream.extend_from_slice(&adler.to_be_bytes());

    let mut idat_chunk = Vec::new();
    idat_chunk.extend_from_slice(b"IDAT");
    idat_chunk.extend_from_slice(&zlib_stream);
    let idat_crc = crc32(&idat_chunk);

    png.extend_from_slice(&(zlib_stream.len() as u32).to_be_bytes());
    png.extend_from_slice(&idat_chunk);
    png.extend_from_slice(&idat_crc.to_be_bytes());

    let mut iend_chunk = Vec::new();
    iend_chunk.extend_from_slice(b"IEND");
    let iend_crc = crc32(&iend_chunk);

    png.extend_from_slice(&0u32.to_be_bytes());
    png.extend_from_slice(&iend_chunk);
    png.extend_from_slice(&iend_crc.to_be_bytes());

    png
}

static EMBEDDED_PREVIEW_PNG: &[u8] = include_bytes!("../../../111.png");

pub fn get_preview_png_bytes() -> Vec<u8> {
    if let Ok(bytes) = fs::read("111.png") {
        return bytes;
    }
    if let Ok(bytes) = fs::read(r"E:\PZ Mod Studio\111.png") {
        return bytes;
    }
    EMBEDDED_PREVIEW_PNG.to_vec()
}

/// Generates a synthetic master patch mod under Zomboid/mods/<package_folder_name> and updates ModListData.ini.
pub fn generate_master_patch(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    let pkg_name = req.package_folder_name
        .clone()
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let clean_pkg_name = if pkg_name.starts_with("Z_PZModStudio_") {
        pkg_name.clone()
    } else {
        format!("Z_PZModStudio_{}", pkg_name.replace(' ', "_"))
    };

    let display_name = if clean_pkg_name.starts_with("Z_PZModStudio_") {
        clean_pkg_name["Z_PZModStudio_".len()..].to_string().replace('_', " ")
    } else {
        clean_pkg_name.clone()
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(&req.user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid directories provided to generate master patch.".to_string());
    }

    let primary_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    let target_dirs = vec![primary_dir.clone()];

    let mut mod_info_content = String::new();
    mod_info_content.push_str(&format!("name=PZ Mod Studio Patch: {}\r\n", display_name));
    mod_info_content.push_str(&format!("id={}\r\n", clean_pkg_name));
    mod_info_content.push_str("description=Auto-generated compatibility patch package generated by Project Zomboid Mod Studio.\r\n");
    mod_info_content.push_str("poster=poster.png\r\n");
    mod_info_content.push_str("icon=icon.png\r\n");
    mod_info_content.push_str("modversion=1.0.0\r\n");
    mod_info_content.push_str("pzversion=42.0,41.78\r\n");
    mod_info_content.push_str("versionMin=42.0\r\n");
    mod_info_content.push_str("author=PZ Mod Studio\r\n");

    let mut files_written = 0;
    let polyfills_count = req.active_polyfill_ids.len();

    let mut polyfill_lua_content = String::from("-- Z_PZModStudio_Polyfills.lua (PZ Mod Studio Build 41/42+ Runtime Shim & Translator Fix)\n\n");
    polyfill_lua_content.push_str("if not Z_PZModStudio_Polyfills then Z_PZModStudio_Polyfills = {} end\n\n");

    polyfill_lua_content.push_str("if zombie and zombie.core and zombie.core.Translator then\n");
    polyfill_lua_content.push_str("    local original_getText = zombie.core.Translator.getText\n");
    polyfill_lua_content.push_str("    zombie.core.Translator.getText = function(str, ...)\n");
    polyfill_lua_content.push_str("        if not str then return \"\" end\n");
    polyfill_lua_content.push_str("        local status, result = pcall(original_getText, str, ...)\n");
    polyfill_lua_content.push_str("        if status and result then return result else return tostring(str) end\n");
    polyfill_lua_content.push_str("    end\n");
    polyfill_lua_content.push_str("end\n\n");

    polyfill_lua_content.push_str("if _G and _G.getText then\n");
    polyfill_lua_content.push_str("    local orig_gt = _G.getText\n");
    polyfill_lua_content.push_str("    _G.getText = function(str, ...)\n");
    polyfill_lua_content.push_str("        if not str then return \"\" end\n");
    polyfill_lua_content.push_str("        local status, result = pcall(orig_gt, str, ...)\n");
    polyfill_lua_content.push_str("        if status and result then return result else return tostring(str) end\n");
    polyfill_lua_content.push_str("    end\n");
    polyfill_lua_content.push_str("end\n\n");

    polyfill_lua_content.push_str("    if zombie and zombie.core and zombie.core.Translator then\n");
    polyfill_lua_content.push_str("        local status, res = pcall(zombie.core.Translator.getText, clean)\n");
    polyfill_lua_content.push_str("        if status and res then return res end\n");
    polyfill_lua_content.push_str("    end\n");
    polyfill_lua_content.push_str("    return tostring(str)\n");
    polyfill_lua_content.push_str("end\n\n");
    
    let ui_override_content = r#"
-- PZ Mod Studio In-Game Load Order & Master Patch Lock
local Events = Events or triggerEvent
Events.OnGameStart.Add(function()
    if ModLoadOrderUI then
        ModLoadOrderUI.onAuto = function(self)
            local text = "PZ Mod Studio Control Active:\nLoad order is managed automatically by PZ Mod Studio.\nIn-game primitive re-sorting is locked to preserve Master Patch overrides."
            local modal = ISModalDialog:new(0, 0, 420, 160, text, false, nil, nil)
            modal:initialise()
            modal:addToUIManager()
        end
    end
end)
"#;

    let png_256 = get_preview_png_bytes();

    for patch_mod_dir in &target_dirs {
        fs::create_dir_all(patch_mod_dir).map_err(|e| e.to_string())?;

        // 1. Top level mod.info and media/
        fs::write(patch_mod_dir.join("mod.info"), &mod_info_content).map_err(|e| e.to_string())?;
        let _ = fs::write(patch_mod_dir.join("poster.png"), &png_256);
        let _ = fs::write(patch_mod_dir.join("icon.png"), &png_256);

        let media_dir = patch_mod_dir.join("media");
        let _ = fs::create_dir_all(&media_dir);
        let _ = fs::write(media_dir.join("mod.info"), &mod_info_content);
        let _ = fs::write(media_dir.join("poster.png"), &png_256);
        let _ = fs::write(media_dir.join("icon.png"), &png_256);

        // 2. Build 42 native subfolder structure (42/mod.info and 42/media/)
        let dir_42 = patch_mod_dir.join("42");
        let _ = fs::create_dir_all(&dir_42);
        let _ = fs::write(dir_42.join("mod.info"), &mod_info_content);
        let _ = fs::write(dir_42.join("poster.png"), &png_256);
        let _ = fs::write(dir_42.join("icon.png"), &png_256);

        let media_42_dir = dir_42.join("media");
        let _ = fs::create_dir_all(&media_42_dir);
        let _ = fs::write(media_42_dir.join("mod.info"), &mod_info_content);

        // Write merged files to both top level and 42/ subfolder
        for file in &req.merged_files {
            let dest_path = patch_mod_dir.join(&file.relative_path);
            if let Some(parent) = dest_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&dest_path, &file.content);

            let dest_42_path = dir_42.join(&file.relative_path);
            if let Some(parent) = dest_42_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&dest_42_path, &file.content);

            files_written += 1;
        }

        // Polyfills in both media/lua/shared and 42/media/lua/shared
        let polyfill_dir = media_dir.join("lua").join("shared");
        let _ = fs::create_dir_all(&polyfill_dir);
        let _ = fs::write(polyfill_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfill_lua_content);

        let polyfill_42_dir = media_42_dir.join("lua").join("shared");
        let _ = fs::create_dir_all(&polyfill_42_dir);
        let _ = fs::write(polyfill_42_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfill_lua_content);

        // UI Override shims
        let client_override_dir = media_dir.join("lua").join("client").join("OptionScreens");
        let _ = fs::create_dir_all(&client_override_dir);
        let _ = fs::write(client_override_dir.join("Z_PZModStudio_UIOverride.lua"), ui_override_content);

        let client_override_42_dir = media_42_dir.join("lua").join("client").join("OptionScreens");
        let _ = fs::create_dir_all(&client_override_42_dir);
        let _ = fs::write(client_override_42_dir.join("Z_PZModStudio_UIOverride.lua"), ui_override_content);
    }

    // Update ModListData.ini to place clean_pkg_name at the end of load order
    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            mod_list.active_mods.retain(|id| id != &clean_pkg_name);
            mod_list.active_mods.push(clean_pkg_name.clone());
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);

            // Write patch_metadata.json
            let merged_file_paths: Vec<String> = req.merged_files.iter().map(|f| f.relative_path.clone()).collect();
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default();

            let meta = MasterPatchMetadata {
                is_packaged: true,
                created_at: format!("Epoch-{}", timestamp),
                packaged_mod_ids: mod_list.active_mods.clone(),
                merged_file_paths,
            };

            if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
                for patch_dir in &target_dirs {
                    let _ = fs::write(patch_dir.join("patch_metadata.json"), &meta_json);
                }
            }
        }
    }

    Ok(MasterPatchResult {
        success: true,
        patch_mod_dir: primary_dir.to_string_lossy().to_string(),
        files_written,
        polyfills_injected: polyfills_count,
    })
}

pub fn prepare_carrier_mod(user_zomboid_dir: &str) -> Result<String, String> {
    if user_zomboid_dir.is_empty() {
        return Err("User Zomboid directory path is missing.".to_string());
    }

    let png_256 = get_preview_png_bytes();

    let all_user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    let primary_user_dir = &all_user_dirs[0];

    // 1. Create Zomboid/Workshop/PZModStudioCarrier (Primary location read by PZ Workshop Upload UI)
    let workshop_item_dir = primary_user_dir.join("Workshop").join("PZModStudioCarrier");
    let _ = fs::remove_dir_all(&workshop_item_dir);
    fs::create_dir_all(&workshop_item_dir).map_err(|e| e.to_string())?;

    let workshop_txt = format!(
        "version=2\r\ntitle={}\r\ndescription={}\r\ntags=Build 41,Build 42\r\nvisibility=public\r\n",
        "PZ Mod Studio Carrier Patch",
        "Carrier mod container for PZ Mod Studio 3-Way merges and B42 polyfill shims."
    );

    fs::write(workshop_item_dir.join("workshop.txt"), &workshop_txt).map_err(|e| e.to_string())?;
    let _ = fs::write(workshop_item_dir.join("preview.png"), &png_256);

    // CRITICAL: Project Zomboid Workshop upload tool REQUIRES Contents/ folder at root of Workshop item directory!
    let carrier_mod_dir = workshop_item_dir.join("Contents").join("mods").join("PZModStudioCarrier");
    fs::create_dir_all(&carrier_mod_dir).map_err(|e| e.to_string())?;

    let media_dir = carrier_mod_dir.join("media").join("lua").join("shared");
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;
    let _ = fs::write(media_dir.join("carrier_shim.lua"), "-- PZ Mod Studio Carrier Shim\nif not Z_PZModStudio_Polyfills then Z_PZModStudio_Polyfills = {} end\n");

    let mod_info = format!(
        "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\nauthor=PZ Mod Studio\r\n",
        "PZModStudio Carrier Patch",
        "PZModStudioCarrier",
        "Carrier mod container for PZ Mod Studio 3-Way merges and B42 polyfill shims."
    );

    fs::write(carrier_mod_dir.join("mod.info"), &mod_info).map_err(|e| e.to_string())?;
    let _ = fs::write(carrier_mod_dir.join("poster.png"), &png_256);
    let _ = fs::write(carrier_mod_dir.join("icon.png"), &png_256);

    // 2. Also populate ALL user Zomboid/mods/ directories for direct in-game local mod list detection!
    for z_dir in &all_user_dirs {
        let local_carrier_dir = z_dir.join("mods").join("PZModStudioCarrier");
        if let Ok(_) = fs::create_dir_all(&local_carrier_dir) {
            let _ = fs::write(local_carrier_dir.join("mod.info"), &mod_info);
            let _ = fs::write(local_carrier_dir.join("poster.png"), &png_256);
            let _ = fs::write(local_carrier_dir.join("icon.png"), &png_256);
            let local_media = local_carrier_dir.join("media").join("lua").join("shared");
            let _ = fs::create_dir_all(&local_media);
            let _ = fs::write(local_media.join("carrier_shim.lua"), "-- PZ Mod Studio Carrier Shim\nif not Z_PZModStudio_Polyfills then Z_PZModStudio_Polyfills = {} end\n");
        }
    }

    // 3. Also populate common install dirs for PZ -debug mode compatibility
    let pz_installs = [
        r"G:\Juegos\steamapps\common\ProjectZomboid",
        r"C:\Program Files (x86)\Steam\steamapps\common\ProjectZomboid",
        r"D:\SteamLibrary\steamapps\common\ProjectZomboid",
        r"E:\SteamLibrary\steamapps\common\ProjectZomboid",
    ];
    for pz_dir in &pz_installs {
        let install_path = Path::new(pz_dir);
        if install_path.exists() {
            for sub in &["Workshop", "media/workshop"] {
                let debug_ws = install_path.join(sub).join("PZModStudioCarrier");
                if let Ok(_) = fs::create_dir_all(debug_ws.join("Contents").join("mods").join("PZModStudioCarrier")) {
                    let _ = fs::write(debug_ws.join("workshop.txt"), &workshop_txt);
                    let _ = fs::write(debug_ws.join("preview.png"), &png_256);
                    let c_mod = debug_ws.join("Contents").join("mods").join("PZModStudioCarrier");
                    let _ = fs::write(c_mod.join("mod.info"), &mod_info);
                    let _ = fs::write(c_mod.join("poster.png"), &png_256);
                    let _ = fs::write(c_mod.join("icon.png"), &png_256);
                }
            }
        }
    }

    Ok(workshop_item_dir.to_string_lossy().to_string())
}

/// Safely removes synthetic patch files for a specific package from disk and removes it from active load order.
pub fn clean_master_patch(req: MasterPatchRequest) -> Result<bool, String> {
    let target_folder_name = req.package_folder_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let mut target_dirs = Vec::new();

    if let (Some(ref carrier_id), Some(ref ws_dir)) = (&req.carrier_workshop_id, &req.workshop_dir) {
        let clean_c = carrier_id.trim();
        if !clean_c.is_empty() && !ws_dir.is_empty() {
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("Contents").join("mods").join(&target_folder_name));
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("mods").join(&target_folder_name));
        }
    }
    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(&req.user_zomboid_dir) {
        target_dirs.push(user_dir.join("mods").join(&target_folder_name));
        target_dirs.push(user_dir.join("Lua").join("mods").join(&target_folder_name));
    }
    if let Some(ref install_dir) = req.pz_install_dir {
        if !install_dir.is_empty() {
            target_dirs.push(Path::new(install_dir).join("mods").join(&target_folder_name));
        }
    }

    for dir in target_dirs {
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
    }

    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            mod_list.active_mods.retain(|id| id != &target_folder_name);
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(true)
}

pub fn get_master_patch_status(user_zomboid_dir: &str, mod_list_ini_path: &str, package_folder_name: Option<String>) -> MasterPatchStatusInfo {
    let target_folder = package_folder_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let clean_sub = target_folder
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim().to_string();

    let candidates = vec![
        target_folder.clone(),
        format!("Z_PZModStudio_{}", clean_sub),
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_")),
    ];

    let all_user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if all_user_dirs.is_empty() {
        return MasterPatchStatusInfo {
            is_packaged: false,
            created_at: None,
            packaged_mods: Vec::new(),
            missing_active_mods: Vec::new(),
            merged_files: Vec::new(),
        };
    }

    let mut meta_path = None;
    let mut actual_folder = candidates[0].clone();

    for user_dir in &all_user_dirs {
        for cand in &candidates {
            let p = user_dir.join("mods").join(cand).join("patch_metadata.json");
            if p.exists() {
                meta_path = Some(p);
                actual_folder = cand.clone();
                break;
            }
        }
        if meta_path.is_some() {
            break;
        }
    }

    let active_mods: Vec<String> = if !mod_list_ini_path.is_empty() {
        read_mod_list_ini(mod_list_ini_path)
            .map(|data| data.active_mods.into_iter().filter(|s| !candidates.contains(s)).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    if let Some(ref m_path) = meta_path {
        if let Ok(content) = fs::read_to_string(m_path) {
            if let Ok(meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                let missing: Vec<String> = active_mods
                    .iter()
                    .cloned()
                    .filter(|id| !meta.packaged_mod_ids.contains(id))
                    .collect();

                return MasterPatchStatusInfo {
                    is_packaged: meta.is_packaged,
                    created_at: Some(meta.created_at),
                    packaged_mods: meta.packaged_mod_ids,
                    merged_files: meta.merged_file_paths,
                    missing_active_mods: missing,
                };
            }
        }
    }

    MasterPatchStatusInfo {
        is_packaged: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
        missing_active_mods: active_mods,
    }
}

pub fn list_merged_packages(user_zomboid_dir: &str, _mod_list_ini_path: &str) -> Vec<MergedPackageInfo> {
    let mut packages = Vec::new();
    let mut seen_folders = std::collections::HashSet::new();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return packages;
    }

    for user_dir in &user_dirs {
        let mods_dir = user_dir.join("mods");
        if !mods_dir.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if folder_name.starts_with("Z_PZModStudio_") && !folder_name.contains("Carrier") {
                        if !seen_folders.insert(folder_name.clone()) {
                            continue;
                        }

                        let display_name = if let Ok(info_str) = fs::read_to_string(path.join("mod.info")) {
                            let mut parsed_name = None;
                            for line in info_str.lines() {
                                let trimmed = line.trim();
                                if trimmed.starts_with("name=") {
                                    let val = trimmed[5..].trim().to_string();
                                    if !val.is_empty() {
                                        parsed_name = Some(val);
                                        break;
                                    }
                                }
                            }
                            parsed_name.unwrap_or_else(|| {
                                let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                                format!("PZ Mod Studio Patch: {}", clean)
                            })
                        } else {
                            let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                            format!("PZ Mod Studio Patch: {}", clean)
                        };

                        let meta_path = path.join("patch_metadata.json");
                        
                        let (is_packaged, created_at, packaged_mods, merged_files) = if meta_path.exists() {
                            if let Ok(content) = fs::read_to_string(&meta_path) {
                                if let Ok(meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                                    (meta.is_packaged, Some(meta.created_at), meta.packaged_mod_ids, meta.merged_file_paths)
                                } else {
                                    (false, None, Vec::new(), Vec::new())
                                }
                            } else {
                                (false, None, Vec::new(), Vec::new())
                            }
                        } else {
                            (false, None, Vec::new(), Vec::new())
                        };

                        packages.push(MergedPackageInfo {
                            folder_name: folder_name.clone(),
                            display_name,
                            mod_id: folder_name,
                            is_packaged,
                            created_at,
                            packaged_mods,
                            merged_files,
                        });
                    }
                }
            }
        }
    }

    packages
}

pub fn create_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, name: &str) -> Result<MergedPackageInfo, String> {
    let clean_sub = name.trim().replace("PZ Mod Studio Patch: ", "").replace(' ', "_");
    if clean_sub.is_empty() {
        return Err("El nombre del paquete no puede estar vacío.".to_string());
    }
    let folder_name = format!("Z_PZModStudio_{}", clean_sub);
    let display_name = format!("PZ Mod Studio Patch: {}", clean_sub.replace('_', " "));

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Directorio Zomboid no válido.".to_string());
    }
    let pkg_dir = user_dirs[0].join("mods").join(&folder_name);
    fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription=Paquete de fusión de compatibilidad sintetizado por PZ Mod Studio.\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.0\r\nauthor=PZ Mod Studio\r\n",
        display_name, folder_name
    );
    let _ = fs::write(pkg_dir.join("mod.info"), &mod_info_content);
    let png_256 = get_preview_png_bytes();
    let _ = fs::write(pkg_dir.join("poster.png"), &png_256);
    let _ = fs::write(pkg_dir.join("icon.png"), &png_256);

    let meta = MasterPatchMetadata {
        is_packaged: false,
        created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default(),
        packaged_mod_ids: Vec::new(),
        merged_file_paths: Vec::new(),
    };
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(pkg_dir.join("patch_metadata.json"), &meta_json);
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            if !mod_list.active_mods.contains(&folder_name) {
                mod_list.active_mods.push(folder_name.clone());
                let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
            }
        }
    }

    Ok(MergedPackageInfo {
        folder_name: folder_name.clone(),
        display_name,
        mod_id: folder_name,
        is_packaged: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

pub fn rename_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, old_folder: &str, new_name: &str) -> Result<MergedPackageInfo, String> {
    let clean_old_sub = old_folder
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_old_sub = clean_old_sub.trim();

    let old_candidates = vec![
        old_folder.to_string(),
        format!("Z_PZModStudio_{}", clean_old_sub),
        format!("Z_PZModStudio_{}", clean_old_sub.replace(' ', "_")),
    ];

    let clean_new_sub = new_name
        .replace("PZ Mod Studio Patch: ", "")
        .trim()
        .replace(' ', "_");
    if clean_new_sub.is_empty() {
        return Err("El nuevo nombre no puede estar vacío.".to_string());
    }
    let new_folder = format!("Z_PZModStudio_{}", clean_new_sub);
    let display_name = format!("PZ Mod Studio Patch: {}", clean_new_sub.replace('_', " "));

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Directorio Zomboid no válido.".to_string());
    }

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription=Paquete de fusión de compatibilidad sintetizado por PZ Mod Studio.\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.0\r\nauthor=PZ Mod Studio\r\n",
        display_name, new_folder
    );

    for dir in &user_dirs {
        for old_target in &old_candidates {
            let old_p = dir.join("mods").join(old_target);
            let new_p = dir.join("mods").join(&new_folder);
            if old_p.exists() {
                let _ = fs::rename(&old_p, &new_p);
                let _ = fs::write(new_p.join("mod.info"), &mod_info_content);
            }
        }
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            for id in &mut mod_list.active_mods {
                if old_candidates.contains(id) {
                    *id = new_folder.clone();
                }
            }
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(MergedPackageInfo {
        folder_name: new_folder.clone(),
        display_name,
        mod_id: new_folder,
        is_packaged: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

fn force_remove_dir_all(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    let _ = force_remove_dir_all(&entry_path);
                } else {
                    if let Ok(metadata) = fs::metadata(&entry_path) {
                        let mut permissions = metadata.permissions();
                        if permissions.readonly() {
                            permissions.set_readonly(false);
                            let _ = fs::set_permissions(&entry_path, permissions);
                        }
                    }
                    let _ = fs::remove_file(&entry_path);
                }
            }
        }
        let _ = fs::remove_dir(path);
    } else {
        if let Ok(metadata) = fs::metadata(path) {
            let mut permissions = metadata.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                let _ = fs::set_permissions(path, permissions);
            }
        }
        let _ = fs::remove_file(path);
    }
    Ok(())
}

pub fn delete_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, folder_name: &str) -> Result<bool, String> {
    let clean_sub = folder_name
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim();

    let candidates = vec![
        folder_name.to_string(),
        format!("Z_PZModStudio_{}", clean_sub),
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_")),
    ];

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for dir in &user_dirs {
        for target in &candidates {
            let _ = force_remove_dir_all(&dir.join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Lua").join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Workshop").join("PZModStudioCarrier").join("Contents").join("mods").join(target));
        }
    }

    // ALSO purge from common Steam install paths and workshop content folders!
    let common_paths = [
        r"G:\Juegos\steamapps\workshop\content\108600\9999999999\mods",
        r"G:\Juegos\steamapps\common\ProjectZomboid\mods",
        r"C:\Program Files (x86)\Steam\steamapps\workshop\content\108600\9999999999\mods",
        r"C:\Program Files (x86)\Steam\steamapps\common\ProjectZomboid\mods",
        r"D:\SteamLibrary\steamapps\workshop\content\108600\9999999999\mods",
        r"D:\SteamLibrary\steamapps\common\ProjectZomboid\mods",
        r"E:\SteamLibrary\steamapps\workshop\content\108600\9999999999\mods",
        r"E:\SteamLibrary\steamapps\common\ProjectZomboid\mods",
    ];
    for cp in &common_paths {
        for target in &candidates {
            let p = Path::new(cp).join(target);
            if p.exists() {
                let _ = force_remove_dir_all(&p);
            }
        }
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            mod_list.active_mods.retain(|id| !candidates.contains(id));
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(true)
}
