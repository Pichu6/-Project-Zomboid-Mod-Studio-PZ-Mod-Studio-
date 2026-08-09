pub mod diff_engine;
pub mod instance_manager;
pub mod load_order;
pub mod patch_generator;
pub mod preset_manager;
pub mod sandbox;
pub mod server_manager;
pub mod vfs;

use diff_engine::lua::{three_way_merge_lua, validate_lua_syntax, LuaSyntaxCheckResult, MergeChunkResult};
use diff_engine::pz_scripts::{merge_pz_data_scripts, PzScriptMergeResult};
use instance_manager::{activate_instance, create_instance, delete_instance, list_instances, update_instance};
use load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini, ModListData};
use load_order::mod_info::{scan_all_installed_mods, ModManifest};
use load_order::topological_sort::{sort_dependencies_topologically, DependencyAnalysisResult};
use patch_generator::{generate_master_patch, prepare_carrier_mod, MasterPatchRequest, MasterPatchResult};
use preset_manager::{check_missing_preset_mods, export_preset_file, import_preset_file};
use sandbox::{launch_sandbox_and_watch, SandboxLaunchConfig};
use server_manager::{create_new_server_config, list_server_configs, sync_client_to_server};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use vfs::{auto_detect_paths, scan_conflicts, validate_paths, StudioPaths, VfsConflictRaw};

#[tauri::command]
fn get_auto_paths() -> StudioPaths {
    auto_detect_paths()
}

#[tauri::command]
fn set_and_validate_paths(custom_paths: StudioPaths) -> StudioPaths {
    validate_paths(custom_paths)
}

#[tauri::command]
fn scan_conflicts_cmd(paths: StudioPaths) -> Vec<VfsConflictRaw> {
    scan_conflicts(&paths)
}

#[tauri::command]
fn validate_lua_syntax_cmd(code: String) -> LuaSyntaxCheckResult {
    validate_lua_syntax(&code)
}

#[tauri::command]
fn three_way_merge_lua_cmd(base: String, target_a: String, target_b: String) -> MergeChunkResult {
    three_way_merge_lua(&base, &target_a, &target_b)
}

#[tauri::command]
fn merge_pz_data_scripts_cmd(base: String, mod_a: String, mod_b: String) -> PzScriptMergeResult {
    merge_pz_data_scripts(&base, &mod_a, &mod_b)
}

#[tauri::command]
fn read_mod_list_ini_cmd(ini_path: String) -> Result<ModListData, String> {
    read_mod_list_ini(&ini_path)
}

#[tauri::command]
fn write_mod_list_ini_cmd(ini_path: String, active_mods: Vec<String>) -> Result<(), String> {
    write_mod_list_ini(&ini_path, &active_mods)
}

#[tauri::command]
fn scan_all_installed_mods_cmd(paths: StudioPaths) -> Vec<ModManifest> {
    scan_all_installed_mods(&paths)
}

#[tauri::command]
fn sort_mod_dependencies_cmd(manifests: Vec<ModManifest>) -> DependencyAnalysisResult {
    sort_dependencies_topologically(&manifests)
}

#[tauri::command]
fn launch_sandbox_cmd<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    config: SandboxLaunchConfig,
) -> Result<u32, String> {
    let stop_signal = Arc::new(AtomicBool::new(false));
    launch_sandbox_and_watch(app_handle, config, stop_signal)
}

#[tauri::command]
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
fn pick_save_file_cmd(default_name: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("PZ Mod Studio Preset", &["pzpack", "json"]);
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    dialog.save_file().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_open_file_cmd() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("PZ Mod Studio Preset", &["pzpack", "json"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn prepare_carrier_mod_cmd(user_zomboid_dir: String) -> Result<String, String> {
    prepare_carrier_mod(&user_zomboid_dir)
}

#[tauri::command]
fn open_external_url_cmd(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL in browser: {}", e))
}

#[tauri::command]
fn clean_master_patch_cmd(req: MasterPatchRequest) -> Result<bool, String> {
    patch_generator::clean_master_patch(req)
}

#[tauri::command]
fn get_master_patch_status_cmd(user_zomboid_dir: String, mod_list_ini_path: String) -> patch_generator::MasterPatchStatusInfo {
    patch_generator::get_master_patch_status(&user_zomboid_dir, &mod_list_ini_path)
}

#[tauri::command]
fn list_merged_packages_cmd(user_zomboid_dir: String, mod_list_ini_path: String) -> Vec<patch_generator::MergedPackageInfo> {
    patch_generator::list_merged_packages(&user_zomboid_dir, &mod_list_ini_path)
}

#[tauri::command]
fn create_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, name: String) -> Result<patch_generator::MergedPackageInfo, String> {
    patch_generator::create_merged_package(&user_zomboid_dir, &mod_list_ini_path, &name)
}

#[tauri::command]
fn rename_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, old_folder: String, new_name: String) -> Result<patch_generator::MergedPackageInfo, String> {
    patch_generator::rename_merged_package(&user_zomboid_dir, &mod_list_ini_path, &old_folder, &new_name)
}

#[tauri::command]
fn delete_merged_package_cmd(user_zomboid_dir: String, mod_list_ini_path: String, folder_name: String) -> Result<bool, String> {
    patch_generator::delete_merged_package(&user_zomboid_dir, &mod_list_ini_path, &folder_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_auto_paths,
            set_and_validate_paths,
            scan_conflicts_cmd,
            validate_lua_syntax_cmd,
            three_way_merge_lua_cmd,
            merge_pz_data_scripts_cmd,
            read_mod_list_ini_cmd,
            write_mod_list_ini_cmd,
            scan_all_installed_mods_cmd,
            sort_mod_dependencies_cmd,
            launch_sandbox_cmd,
            generate_master_patch_cmd,
            clean_master_patch_cmd,
            get_master_patch_status_cmd,
            list_merged_packages_cmd,
            create_merged_package_cmd,
            rename_merged_package_cmd,
            delete_merged_package_cmd,
            pick_folder_cmd,
            pick_save_file_cmd,
            pick_open_file_cmd,
            open_external_url_cmd,
            prepare_carrier_mod_cmd,
            export_preset_file,
            import_preset_file,
            check_missing_preset_mods,
            list_server_configs,
            sync_client_to_server,
            create_new_server_config,
            list_instances,
            create_instance,
            activate_instance,
            delete_instance,
            update_instance
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
