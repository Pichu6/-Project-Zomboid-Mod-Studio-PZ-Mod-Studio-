pub mod vfs;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_auto_paths,
            set_and_validate_paths,
            scan_conflicts_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
