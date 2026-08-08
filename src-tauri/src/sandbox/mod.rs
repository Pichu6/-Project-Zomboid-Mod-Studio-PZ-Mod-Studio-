use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxLaunchConfig {
    pub pz_install_dir: String,
    pub user_zomboid_dir: String,
    pub test_mode: String, // "BACKGROUND_QUICK" or "WINDOWED_DEEP"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedErrorPayload {
    pub id: String,
    pub raw_error: String,
    pub source_file: Option<String>,
    pub line_number: Option<usize>,
    pub title: String,
    pub explanation: String,
    pub recommended_action: String,
    pub polyfill_rule_id_suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLinePayload {
    pub line: String,
    pub is_error: bool,
}

/// Spawns an isolated Project Zomboid test process and monitors console.txt in real time.
pub fn launch_sandbox_and_watch<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    config: SandboxLaunchConfig,
    stop_signal: Arc<AtomicBool>,
) -> Result<u32, String> {
    let install_dir = Path::new(&config.pz_install_dir);
    let exe_path = install_dir.join("ProjectZomboid64.exe");
    
    if !exe_path.exists() {
        return Err(format!("ProjectZomboid64.exe not found at: {}", exe_path.display()));
    }

    let temp_cache_dir = Path::new(&config.user_zomboid_dir).join("temp_sandbox_cache");
    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(install_dir); // Set working directory to game folder so DLLs load properly
    cmd.arg("-cachedir").arg(&temp_cache_dir).arg("-debug");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if config.test_mode == "BACKGROUND_QUICK" {
            // Hide console window for background test
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to launch ProjectZomboid64.exe: {}", e))?;
    let pid = child.id();

    // Spawn background thread to stream console.txt lines and detect crashes
    let console_txt_path = Path::new(&config.user_zomboid_dir).join("console.txt");
    let app = app_handle.clone();

    thread::spawn(move || {
        let mut file_offset = 0u64;
        let mut error_counter = 1;

        while !stop_signal.load(Ordering::Relaxed) {
            if console_txt_path.exists() {
                if let Ok(file) = File::open(&console_txt_path) {
                    let mut reader = BufReader::new(file);
                    if reader.seek(SeekFrom::Start(file_offset)).is_ok() {
                        let mut line_buf = String::new();
                        while reader.read_line(&mut line_buf).unwrap_or(0) > 0 {
                            let trimmed = line_buf.trim_end().to_string();
                            let is_error = trimmed.contains("ERROR") || trimmed.contains("Exception") || trimmed.contains("KahluaThreadException");

                            let _ = app.emit("sandbox-log", LogLinePayload {
                                line: trimmed.clone(),
                                is_error,
                            });

                            // Translate known error patterns
                            if let Some(card) = translate_log_error(&trimmed, error_counter) {
                                let _ = app.emit("sandbox-error-card", card);
                                error_counter += 1;
                            }

                            line_buf.clear();
                        }
                        if let Ok(pos) = reader.stream_position() {
                            file_offset = pos;
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(300));
        }
    });

    Ok(pid)
}

/// Translates raw Java stacktraces & Lua errors into actionable cards.
fn translate_log_error(line: &str, counter: usize) -> Option<TranslatedErrorPayload> {
    if line.contains("UnknownFormatConversionException") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("zombie/core/Translator.java".to_string()),
            line_number: None,
            title: "Translator Format Exception (% character)".to_string(),
            explanation: "A mod called Translator.getText() with an unescaped % or . character, causing Java String formatting to collapse.".to_string(),
            recommended_action: "Apply Polyfill Rule: SANITIZE_TRANSLATOR_FORMAT".to_string(),
            polyfill_rule_id_suggestion: Some("SANITIZE_TRANSLATOR_FORMAT".to_string()),
        })
    } else if line.contains("attempted index of non-table") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: None,
            line_number: None,
            title: "Uninitialized Global Table Access".to_string(),
            explanation: "Mod code attempted to access properties of a global Lua table before PZ Build 42 instantiated it.".to_string(),
            recommended_action: "Apply Polyfill Rule: SAFE_GLOBAL_TABLE_ACCESS".to_string(),
            polyfill_rule_id_suggestion: Some("SAFE_GLOBAL_TABLE_ACCESS".to_string()),
        })
    } else if line.contains("NullPointerException") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: None,
            line_number: None,
            title: "Java Interop Null Pointer Exception".to_string(),
            explanation: "A Java method returned null or received a null parameter from a legacy Lua mod call.".to_string(),
            recommended_action: "Check object initialization or apply argument wrapper polyfill.".to_string(),
            polyfill_rule_id_suggestion: None,
        })
    } else {
        None
    }
}
