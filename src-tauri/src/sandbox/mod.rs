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

/// Checks Windows task list to detect if ProjectZomboid64.exe is already running.
pub fn find_running_pz_pid() -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("tasklist");
        cmd.args(&["/FI", "IMAGENAME eq ProjectZomboid64.exe", "/FO", "CSV", "/NH"]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("ProjectZomboid64.exe") {
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        let pid_str = parts[1].trim().trim_matches('"');
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            return Some(pid);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Configures options.ini for windowed or fullscreen mode before launching.
pub fn configure_options_ini(user_zomboid_dir: &str, is_windowed: bool) {
    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir) {
        let options_path = user_dir.join("options.ini");
        if options_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&options_path) {
                let mut new_lines = Vec::new();
                let mut found_fullscreen = false;
                let mut found_borderless = false;

                for line in content.lines() {
                    if line.starts_with("fullScreen=") {
                        new_lines.push(format!("fullScreen={}", !is_windowed));
                        found_fullscreen = true;
                    } else if line.starts_with("borderless=") {
                        new_lines.push("borderless=false".to_string());
                        found_borderless = true;
                    } else {
                        new_lines.push(line.to_string());
                    }
                }

                if !found_fullscreen {
                    new_lines.push(format!("fullScreen={}", !is_windowed));
                }
                if !found_borderless {
                    new_lines.push("borderless=false".to_string());
                }

                let _ = std::fs::write(&options_path, new_lines.join("\r\n"));
            }
        }
    }
}

/// Spawns or attaches to an active Project Zomboid process and monitors console.txt in real time.
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

    let is_normal = config.test_mode.contains("NORMAL");
    let is_windowed = config.test_mode.contains("WINDOWED");

    // Configure options.ini for both fullscreen and windowed modes across user directories
    configure_options_ini(&config.user_zomboid_dir, is_windowed);

    // Launch Project Zomboid directly with independent null stdio to ensure clean GUI instantiation
    let is_already_running = find_running_pz_pid().is_some();
    let pid = if let Some(existing_pid) = find_running_pz_pid() {
        existing_pid
    } else {
        let mut cmd = Command::new(&exe_path);
        cmd.current_dir(install_dir);

        if !is_normal {
            cmd.arg("-debug");
        }

        if is_windowed {
            cmd.arg("-windowed");
        } else {
            cmd.arg("-fullscreen");
        }

        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());

        let child = cmd.spawn().map_err(|e| format!("Failed to launch ProjectZomboid64.exe: {}", e))?;
        let child_pid = child.id();
        thread::sleep(Duration::from_millis(300));
        find_running_pz_pid().unwrap_or(child_pid)
    };

    // Emit initial log message
    let app = app_handle.clone();
    let mode_desc = match config.test_mode.as_str() {
        "DEBUG_FULLSCREEN" | "MONITORED" => "Debug Mode (Fullscreen)",
        "DEBUG_WINDOWED" | "WINDOWED" | "WINDOWED_DEEP" => "Debug Mode (Windowed)",
        "NORMAL_FULLSCREEN" => "Normal Game (Fullscreen)",
        "NORMAL_WINDOWED" | "NORMAL" | "NORMAL_DIRECT" => "Normal Game (Windowed)",
        _ => "Custom Mode",
    };

    if is_already_running {
        let _ = app.emit("sandbox-log", LogLinePayload {
            line: format!("[PZ Monitor Center] Project Zomboid is ALREADY RUNNING (PID: {}). Attached to active session! ({})", pid, mode_desc),
            is_error: false,
        });
    } else {
        let _ = app.emit("sandbox-log", LogLinePayload {
            line: format!("[PZ Monitor Center] Launched new ProjectZomboid64.exe session! PID: {} | {}", pid, mode_desc),
            is_error: false,
        });
    }

    // Spawn background thread to stream console.txt lines and detect crashes
    let console_txt_path = Path::new(&config.user_zomboid_dir).join("console.txt");

    thread::spawn(move || {
        let mut file_offset = if let Ok(metadata) = std::fs::metadata(&console_txt_path) {
            metadata.len()
        } else {
            0u64
        };
        let mut error_counter = 1;

        while !stop_signal.load(Ordering::Relaxed) {
            if console_txt_path.exists() {
                if let Ok(file) = File::open(&console_txt_path) {
                    if let Ok(metadata) = file.metadata() {
                        let current_len = metadata.len();
                        if current_len < file_offset {
                            // File was truncated or recreated by new PZ session: reset offset to start!
                            file_offset = 0;
                        }
                    }

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
            thread::sleep(Duration::from_millis(200));
        }
    });

    Ok(pid)
}

/// Translates raw Java stacktraces & Lua errors into actionable cards.
pub fn translate_log_error(line: &str, counter: usize) -> Option<TranslatedErrorPayload> {
    if line.contains("isLocalPlayer()") || line.contains("ToggleDoorActual") || line.contains("ToggleWindow") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("zombie/iso/objects/IsoDoor.java".to_string()),
            line_number: None,
            title: "B42 IsoDoor / IsoWindow NPC Null Pointer Interop".to_string(),
            explanation: "A non-player entity (zombie or NPC) interacted with a door or window, triggering a Build 42 JVM check for local players on a null character object.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_OBJECT_INTERACT_SAFETY".to_string(),
            polyfill_rule_id_suggestion: Some("B42_OBJECT_INTERACT_SAFETY".to_string()),
        })
    } else if line.contains("BWORoomPrograms") || (line.contains("restaurant") && line.contains("getName")) {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/shared/BWORoomPrograms.lua".to_string()),
            line_number: Some(1005),
            title: "Bandits Week One Dining Room Safety (B42)".to_string(),
            explanation: "Bandits Week One room program attempted to query getName() on an outdoor/unzoned tile where getRoom() is nil, generating error floods on each AI tick.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_BANDITS_ROOM_SAFETY".to_string(),
            polyfill_rule_id_suggestion: Some("B42_BANDITS_ROOM_SAFETY".to_string()),
        })
    } else if line.contains("dSAG") || line.contains("onNewDay") || line.contains("ReportWindow") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/client/dSAG/dSAG_Window.lua".to_string()),
            line_number: Some(1121),
            title: "Daily Report Journal Callback Protection".to_string(),
            explanation: "Daily Report Journal rollover or player death event executed callbacks on an uninitialized UI window.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_DAILY_REPORT_SAFETY".to_string(),
            polyfill_rule_id_suggestion: Some("B42_DAILY_REPORT_SAFETY".to_string()),
        })
    } else if line.contains("UnknownFormatConversionException") {
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
    } else if line.contains("attempted index of non-table") || line.contains("attempted index: getName of non-table") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: None,
            line_number: None,
            title: "Uninitialized Global Table Access".to_string(),
            explanation: "Mod code attempted to access properties of a nil/uninitialized table before PZ Build 42 instantiated it.".to_string(),
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
            recommended_action: "Apply Universal Master Polyfills to handle null Java interop arguments safely.".to_string(),
            polyfill_rule_id_suggestion: Some("B42_OBJECT_INTERACT_SAFETY".to_string()),
        })
    } else if line.contains("KahluaThreadException") || line.contains("se.krka.kahlua.vm.KahluaException") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: None,
            line_number: None,
            title: "Lua Runtime Execution Crash (Kahlua)".to_string(),
            explanation: "An unhandled Lua runtime exception was thrown inside the PZ Kahlua VM.".to_string(),
            recommended_action: "Apply Universal Master Polyfills to protect game loops and callframe stacktraces.".to_string(),
            polyfill_rule_id_suggestion: Some("SAFE_GLOBAL_TABLE_ACCESS".to_string()),
        })
    } else if line.contains("IndexOutOfBoundsException") || line.contains("Index 0 out of bounds") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("java/util/ArrayList.java".to_string()),
            line_number: None,
            title: "Multiplayer Java ArrayList Out of Bounds (B42)".to_string(),
            explanation: "A mod accessed IsoPlayer.getPlayers() or getOnlinePlayers() index 0 while the Java player collection was empty during a render/tick loop in Multiplayer.".to_string(),
            recommended_action: "Apply Universal Master Polyfills (Safe ArrayList Proxy & getOnlinePlayers shield).".to_string(),
            polyfill_rule_id_suggestion: Some("B42_DAILY_REPORT_SAFETY".to_string()),
        })
    } else if line.contains("FancyHandwork") || line.contains("fancyMP") || line.contains("aFancyHandwork") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/client/aFancyHandwork.lua".to_string()),
            line_number: Some(336),
            title: "Fancy Handwork Multiplayer Hand Sync Safety".to_string(),
            explanation: "Fancy Handwork fancyMP loop threw an uncaught error when evaluating local/remote player hand objects on tick.".to_string(),
            recommended_action: "Apply Universal Master Polyfills to guard FancyHandwork callbacks safely.".to_string(),
            polyfill_rule_id_suggestion: Some("SAFE_GLOBAL_TABLE_ACCESS".to_string()),
        })
    } else if line.contains("SaucedCarts") || line.contains("Pushable Carts") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/client/SaucedCarts.lua".to_string()),
            line_number: None,
            title: "SaucedCarts Pushable Carts Multiplayer Sync".to_string(),
            explanation: "Pushable Carts vehicle/entity interaction threw a null pointer exception during multiplayer state updates.".to_string(),
            recommended_action: "Apply Universal Master Polyfills to guard SaucedCarts interop.".to_string(),
            polyfill_rule_id_suggestion: Some("SAFE_GLOBAL_TABLE_ACCESS".to_string()),
        })
    } else if line.contains("duplicate recipe") || line.contains("duplicate item") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: None,
            line_number: None,
            title: "Duplicate Item/Recipe ID Collision".to_string(),
            explanation: "Multiple active mods registered the same script ID or recipe name, causing overwrite conflicts.".to_string(),
            recommended_action: "Use Merger Module to merge script definitions into Master Patch.".to_string(),
            polyfill_rule_id_suggestion: None,
        })
    } else {
        None
    }
}

/// Terminates a running Project Zomboid instance using OS process signals or taskkill.
pub fn kill_pz_game(pid: Option<u32>, force: bool) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("taskkill");
        if force {
            cmd.arg("/F");
        }
        if let Some(p) = pid {
            cmd.args(&["/PID", &p.to_string()]);
        } else {
            cmd.args(&["/IM", "ProjectZomboid64.exe"]);
        }
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = cmd.output().map_err(|e| format!("Failed to execute taskkill: {}", e))?;
        if output.status.success() {
            let msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(if msg.is_empty() { "Project Zomboid process terminated successfully.".to_string() } else { msg })
        } else {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if err.contains("not found") || err.contains("no such process") {
                Ok("Project Zomboid is not running.".to_string())
            } else {
                Err(format!("Taskkill error: {}", err))
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Process termination is only supported on Windows in this build.".to_string())
    }
}

/// Launches ProjectZomboid64.exe directly with custom CLI flags.
pub fn launch_pz_direct(
    pz_install_dir: &str,
    user_zomboid_dir: &str,
    debug: bool,
    windowed: bool,
    nosteam: bool,
    extra_args: &[String],
) -> Result<u32, String> {
    let install_path = Path::new(pz_install_dir);
    let exe_path = install_path.join("ProjectZomboid64.exe");

    if !exe_path.exists() {
        return Err(format!("ProjectZomboid64.exe not found at: {}", exe_path.display()));
    }

    if windowed {
        configure_options_ini(user_zomboid_dir, true);
    }

    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(install_path);

    if debug {
        cmd.arg("-debug");
    }
    if nosteam {
        cmd.arg("-nosteam");
    }
    for arg in extra_args {
        cmd.arg(arg);
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn ProjectZomboid64.exe: {}", e))?;
    let child_pid = child.id();
    thread::sleep(Duration::from_millis(300));
    Ok(find_running_pz_pid().unwrap_or(child_pid))
}

/// Writes an action/command to the IPC command queue file for the companion mod to consume.
pub fn write_game_ipc_command(user_zomboid_dir: &str, command: serde_json::Value) -> Result<String, String> {
    let lua_dir = Path::new(user_zomboid_dir).join("Lua");
    let _ = std::fs::create_dir_all(&lua_dir);

    let json_text = serde_json::to_string_pretty(&command)
        .map_err(|e| format!("Failed to serialize IPC command: {}", e))?;

    // Primary target: Zomboid/Lua/pz_ipc_queue.json (read by PZ getFileReader)
    let ipc_path_lua = lua_dir.join("pz_ipc_queue.json");
    std::fs::write(&ipc_path_lua, &json_text)
        .map_err(|e| format!("Failed to write IPC command queue at {}: {}", ipc_path_lua.display(), e))?;

    // Secondary fallback: Zomboid/pz_ipc_queue.json
    let ipc_path_root = Path::new(user_zomboid_dir).join("pz_ipc_queue.json");
    let _ = std::fs::write(&ipc_path_root, &json_text);

    Ok(format!("IPC command successfully enqueued at {}", ipc_path_lua.display()))
}

/// Reads the latest response emitted by the companion mod from pz_ipc_resp.json.
pub fn read_game_ipc_response(user_zomboid_dir: &str) -> Result<Option<serde_json::Value>, String> {
    let resp_path_lua = Path::new(user_zomboid_dir).join("Lua").join("pz_ipc_resp.json");
    let resp_path_root = Path::new(user_zomboid_dir).join("pz_ipc_resp.json");

    let target_path = if resp_path_lua.exists() {
        resp_path_lua
    } else if resp_path_root.exists() {
        resp_path_root
    } else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read IPC response: {}", e))?;

    if content.trim().is_empty() || content.trim() == "{}" {
        return Ok(None);
    }

    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse IPC response JSON: {}", e))?;

    Ok(Some(parsed))
}

/// Installs the Z_PZModStudio_Bridge companion mod into the user's Zomboid/mods directory.
pub fn install_bridge_companion_mod(user_zomboid_dir: &str) -> Result<String, String> {
    let target_mod_dir = Path::new(user_zomboid_dir)
        .join("mods")
        .join("Z_PZModStudio_Bridge");

    let client_lua_dir = target_mod_dir.join("media").join("lua").join("client");
    std::fs::create_dir_all(&client_lua_dir)
        .map_err(|e| format!("Failed to create directories for bridge mod: {}", e))?;

    let mod_info_content = r#"name=PZ Mod Studio Live Bridge
id=Z_PZModStudio_Bridge
description=Companion IPC Bridge for PZ Mod Studio and AI Agents to execute real-time game commands, equip items, and debug live sessions.
poster=poster.png
versionMin=41.00
"#;

    let lua_script_content = r#"-- =============================================================================
-- PZ Mod Studio — Live Companion Bridge Mod
-- Allows AI Agents & Developer Tools to execute in-game commands, spawn/equip items,
-- evaluate dynamic Lua, broadcast server alerts, and stream player telemetry.
-- =============================================================================

local Bridge = {}
Bridge.tickCount = 0
Bridge.RESP_FILE = "pz_ipc_resp.json"
Bridge.PLAYERS_FILE = "pz_server_players.json"
Bridge.QUEUE_FILES = { "pz_ipc_queue.json", "pz_server_commands.json" }

local function safeHaloText(player, text, r, g, b)
    if not player or not text then return end
    pcall(function()
        if player.setHaloNote then
            player:setHaloNote(tostring(text), r or 255, g or 215, b or 0, 350)
        elseif HaloTextHelper and HaloTextHelper.addText then
            HaloTextHelper.addText(player, tostring(text))
        end
    end)
end

function Bridge.UpdatePlayersState(player)
    if not player then return end
    local username = player:getUsername() or "Player"
    local x = math.floor(player:getX() or 0)
    local y = math.floor(player:getY() or 0)
    local z = math.floor(player:getZ() or 0)
    local health = 1.0
    if player.getBodyDamage and player:getBodyDamage() then
        health = (player:getBodyDamage():getOverallBodyHealth() or 100) / 100
    end
    local isGod = false
    if player.isGodMod then
        isGod = player:isGodMod() == true
    end
    local role = "User"
    if player.getAccessLevel then
        local acc = player:getAccessLevel()
        if acc and acc ~= "" and acc ~= "none" then
            role = acc
        end
    end
    local steamId = ""
    if player.getSteamID then
        local s = player:getSteamID()
        if s then steamId = tostring(s) end
    end
    local ping = 35
    if player.getPing then
        ping = player:getPing() or 35
    end

    local jsonStr = string.format(
        '[{"username":"%s","role":"%s","ping":%d,"health":%.2f,"is_godmode":%s,"x":%d,"y":%d,"z":%d,"steam_id":"%s"}]',
        username:gsub('"', '\\"'),
        role:gsub('"', '\\"'),
        ping,
        health,
        tostring(isGod),
        x,
        y,
        z,
        steamId:gsub('"', '\\"')
    )

    local writer = getFileWriter(Bridge.PLAYERS_FILE, true, false)
    if writer then
        writer:write(jsonStr)
        writer:close()
    end
end

function Bridge.ProcessQueueFile(queueFile, player)
    local reader = getFileReader(queueFile, false)
    if not reader then return end

    local raw = ""
    local line = reader:readLine()
    while line do
        raw = raw .. line
        line = reader:readLine()
    end
    reader:close()

    if raw ~= "" and raw ~= "{}" and not raw:match("^%s*$") then
        -- Immediately clear queue file to prevent repeated execution on error
        local writer = getFileWriter(queueFile, true, false)
        if writer then
            writer:write("{}")
            writer:close()
        end

        local success, err = pcall(function()
            Bridge.ExecuteCommand(raw, player)
        end)

        -- Write response
        local respWriter = getFileWriter(Bridge.RESP_FILE, true, false)
        if respWriter then
            if success then
                respWriter:write('{"status": "ok", "timestamp": "' .. tostring(getTimeInMillis()) .. '"}')
            else
                respWriter:write('{"status": "error", "message": "' .. tostring(err):gsub('"', '\\"') .. '"}')
            end
            respWriter:close()
        end
    end
end

function Bridge.OnTick()
    Bridge.tickCount = Bridge.tickCount + 1

    local player = getPlayer()
    if not player then return end

    -- Update live players JSON every 30 frames (~0.5 sec)
    if Bridge.tickCount % 30 == 0 then
        pcall(function() Bridge.UpdatePlayersState(player) end)
    end

    -- Check for commands every 10 frames (~0.15s)
    if Bridge.tickCount % 10 ~= 0 then return end

    for _, qFile in ipairs(Bridge.QUEUE_FILES) do
        Bridge.ProcessQueueFile(qFile, player)
    end
end

function Bridge.ExecuteCommand(jsonStr, player)
    local actionMatch = jsonStr:match('"action"%s*:%s*"([^"]+)"')
    if not actionMatch then return end

    if actionMatch == "broadcast" then
        local msgMatch = jsonStr:match('"message"%s*:%s*"([^"]+)"')
        if msgMatch then
            local unescaped = msgMatch:gsub('\\n', ' '):gsub('\\"', '"')
            safeHaloText(player, "[SERVER]: " .. unescaped, 255, 69, 0)
            pcall(function()
                if processSayMessage then
                    processSayMessage("[ANNOUNCEMENT]: " .. unescaped)
                elseif ISChat and ISChat.addLineToChat then
                    ISChat.addLineToChat("[ANNOUNCEMENT]: " .. unescaped, 0)
                end
            end)
            print("[PZModStudio_Bridge] Broadcast received: " .. unescaped)
        end
    elseif actionMatch == "kick" then
        local targetMatch = jsonStr:match('"target"%s*:%s*"([^"]+)"')
        local reasonMatch = jsonStr:match('"reason"%s*:%s*"([^"]+)"') or "Kicked by admin"
        if not targetMatch or targetMatch == player:getUsername() then
            safeHaloText(player, "YOU HAVE BEEN KICKED: " .. reasonMatch, 255, 0, 0)
            pcall(function()
                if isClient() and getCore() then
                    getCore():quit()
                end
            end)
        end
    elseif actionMatch == "ban" then
        local targetMatch = jsonStr:match('"target"%s*:%s*"([^"]+)"')
        local reasonMatch = jsonStr:match('"reason"%s*:%s*"([^"]+)"') or "Banned by admin"
        if not targetMatch or targetMatch == player:getUsername() then
            safeHaloText(player, "YOU HAVE BEEN BANNED: " .. reasonMatch, 255, 0, 0)
            pcall(function()
                if isClient() and getCore() then
                    getCore():quit()
                end
            end)
        end
    elseif actionMatch == "give_item" then
        local itemMatch = jsonStr:match('"item"%s*:%s*"([^"]+)"')
        local countMatch = tonumber(jsonStr:match('"count"%s*:%s*(%d+)')) or 1
        local equipMatch = jsonStr:match('"equip"%s*:%s*true') or jsonStr:match('"equip"%s*:%s*"primary"')
        if itemMatch then
            local lastItem = nil
            for i = 1, countMatch do
                lastItem = player:getInventory():AddItem(itemMatch)
            end
            if lastItem and equipMatch then
                player:setPrimaryHandItem(lastItem)
                player:setSecondaryHandItem(lastItem)
            end
            safeHaloText(player, "Added: " .. itemMatch .. (countMatch > 1 and (" x" .. tostring(countMatch)) or ""), 0, 255, 0)
            print("[PZModStudio_Bridge] Successfully added item: " .. itemMatch)
        end
    elseif actionMatch == "eval_lua" then
        local codeMatch = jsonStr:match('"code"%s*:%s*"(.-)"%s*[,}]')
        if not codeMatch then
            codeMatch = jsonStr:match('"code"%s*:%s*"([^"]+)"')
        end
        if codeMatch then
            local unescaped = codeMatch:gsub('\\n', '\n'):gsub('\\r', ''):gsub('\\t', '\t'):gsub('\\"', '"'):gsub('\\\\', '\\')
            local func, loadErr = loadstring(unescaped)
            if func then
                local execOk, execErr = pcall(func)
                if not execOk then
                    print("[PZModStudio_Bridge] Lua runtime error in eval: " .. tostring(execErr))
                    safeHaloText(player, "Lua Error: " .. tostring(execErr), 255, 0, 0)
                else
                    safeHaloText(player, "Lua Executed", 100, 200, 255)
                end
            else
                print("[PZModStudio_Bridge] Lua syntax error in eval: " .. tostring(loadErr))
            end
        end
    elseif actionMatch == "set_godmode" or actionMatch == "godmode" then
        local current = false
        if player.isGodMod then current = player:isGodMod() == true end
        player:setGodMod(not current)
        if not current then
            safeHaloText(player, "Godmode ENABLED", 255, 215, 0)
        else
            safeHaloText(player, "Godmode DISABLED", 200, 200, 200)
        end
    elseif actionMatch == "teleport" then
        local xMatch = tonumber(jsonStr:match('"x"%s*:%s*([%d%.]+)'))
        local yMatch = tonumber(jsonStr:match('"y"%s*:%s*([%d%.]+)'))
        local zMatch = tonumber(jsonStr:match('"z"%s*:%s*([%d%.]+)')) or 0
        if xMatch and yMatch then
            player:setX(xMatch)
            player:setY(yMatch)
            player:setZ(zMatch)
            player:setLx(xMatch)
            player:setLy(yMatch)
            player:setLz(zMatch)
            safeHaloText(player, string.format("Teleported to %d, %d, %d", xMatch, yMatch, zMatch), 200, 100, 255)
        end
    end
end

Events.OnTick.Add(Bridge.OnTick)
print("[PZModStudio_Bridge] Live Companion Mod Initialized successfully!")
"#;

    let shared_lua_dir = target_mod_dir.join("media").join("lua").join("shared");
    let _ = std::fs::create_dir_all(&shared_lua_dir);

    let polyfills_content = crate::patch_generator::generate_master_polyfill_lua();
    let _ = std::fs::write(shared_lua_dir.join("Z_PZModStudio_Polyfills.lua"), polyfills_content);

    let _ = std::fs::write(target_mod_dir.join("mod.info"), mod_info_content);
    let _ = std::fs::write(client_lua_dir.join("PZModStudio_Bridge.lua"), lua_script_content);

    let png_bytes = crate::patch_generator::get_preview_png_bytes();
    let _ = std::fs::write(target_mod_dir.join("poster.png"), &png_bytes);
    let _ = std::fs::write(target_mod_dir.join("icon.png"), &png_bytes);

    let meta = serde_json::json!({
        "is_packaged": false,
        "is_visible_in_modlist": true,
        "created_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default(),
        "packaged_mod_ids": [],
        "merged_file_paths": []
    });
    let _ = std::fs::write(target_mod_dir.join("patch_metadata.json"), serde_json::to_string_pretty(&meta).unwrap_or_default());

    Ok(format!("Bridge mod successfully installed at {}", target_mod_dir.display()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFileInfo {
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
    pub modified_timestamp: u64,
    pub is_active_console: bool,
}

pub fn list_available_log_files(user_zomboid_dir: &str) -> Vec<LogFileInfo> {
    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for u_dir in user_dirs {
        // 1. Check console.txt
        let console_p = u_dir.join("console.txt");
        if console_p.exists() && seen.insert(console_p.clone()) {
            let meta = std::fs::metadata(&console_p).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mod_time = meta.and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(LogFileInfo {
                file_name: "console.txt".to_string(),
                absolute_path: console_p.to_string_lossy().to_string(),
                size_bytes: size,
                modified_timestamp: mod_time,
                is_active_console: true,
            });
        }

        // 2. Check Logs/ folder
        let logs_dir = u_dir.join("Logs");
        if logs_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(logs_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() && p.extension().map(|e| e == "txt").unwrap_or(false) {
                        if seen.insert(p.clone()) {
                            let meta = std::fs::metadata(&p).ok();
                            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                            let mod_time = meta.and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                            files.push(LogFileInfo {
                                file_name: fname,
                                absolute_path: p.to_string_lossy().to_string(),
                                size_bytes: size,
                                modified_timestamp: mod_time,
                                is_active_console: false,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.modified_timestamp.cmp(&a.modified_timestamp));
    files
}

pub fn read_log_file(file_path: &str, max_lines: Option<usize>) -> Result<Vec<String>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let file = File::open(path).map_err(|e| format!("Error opening file: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    for line in reader.lines() {
        if let Ok(l) = line {
            lines.push(l);
        }
    }

    if let Some(limit) = max_lines {
        if lines.len() > limit {
            let start = lines.len() - limit;
            return Ok(lines[start..].to_vec());
        }
    }

    Ok(lines)
}

