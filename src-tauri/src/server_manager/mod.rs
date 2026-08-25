use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::load_order::mod_info::get_all_user_zomboid_dirs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PZServerConfig {
    pub name: String,
    pub file_path: String,
    pub mods: Vec<String>,
    pub workshop_items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedicatedServerStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub server_name: Option<String>,
    pub memory_gb: Option<u32>,
    pub start_timestamp: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedPlayer {
    pub username: String,
    pub role: String,
    pub ping: u32,
    pub health: f32,
    pub is_godmode: bool,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub steam_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerQuickSettings {
    pub public_name: String,
    pub public_description: String,
    pub password: String,
    pub max_players: u32,
    pub pvp: bool,
    pub pause_empty: bool,
    pub open: bool,
    pub port: u32,
    pub rcon_port: u32,
    pub rcon_password: String,
    pub map_names: String,
}

#[tauri::command]
pub fn list_server_configs(user_zomboid_dir: String) -> Result<Vec<PZServerConfig>, String> {
    let mut configs = Vec::new();

    for user_dir in get_all_user_zomboid_dirs(&user_zomboid_dir) {
        let server_dir = user_dir.join("Server");
        if server_dir.exists() {
            if let Ok(entries) = fs::read_dir(&server_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("ini") {
                        let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                        if let Ok(content) = fs::read_to_string(&path) {
                            let mut mods = Vec::new();
                            let mut workshop_items = Vec::new();

                            for line in content.lines() {
                                let trimmed = line.trim();
                                if trimmed.starts_with("Mods=") {
                                    mods = trimmed[5..]
                                        .split(';')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                } else if trimmed.starts_with("WorkshopItems=") {
                                    workshop_items = trimmed[14..]
                                        .split(';')
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty())
                                        .collect();
                                }
                            }

                            configs.push(PZServerConfig {
                                name,
                                file_path: path.to_string_lossy().to_string(),
                                mods,
                                workshop_items,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(configs)
}

#[tauri::command]
pub fn sync_client_to_server(
    file_path: String,
    active_mod_ids: Vec<String>,
    active_workshop_ids: Vec<String>,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("Server .ini file does not exist.".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let mods_str = format!("Mods={}", active_mod_ids.join(";"));
    let ws_str = format!("WorkshopItems={}", active_workshop_ids.join(";"));

    let mut new_lines = Vec::new();
    let mut mods_found = false;
    let mut ws_found = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Mods=") {
            new_lines.push(mods_str.clone());
            mods_found = true;
        } else if trimmed.starts_with("WorkshopItems=") {
            new_lines.push(ws_str.clone());
            ws_found = true;
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !mods_found {
        new_lines.push(mods_str);
    }
    if !ws_found {
        new_lines.push(ws_str);
    }

    fs::write(path, new_lines.join("\r\n")).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn create_new_server_config(user_zomboid_dir: String, server_name: String) -> Result<PZServerConfig, String> {
    let clean_name = server_name.trim().replace(' ', "_");
    if clean_name.is_empty() {
        return Err("Invalid server name.".to_string());
    }

    let user_path = if user_zomboid_dir.is_empty() {
        dirs_next::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Zomboid")
    } else {
        PathBuf::from(user_zomboid_dir)
    };

    let server_dir = user_path.join("Server");
    fs::create_dir_all(&server_dir).map_err(|e| e.to_string())?;

    let ini_path = server_dir.join(format!("{}.ini", clean_name));

    let default_content = format!(
        "PVP=true\r\n\
PauseEmpty=true\r\n\
GlobalChat=true\r\n\
Open=true\r\n\
Public=true\r\n\
PublicName={}\r\n\
PublicDescription=Server managed by Project Zomboid Mod Studio\r\n\
MaxPlayers=16\r\n\
Mods=\r\n\
WorkshopItems=\r\n",
        clean_name
    );

    fs::write(&ini_path, default_content).map_err(|e| e.to_string())?;

    Ok(PZServerConfig {
        name: clean_name,
        file_path: ini_path.to_string_lossy().to_string(),
        mods: Vec::new(),
        workshop_items: Vec::new(),
    })
}

#[tauri::command]
pub fn delete_server_config(
    user_zomboid_dir: String,
    file_path: String,
    server_name: Option<String>,
) -> Result<bool, String> {
    let p = Path::new(&file_path);
    if p.exists() && p.is_file() {
        let _ = fs::remove_file(p);
    }

    let srv_name = server_name.unwrap_or_else(|| {
        p.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    if !srv_name.is_empty() {
        for user_dir in get_all_user_zomboid_dirs(&user_zomboid_dir) {
            let srv_dir = user_dir.join("Server");
            let _ = fs::remove_file(srv_dir.join(format!("{}.ini", srv_name)));
            let _ = fs::remove_file(srv_dir.join(format!("{}_SandboxVars.lua", srv_name)));
            let _ = fs::remove_file(srv_dir.join(format!("{}_spawnregions.lua", srv_name)));
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn save_server_log_snapshot(
    user_zomboid_dir: String,
    server_name: String,
    custom_lines: Option<Vec<String>>,
) -> Result<String, String> {
    let user_dirs = get_all_user_zomboid_dirs(&user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Invalid Zomboid directory.".to_string());
    }

    let primary_dir = &user_dirs[0];
    let logs_dir = primary_dir.join("Logs");
    let _ = fs::create_dir_all(&logs_dir);

    // Format: "servertest - 2026-08-24_10-48-00.txt"
    let now = chrono::Local::now();
    let timestamp_str = now.format("%Y-%m-%d_%H-%M-%S").to_string();
    let clean_srv = if server_name.trim().is_empty() { "server" } else { server_name.trim() };
    let filename = format!("{} - {}.txt", clean_srv, timestamp_str);
    let target_path = logs_dir.join(&filename);

    let content_to_write = if let Some(lines) = custom_lines {
        lines.join("\r\n")
    } else {
        let recent_lines = get_dedicated_server_logs(user_zomboid_dir.clone(), Some(5000))
            .unwrap_or_default();
        recent_lines.join("\r\n")
    };

    fs::write(&target_path, content_to_write)
        .map_err(|e| format!("Failed to write server log snapshot: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn launch_dedicated_server(
    pz_install_dir: String,
    user_zomboid_dir: String,
    server_name: String,
    memory_gb: Option<u32>,
    nosteam: Option<bool>,
) -> Result<u32, String> {
    let install_path = Path::new(&pz_install_dir);
    if !install_path.exists() {
        return Err(format!("Install directory not found: {}", pz_install_dir));
    }

    let mem = memory_gb.unwrap_or(4).max(2).min(32);
    let clean_name = server_name.trim().replace(' ', "_");
    let is_nosteam = nosteam.unwrap_or(false);

    let java_exe = install_path.join("jre64").join("bin").join("java.exe");
    let pz_server_bat = install_path.join("ProjectZomboidServer.bat");
    let start_server_bat = install_path.join("StartServer64.bat");
    let pz_exe = install_path.join("ProjectZomboid64.exe");

    let primary_user_dir = if !user_zomboid_dir.is_empty() {
        Path::new(&user_zomboid_dir).to_path_buf()
    } else if let Some(home) = dirs_next::home_dir() {
        home.join("Zomboid")
    } else {
        Path::new(".").to_path_buf()
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let mut cmd = if java_exe.exists() {
            let mut c = Command::new(&java_exe);
            c.arg("-Djava.awt.headless=true");
            c.arg("--enable-native-access=ALL-UNNAMED");
            c.arg("--add-exports=java.base/jdk.internal.misc=ALL-UNNAMED");
            if is_nosteam {
                c.arg("-Dzomboid.steam=0");
                c.arg("-Dzomboid.znetlog=0");
            } else {
                c.arg("-Dzomboid.steam=1");
                c.arg("-Dzomboid.znetlog=1");
            }
            c.arg("-XX:+UseZGC");
            c.arg("-XX:-CreateCoredumpOnCrash");
            c.arg("-XX:-OmitStackTraceInFastThrow");
            c.arg(format!("-Xmx{}g", mem));
            c.arg("-Djava.library.path=./natives/;./natives/win64/;./");
            c.arg("-cp");
            c.arg("./;projectzomboid.jar");
            c.arg("zombie.network.GameServer");
            c.arg("-servername");
            c.arg(&clean_name);
            c.arg(format!("-cachedir={}", primary_user_dir.display()));
            if is_nosteam {
                c.arg("-nosteam");
            }
            c
        } else if pz_server_bat.exists() {
            let mut c = Command::new("cmd.exe");
            c.args(&["/c", &pz_server_bat.to_string_lossy(), "-servername", &clean_name]);
            c
        } else if start_server_bat.exists() {
            let mut c = Command::new("cmd.exe");
            c.args(&["/c", &start_server_bat.to_string_lossy(), "-servername", &clean_name]);
            c
        } else if pz_exe.exists() {
            let mut c = Command::new(&pz_exe);
            c.args(&["-servername", &clean_name]);
            c
        } else {
            return Err("Could not find java.exe, ProjectZomboidServer.bat, or ProjectZomboid64.exe in install directory.".to_string());
        };

        cmd.current_dir(install_path);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: runs 100% headless inside PZ Mod Studio!

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn dedicated server: {}", e))?;
        let child_pid = child.id();

        // Save server state to JSON
        let state = DedicatedServerStatus {
            is_running: true,
            pid: Some(child_pid),
            server_name: Some(clean_name),
            memory_gb: Some(mem),
            start_timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .ok(),
        };

        let state_file = primary_user_dir.join("pz_server_state.json");
        let _ = fs::write(&state_file, serde_json::to_string_pretty(&state).unwrap_or_default());

        return Ok(child_pid);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Dedicated server launcher currently implemented for Windows.".to_string())
    }
}

#[tauri::command]
pub fn stop_dedicated_server(user_zomboid_dir: String, _pid: Option<u32>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let primary_user_dir = if !user_zomboid_dir.is_empty() {
            Path::new(&user_zomboid_dir).to_path_buf()
        } else if let Some(home) = dirs_next::home_dir() {
            home.join("Zomboid")
        } else {
            Path::new(".").to_path_buf()
        };

        let state_file = primary_user_dir.join("pz_server_state.json");
        let srv_name = if state_file.exists() {
            fs::read_to_string(&state_file)
                .ok()
                .and_then(|c| serde_json::from_str::<DedicatedServerStatus>(&c).ok())
                .and_then(|s| s.server_name)
                .unwrap_or_else(|| "servertest".to_string())
        } else {
            "servertest".to_string()
        };

        // Automatically archive the full server session log with timestamp
        let _ = save_server_log_snapshot(user_zomboid_dir.clone(), srv_name, None);

        // Terminate java.exe / ProjectZomboid64.exe dedicated server processes
        let mut cmd1 = Command::new("taskkill");
        cmd1.args(&["/F", "/IM", "java.exe"]);
        cmd1.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let _ = cmd1.output();

        if state_file.exists() {
            let _ = fs::remove_file(state_file);
        }

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn get_dedicated_server_status(user_zomboid_dir: String) -> Result<DedicatedServerStatus, String> {
    let primary_user_dir = if !user_zomboid_dir.is_empty() {
        Path::new(&user_zomboid_dir).to_path_buf()
    } else if let Some(home) = dirs_next::home_dir() {
        home.join("Zomboid")
    } else {
        Path::new(".").to_path_buf()
    };

    let state_file = primary_user_dir.join("pz_server_state.json");
    let mut state = if state_file.exists() {
        fs::read_to_string(&state_file)
            .ok()
            .and_then(|c| serde_json::from_str::<DedicatedServerStatus>(&c).ok())
            .unwrap_or(DedicatedServerStatus {
                is_running: false,
                pid: None,
                server_name: None,
                memory_gb: None,
                start_timestamp: None,
            })
    } else {
        DedicatedServerStatus {
            is_running: false,
            pid: None,
            server_name: None,
            memory_gb: None,
            start_timestamp: None,
        }
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("tasklist");
        cmd.args(&["/FO", "CSV", "/NH"]);
        cmd.creation_flags(0x08000000);

        if let Ok(output) = cmd.output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let found_proc = text.lines().find(|l| {
                l.contains("java.exe")
            });

            if let Some(proc_line) = found_proc {
                let pid_from_tasklist = proc_line
                    .split(',')
                    .nth(1)
                    .and_then(|p| p.trim_matches('"').parse::<u32>().ok());

                state.is_running = true;
                if state.pid.is_none() {
                    state.pid = pid_from_tasklist;
                }
                if state.server_name.is_none() {
                    state.server_name = Some("servertest".to_string());
                }
                return Ok(state);
            } else {
                if state_file.exists() {
                    let srv_name = state.server_name.clone().unwrap_or_else(|| "servertest".to_string());
                    let _ = save_server_log_snapshot(user_zomboid_dir.clone(), srv_name, None);
                    let _ = fs::remove_file(&state_file);
                }
                state.is_running = false;
                state.pid = None;
            }
        }
    }

    Ok(state)
}

#[tauri::command]
pub fn get_dedicated_server_logs(
    user_zomboid_dir: String,
    max_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let primary_user_dir = if !user_zomboid_dir.is_empty() {
        Path::new(&user_zomboid_dir).to_path_buf()
    } else if let Some(home) = dirs_next::home_dir() {
        home.join("Zomboid")
    } else {
        Path::new(".").to_path_buf()
    };

    let limit = max_lines.unwrap_or(300).max(20).min(2000);

    // Look for latest server debug log file in Zomboid/Logs/
    let logs_dir = primary_user_dir.join("Logs");
    let mut server_log_paths = Vec::new();

    if logs_dir.exists() {
        if let Ok(entries) = fs::read_dir(&logs_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let name = p.file_name().unwrap_or_default().to_string_lossy();
                    if name.contains("DebugLog-server.txt") || name.contains("DebugLog.txt") {
                        server_log_paths.push(p);
                    }
                }
            }
        }
    }

    server_log_paths.sort_by(|a, b| {
        let meta_a = a.metadata().and_then(|m| m.modified()).ok();
        let meta_b = b.metadata().and_then(|m| m.modified()).ok();
        meta_a.cmp(&meta_b)
    });

    let target_file = server_log_paths.last().cloned().unwrap_or_else(|| {
        primary_user_dir.join("console.txt")
    });

    if !target_file.exists() {
        return Ok(vec!["[PZ Mod Studio] Waiting for dedicated server to write log file...".to_string()]);
    }

    let file = fs::File::open(&target_file)
        .map_err(|e| format!("Failed to open log file '{}': {}", target_file.display(), e))?;
    
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        lines.push(line);
    }

    let total = lines.len();
    if total > limit {
        Ok(lines[total - limit..].to_vec())
    } else {
        Ok(lines)
    }
}

#[tauri::command]
pub fn get_connected_players(user_zomboid_dir: String) -> Result<Vec<ConnectedPlayer>, String> {
    let primary_user_dir = if !user_zomboid_dir.is_empty() {
        Path::new(&user_zomboid_dir).to_path_buf()
    } else if let Some(home) = dirs_next::home_dir() {
        home.join("Zomboid")
    } else {
        Path::new(".").to_path_buf()
    };

    // 1. Check pz_server_players.json from Bridge Companion Mod (both in Lua/ and root)
    let players_file_lua = primary_user_dir.join("Lua").join("pz_server_players.json");
    let players_file_root = primary_user_dir.join("pz_server_players.json");

    let target_players_file = if players_file_lua.exists() {
        Some(players_file_lua)
    } else if players_file_root.exists() {
        Some(players_file_root)
    } else {
        None
    };

    if let Some(pf) = target_players_file {
        if let Ok(content) = fs::read_to_string(&pf) {
            if let Ok(list) = serde_json::from_str::<Vec<ConnectedPlayer>>(&content) {
                if !list.is_empty() {
                    return Ok(list);
                }
            }
        }
    }

    // 2. Parse connection logs from Logs/
    let logs_dir = primary_user_dir.join("Logs");
    let mut online_map: std::collections::HashMap<String, ConnectedPlayer> = std::collections::HashMap::new();

    if logs_dir.exists() {
        if let Ok(entries) = fs::read_dir(&logs_dir) {
            let mut user_log_paths = Vec::new();
            let mut conn_log_paths = Vec::new();

            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if name.contains("user.txt") {
                        user_log_paths.push(p.clone());
                    }
                    if name.contains("connections.txt") {
                        conn_log_paths.push(p);
                    }
                }
            }

            user_log_paths.sort_by(|a, b| {
                let meta_a = a.metadata().and_then(|m| m.modified()).ok();
                let meta_b = b.metadata().and_then(|m| m.modified()).ok();
                meta_a.cmp(&meta_b)
            });
            conn_log_paths.sort_by(|a, b| {
                let meta_a = a.metadata().and_then(|m| m.modified()).ok();
                let meta_b = b.metadata().and_then(|m| m.modified()).ok();
                meta_a.cmp(&meta_b)
            });

            // Process latest user.txt
            if let Some(latest_user) = user_log_paths.last() {
                if let Ok(content) = fs::read_to_string(latest_user) {
                    for line in content.lines() {
                        let is_connect = line.contains("fully connected")
                            || (line.contains("connected")
                                && !line.contains("disconnected")
                                && !line.contains("Connection closed")
                                && !line.contains("Connection disconnect")
                                && !line.contains("Connection remove"));
                        let is_disconnect = line.contains("disconnected")
                            || line.contains("Connection closed")
                            || line.contains("Connection disconnect")
                            || line.contains("Connection remove");
                        let is_death = line.contains(" died at ");

                        if is_connect {
                            let mut username = String::new();
                            let mut steam_id = String::new();
                            let mut x = 0;
                            let mut y = 0;
                            let mut z = 0;

                            // Pattern: [25-08-26 01:39:14.144] 76561198078149251 "pichu" fully connected (11902,6894,0).
                            let quote_parts: Vec<&str> = line.split('"').collect();
                            if quote_parts.len() >= 3 {
                                username = quote_parts[1].trim().to_string();
                                if let Some(first_part) = quote_parts.first() {
                                    steam_id = first_part
                                        .split_whitespace()
                                        .last()
                                        .unwrap_or("")
                                        .chars()
                                        .filter(|c| c.is_ascii_digit())
                                        .collect();
                                }
                            } else if let Some(pos) = line.find("user ") {
                                let rest = &line[pos + 5..];
                                username = rest.split_whitespace().next().unwrap_or("").trim_matches('"').to_string();
                            } else if let Some(pos) = line.find("player ") {
                                let rest = &line[pos + 7..];
                                username = rest.split_whitespace().next().unwrap_or("").trim_matches('"').to_string();
                            }

                            if let Some(coord_start) = line.rfind('(') {
                                if let Some(coord_end) = line[coord_start..].find(')') {
                                    let coords_str = &line[coord_start + 1..coord_start + coord_end];
                                    let parts: Vec<&str> = coords_str.split(',').map(|s| s.trim()).collect();
                                    if parts.len() == 3 {
                                        x = parts[0].parse::<i32>().unwrap_or(0);
                                        y = parts[1].parse::<i32>().unwrap_or(0);
                                        z = parts[2].parse::<i32>().unwrap_or(0);
                                    }
                                }
                            }

                            if !username.is_empty() && username != "null" {
                                online_map.insert(username.clone(), ConnectedPlayer {
                                    username,
                                    role: "User".to_string(),
                                    ping: 35,
                                    health: 1.0,
                                    is_godmode: false,
                                    x,
                                    y,
                                    z,
                                    steam_id,
                                });
                            }
                        } else if is_disconnect {
                            let quote_parts: Vec<&str> = line.split('"').collect();
                            if quote_parts.len() >= 3 {
                                let username = quote_parts[1].trim();
                                online_map.remove(username);
                            } else if let Some(pos) = line.find("player ") {
                                let rest = &line[pos + 7..];
                                let username = rest.split_whitespace().next().unwrap_or("").trim_matches('"');
                                online_map.remove(username);
                            } else if let Some(pos) = line.find("user ") {
                                let rest = &line[pos + 5..];
                                let username = rest.split_whitespace().next().unwrap_or("").trim_matches('"');
                                online_map.remove(username);
                            }
                        } else if is_death {
                            if let Some(pos) = line.find("user ") {
                                if let Some(died_pos) = line.find(" died at ") {
                                    let username = line[pos + 5..died_pos].trim().trim_matches('"');
                                    if let Some(player) = online_map.get_mut(username) {
                                        player.health = 0.0;
                                        if let Some(coord_start) = line.rfind('(') {
                                            if let Some(coord_end) = line[coord_start..].find(')') {
                                                let coords_str = &line[coord_start + 1..coord_start + coord_end];
                                                let parts: Vec<&str> = coords_str.split(',').map(|s| s.trim()).collect();
                                                if parts.len() >= 3 {
                                                    player.x = parts[0].parse::<i32>().unwrap_or(player.x);
                                                    player.y = parts[1].parse::<i32>().unwrap_or(player.y);
                                                    player.z = parts[2].parse::<i32>().unwrap_or(player.z);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Also enhance with latest connections.txt (roles, steam_id)
            if let Some(latest_conn) = conn_log_paths.last() {
                if let Ok(content) = fs::read_to_string(latest_conn) {
                    for line in content.lines() {
                        if line.contains("username=") {
                            let mut username = String::new();
                            let mut role = String::new();
                            let mut steam_id = String::new();

                            for part in line.split_whitespace() {
                                if part.starts_with("username=\"") {
                                    username = part.trim_start_matches("username=\"").trim_end_matches('"').trim_end_matches('.').to_string();
                                } else if part.starts_with("role=\"") {
                                    role = part.trim_start_matches("role=\"").trim_end_matches('"').to_string();
                                } else if part.starts_with("steam-id=\"") {
                                    steam_id = part.trim_start_matches("steam-id=\"").trim_end_matches('"').to_string();
                                }
                            }

                            if !username.is_empty() && username != "null" {
                                if line.contains("event=\"disconnected\"") || line.contains("connection-type=\"Disconnected\"") {
                                    online_map.remove(&username);
                                } else if line.contains("fully-connected") || line.contains("client-connect") || line.contains("player-connect") {
                                    if let Some(player) = online_map.get_mut(&username) {
                                        if !role.is_empty() && role != "null" {
                                            player.role = role;
                                        }
                                        if !steam_id.is_empty() && steam_id != "0" {
                                            player.steam_id = steam_id;
                                        }
                                    } else if line.contains("fully-connected") {
                                        online_map.insert(username.clone(), ConnectedPlayer {
                                            username,
                                            role: if !role.is_empty() && role != "null" { role } else { "User".to_string() },
                                            ping: 35,
                                            health: 1.0,
                                            is_godmode: false,
                                            x: 0,
                                            y: 0,
                                            z: 0,
                                            steam_id: if steam_id != "0" { steam_id } else { String::new() },
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let result: Vec<ConnectedPlayer> = online_map.into_values().collect();
    Ok(result)
}

#[tauri::command]
pub fn send_server_command(
    user_zomboid_dir: String,
    action: String,
    target: Option<String>,
    message: Option<String>,
    reason: Option<String>,
) -> Result<bool, String> {
    let primary_user_dir = if !user_zomboid_dir.is_empty() {
        Path::new(&user_zomboid_dir)
    } else if let Some(home) = dirs_next::home_dir() {
        &home.join("Zomboid")
    } else {
        Path::new(".")
    };

    let payload = serde_json::json!({
        "action": action,
        "target": target,
        "message": message,
        "reason": reason,
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    });

    let json_text = serde_json::to_string_pretty(&payload).unwrap_or_default();

    // 1. Write to Zomboid/Lua/ (where PZ getFileReader reads)
    let lua_dir = primary_user_dir.join("Lua");
    let _ = fs::create_dir_all(&lua_dir);
    let _ = fs::write(lua_dir.join("pz_server_commands.json"), &json_text);
    let _ = fs::write(lua_dir.join("pz_ipc_queue.json"), &json_text);

    // 2. Write to root Zomboid/ (fallback)
    let _ = fs::write(primary_user_dir.join("pz_server_commands.json"), &json_text);
    let _ = fs::write(primary_user_dir.join("pz_ipc_queue.json"), &json_text);

    Ok(true)
}

#[tauri::command]
pub fn get_server_quick_settings(file_path: String) -> Result<ServerQuickSettings, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("Server .ini file not found.".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let mut settings = ServerQuickSettings {
        public_name: String::new(),
        public_description: String::new(),
        password: String::new(),
        max_players: 16,
        pvp: true,
        pause_empty: true,
        open: true,
        port: 16261,
        rcon_port: 27015,
        rcon_password: String::new(),
        map_names: "Muldraugh, KY".to_string(),
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("PublicName=") {
            settings.public_name = trimmed[11..].trim().to_string();
        } else if trimmed.starts_with("PublicDescription=") {
            settings.public_description = trimmed[18..].trim().to_string();
        } else if trimmed.starts_with("Password=") {
            settings.password = trimmed[9..].trim().to_string();
        } else if trimmed.starts_with("MaxPlayers=") {
            if let Ok(v) = trimmed[11..].trim().parse::<u32>() {
                settings.max_players = v;
            }
        } else if trimmed.starts_with("PVP=") {
            settings.pvp = trimmed[4..].trim().eq_ignore_ascii_case("true");
        } else if trimmed.starts_with("PauseEmpty=") {
            settings.pause_empty = trimmed[11..].trim().eq_ignore_ascii_case("true");
        } else if trimmed.starts_with("Open=") {
            settings.open = trimmed[5..].trim().eq_ignore_ascii_case("true");
        } else if trimmed.starts_with("DefaultPort=") {
            if let Ok(v) = trimmed[12..].trim().parse::<u32>() {
                settings.port = v;
            }
        } else if trimmed.starts_with("RCONPort=") {
            if let Ok(v) = trimmed[9..].trim().parse::<u32>() {
                settings.rcon_port = v;
            }
        } else if trimmed.starts_with("RCONPassword=") {
            settings.rcon_password = trimmed[13..].trim().to_string();
        } else if trimmed.starts_with("Map=") {
            settings.map_names = trimmed[4..].trim().to_string();
        }
    }

    Ok(settings)
}

#[tauri::command]
pub fn save_server_quick_settings(file_path: String, settings: ServerQuickSettings) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("Server .ini file not found.".to_string());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut new_lines = Vec::new();

    let mut keys_found = std::collections::HashSet::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("PublicName=") {
            new_lines.push(format!("PublicName={}", settings.public_name));
            keys_found.insert("PublicName");
        } else if trimmed.starts_with("PublicDescription=") {
            new_lines.push(format!("PublicDescription={}", settings.public_description));
            keys_found.insert("PublicDescription");
        } else if trimmed.starts_with("Password=") {
            new_lines.push(format!("Password={}", settings.password));
            keys_found.insert("Password");
        } else if trimmed.starts_with("MaxPlayers=") {
            new_lines.push(format!("MaxPlayers={}", settings.max_players));
            keys_found.insert("MaxPlayers");
        } else if trimmed.starts_with("PVP=") {
            new_lines.push(format!("PVP={}", settings.pvp));
            keys_found.insert("PVP");
        } else if trimmed.starts_with("PauseEmpty=") {
            new_lines.push(format!("PauseEmpty={}", settings.pause_empty));
            keys_found.insert("PauseEmpty");
        } else if trimmed.starts_with("Open=") {
            new_lines.push(format!("Open={}", settings.open));
            keys_found.insert("Open");
        } else if trimmed.starts_with("DefaultPort=") {
            new_lines.push(format!("DefaultPort={}", settings.port));
            keys_found.insert("DefaultPort");
        } else if trimmed.starts_with("RCONPort=") {
            new_lines.push(format!("RCONPort={}", settings.rcon_port));
            keys_found.insert("RCONPort");
        } else if trimmed.starts_with("RCONPassword=") {
            new_lines.push(format!("RCONPassword={}", settings.rcon_password));
            keys_found.insert("RCONPassword");
        } else if trimmed.starts_with("Map=") {
            new_lines.push(format!("Map={}", settings.map_names));
            keys_found.insert("Map");
        } else {
            new_lines.push(line.to_string());
        }
    }

    // Append any missing keys
    if !keys_found.contains("PublicName") { new_lines.push(format!("PublicName={}", settings.public_name)); }
    if !keys_found.contains("PublicDescription") { new_lines.push(format!("PublicDescription={}", settings.public_description)); }
    if !keys_found.contains("Password") { new_lines.push(format!("Password={}", settings.password)); }
    if !keys_found.contains("MaxPlayers") { new_lines.push(format!("MaxPlayers={}", settings.max_players)); }
    if !keys_found.contains("PVP") { new_lines.push(format!("PVP={}", settings.pvp)); }
    if !keys_found.contains("PauseEmpty") { new_lines.push(format!("PauseEmpty={}", settings.pause_empty)); }
    if !keys_found.contains("Open") { new_lines.push(format!("Open={}", settings.open)); }

    fs::write(path, new_lines.join("\r\n")).map_err(|e| e.to_string())?;

    Ok(true)
}

