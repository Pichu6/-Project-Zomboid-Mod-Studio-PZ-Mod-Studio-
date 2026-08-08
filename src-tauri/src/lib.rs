pub mod diff_engine;
pub mod load_order;
pub mod patch_generator;
pub mod sandbox;
pub mod vfs;

use diff_engine::lua::{three_way_merge_lua, validate_lua_syntax, LuaSyntaxCheckResult, MergeChunkResult};
use diff_engine::pz_scripts::{merge_pz_data_scripts, PzScriptMergeResult};
use load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini, ModListData};
use load_order::mod_info::ModManifest;
use load_order::topological_sort::{sort_dependencies_topologically, DependencyAnalysisResult};
use patch_generator::{generate_master_patch, MasterPatchRequest, MasterPatchResult};
use sandbox::{launch_sandbox_and_watch, SandboxLaunchConfig};
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
            sort_mod_dependencies_cmd,
            launch_sandbox_cmd,
            generate_master_patch_cmd,
            pick_folder_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
