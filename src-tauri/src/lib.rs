pub mod bisect;
pub mod catalog;
pub mod claude_agent;
pub mod compat;
pub mod diff_engine;
pub mod error_report;
pub mod images;
pub mod instance_manager;
pub mod load_order;
pub mod mcp;
pub mod mod_install;
pub mod nexus;
pub mod origins;
pub mod patch_generator;
pub mod preset_manager;
pub mod sandbox;
pub mod scripts;
pub mod secrets;
pub mod steam_client;
pub mod server_manager;
pub mod vdf;
pub mod vfs;
pub mod workshop;

use diff_engine::lua::{three_way_merge_lua, validate_lua_syntax, LuaSyntaxCheckResult, MergeChunkResult};

use instance_manager::{activate_instance, create_instance, delete_instance, list_instances, save_master_load_order, update_instance};
use load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini, ModListData};
use load_order::mod_info::{scan_all_installed_mods, ModManifest};
use patch_generator::{generate_master_patch, MasterPatchRequest, MasterPatchResult};
use preset_manager::{check_missing_preset_mods, export_preset_file, import_preset_file};
use sandbox::{launch_sandbox_and_watch, SandboxLaunchConfig};
use server_manager::check_server_mods;
use server_manager::{
    create_new_server_config, delete_server_config, get_connected_players,
    get_dedicated_server_logs, get_dedicated_server_status, get_server_quick_settings,
    launch_dedicated_server, list_server_configs, save_server_log_snapshot,
    save_server_quick_settings, send_server_command, stop_dedicated_server,
    sync_client_to_server,
};
use vfs::{auto_detect_paths, validate_paths, StudioPaths, VfsConflictRaw};

#[tauri::command(async)]
fn get_auto_paths() -> StudioPaths {
    auto_detect_paths()
}

#[tauri::command(async)]
fn set_and_validate_paths(custom_paths: StudioPaths) -> StudioPaths {
    validate_paths(custom_paths)
}

#[tauri::command(async)]
fn scan_conflicts_cmd(paths: StudioPaths, package_folder: Option<String>) -> Vec<VfsConflictRaw> {
    vfs::scan_conflicts_in(&paths, package_folder.as_deref())
}

#[tauri::command(async)]
fn validate_lua_syntax_cmd(code: String) -> LuaSyntaxCheckResult {
    validate_lua_syntax(&code)
}

#[tauri::command(async)]
fn three_way_merge_lua_cmd(base: String, target_a: String, target_b: String) -> MergeChunkResult {
    three_way_merge_lua(&base, &target_a, &target_b)
}

#[tauri::command(async)]
fn read_mod_list_ini_cmd(ini_path: String) -> Result<ModListData, String> {
    read_mod_list_ini(&ini_path)
}

#[tauri::command]
fn write_mod_list_ini_cmd(ini_path: String, active_mods: Vec<String>) -> Result<(), String> {
    write_mod_list_ini(&ini_path, &active_mods)
}

#[tauri::command(async)]
fn scan_all_installed_mods_cmd(paths: StudioPaths) -> Vec<ModManifest> {
    scan_all_installed_mods(&paths)
}

/// Read-only health check of `active` (mod ids in load order) against what is installed,
/// following the game's own rules. Returns the catalog too, so the UI can show details.
#[tauri::command(async)]
fn get_mod_health_cmd(paths: StudioPaths, active: Vec<String>) -> catalog::ModHealth {
    catalog::mod_health_full(&paths, &active)
}

/// Merges the given shared files automatically (only those needing no decision) and publishes
/// the Studio package.
#[tauri::command(async)]
fn auto_merge_conflicts_cmd(paths: StudioPaths, relative_paths: Vec<String>) -> Result<vfs::AutoMergeResult, String> {
    vfs::auto_merge_conflicts(&paths, &relative_paths)
}

/// One page of Project Zomboid mods from Nexus Mods (public API, no key).
#[tauri::command(async)]
fn nexus_search_cmd(
    query: Option<String>,
    category: Option<String>,
    sort: nexus::NexusSort,
    offset: u64,
    count: u64,
) -> Result<nexus::NexusSearchResult, String> {
    nexus::search_mods(query.as_deref(), category.as_deref(), sort, offset, count)
}

/// Project Zomboid categories on Nexus with mod counts.
#[tauri::command(async)]
fn nexus_categories_cmd() -> Result<Vec<nexus::NexusCategory>, String> {
    nexus::categories()
}

/// Description, requirements and files of one Nexus mod.
#[tauri::command(async)]
fn nexus_mod_details_cmd(mod_id: u64) -> Result<nexus::NexusModDetails, String> {
    nexus::mod_details(mod_id)
}

/// Full description, screenshots and required items of one Workshop item (no key).
#[tauri::command(async)]
fn workshop_item_details_cmd(id: String) -> Result<workshop::WorkshopItemDetails, String> {
    workshop::item_details(&id)
}

/// Whether a Steam Web API key is saved (the key itself never goes back to the UI).
#[tauri::command(async)]
fn steam_key_status_cmd() -> Result<bool, String> {
    Ok(secrets::get(secrets::STEAM_WEB_API_KEY)?.is_some())
}

/// Checks the key with a one-item Workshop search, then saves it in Windows Credential Manager.
#[tauri::command(async)]
fn set_steam_key_cmd(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.len() != 32 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("A Steam Web API key is 32 characters, 0-9 and A-F.".to_string());
    }
    workshop::search(key, None, workshop::WorkshopSort::Trending, None, None, 1, 1)?;
    secrets::set(secrets::STEAM_WEB_API_KEY, key)
}

#[tauri::command(async)]
fn delete_steam_key_cmd() -> Result<(), String> {
    secrets::delete(secrets::STEAM_WEB_API_KEY)
}

/// Searches the Project Zomboid Workshop with the saved key.
#[tauri::command(async)]
fn workshop_search_cmd(query: workshop::BrowseQuery) -> Result<workshop::WorkshopSearchResult, String> {
    // The public browse page needs no key; the Web API is the fallback when Steam changes it.
    let public = workshop::search_public(&query);
    let Err(err) = public else { return public };
    match secrets::get(secrets::STEAM_WEB_API_KEY)? {
        // The Web API cannot list collections, so the key only helps with mods.
        Some(key) if !query.collections => workshop::search(
            &key,
            query.text.as_deref(),
            query.sort.unwrap_or(workshop::WorkshopSort::Trending),
            query.build.as_deref(),
            query.category.as_deref(),
            query.page,
            30,
        ),
        _ => Err(err),
    }
}

/// Subscribes or unsubscribes through the Steam client that is already signed in. No key.
/// Steam downloads or removes the files itself afterwards.
///
/// The work happens in a short-lived copy of this program, because Steam's API may only be
/// started once in a process and the window outlives many subscriptions.
#[tauri::command(async)]
fn workshop_subscribe_cmd(
    paths: StudioPaths,
    ids: Vec<String>,
    subscribe: bool,
) -> Result<steam_client::SubscribeOutcome, String> {
    let flag = if subscribe { "--steam-subscribe" } else { "--steam-unsubscribe" };
    let output = steam_helper(flag, &paths.pz_install_dir, &ids)?;
    serde_json::from_str(&output).map_err(|e| format!("Unexpected answer from the Steam helper: {}", e))
}

/// Marks the Steam helper's own line, among whatever Steam's library prints.
pub const STEAM_ANSWER_PREFIX: &str = "PZMS-STEAM:";

/// The helper's answer out of its output, ignoring Steam's chatter.
fn steam_answer(output: &str) -> Option<String> {
    output
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(STEAM_ANSWER_PREFIX).map(|a| a.trim().to_string()))
}

/// Runs this program again with a `--steam-*` flag and returns what it printed.
fn steam_helper(flag: &str, pz_install_dir: &str, ids: &[String]) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Could not find the Studio's own program: {}", e))?;
    let mut command = std::process::Command::new(exe);
    command.arg(flag).arg(pz_install_dir).args(ids);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes up
    }
    let done = command.output().map_err(|e| format!("The Steam helper could not be started: {}", e))?;
    let reason = || {
        steam_answer(&String::from_utf8_lossy(&done.stderr)).unwrap_or_else(|| "Steam refused the request.".to_string())
    };
    if !done.status.success() {
        return Err(reason());
    }
    steam_answer(&String::from_utf8_lossy(&done.stdout)).ok_or_else(reason)
}

/// Whether subscribing from here is possible right now (the game's Steam library and a running
/// Steam client). Does not start Steam's API, so it costs nothing and shows no in-game status.
#[tauri::command(async)]
fn steam_client_ready_cmd(paths: StudioPaths) -> Result<bool, String> {
    Ok(steam_client::is_ready(&paths.pz_install_dir))
}

/// A mod's own poster/icon as a data URL, so the webview can show a file on disk.
#[tauri::command(async)]
fn read_mod_image_cmd(paths: StudioPaths, path: String) -> Result<String, String> {
    images::read_as_data_url(&paths, &path)
}

/// Steam Workshop details for item ids (public Web API, no key).
#[tauri::command(async)]
fn workshop_details_cmd(ids: Vec<String>) -> Result<Vec<workshop::WorkshopItem>, String> {
    workshop::get_details(&ids)
}

/// Looks up pasted Workshop links / ids / a collection link.
#[tauri::command(async)]
fn workshop_lookup_cmd(input: String) -> Result<workshop::WorkshopLookup, String> {
    workshop::lookup(&input)
}

/// Installs the mod(s) in a downloaded .zip or an extracted folder into Zomboid/mods.
#[tauri::command(async)]
fn install_mods_cmd(
    source: String,
    paths: StudioPaths,
    replace_existing: bool,
    origin: Option<origins::ModOrigin>,
) -> Result<mod_install::InstallResult, String> {
    mod_install::install_mods(&source, &paths.user_zomboid_dir, &paths.workshop_dir, replace_existing, origin)
}

/// Copies a mod the installed build will not load into Zomboid/mods and adapts it.
#[tauri::command(async)]
fn make_compatible_copy_cmd(paths: StudioPaths, mod_id: String, replace_existing: bool) -> Result<compat::CompatResult, String> {
    let game = load_order::mod_info::read_installed_game_version(&paths.user_zomboid_dir)
        .ok_or("The installed game version is unknown: start Project Zomboid once so Zomboid/version.txt exists.")?;
    let catalog = catalog::build_catalog(&paths.workshop_dir, &paths.user_zomboid_dir, Some(game));
    let original = catalog
        .mods
        .iter()
        .find(|m| m.id == mod_id && m.source != catalog::ModSource::Local)
        .ok_or_else(|| format!("{} is not installed from the Workshop.", mod_id))?;
    let workshop_id = match &original.source {
        catalog::ModSource::Workshop { workshop_id } => Some(workshop_id.clone()),
        _ => None,
    };
    compat::make_compatible_copy(std::path::Path::new(&original.root_dir), &paths.user_zomboid_dir, game, workshop_id, replace_existing)
}

#[tauri::command(async)]
fn remove_compatible_copy_cmd(paths: StudioPaths, folder: String) -> Result<(), String> {
    compat::remove_compatible_copy(&paths.user_zomboid_dir, &folder)
}

/// Game-exact load-order sort of the whole list (enabled and disabled), keeping the user's order
/// wherever no require/loadModAfter/loadModBefore rule forces a change.
#[tauri::command(async)]
fn sort_load_order_cmd(paths: StudioPaths, order: Vec<String>) -> catalog::SortResult {
    let catalog = catalog::build_catalog(&paths.workshop_dir, &paths.user_zomboid_dir, None);
    catalog::sort_load_order(&catalog, &order)
}

#[tauri::command(async)]
fn launch_sandbox_cmd<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    config: SandboxLaunchConfig,
) -> Result<u32, String> {
    launch_sandbox_and_watch(app_handle, config)
}

/// The hunt in progress, if the player left one running.
/// Things two or more active mods declare (the same item, recipe or vehicle in different files).
/// Read-only, and asked for on its own because it reads every script of every active mod.
#[tauri::command(async)]
fn script_conflicts_cmd(paths: StudioPaths, active: Vec<String>) -> Vec<catalog::HealthIssue> {
    catalog::script_definition_issues(&paths, &active)
}

/// Every earlier version of the mod list the Studio kept, newest first.
/// What the Build 42 shim covers, read from the shim that ships inside merge packages.
/// What a link offers, worked out without downloading it.
/// The player's own sandbox presets, so one can be put into a pack.
/// The text files of one installed mod, to pick one to patch.
/// For each `require("...") failed` asked about, where that module really is.
///
/// Indexing every Lua file of the game and the active mods takes a moment, so the whole set is
/// answered in one call rather than one card at a time.
#[tauri::command(async)]
fn resolve_failed_requires_cmd(
    paths: StudioPaths,
    wanted: Vec<String>,
) -> Vec<sandbox::requires::RequireAnswer> {
    let active: Vec<String> = load_order::ini_parser::read_mod_list_ini(&paths.mod_list_ini_path)
        .map(|d| d.active_mods)
        .unwrap_or_default();
    let catalog = catalog::build_catalog(&paths.workshop_dir, &paths.user_zomboid_dir, None);
    let index = sandbox::requires::index_modules(&paths, &catalog, &active);
    wanted.iter().map(|w| sandbox::requires::answer_for(w, &index)).collect()
}

#[tauri::command(async)]
fn mod_files_cmd(paths: StudioPaths, mod_id: String) -> Result<Vec<vfs::mod_patch::ModFile>, String> {
    let catalog = catalog::build_catalog(&paths.workshop_dir, &paths.user_zomboid_dir, None);
    vfs::mod_patch::files_of_mod(&catalog, &mod_id)
}

/// One mod's file, in the shape the Merger edits and saves into the package.
#[tauri::command(async)]
fn mod_file_to_patch_cmd(
    paths: StudioPaths,
    mod_id: String,
    relative_path: String,
) -> Result<vfs::VfsConflictRaw, String> {
    let catalog = catalog::build_catalog(&paths.workshop_dir, &paths.user_zomboid_dir, None);
    vfs::mod_patch::conflict_for_mod_file(&catalog, &paths, &mod_id, &relative_path)
}

#[tauri::command(async)]
fn sandbox_presets_cmd(
    user_zomboid_dir: String,
) -> Vec<preset_manager::sandbox_presets::SandboxPresetInfo> {
    preset_manager::sandbox_presets::list(&user_zomboid_dir)
}

/// Writes a pack's sandbox settings into `Zomboid/Sandbox Presets`, never over one of the
/// player's own. Returns the name the game will show.
#[tauri::command(async)]
fn write_sandbox_preset_cmd(
    user_zomboid_dir: String,
    sandbox: preset_manager::sandbox_presets::PresetSandbox,
) -> Result<String, String> {
    preset_manager::sandbox_presets::write_from_pack(&user_zomboid_dir, &sandbox)
}

#[tauri::command(async)]
fn resolve_url_install_cmd(url: String) -> Result<mod_install::from_url::UrlInstallPlan, String> {
    mod_install::from_url::resolve(&url)
}

/// Downloads a link and installs the mod(s) in it, recording where they came from.
#[tauri::command(async)]
fn install_from_url_cmd(
    paths: StudioPaths,
    url: String,
    replace_existing: bool,
) -> Result<mod_install::InstallResult, String> {
    mod_install::from_url::install_from_url(
        &url,
        &paths.user_zomboid_dir,
        &paths.workshop_dir,
        replace_existing,
    )
}

#[tauri::command(async)]
fn polyfill_sections_cmd() -> Vec<patch_generator::PolyfillSection> {
    patch_generator::polyfill_sections()
}

#[tauri::command(async)]
fn mod_list_history_cmd(paths: StudioPaths) -> Vec<load_order::ini_parser::ModListVersion> {
    load_order::ini_parser::list_mod_list_history(&paths.mod_list_ini_path, &paths.user_zomboid_dir)
}

/// Puts one of them back, and says which mods it switches on.
#[tauri::command(async)]
fn restore_mod_list_version_cmd(paths: StudioPaths, backup_file: String) -> Result<Vec<String>, String> {
    load_order::ini_parser::restore_mod_list_version(
        &paths.mod_list_ini_path,
        &paths.user_zomboid_dir,
        &backup_file,
    )
}

#[tauri::command(async)]
fn bisect_state_cmd(paths: StudioPaths) -> Option<bisect::BisectSession> {
    bisect::load(&paths.user_zomboid_dir)
}

/// Starts halving the list. The mods switched on now are the suspects; the list is replaced by
/// the first trial and kept in the session to be put back at the end.
#[tauri::command(async)]
fn bisect_start_cmd(
    paths: StudioPaths,
    mods: Vec<bisect::BisectMod>,
) -> Result<bisect::BisectSession, String> {
    bisect::start(&paths.mod_list_ini_path, &paths.user_zomboid_dir, &mods)
}

/// Did it still happen? Narrows the suspects and switches the next trial on.
#[tauri::command(async)]
fn bisect_answer_cmd(
    paths: StudioPaths,
    still_happens: bool,
) -> Result<bisect::BisectSession, String> {
    bisect::answer(&paths.mod_list_ini_path, &paths.user_zomboid_dir, still_happens)
}

/// Gives up and puts the player's own list back, optionally without one mod.
#[tauri::command(async)]
fn bisect_stop_cmd(paths: StudioPaths, switch_off: Option<String>) -> Result<Vec<String>, String> {
    bisect::stop(
        &paths.mod_list_ini_path,
        &paths.user_zomboid_dir,
        switch_off.as_deref(),
    )
}

#[tauri::command(async)]
fn generate_master_patch_cmd(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    generate_master_patch(req)
}

#[tauri::command]
fn pick_folder_cmd(default_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref path) = default_path {
        if !path.is_empty() {
            dialog = dialog.set_directory(path);
        }
    }
    dialog.pick_folder().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save_file_cmd(
    default_name: Option<String>,
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let (Some(ref fname), Some(ref fext)) = (filter_name, filter_ext) {
        dialog = dialog.add_filter(fname, &[fext.as_str()]);
    } else {
        dialog = dialog.add_filter("PZ Mod Studio File", &["pzmerge", "pzpack", "json"]);
    }
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog.save_file().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_open_file_cmd(
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let (Some(ref fname), Some(ref fext)) = (filter_name, filter_ext) {
        dialog = dialog.add_filter(fname, &[fext.as_str()]);
    } else {
        dialog = dialog.add_filter("PZ Mod Studio File", &["pzmerge", "pzpack", "json"]);
    }
    dialog.pick_file().map(|p| p.to_string_lossy().to_string())
}

/// Builds one Markdown file describing an error: what broke, on which build, in which mod, with
/// the code. Meant to be handed to a person or an AI agent that was not at the machine.
#[tauri::command(async)]
fn error_report_cmd(paths: StudioPaths, request: error_report::ErrorReportRequest) -> Result<String, String> {
    error_report::build(&paths, &request)
}

/// Writes that report where the user chose.
#[tauri::command(async)]
fn save_text_file_cmd(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("The file could not be saved: {}", e))
}

/// Where the Studio's own MCP server sits, so the config the user copies is one that works.
#[tauri::command(async)]
fn mcp_server_path_cmd() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let beside = exe.with_file_name("pz-mcp-server.exe");
    // In a portable copy the console server sits next to the app; falling back to the app itself
    // is still right, because it serves MCP with --mcp.
    Ok(if beside.is_file() { beside } else { exe }.to_string_lossy().to_string())
}

/// Shows a mod's folder in Explorer. The path comes from the UI, so it is checked against the
/// folders the user configured first: this opens mods, not anywhere on the disk.
#[tauri::command(async)]
fn open_mod_folder_cmd(paths: StudioPaths, folder: String) -> Result<(), String> {
    let target = std::fs::canonicalize(&folder).map_err(|_| format!("{} is not there any more.", folder))?;
    let roots: Vec<std::path::PathBuf> = [&paths.workshop_dir, &paths.user_zomboid_dir, &paths.pz_install_dir]
        .iter()
        .filter(|d| !d.is_empty())
        .filter_map(|d| std::fs::canonicalize(d).ok())
        .collect();
    if !roots.iter().any(|root| target.starts_with(root)) {
        return Err("That folder is outside your game and Zomboid folders.".to_string());
    }
    open::that(&target).map_err(|e| format!("Windows could not open that folder: {}", e))?;
    Ok(())
}

#[tauri::command(async)]
fn open_package_folder_cmd(user_zomboid_dir: String, package_folder_name: String) -> Result<bool, String> {
    let clean_pkg_name = if package_folder_name.starts_with("Z_PZModStudio_") {
        package_folder_name
    } else {
        format!("Z_PZModStudio_{}", package_folder_name)
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(&user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("User Zomboid folder not found.".to_string());
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    let _ = std::fs::create_dir_all(&pkg_dir);

    open::that(&pkg_dir).map_err(|e| format!("Error opening physical folder: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn open_logs_folder_cmd(user_zomboid_dir: String) -> Result<bool, String> {
    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(&user_zomboid_dir);
    let target = if !user_dirs.is_empty() {
        let logs_dir = user_dirs[0].join("Logs");
        if logs_dir.exists() {
            logs_dir
        } else {
            user_dirs[0].clone()
        }
    } else {
        if let Some(home) = dirs_next::home_dir() {
            let p = home.join("Zomboid").join("Logs");
            if p.exists() { p } else { home.join("Zomboid") }
        } else {
            return Err("Zomboid folder not found.".to_string());
        }
    };

    open::that(&target).map_err(|e| format!("Error opening logs folder: {}", e))?;
    Ok(true)
}

#[tauri::command(async)]
fn list_available_log_files_cmd(user_zomboid_dir: String) -> Vec<sandbox::LogFileInfo> {
    sandbox::list_available_log_files(&user_zomboid_dir)
}

#[tauri::command(async)]
fn read_log_file_cmd(file_path: String, max_lines: Option<usize>) -> Result<Vec<String>, String> {
    sandbox::read_log_file(&file_path, max_lines)
}

#[tauri::command]
fn open_external_url_cmd(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    open::that(url).map_err(|e| format!("Failed to open URL in browser: {}", e))
}

/// Only plain http(s) links are opened. URLs come from mod.info `url=` lines, which mod
/// authors control, so anything else (file:, ms-settings:, shell metacharacters...) is refused.
fn validate_external_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let has_web_scheme = lower.starts_with("https://") || lower.starts_with("http://");
    let has_control_chars = url.chars().any(|c| c.is_control() || c == '"');
    if !has_web_scheme || has_control_chars || url.len() > 2048 {
        return Err(format!("Refusing to open non-web URL: {}", url));
    }
    Ok(url)
}

#[tauri::command(async)]
fn clean_master_patch_cmd(req: MasterPatchRequest) -> Result<bool, String> {
    patch_generator::clean_master_patch(req)
}

#[tauri::command(async)]
fn get_master_patch_status_cmd(user_zomboid_dir: String, mod_list_ini_path: String, package_folder_name: Option<String>) -> patch_generator::MasterPatchStatusInfo {
    patch_generator::get_master_patch_status(&user_zomboid_dir, &mod_list_ini_path, package_folder_name)
}

#[tauri::command(async)]
fn list_merged_packages_cmd(user_zomboid_dir: String, mod_list_ini_path: String) -> Vec<patch_generator::MergedPackageInfo> {
    patch_generator::list_merged_packages(&user_zomboid_dir, &mod_list_ini_path)
}

#[tauri::command]
fn create_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, name: String, description: Option<String>) -> Result<patch_generator::MergedPackageInfo, String> {
    patch_generator::create_merged_package(&user_zomboid_dir, &mod_list_ini_path, &name, description.as_deref())
}

#[tauri::command]
fn rename_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, old_folder: String, new_name: String, description: Option<String>) -> Result<patch_generator::MergedPackageInfo, String> {
    patch_generator::rename_merged_package(&user_zomboid_dir, &mod_list_ini_path, &old_folder, &new_name, description.as_deref())
}

#[tauri::command(async)]
fn delete_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, folder_name: String) -> Result<bool, String> {
    patch_generator::delete_merged_package(&user_zomboid_dir, &mod_list_ini_path, &folder_name)
}

#[tauri::command]
fn save_draft_resolution_cmd(
    user_zomboid_dir: String,
    package_folder_name: String,
    relative_path: String,
    resolved_content: String,
    status: String,
) -> Result<bool, String> {
    patch_generator::save_draft_resolution(
        &user_zomboid_dir,
        &package_folder_name,
        &relative_path,
        &resolved_content,
        &status,
    )
}

#[tauri::command]
fn clear_draft_resolutions_cmd(
    user_zomboid_dir: String,
    package_folder_name: String,
) -> Result<bool, String> {
    patch_generator::clear_draft_resolutions(&user_zomboid_dir, &package_folder_name)
}

#[tauri::command(async)]
fn export_merged_package_cmd(
    user_zomboid_dir: String,
    package_folder_name: String,
    target_file_path: String,
) -> Result<bool, String> {
    patch_generator::export_merged_package(&user_zomboid_dir, &package_folder_name, &target_file_path)
}

#[tauri::command(async)]
fn import_merged_package_cmd(
    user_zomboid_dir: String,
    mod_list_ini_path: String,
    source_file_path: String,
) -> Result<patch_generator::MergedPackageInfo, String> {
    patch_generator::import_merged_package(&user_zomboid_dir, &mod_list_ini_path, &source_file_path)
}

#[tauri::command]
fn toggle_package_in_modlist_cmd(
    user_zomboid_dir: String,
    mod_list_ini_path: String,
    folder_name: String,
    enabled: bool,
) -> Result<bool, String> {
    patch_generator::toggle_package_in_modlist(&user_zomboid_dir, &mod_list_ini_path, &folder_name, enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Follow console.txt from the start: the game is often launched from Steam.
            sandbox::watch_console_log(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auto_paths,
            set_and_validate_paths,
            scan_conflicts_cmd,
            validate_lua_syntax_cmd,
            three_way_merge_lua_cmd,
            read_mod_list_ini_cmd,
            write_mod_list_ini_cmd,
            scan_all_installed_mods_cmd,
            get_mod_health_cmd,
            auto_merge_conflicts_cmd,
            sort_load_order_cmd,
            make_compatible_copy_cmd,
            remove_compatible_copy_cmd,
            nexus_search_cmd,
            nexus_categories_cmd,
            nexus_mod_details_cmd,
            workshop_item_details_cmd,
            install_mods_cmd,
            workshop_details_cmd,
            workshop_lookup_cmd,
            steam_key_status_cmd,
            set_steam_key_cmd,
            delete_steam_key_cmd,
            workshop_search_cmd,
            read_mod_image_cmd,
            workshop_subscribe_cmd,
            steam_client_ready_cmd,
            launch_sandbox_cmd,
            script_conflicts_cmd,
            resolve_failed_requires_cmd,
            mod_files_cmd,
            mod_file_to_patch_cmd,
            sandbox_presets_cmd,
            write_sandbox_preset_cmd,
            resolve_url_install_cmd,
            install_from_url_cmd,
            polyfill_sections_cmd,
            mod_list_history_cmd,
            restore_mod_list_version_cmd,
            bisect_state_cmd,
            bisect_start_cmd,
            bisect_answer_cmd,
            bisect_stop_cmd,
            generate_master_patch_cmd,
            clean_master_patch_cmd,
            get_master_patch_status_cmd,
            list_merged_packages_cmd,
            create_merged_package_cmd,
            rename_merged_package_cmd,
            delete_merged_package_cmd,
            toggle_package_in_modlist_cmd,
            save_draft_resolution_cmd,
            clear_draft_resolutions_cmd,
            export_merged_package_cmd,
            import_merged_package_cmd,
            open_package_folder_cmd,
            open_mod_folder_cmd,
            mcp_server_path_cmd,
            error_report_cmd,
            save_text_file_cmd,
            open_logs_folder_cmd,
            list_available_log_files_cmd,
            read_log_file_cmd,
            pick_folder_cmd,
            pick_save_file_cmd,
            pick_open_file_cmd,
            open_external_url_cmd,
            export_preset_file,
            import_preset_file,
            check_missing_preset_mods,
            list_server_configs,
            sync_client_to_server,
            check_server_mods,
            create_new_server_config,
            delete_server_config,
            launch_dedicated_server,
            stop_dedicated_server,
            get_dedicated_server_status,
            get_dedicated_server_logs,
            save_server_log_snapshot,
            get_connected_players,
            send_server_command,
            get_server_quick_settings,
            save_server_quick_settings,
            list_instances,
            create_instance,
            activate_instance,
            delete_instance,
            update_instance,
            save_master_load_order
        ])
        // A dedicated server outlives this window on purpose: people close the Studio and keep
        // playing. Stopping it is the Servers tab's button, where the user means it.

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_helpers_answer_is_found_among_steams_chatter() {
        let output = "Setting breakpad minidump AppID = 108600\nSteamInternal_SetMinidumpSteamID: ...\nPZMS-STEAM:{\"done\":[\"7\"]}\n";
        assert_eq!(super::steam_answer(output).as_deref(), Some("{\"done\":[\"7\"]}"));
        assert_eq!(super::steam_answer("only steam noise\n"), None);
    }

    use super::validate_external_url;

    #[test]
    fn only_web_urls_are_opened() {
        assert!(validate_external_url("https://steamcommunity.com/sharedfiles/filedetails/?id=1&b=2").is_ok());
        assert!(validate_external_url(" HTTP://example.com ").is_ok());
        for bad in ["steam://url/CommunityFilePage/2699828474", "steam://run/108600", "ftp://x&calc", "file:///C:/Windows/System32/calc.exe", "calc.exe", "ms-settings:", "https://x\"&calc", "https://x\r\ncalc"] {
            assert!(validate_external_url(bad).is_err(), "accepted {:?}", bad);
        }
    }
}
