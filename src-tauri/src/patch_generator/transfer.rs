//! A package as one .pzmerge file: export and import.

use super::*;

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
