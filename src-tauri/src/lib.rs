pub mod diff_engine;
pub mod vfs;

use diff_engine::lua::{three_way_merge_lua, validate_lua_syntax, LuaSyntaxCheckResult, MergeChunkResult};
use diff_engine::pz_scripts::{merge_pz_data_scripts, PzScriptMergeResult};
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
            merge_pz_data_scripts_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
