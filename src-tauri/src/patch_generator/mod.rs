use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use crate::load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini};

pub const PACKAGE_PREFIX: &str = "Z_PZModStudio_";
pub const BRIDGE_FOLDER: &str = "Z_PZModStudio_Bridge";

/// Maps a package name ("My Patch", "PZ Mod Studio Patch: My Patch" or "Z_PZModStudio_My_Patch")
/// to its folder name, and refuses anything that is not one plain folder name inside the
/// Z_PZModStudio_ namespace. Every function that creates, writes or deletes a package folder
/// goes through this, so an empty name, ".." or a path can never reach fs::remove_dir_all.
pub fn to_package_folder(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let folder = if trimmed.starts_with(PACKAGE_PREFIX) {
        trimmed.to_string()
    } else {
        let sub = trimmed.replace("PZ Mod Studio Patch: ", "");
        format!("{}{}", PACKAGE_PREFIX, sub.trim().replace(' ', "_"))
    };
    let suffix = &folder[PACKAGE_PREFIX.len()..];
    let invalid = suffix.is_empty()
        || suffix.chars().all(|c| c == '.' || c == '_')
        || folder.ends_with('.')
        || folder.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c));
    if invalid {
        return Err(format!("Invalid package name: '{}'", raw));
    }
    Ok(folder)
}

/// Joins a relative path taken from a request or an imported file onto `base`, refusing
/// absolute paths, drive prefixes and `..` so the result always stays inside `base`.
pub fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative.trim());
    let mut has_normal = false;
    for comp in rel.components() {
        match comp {
            Component::Normal(part) => {
                if part.to_string_lossy().contains(':') {
                    return Err(format!("Unsafe file path: '{}'", relative));
                }
                has_normal = true;
            }
            Component::CurDir => {}
            _ => return Err(format!("Unsafe file path: '{}'", relative)),
        }
    }
    if !has_normal {
        return Err(format!("Empty file path: '{}'", relative));
    }
    Ok(base.join(rel))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedFilePayload {
    pub relative_path: String, // e.g. "media/lua/client/ISUI/ISInventoryPane.lua"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchRequest {
    pub workshop_dir: Option<String>,
    pub pz_install_dir: Option<String>,
    pub user_zomboid_dir: String,
    pub mod_list_ini_path: String,
    pub merged_files: Vec<MergedFilePayload>,
    pub package_folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedPackageInfo {
    pub folder_name: String,
    pub display_name: String,
    pub mod_id: String,
    pub description: Option<String>,
    pub is_packaged: bool,
    pub is_active_in_modlist: bool,
    pub is_companion_bridge: bool,
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
    /// Whether the Build 42 compatibility shim was written into the package.
    pub polyfill_shim_written: bool,
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

/// The picture every generated package shows in the game's mod list. Compiled in, so it does not
/// depend on where the Studio was started from: it used to be read from the working directory,
/// which meant a stray file of that name next to the exe became the poster.
static EMBEDDED_PREVIEW_PNG: &[u8] = include_bytes!("../../../assets/package-poster.png");

pub fn get_preview_png_bytes() -> Vec<u8> {
    EMBEDDED_PREVIEW_PNG.to_vec()
}

/// The canonical copy lives in mods/Z_PZModStudio_Bridge; it is compiled in so the
/// installer and generated packages always ship exactly what is in the repo.
pub const MASTER_POLYFILL_LUA: &str =
    include_str!("../../../mods/Z_PZModStudio_Bridge/media/lua/shared/Z_PZModStudio_Polyfills.lua");

pub fn generate_master_polyfill_lua() -> String {
    MASTER_POLYFILL_LUA.to_string()
}

/// Generates a synthetic master patch mod under Zomboid/mods/<package_folder_name> and updates ModListData.ini.
pub fn generate_master_patch(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    let pkg_name = req.package_folder_name
        .clone()
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let clean_pkg_name = to_package_folder(&pkg_name)?;

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

    // Refuse the whole request up front if any path would escape the package folder.
    for file in &req.merged_files {
        safe_join(&primary_dir, &file.relative_path)?;
    }

    let mut mod_info_content = String::new();
    mod_info_content.push_str(&format!("name=PZ Mod Studio Patch: {}\r\n", display_name));
    mod_info_content.push_str(&format!("id={}\r\n", clean_pkg_name));
    mod_info_content.push_str("description=Auto-generated compatibility patch package generated by Project Zomboid Mod Studio.\r\n");
    mod_info_content.push_str("poster=poster.png\r\n");
    mod_info_content.push_str("icon=icon.png\r\n");
    mod_info_content.push_str("modversion=1.0.0\r\n");
    mod_info_content.push_str("pzversion=41,42\r\n");
    mod_info_content.push_str("versionMin=41.00\r\n");
    mod_info_content.push_str("author=PZ Mod Studio\r\n");

    let mut files_written = 0;

    let polyfill_lua_content = generate_master_polyfill_lua();
    
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

        // Purge old media and 42 directories so obsolete/removed shims never linger on disk
        let _ = fs::remove_dir_all(patch_mod_dir.join("media"));
        let _ = fs::remove_dir_all(patch_mod_dir.join("42"));

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
            if file.relative_path.contains("sandbox-options.txt") || file.content.starts_with("-- vanilla file not present") {
                continue;
            }
            let dest_path = safe_join(&patch_mod_dir, &file.relative_path)?;
            if let Some(parent) = dest_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&dest_path, &file.content);

            let dest_42_path = safe_join(&dir_42, &file.relative_path)?;
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

    // 2. Update ModListData.ini to place clean_pkg_name at the end of load order and remove any other synthetic packages
    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            // Other packages are the user's and stay. Only this one moves, to the end, where a
            // patch has to be to win.
            mod_list.active_mods.retain(|id| id != &clean_pkg_name);
            mod_list.active_mods.push(clean_pkg_name.clone());
            // The Mod List reads the saved order, not default.txt, so put the package there too:
            // without this it comes back as disabled and the next toggle drops it again.
            remember_package_in_saved_order(&req.user_zomboid_dir, &clean_pkg_name, &mod_list.active_mods);
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);

            // Write patch_metadata.json for the newly active published package
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

            // CRITICAL: Persist all merged files into draft_resolutions.json so they stay RESOLVED when unpackaged/reopened!
            let mut draft_resolutions = get_draft_resolutions(&req.user_zomboid_dir, &clean_pkg_name);
            for file in &req.merged_files {
                draft_resolutions.insert(
                    file.relative_path.clone(),
                    DraftResolutionItem {
                        relative_path: file.relative_path.clone(),
                        resolved_content: file.content.clone(),
                        status: "RESOLVED".to_string(),
                    },
                );
            }
            if let Ok(draft_json) = serde_json::to_string_pretty(&draft_resolutions) {
                for patch_dir in &target_dirs {
                    let _ = fs::write(patch_dir.join("draft_resolutions.json"), &draft_json);
                }
            }
        }
    }

    Ok(MasterPatchResult {
        success: true,
        patch_mod_dir: primary_dir.to_string_lossy().to_string(),
        files_written,
        polyfill_shim_written: true,
    })
}

/// Safely removes synthetic patch files for a specific package from disk and removes it from active load order.
pub fn clean_master_patch(req: MasterPatchRequest) -> Result<bool, String> {
    let target_folder_name = to_package_folder(
        req.package_folder_name
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Z_PZModStudio_MergedPatch"),
    )?;
    if target_folder_name == BRIDGE_FOLDER {
        return Err(format!("The companion mod '{}' cannot be cleaned.", BRIDGE_FOLDER));
    }

    let mut target_dirs = Vec::new();

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
            // Remove published compiled outputs (media and 42)
            let _ = fs::remove_dir_all(dir.join("media"));
            let _ = fs::remove_dir_all(dir.join("42"));

            // Mark package_metadata.json as is_packaged = false (DRAFT mode)
            let meta_path = dir.join("patch_metadata.json");
            if meta_path.exists() {
                if let Ok(content) = fs::read_to_string(&meta_path) {
                    if let Ok(mut meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                        meta.is_packaged = false;
                        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                            let _ = fs::write(&meta_path, &new_json);
                        }
                    }
                }
            }
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

    'outer: for user_dir in &all_user_dirs {
        for cand in &candidates {
            let p = user_dir.join("mods").join(cand).join("patch_metadata.json");
            if p.exists() {
                meta_path = Some(p);
                break 'outer;
            }
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

pub fn get_active_mod_ids_from_disk(user_zomboid_dir: &str, mod_list_ini_path: &str) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();

    // 1. Check PZModStudio_MasterLoadOrder.json in user_dirs
    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for u_dir in &user_dirs {
        let master_json_path = u_dir.join("PZModStudio_MasterLoadOrder.json");
        if master_json_path.exists() {
            if let Ok(content) = fs::read_to_string(&master_json_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(arr) = parsed.get("active_mod_ids").and_then(|v| v.as_array()) {
                        for item in arr {
                            if let Some(s) = item.as_str() {
                                set.insert(s.to_string());
                            }
                        }
                        if !set.is_empty() {
                            return set;
                        }
                    }
                }
            }
        }

        // 2. Check active profile in PZModStudio_Profiles
        let profiles_dir = u_dir.join("PZModStudio_Profiles");
        if profiles_dir.exists() {
            if let Ok(entries) = fs::read_dir(&profiles_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.extension().and_then(|s| s.to_str()) == Some("json") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            if let Ok(inst) = serde_json::from_str::<crate::instance_manager::AppInstance>(&content) {
                                if inst.is_active {
                                    for id in inst.active_mod_ids {
                                        set.insert(id);
                                    }
                                    if !set.is_empty() {
                                        return set;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Check mod_list_ini_path / ModListData.ini
    if !mod_list_ini_path.is_empty() {
        if let Ok(data) = read_mod_list_ini(mod_list_ini_path) {
            for id in data.active_mods {
                set.insert(id);
            }
            if !set.is_empty() {
                return set;
            }
        }
    }

    for u_dir in &user_dirs {
        for candidate_ini in &[u_dir.join("ModListData.ini"), u_dir.join("mods").join("ModListData.ini")] {
            if candidate_ini.exists() {
                if let Ok(data) = read_mod_list_ini(&candidate_ini.to_string_lossy()) {
                    for id in data.active_mods {
                        set.insert(id);
                    }
                    if !set.is_empty() {
                        return set;
                    }
                }
            }
        }

        // 4. Check mods.txt
        let mods_txt = u_dir.join("mods.txt");
        if mods_txt.exists() {
            if let Ok(content) = fs::read_to_string(&mods_txt) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('#') {
                        set.insert(trimmed.to_string());
                    }
                }
                if !set.is_empty() {
                    return set;
                }
            }
        }
    }

    set
}

pub fn list_merged_packages(user_zomboid_dir: &str, _mod_list_ini_path: &str) -> Vec<MergedPackageInfo> {
    let mut packages = Vec::new();
    let mut seen_folders = std::collections::HashSet::new();

    let mut candidate_dirs = Vec::new();
    let clean_user = user_zomboid_dir.trim();
    if !clean_user.is_empty() {
        let p = PathBuf::from(clean_user);
        if p.exists() {
            candidate_dirs.push(p.clone());
            candidate_dirs.push(p.join("mods"));
        }
    }
    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir) {
        if user_dir.exists() {
            candidate_dirs.push(user_dir.clone());
        }
        let m_dir = user_dir.join("mods");
        if m_dir.exists() {
            candidate_dirs.push(m_dir);
        }
    }

    if let Some(home) = dirs_next::home_dir() {
        let h1 = home.join("Zomboid").join("mods");
        if h1.exists() { candidate_dirs.push(h1); }
        let h2 = home.join("Documents").join("Zomboid").join("mods");
        if h2.exists() { candidate_dirs.push(h2); }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p1 = PathBuf::from(profile).join("Zomboid").join("mods");
        if p1.exists() { candidate_dirs.push(p1); }
    }

    let detected_paths = crate::vfs::auto_detect_paths();
    if !detected_paths.workshop_dir.is_empty() {
        let ws_mods = Path::new(&detected_paths.workshop_dir).join("mods");
        if ws_mods.exists() {
            candidate_dirs.push(ws_mods);
        }
    }

    for mods_dir in &candidate_dirs {
        if let Ok(entries) = fs::read_dir(mods_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if folder_name.starts_with("Z_PZModStudio_") && !folder_name.contains("Carrier") {
                        if !seen_folders.insert(folder_name.clone()) {
                            continue;
                        }

                        let is_companion_bridge = folder_name == "Z_PZModStudio_Bridge";

                        let mut parsed_desc = None;
                        let display_name = if is_companion_bridge {
                            parsed_desc = Some("Official companion mod for live game control, command execution, and AI agent communication.".to_string());
                            "PZ Mod Studio Live Bridge (Companion Mod)".to_string()
                        } else if let Ok(info_str) = fs::read_to_string(path.join("mod.info")) {
                            let mut parsed_name = None;
                            for line in info_str.lines() {
                                let trimmed = line.trim();
                                if trimmed.starts_with("name=") {
                                    let val = trimmed[5..].trim().to_string();
                                    if !val.is_empty() {
                                        let clean = val
                                            .replace("PZ Mod Studio Patch: ", "")
                                            .replace("PZ Mod Studio Patch:", "")
                                            .replace("Z_PZModStudio_", "");
                                        parsed_name = Some(clean.trim().replace('_', " "));
                                    }
                                } else if trimmed.starts_with("description=") {
                                    let val = trimmed[12..].trim().to_string();
                                    if !val.is_empty() {
                                        parsed_desc = Some(val);
                                    }
                                }
                            }
                            parsed_name.unwrap_or_else(|| {
                                let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                                clean
                            })
                        } else {
                            let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                            clean
                        };

                        let meta_path = path.join("patch_metadata.json");
                        
                        let (is_packaged, created_at, packaged_mods, merged_files, meta_visible, meta_desc) = if meta_path.exists() {
                            if let Ok(content) = fs::read_to_string(&meta_path) {
                                if let Ok(meta_json) = serde_json::from_str::<serde_json::Value>(&content) {
                                    let is_pkg = meta_json["is_packaged"].as_bool().unwrap_or(false);
                                    let created = meta_json["created_at"].as_str().map(|s| s.to_string());
                                    let mods = meta_json["packaged_mod_ids"]
                                        .as_array()
                                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                        .unwrap_or_default();
                                    let files = meta_json["merged_file_paths"]
                                        .as_array()
                                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                        .unwrap_or_default();
                                    let vis = meta_json.get("is_visible_in_modlist").and_then(|v| v.as_bool());
                                    let desc = meta_json.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    (is_pkg, created, mods, files, vis, desc)
                                } else {
                                    (false, None, Vec::new(), Vec::new(), None, None)
                                }
                            } else {
                                (false, None, Vec::new(), Vec::new(), None, None)
                            }
                        } else {
                            (false, None, Vec::new(), Vec::new(), None, None)
                        };

                        let description = parsed_desc.or(meta_desc);
                        let is_active_in_modlist = meta_visible.unwrap_or(true);

                        packages.push(MergedPackageInfo {
                            folder_name: folder_name.clone(),
                            display_name,
                            mod_id: folder_name,
                            description,
                            is_packaged,
                            is_active_in_modlist,
                            is_companion_bridge,
                            created_at,
                            packaged_mods,
                            merged_files,
                        });
                    }
                }
            }
        }
    }

    packages.sort_by(|a, b| {
        if a.is_companion_bridge != b.is_companion_bridge {
            a.is_companion_bridge.cmp(&b.is_companion_bridge)
        } else {
            a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase())
        }
    });

    packages
}

pub fn create_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, name: &str, description: Option<&str>) -> Result<MergedPackageInfo, String> {
    if name.trim().is_empty() {
        return Err("Package name cannot be empty.".to_string());
    }
    let folder_name = to_package_folder(name)?;
    if folder_name == BRIDGE_FOLDER {
        return Err(format!("'{}' is reserved for the companion mod.", BRIDGE_FOLDER));
    }
    let clean_sub = folder_name[PACKAGE_PREFIX.len()..].to_string();
    let display_name = clean_sub.replace('_', " ");
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);
    let final_desc = description.unwrap_or("Compatibility merge package synthesized by PZ Mod Studio.").trim();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Invalid Zomboid directory.".to_string());
    }
    let pkg_dir = user_dirs[0].join("mods").join(&folder_name);
    fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, folder_name, final_desc
    );
    let _ = fs::write(pkg_dir.join("mod.info"), &mod_info_content);
    let png_256 = get_preview_png_bytes();
    let _ = fs::write(pkg_dir.join("poster.png"), &png_256);
    let _ = fs::write(pkg_dir.join("icon.png"), &png_256);

    let meta = serde_json::json!({
        "is_packaged": false,
        "is_visible_in_modlist": true,
        "description": final_desc,
        "created_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default(),
        "packaged_mod_ids": [],
        "merged_file_paths": []
    });
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(pkg_dir.join("patch_metadata.json"), &meta_json);
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            mod_list.active_mods.retain(|id| id != &folder_name);
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(MergedPackageInfo {
        folder_name: folder_name.clone(),
        display_name,
        mod_id: folder_name,
        description: Some(final_desc.to_string()),
        is_packaged: false,
        is_active_in_modlist: true,
        is_companion_bridge: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

pub fn rename_merged_package(
    user_zomboid_dir: &str,
    mod_list_ini_path: &str,
    old_folder: &str,
    new_name: &str,
    new_description: Option<&str>,
) -> Result<MergedPackageInfo, String> {
    let old_candidates = package_folder_candidates(old_folder)?;

    if new_name.trim().is_empty() {
        return Err("The new name cannot be empty.".to_string());
    }
    let new_folder = to_package_folder(new_name)?;
    if new_folder == BRIDGE_FOLDER {
        return Err(format!("'{}' is reserved for the companion mod.", BRIDGE_FOLDER));
    }
    let clean_new_sub = new_folder[PACKAGE_PREFIX.len()..].to_string();
    let display_name = clean_new_sub.replace('_', " ");
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);
    let final_desc = new_description.unwrap_or("Compatibility merge package synthesized by PZ Mod Studio.").trim();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Invalid Zomboid directory.".to_string());
    }

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, new_folder, final_desc
    );

    for dir in &user_dirs {
        for old_target in &old_candidates {
            let old_p = dir.join("mods").join(old_target);
            let new_p = dir.join("mods").join(&new_folder);
            if old_p.exists() {
                let _ = fs::rename(&old_p, &new_p);
                let _ = fs::write(new_p.join("mod.info"), &mod_info_content);
                let meta_path = new_p.join("patch_metadata.json");
                if meta_path.exists() {
                    if let Ok(meta_str) = fs::read_to_string(&meta_path) {
                        if let Ok(mut meta_json) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                            meta_json["description"] = serde_json::json!(final_desc);
                            let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta_json).unwrap_or_default());
                        }
                    }
                }
            }
        }
    }

    let mut is_active = false;
    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            for id in &mut mod_list.active_mods {
                if old_candidates.contains(id) {
                    *id = new_folder.clone();
                    is_active = true;
                }
            }
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(MergedPackageInfo {
        folder_name: new_folder.clone(),
        display_name,
        mod_id: new_folder,
        description: Some(final_desc.to_string()),
        is_packaged: false,
        is_active_in_modlist: is_active,
        is_companion_bridge: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

pub fn toggle_package_in_modlist(
    user_zomboid_dir: &str,
    mod_list_ini_path: &str,
    folder_name: &str,
    enabled: bool,
) -> Result<bool, String> {
    let clean_sub = folder_name
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim();

    let target_id = if folder_name.starts_with("Z_PZModStudio_") {
        folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);

    // 1. Write is_visible_in_modlist to patch_metadata.json
    for u_dir in &user_dirs {
        for cand in &[target_id.clone(), folder_name.to_string()] {
            let pkg_dir = u_dir.join("mods").join(cand);
            if pkg_dir.exists() {
                let meta_path = pkg_dir.join("patch_metadata.json");
                let mut meta_json = if meta_path.exists() {
                    fs::read_to_string(&meta_path)
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .unwrap_or_else(|| serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };
                meta_json["is_visible_in_modlist"] = serde_json::json!(enabled);
                let _ = fs::write(meta_path, serde_json::to_string_pretty(&meta_json).unwrap_or_default());
            }
        }
    }

    // 2. If disabled (hidden from ModList), remove from active_mods so it's not active while hidden
    if !enabled {
        // Read the list in order: a HashSet here used to shuffle the player's whole load order.
        let mut active_mods: Vec<String> = crate::load_order::ini_parser::read_mod_list_ini(mod_list_ini_path)
            .map(|d| d.active_mods)
            .unwrap_or_else(|_| {
                get_active_mod_ids_from_disk(user_zomboid_dir, mod_list_ini_path).into_iter().collect()
            });
        let initial_len = active_mods.len();
        active_mods.retain(|id| id != &target_id && id != folder_name);

        if active_mods.len() != initial_len {
            let mut load_order: Vec<String> = Vec::new();
            for u_dir in &user_dirs {
                let master_json_path = u_dir.join("PZModStudio_MasterLoadOrder.json");
                if master_json_path.exists() {
                    if let Ok(content) = fs::read_to_string(&master_json_path) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(arr) = parsed.get("load_order").and_then(|v| v.as_array()) {
                                for item in arr {
                                    if let Some(s) = item.as_str() {
                                        load_order.push(s.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _ = crate::instance_manager::save_master_load_order(user_zomboid_dir.to_string(), load_order, active_mods);
        }
    }

    Ok(true)
}

/// Deletes a folder tree, clearing read-only flags on the way. Symlinks and junctions are
/// removed as links: their targets (which may be a real mod or a whole drive) are never walked.
fn force_remove_dir_all(path: &Path) -> std::io::Result<()> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if meta.file_type().is_symlink() || is_reparse_point(&meta) {
        // A directory link (junction or dir symlink) is removed with remove_dir on Windows.
        return fs::remove_dir(path).or_else(|_| fs::remove_file(path));
    }
    if meta.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let _ = force_remove_dir_all(&entry.path());
            }
        }
        let _ = fs::remove_dir(path);
    } else {
        let mut permissions = meta.permissions();
        if permissions.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_meta: &fs::Metadata) -> bool {
    false
}

/// The folder names a package may be stored under (older versions kept spaces in the name).
/// Only names that pass `to_package_folder` are returned, so callers can delete them safely.
fn package_folder_candidates(folder_name: &str) -> Result<Vec<String>, String> {
    let primary = to_package_folder(folder_name)?;
    let mut candidates = vec![primary.clone()];
    let sub = primary[PACKAGE_PREFIX.len()..].to_string();
    for alt in [format!("{}{}", PACKAGE_PREFIX, sub.replace('_', " "))] {
        if !candidates.contains(&alt) && to_package_folder(&alt).as_deref() == Ok(alt.as_str()) {
            candidates.push(alt);
        }
    }
    if candidates.iter().any(|c| c == BRIDGE_FOLDER) {
        return Err(format!("The companion mod '{}' is an internal system component.", BRIDGE_FOLDER));
    }
    Ok(candidates)
}

pub fn delete_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, folder_name: &str) -> Result<bool, String> {
    let candidates = package_folder_candidates(folder_name)?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for dir in &user_dirs {
        for target in &candidates {
            let _ = force_remove_dir_all(&dir.join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Lua").join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Workshop").join("PZModStudioCarrier").join("Contents").join("mods").join(target));
        }
    }

    // Also remove from dynamically detected installation and workshop folders
    let detected_paths = crate::vfs::auto_detect_paths();
    let mut extra_dirs = Vec::new();
    if !detected_paths.pz_install_dir.is_empty() {
        extra_dirs.push(Path::new(&detected_paths.pz_install_dir).join("mods"));
    }
    if !detected_paths.workshop_dir.is_empty() {
        extra_dirs.push(Path::new(&detected_paths.workshop_dir).join("mods"));
    }
    for extra_dir in extra_dirs {
        for target in &candidates {
            let p = extra_dir.join(target);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftResolutionItem {
    pub relative_path: String,
    pub resolved_content: String,
    pub status: String,
}

pub fn save_draft_resolution(
    user_zomboid_dir: &str,
    package_folder_name: &str,
    relative_path: &str,
    resolved_content: &str,
    status: &str,
) -> Result<bool, String> {
    let clean_pkg_name = to_package_folder(package_folder_name)?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    let _ = fs::create_dir_all(&pkg_dir);
    let draft_file = pkg_dir.join("draft_resolutions.json");

    let mut resolutions: std::collections::HashMap<String, DraftResolutionItem> = if draft_file.exists() {
        fs::read_to_string(&draft_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    resolutions.insert(
        relative_path.to_string(),
        DraftResolutionItem {
            relative_path: relative_path.to_string(),
            resolved_content: resolved_content.to_string(),
            status: status.to_string(),
        },
    );

    let json_str = serde_json::to_string_pretty(&resolutions).map_err(|e| e.to_string())?;
    fs::write(draft_file, json_str).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_draft_resolutions(
    user_zomboid_dir: &str,
    package_folder_name: &str,
) -> std::collections::HashMap<String, DraftResolutionItem> {
    let Ok(clean_pkg_name) = to_package_folder(package_folder_name) else {
        return std::collections::HashMap::new();
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return std::collections::HashMap::new();
    }

    let draft_file = user_dirs[0].join("mods").join(&clean_pkg_name).join("draft_resolutions.json");
    if draft_file.exists() {
        fs::read_to_string(&draft_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    }
}

pub fn clear_draft_resolutions(
    user_zomboid_dir: &str,
    package_folder_name: &str,
) -> Result<bool, String> {
    let clean_pkg_name = to_package_folder(package_folder_name)?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for u_dir in user_dirs {
        let draft_file = u_dir.join("mods").join(&clean_pkg_name).join("draft_resolutions.json");
        if draft_file.exists() {
            // These are hand-written merges: keep a copy before throwing them away, the way the
            // mod list does.
            if let Ok(text) = fs::read_to_string(&draft_file) {
                let backups = u_dir.join("PZModStudio_Backups");
                let _ = fs::create_dir_all(&backups);
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = fs::write(backups.join(format!("{}.merges.{}.json", clean_pkg_name, stamp)), text);
            }
            let _ = fs::remove_file(draft_file);
        }
    }
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedMergedPackage {
    pub format_version: u32,
    pub folder_name: String,
    pub display_name: String,
    pub created_at: String,
    pub is_packaged: bool,
    pub packaged_mod_ids: Vec<String>,
    pub draft_resolutions: std::collections::HashMap<String, DraftResolutionItem>,
    pub merged_files: Vec<MergedFilePayload>,
}

pub fn export_merged_package(
    user_zomboid_dir: &str,
    package_folder_name: &str,
    target_file_path: &str,
) -> Result<bool, String> {
    let clean_pkg_name = to_package_folder(package_folder_name)?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    if !pkg_dir.exists() {
        return Err(format!("The package '{}' does not exist on disk.", clean_pkg_name));
    }

    let meta_path = pkg_dir.join("patch_metadata.json");
    let (is_packaged, created_at, packaged_mods) = if meta_path.exists() {
        if let Ok(content) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                (meta.is_packaged, meta.created_at, meta.packaged_mod_ids)
            } else {
                (false, String::new(), Vec::new())
            }
        } else {
            (false, String::new(), Vec::new())
        }
    } else {
        (false, String::new(), Vec::new())
    };

    let draft_resolutions = get_draft_resolutions(user_zomboid_dir, &clean_pkg_name);

    let display_name = clean_pkg_name["Z_PZModStudio_".len()..].replace('_', " ");

    let mut merged_files = Vec::new();
    let media_dir = pkg_dir.join("media");
    if media_dir.exists() {
        for entry in walkdir::WalkDir::new(&media_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(rel) = entry.path().strip_prefix(&pkg_dir) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        merged_files.push(MergedFilePayload {
                            relative_path: rel_str,
                            content,
                        });
                    }
                }
            }
        }
    }

    let export_payload = ExportedMergedPackage {
        format_version: 1,
        folder_name: clean_pkg_name,
        display_name,
        created_at,
        is_packaged,
        packaged_mod_ids: packaged_mods,
        draft_resolutions,
        merged_files,
    };

    let json_str = serde_json::to_string_pretty(&export_payload).map_err(|e| e.to_string())?;
    fs::write(target_file_path, json_str).map_err(|e| e.to_string())?;

    Ok(true)
}

pub fn import_merged_package(
    user_zomboid_dir: &str,
    _mod_list_ini_path: &str,
    source_file_path: &str,
) -> Result<MergedPackageInfo, String> {
    if source_file_path.ends_with(".pzpack") {
        return Err("This file is a Collection Preset (.pzpack), not a Merge Package (.pzmerge). To import mod list presets, go to 'Mod List' > 'Presets' > 'Import .pzpack'.".to_string());
    }

    let content = fs::read_to_string(source_file_path).map_err(|e| format!("Error reading file: {}", e))?;

    if content.contains("\"load_order\"") && !content.contains("\"merged_files\"") {
        return Err("This file corresponds to a Mod List Preset (.pzpack). Please import it from the 'Mod List' tab.".to_string());
    }

    let imported: ExportedMergedPackage = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid .pzmerge package format: {}", e))?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let clean_folder = to_package_folder(&imported.folder_name)?;
    if clean_folder == BRIDGE_FOLDER {
        return Err("A .pzmerge package cannot replace the companion mod 'Z_PZModStudio_Bridge'.".to_string());
    }
    if imported.merged_files.is_empty() {
        return Err(
            "This package has no merged files in it — whoever exported it had not published it yet, \
             so there is nothing to install. Ask them to press Package & Publish and export again."
                .to_string(),
        );
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_folder);

    // Check every path in the (untrusted) file before anything is written.
    let mut file_targets = Vec::with_capacity(imported.merged_files.len());
    for file in &imported.merged_files {
        let dest = safe_join(&pkg_dir, &file.relative_path)?;
        let dest_42 = safe_join(&pkg_dir.join("42"), &file.relative_path)?;
        file_targets.push((dest, dest_42, &file.content));
    }

    fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;

    // The name ends up in mod.info, one key per line: keep it on one line.
    let display_name: String = imported.display_name.chars().filter(|c| !c.is_control()).collect();
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription=Compatibility merge package synthesized by PZ Mod Studio.\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, clean_folder
    );
    let _ = fs::write(pkg_dir.join("mod.info"), &mod_info_content);
    let png_256 = get_preview_png_bytes();
    let _ = fs::write(pkg_dir.join("poster.png"), &png_256);
    let _ = fs::write(pkg_dir.join("icon.png"), &png_256);

    // A merge package is vanilla files rewritten with other mods' code spliced in. Without
    // those mods the game runs code that refers to things that are not there, so the import
    // reports what is missing rather than letting it fail in game.
    let installed: std::collections::HashSet<String> = crate::catalog::build_catalog(
        "",
        user_zomboid_dir,
        None,
    )
    .mods
    .iter()
    .map(|m| m.id.to_lowercase())
    .collect();
    let missing: Vec<String> = imported
        .packaged_mod_ids
        .iter()
        .filter(|id| !id.starts_with("Z_PZModStudio_") && !installed.contains(&id.to_lowercase()))
        .cloned()
        .collect();

    let meta = MasterPatchMetadata {
        // Whoever built it says it is published; on this machine it has not been checked
        // against anything, so it starts as a draft until the user publishes it here.
        is_packaged: false,
        created_at: if imported.created_at.is_empty() {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default()
        } else {
            imported.created_at.clone()
        },
        packaged_mod_ids: imported.packaged_mod_ids.clone(),
        merged_file_paths: imported.merged_files.iter().map(|f| f.relative_path.clone()).collect(),
    };
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(pkg_dir.join("patch_metadata.json"), &meta_json);
    }

    if let Ok(draft_json) = serde_json::to_string_pretty(&imported.draft_resolutions) {
        let _ = fs::write(pkg_dir.join("draft_resolutions.json"), &draft_json);
    }

    // Write merged files to disk (top level and the 42/ subfolder for native B42 compatibility)
    for (dest, dest_42, content) in file_targets {
        for target in [dest, dest_42] {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(target, content);
        }
    }

    let description = if missing.is_empty() {
        "Imported merge package. Check it in the Mod Merger, then publish it here.".to_string()
    } else {
        format!(
            "Imported merge package. It patches {} mod(s) you do not have ({}), so parts of it              will not work until you install them. Check it in the Mod Merger before playing.",
            missing.len(),
            missing.join(", ")
        )
    };

    Ok(MergedPackageInfo {
        folder_name: clean_folder.clone(),
        display_name,
        mod_id: clean_folder,
        // It has not been published on this machine yet, whatever the file claims.
        is_packaged: false,
        description: Some(description),
        is_active_in_modlist: false,
        is_companion_bridge: false,
        created_at: Some(meta.created_at),
        packaged_mods: imported.packaged_mod_ids,
        merged_files: imported.merged_files.iter().map(|f| f.relative_path.clone()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn test_validate_polyfill_lua_ast() {
        let poly_content = generate_master_polyfill_lua();
        let parse_result = crate::diff_engine::lua::validate_lua_syntax(&poly_content);
        assert!(parse_result.is_valid, "generate_master_polyfill_lua() must be valid Lua syntax: {:?}", parse_result.error_message);
    }

    #[test]
    fn test_master_polyfill_contains_core_patches() {
        // Tests must never write into a real Zomboid folder: only check the generated text.
        let poly_content = generate_master_polyfill_lua();
        assert!(poly_content.contains("IGUI_ItemCat_GunMag"));
        assert!(poly_content.contains("sanitizeAllScriptItems") || poly_content.contains("getAllItems"));
        assert!(poly_content.contains("BWORoomPrograms"));
        assert!(poly_content.contains("IsoDoor"));
    }

    #[test]
    fn package_folder_names_are_confined_to_the_namespace() {
        assert_eq!(to_package_folder("My Patch").unwrap(), "Z_PZModStudio_My_Patch");
        assert_eq!(to_package_folder("PZ Mod Studio Patch: My Patch").unwrap(), "Z_PZModStudio_My_Patch");
        assert_eq!(to_package_folder("Z_PZModStudio_pack_1").unwrap(), "Z_PZModStudio_pack_1");
        assert_eq!(to_package_folder("Parche Armas ñ").unwrap(), "Z_PZModStudio_Parche_Armas_ñ");
        for bad in ["", "   ", "..", "Z_PZModStudio_", "Z_PZModStudio_..", "../Saves", "a/b", "a\\b", "C:", "x\0y", "name."] {
            assert!(to_package_folder(bad).is_err(), "accepted {:?}", bad);
        }
    }

    #[test]
    fn bridge_cannot_be_deleted_or_renamed() {
        assert!(package_folder_candidates("Z_PZModStudio_Bridge").is_err());
        assert!(package_folder_candidates("Bridge").is_err());
        assert!(package_folder_candidates("").is_err());
        assert!(package_folder_candidates("..").is_err());
        let ok = package_folder_candidates("My Patch").unwrap();
        assert_eq!(ok, vec!["Z_PZModStudio_My_Patch", "Z_PZModStudio_My Patch"]);
    }

    #[test]
    fn safe_join_rejects_escaping_paths() {
        let base = Path::new("base");
        assert_eq!(safe_join(base, "media/lua/client/A.lua").unwrap(), base.join("media/lua/client/A.lua"));
        assert_eq!(safe_join(base, "./media/x.txt").unwrap(), base.join("./media/x.txt"));
        for bad in ["", ".", "../x.lua", "media/../../x.lua", "/etc/passwd", "C:/Windows/x", "C:x", "\\\\server\\share\\x", "media/a.lua:stream"] {
            assert!(safe_join(base, bad).is_err(), "accepted {:?}", bad);
        }
        #[cfg(windows)]
        assert!(safe_join(base, "..\\..\\Startup\\evil.bat").is_err());
    }

    #[test]
    fn force_remove_does_not_follow_directory_links() {
        let root = std::env::temp_dir().join(format!("pzms-rm-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let outside = root.join("outside");
        let pkg = root.join("Z_PZModStudio_Test");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "keep").unwrap();
        fs::create_dir_all(pkg.join("media")).unwrap();
        fs::write(pkg.join("media").join("a.lua"), "x").unwrap();

        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, pkg.join("link")).is_ok()
            || std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(pkg.join("link"))
                .arg(&outside)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, pkg.join("link")).is_ok();

        force_remove_dir_all(&pkg).unwrap();
        assert!(!pkg.exists());
        if linked {
            assert!(outside.join("keep.txt").exists(), "deleted through a link");
        }
        let _ = fs::remove_dir_all(&root);
    }
}

/// Adds a freshly published package to the saved load order and to the active profile, last,
/// so the Mod List agrees with `default.txt` instead of showing it as disabled.
fn remember_package_in_saved_order(user_zomboid_dir: &str, package: &str, active_mods: &[String]) {
    let Some(z_dir) = crate::load_order::mod_info::get_existing_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .next()
    else {
        return;
    };
    let master = z_dir.join("PZModStudio_MasterLoadOrder.json");
    let mut load_order: Vec<String> = fs::read_to_string(&master)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("load_order").and_then(|a| a.as_array()).map(|a| {
                a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
            })
        })
        .unwrap_or_default();
    if load_order.is_empty() {
        // Nothing saved yet: the list the game reads is the best order we have.
        load_order = active_mods.to_vec();
    } else {
        load_order.retain(|id| id != package);
        load_order.push(package.to_string());
    }
    let _ = crate::instance_manager::save_master_load_order(
        user_zomboid_dir.to_string(),
        load_order,
        active_mods.to_vec(),
    );
}
