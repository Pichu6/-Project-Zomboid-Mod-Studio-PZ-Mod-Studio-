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

/// Generates the synthetic master patch mod under Zomboid/mods/Z_PZModStudio_MergedPatch and updates ModListData.ini.
pub fn generate_master_patch(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    let mut target_dirs = Vec::new();
    if let (Some(ref carrier_id), Some(ref ws_dir)) = (&req.carrier_workshop_id, &req.workshop_dir) {
        let clean_c = carrier_id.trim();
        if !clean_c.is_empty() && !ws_dir.is_empty() {
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("Contents").join("mods").join("Z_PZModStudio_Carrier"));
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("mods").join("Z_PZModStudio_Carrier"));
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("mods").join("Z_PZModStudio_MergedPatch"));
        }
    }
    if let Some(ref ws_dir) = req.workshop_dir {
        if !ws_dir.is_empty() {
            target_dirs.push(Path::new(ws_dir).join("9999999999").join("mods").join("Z_PZModStudio_MergedPatch"));
        }
    }
    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(&req.user_zomboid_dir) {
        target_dirs.push(user_dir.join("mods").join("Z_PZModStudio_MergedPatch"));
        target_dirs.push(user_dir.join("Lua").join("mods").join("Z_PZModStudio_MergedPatch"));
    }
    if let Some(ref install_dir) = req.pz_install_dir {
        if !install_dir.is_empty() {
            target_dirs.push(Path::new(install_dir).join("mods").join("Z_PZModStudio_MergedPatch"));
        }
    }

    if target_dirs.is_empty() {
        return Err("No valid Zomboid directories provided to generate master patch.".to_string());
    }

    let primary_dir = target_dirs[0].clone();

    let mut mod_info_content = String::new();
    mod_info_content.push_str("name=Z_PZ Mod Studio Master Patch\r\n");
    mod_info_content.push_str("id=Z_PZModStudio_MergedPatch\r\n");
    mod_info_content.push_str("description=Auto-generated 3-Way compatibility patch and polyfill layer generated by Project Zomboid Mod Studio.\r\n");
    mod_info_content.push_str("poster=poster.png\r\n");
    mod_info_content.push_str("icon=icon.png\r\n");
    mod_info_content.push_str("modversion=1.0.0\r\n");
    mod_info_content.push_str("pzversion=41,42\r\n");
    mod_info_content.push_str("versionMin=41.0\r\n");
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

    polyfill_lua_content.push_str("function Z_PZModStudio_Polyfills.safeGetText(str)\n");
    polyfill_lua_content.push_str("    if not str then return \"\" end\n");
    polyfill_lua_content.push_str("    local clean = string.gsub(str, \"%%\", \"%%%%\")\n");
    polyfill_lua_content.push_str("    if zombie and zombie.core and zombie.core.Translator then\n");
    polyfill_lua_content.push_str("        local status, res = pcall(zombie.core.Translator.getText, clean)\n");
    polyfill_lua_content.push_str("        if status and res then return res end\n");
    polyfill_lua_content.push_str("    end\n");
    polyfill_lua_content.push_str("    return tostring(str)\n");
    polyfill_lua_content.push_str("end\n\n");

    let ui_override_content = r#"-- Z_PZModStudio_UIOverride.lua
-- Takes control of in-game auto-sort button to protect PZ Mod Studio Master Patch load order!

Events.OnMainMenuEnter.Add(function()
    print("[PZ Mod Studio] Active: Taking control of load order management.")
    
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

    // Update ModListData.ini to place Z_PZModStudio_MergedPatch at the end of load order
    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            let patch_id = "Z_PZModStudio_MergedPatch".to_string();
            mod_list.active_mods.retain(|id| id != &patch_id);
            mod_list.active_mods.push(patch_id);
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);
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

        let local_master_dir = z_dir.join("mods").join("Z_PZModStudio_MergedPatch");
        if let Ok(_) = fs::create_dir_all(&local_master_dir) {
            let master_info = format!(
                "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\nauthor=PZ Mod Studio\r\n",
                "Z_PZModStudio Master Patch",
                "Z_PZModStudio_MergedPatch",
                "Auto-generated 3-Way compatibility patch and polyfill layer generated by Project Zomboid Mod Studio."
            );
            let _ = fs::write(local_master_dir.join("mod.info"), &master_info);
            let _ = fs::write(local_master_dir.join("poster.png"), &png_256);
            let _ = fs::write(local_master_dir.join("icon.png"), &png_256);
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
