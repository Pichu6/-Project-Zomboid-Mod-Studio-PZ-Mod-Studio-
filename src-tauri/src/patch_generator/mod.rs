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

pub fn get_preview_png_bytes() -> Vec<u8> {
    if let Ok(bytes) = fs::read("111.png") {
        return bytes;
    }
    if let Ok(bytes) = fs::read(r"E:\PZ Mod Studio\111.png") {
        return bytes;
    }
    generate_256x256_png_bytes()
}

/// Generates the synthetic master patch mod under Zomboid/mods/Z_PZModStudio_MergedPatch and updates ModListData.ini.
pub fn generate_master_patch(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    let mut target_dirs = Vec::new();
    if let (Some(ref carrier_id), Some(ref ws_dir)) = (&req.carrier_workshop_id, &req.workshop_dir) {
        let clean_c = carrier_id.trim();
        if !clean_c.is_empty() && !ws_dir.is_empty() {
            target_dirs.push(Path::new(ws_dir).join(clean_c).join("mods").join("Z_PZModStudio_MergedPatch"));
        }
    }
    if let Some(ref ws_dir) = req.workshop_dir {
        if !ws_dir.is_empty() {
            target_dirs.push(Path::new(ws_dir).join("9999999999").join("mods").join("Z_PZModStudio_MergedPatch"));
        }
    }
    if !req.user_zomboid_dir.is_empty() {
        target_dirs.push(Path::new(&req.user_zomboid_dir).join("mods").join("Z_PZModStudio_MergedPatch"));
        target_dirs.push(Path::new(&req.user_zomboid_dir).join("Lua").join("mods").join("Z_PZModStudio_MergedPatch"));
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

        fs::write(patch_mod_dir.join("mod.info"), &mod_info_content).map_err(|e| e.to_string())?;
        let _ = fs::write(patch_mod_dir.join("poster.png"), &png_256);
        let _ = fs::write(patch_mod_dir.join("icon.png"), &png_256);

        let media_dir = patch_mod_dir.join("media");
        let _ = fs::create_dir_all(&media_dir);
        let _ = fs::write(media_dir.join("mod.info"), &mod_info_content);
        let _ = fs::write(media_dir.join("poster.png"), &png_256);
        let _ = fs::write(media_dir.join("icon.png"), &png_256);

        for file in &req.merged_files {
            let dest_path = patch_mod_dir.join(&file.relative_path);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(dest_path, &file.content).map_err(|e| e.to_string())?;
            files_written += 1;
        }

        let polyfill_dir = media_dir.join("lua").join("shared");
        fs::create_dir_all(&polyfill_dir).map_err(|e| e.to_string())?;
        fs::write(polyfill_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfill_lua_content).map_err(|e| e.to_string())?;

        let client_override_dir = media_dir.join("lua").join("client").join("OptionScreens");
        fs::create_dir_all(&client_override_dir).map_err(|e| e.to_string())?;
        fs::write(client_override_dir.join("Z_PZModStudio_UIOverride.lua"), ui_override_content).map_err(|e| e.to_string())?;
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

    // 1. Create Zomboid/Workshop/Z_PZModStudio_Carrier (Primary location read by PZ Workshop Upload UI)
    let workshop_item_dir = Path::new(user_zomboid_dir).join("Workshop").join("Z_PZModStudio_Carrier");
    let _ = fs::remove_dir_all(&workshop_item_dir);
    fs::create_dir_all(&workshop_item_dir).map_err(|e| e.to_string())?;

    let workshop_txt = "version=1\r\n\
title=PZ Mod Studio Carrier Patch\r\n\
description=Carrier mod container for PZ Mod Studio 3-Way merges and B42 polyfill shims.\r\n\
tags=\r\n\
visibility=public\r\n";

    fs::write(workshop_item_dir.join("workshop.txt"), workshop_txt).map_err(|e| e.to_string())?;
    let _ = fs::write(workshop_item_dir.join("preview.png"), &png_256);

    let carrier_mod_dir = workshop_item_dir.join("Contents").join("mods").join("Z_PZModStudio_Carrier");
    fs::create_dir_all(&carrier_mod_dir).map_err(|e| e.to_string())?;

    let media_dir = carrier_mod_dir.join("media").join("lua").join("shared");
    fs::create_dir_all(&media_dir).map_err(|e| e.to_string())?;
    let _ = fs::write(media_dir.join("carrier_shim.lua"), "-- PZ Mod Studio Carrier Shim\nif not Z_PZModStudio_Polyfills then Z_PZModStudio_Polyfills = {} end\n");

    let mod_info = "name=PZ Mod Studio Carrier Patch\r\n\
id=Z_PZModStudio_Carrier\r\n\
description=Carrier mod container for PZ Mod Studio 3-Way merges and B42 polyfill shims.\r\n\
poster=poster.png\r\n\
icon=icon.png\r\n\
modversion=1.0.0\r\n\
pzversion=41,42\r\n\
versionMin=41.0\r\n\
versionMax=42.99\r\n\
author=PZ Mod Studio\r\n";

    fs::write(carrier_mod_dir.join("mod.info"), mod_info).map_err(|e| e.to_string())?;
    let _ = fs::write(carrier_mod_dir.join("poster.png"), &png_256);
    let _ = fs::write(carrier_mod_dir.join("icon.png"), &png_256);

    let media_root = carrier_mod_dir.join("media");
    let _ = fs::write(media_root.join("mod.info"), mod_info);
    let _ = fs::write(media_root.join("poster.png"), &png_256);

    // 2. Also create Zomboid/mods/Z_PZModStudio_Carrier as secondary backup
    let local_mods_dir = Path::new(user_zomboid_dir).join("mods").join("Z_PZModStudio_Carrier");
    if let Ok(_) = fs::create_dir_all(&local_mods_dir) {
        let _ = fs::write(local_mods_dir.join("mod.info"), mod_info);
        let _ = fs::write(local_mods_dir.join("poster.png"), &png_256);
        let _ = fs::write(local_mods_dir.join("icon.png"), &png_256);
    }

    Ok(workshop_item_dir.to_string_lossy().to_string())
}
