pub mod load_times;
pub mod requires;

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// The mod the game blamed, when the line says so.
    pub mod_name: Option<String>,
    /// Whether the game threw (ERROR, or a stack trace) or complained and carried on (WARN).
    pub severity: Severity,
}

/// What the game itself said about the line a card came from.
///
/// The level the game wrote is the only honest measure: `WARN` means it noticed and went on
/// (`require("X") failed`, a translation with a stray `%`, even "Exception thrown" when the game
/// caught it and reported it as a warning), `ERROR` and the bare lines of a stack trace mean
/// something threw. A warning dressed as a crash made a working list look broken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Severity {
    Exception,
    Warning,
}

impl Severity {
    pub fn of_line(line: &str) -> Severity {
        let line = line.trim_start();
        if line.starts_with("WARN") || line.starts_with("LOG") || line.starts_with("DEBUG") {
            Severity::Warning
        } else {
            Severity::Exception
        }
    }
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

                // Only the one line the launch mode is about. Everything else the player set —
                // borderless above all — is theirs and is left alone.
                for line in content.lines() {
                    if line.starts_with("fullScreen=") {
                        new_lines.push(format!("fullScreen={}", !is_windowed));
                        found_fullscreen = true;
                    } else {
                        new_lines.push(line.to_string());
                    }
                }

                if !found_fullscreen {
                    new_lines.push(format!("fullScreen={}", !is_windowed));
                }

                let updated = new_lines.join("\r\n");
                if updated != content {
                    let _ = crate::load_order::ini_parser::write_file_with_backup(
                        &options_path,
                        &updated,
                        &user_dir.join("PZModStudio_Backups"),
                    );
                }
            }
        }
    }
}

/// Java agents of mods (Zombie Buddy) in the game's launch file only when the mod list has the mod
/// on: they load outside the mod list, so otherwise they run with any profile.
fn sync_java_agents_for_launch(install_dir: &Path, user_zomboid_dir: &str) {
    let Some(z_dir) = crate::load_order::mod_info::get_existing_user_zomboid_dirs(user_zomboid_dir).into_iter().next() else {
        return;
    };
    let active = crate::load_order::ini_parser::parse_default_txt(&z_dir.join("mods").join("default.txt"));
    if let Err(e) = crate::studio_link::sync_java_agents(install_dir, &z_dir, &active) {
        eprintln!("[StudioLink] {}", e);
    }
}

/// Spawns or attaches to an active Project Zomboid process and monitors console.txt in real time.
pub fn launch_sandbox_and_watch<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    config: SandboxLaunchConfig,
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
    sync_java_agents_for_launch(install_dir, &config.user_zomboid_dir);

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
        // Compatible copies in Zomboid/mods must win over their Workshop originals.
        cmd.args(crate::compat::launch_args(&config.user_zomboid_dir));

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

    watch_console_log(app);

    Ok(pid)
}

/// Only one thread ever tails `console.txt`, however many times the game is launched: a second
/// one would double every line and every crash card.
static LOG_WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

/// Follows the game's `console.txt` and sends each new line to the Monitor Center, whether the
/// game was launched from the Studio or from Steam. When the file is not there yet — a player who
/// has never run the game has no log — it waits, and says so instead of sitting silent.
pub fn watch_console_log<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if LOG_WATCHER_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || {
        let mut file_offset: Option<u64> = None;
        let mut error_counter = 1;
        let mut announced_wait = false;
        let mut watching: Option<std::path::PathBuf> = None;
        let mut blame = ModBlame::default();
        // One card per mod and complaint: a mod that fails on every tick would otherwise bury
        // everything else.
        let mut already_reported: std::collections::HashSet<String> = std::collections::HashSet::new();

        loop {
            // The folder can be set or corrected while the Studio is open, so look again each time.
            let found = crate::load_order::mod_info::get_all_user_zomboid_dirs("")
                .into_iter()
                .map(|d| d.join("console.txt"))
                .find(|p| p.is_file());

            let Some(console_txt_path) = found else {
                if !announced_wait {
                    announced_wait = true;
                    let _ = app.emit(
                        "sandbox-log",
                        LogLinePayload {
                            line: "[PZ Monitor Center] No console.txt yet. Start Project Zomboid once and its log appears here.".to_string(),
                            is_error: false,
                        },
                    );
                }
                thread::sleep(Duration::from_millis(1000));
                continue;
            };

            if watching.as_deref() != Some(console_txt_path.as_path()) {
                let _ = app.emit(
                    "sandbox-log",
                    LogLinePayload {
                        line: format!("[PZ Monitor Center] Following {}", console_txt_path.display()),
                        is_error: false,
                    },
                );
                watching = Some(console_txt_path.clone());
                announced_wait = false;
                // Start at the end: the Studio reports what happens from now on.
                file_offset = std::fs::metadata(&console_txt_path).map(|m| m.len()).ok();
            }

            if let Ok(file) = File::open(&console_txt_path) {
                let mut offset = file_offset.unwrap_or(0);
                if let Ok(metadata) = file.metadata() {
                    if metadata.len() < offset {
                        // A new session truncated the file: read it from the top, and forget the
                        // last session -- what it blamed, and which lines were already reported.
                        // Without this a relaunch reported nothing it had reported before, so a
                        // mod's warning that survived a fix never came back as a card, and the
                        // Monitor said two warnings over a log that held six.
                        offset = 0;
                        already_reported.clear();
                        blame = ModBlame::default();
                        let _ = app.emit("sandbox-session-started", ());
                    }
                }
                let mut reader = BufReader::new(file);
                if reader.seek(SeekFrom::Start(offset)).is_ok() {
                    let mut line_buf = String::new();
                    while reader.read_line(&mut line_buf).unwrap_or(0) > 0 {
                        let trimmed = line_buf.trim_end().to_string();
                        let is_error = trimmed.contains("ERROR")
                            || trimmed.contains("Exception")
                            || trimmed.contains("KahluaThreadException");

                        let _ = app.emit("sandbox-log", LogLinePayload { line: trimmed.clone(), is_error });

                        blame.observe(&trimmed);
                        let culprit = blame.of(&trimmed);

                        if let Some(mut card) = translate_log_error(&trimmed, error_counter) {
                            card.mod_name = culprit.clone();
                            let _ = app.emit("sandbox-error-card", card);
                            error_counter += 1;
                        } else if let Some(name) = culprit {
                            // Not a pattern the Studio knows, but the game named the mod, which is
                            // the question a player actually has: which one of my mods did this?
                            let complaining = is_error || trimmed.starts_with("WARN");
                            let key = format!("{}|{}", name, trimmed.chars().take(80).collect::<String>());
                            if complaining && already_reported.insert(key) {
                                let _ = app.emit("sandbox-error-card", blame_card(&trimmed, &name, error_counter));
                                error_counter += 1;
                            }
                        }
                        line_buf.clear();
                    }
                    file_offset = reader.stream_position().ok();
                }
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}

/// Which mod a log line belongs to.
///
/// The game is explicit about this in two ways, so no guessing is needed:
///   `WARN : Lua f:0 at Lua((MOD:Nature's Call)).NC_Main.lua> require(...) failed`
///   `LOG  : Mod f:0> mod "CleanUI" overrides media/lua/client/isui/isinventorypane.lua`
/// The first names the mod on the line itself; the second builds a map from a file path to
/// whichever mod replaced it, which covers lines that only mention a path.
#[derive(Debug, Clone, Default)]
pub struct ModBlame {
    /// media path (lowercased) -> the mod that overrides it, last one winning as the game loads.
    overrides: std::collections::HashMap<String, String>,
    /// The last `Lua((MOD:X))` seen and how many lines ago, because the game prints the failing
    /// stack frame first and the ERROR line after it:
    ///
    /// ```text
    ///     Lua((MOD:Fancy Handwork B42.20)).FHhandleKeybinds(aFancyHandwork.lua:126)
    /// ERROR: General f:240> 20)).FHhandleKeybinds> Exception thrown
    /// ```
    ///
    /// The ERROR line names nobody -- the game even truncates the mod's name to "20))" -- so
    /// read on its own it is one more anonymous Java exception, which is how 413 of them in one
    /// session went unattributed.
    recent: Option<(String, usize)>,
}

/// How many lines a mod's name carries forward. The frame and its error are next to each other;
/// a wider window would start blaming whoever happened to be mentioned earlier.
const BLAME_WINDOW: usize = 3;

impl ModBlame {
    /// Reads `mod "X" overrides <path>` lines as they go by, and remembers a mod named in a
    /// stack frame for the few lines that follow it.
    pub fn observe(&mut self, line: &str) {
        self.recent = match self.recent.take() {
            Some((name, age)) if age + 1 < BLAME_WINDOW => Some((name, age + 1)),
            _ => None,
        };
        if let Some(name) = Self::named_in(line) {
            self.recent = Some((name, 0));
        }
        let Some(rest) = line.split("> mod \"").nth(1) else { return };
        let Some((mod_name, tail)) = rest.split_once("\" overrides ") else { return };
        self.overrides.insert(tail.trim().to_lowercase(), mod_name.to_string());
    }

    /// The mod a line names itself, in `Lua((MOD:X))`.
    fn named_in(line: &str) -> Option<String> {
        let rest = line.split("(MOD:").nth(1)?;
        let (name, _) = rest.split_once(')')?;
        let name = name.trim();
        (!name.is_empty()).then(|| name.to_string())
    }

    /// The mod this line is about, if the game said.
    pub fn of(&self, line: &str) -> Option<String> {
        if let Some(rest) = line.split("(MOD:").nth(1) {
            if let Some((name, _)) = rest.split_once(')') {
                let name = name.trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
        // Otherwise: a media path in the line, if some mod replaced that file.
        let lower = line.to_lowercase();
        if let Some(start) = lower.find("media/").or_else(|| lower.find("media\\")) {
            let path: String = lower[start..]
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != '"' && *c != ')' && *c != '\'')
                .collect();
            let path = path.replace('\\', "/");
            if let Some(owner) = self.overrides.get(path.trim_end_matches(|c| c == ',' || c == '.')) {
                return Some(owner.clone());
            }
        }
        // Failing both: the mod named a line or two above, which for a Java exception is the
        // Lua frame that threw it.
        self.recent.as_ref().map(|(name, _)| name.clone())
    }
}

/// The display name every Studio package gets in `generate_master_patch`: `name=PZ Mod Studio Patch: <x>`.
pub const STUDIO_PACKAGE_PREFIX: &str = "PZ Mod Studio Patch: ";

/// What one mod did to the last session's log: how many times it threw, how many times the game
/// warned about it, and the last line of each.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModErrorStat {
    /// The name the game wrote, which is the mod's display name.
    pub mod_name: String,
    pub exceptions: usize,
    pub warnings: usize,
    pub last_exception: Option<String>,
    pub last_warning: Option<String>,
}

/// Every mod the last session's log named on a line of trouble, with its counts.
///
/// The same attribution as the Monitor's cards: the name on the line, the mod that overrides the
/// path, or the mod in the frame a few lines above. Only lines the game marked as trouble count;
/// a mod that merely loaded is not here. Studio packages are counted under their own name, which
/// is what the game writes.
pub fn error_stats_per_mod(lines: impl Iterator<Item = String>) -> Vec<ModErrorStat> {
    let mut blame = ModBlame::default();
    let mut stats: std::collections::BTreeMap<String, ModErrorStat> = Default::default();
    for line in lines {
        blame.observe(&line);
        let trimmed = line.trim();
        // Only the game's own level lines count: the Java frames under an ERROR would count the
        // same throw three or four times over.
        let is_trouble = trimmed.starts_with("ERROR") || trimmed.starts_with("WARN");
        if !is_trouble {
            continue;
        }
        let Some(name) = blame.of(trimmed) else { continue };
        let entry = stats.entry(name.clone()).or_insert_with(|| ModErrorStat { mod_name: name, ..Default::default() });
        match Severity::of_line(trimmed) {
            Severity::Exception => {
                entry.exceptions += 1;
                entry.last_exception = Some(trimmed.chars().take(200).collect());
            }
            Severity::Warning => {
                entry.warnings += 1;
                entry.last_warning = Some(trimmed.chars().take(200).collect());
            }
        }
    }
    let mut out: Vec<ModErrorStat> = stats.into_values().collect();
    out.sort_by(|a, b| (b.exceptions, b.warnings).cmp(&(a.exceptions, a.warnings)));
    out
}

/// The per-mod counts of the session in `console.txt` now.
pub fn error_stats_from_console(user_zomboid_dir: &str) -> Vec<ModErrorStat> {
    let Some(path) = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .map(|d| d.join("console.txt"))
        .find(|p| p.is_file())
    else {
        return Vec::new();
    };
    let Ok(file) = File::open(&path) else { return Vec::new() };
    error_stats_per_mod(BufReader::new(file).lines().map_while(Result::ok))
}

/// A line worth showing even though it matches no known pattern, because the game named a mod.
fn blame_card(line: &str, mod_name: &str, counter: usize) -> TranslatedErrorPayload {
    let severity = Severity::of_line(line);
    // "WARN : Lua f:0 at Lua((MOD:X)).File.lua> require("Y") failed" -> the part after ">"
    let detail = line.split_once('>').map(|(_, rest)| rest.trim()).unwrap_or(line).to_string();
    let source_file = line
        .split("))." )
        .nth(1)
        .and_then(|rest| rest.split('>').next())
        .map(|f| f.trim().to_string())
        .filter(|f| f.ends_with(".lua"));
    // The game names a Studio package when it read the package's copy of a file -- a mod's own
    // file, patched. Blaming "PZ Mod Studio Patch: MergedPatch" is true and useless: the line
    // is the mod's, and the copy either changed it or did not.
    if let Some(package) = mod_name.strip_prefix(STUDIO_PACKAGE_PREFIX) {
        let file = source_file.clone().unwrap_or_else(|| "a file".to_string());
        return TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file,
            line_number: None,
            title: format!("{}, the patched copy in {}, reported a problem", file, package),
            explanation: if detail.is_empty() { line.to_string() } else { detail },
            recommended_action: format!(
                "The game read {}'s copy of this file, not the mod's. If the patch did not touch this line, the mod's own copy says the same thing, and a copy that changes nothing only freezes the file at today's version: unmerge it in the Merger. If it did, this is the line to look at there.",
                package
            ),
            polyfill_rule_id_suggestion: None,
            mod_name: Some(mod_name.to_string()),
            severity,
        };
    }
    TranslatedErrorPayload {
        id: format!("err_{}", counter),
        raw_error: line.to_string(),
        source_file,
        line_number: None,
        title: format!("{} reported a problem", mod_name),
        explanation: if detail.is_empty() { line.to_string() } else { detail },
        recommended_action: match severity {
            Severity::Exception => format!(
                "The game named {} on this line. If something is misbehaving in game, switching that mod off is the quickest way to tell whether it is the cause.",
                mod_name
            ),
            Severity::Warning => format!(
                "The game named {} here and carried on. Nothing to do unless something in that mod misbehaves in game; then this line is where to look.",
                mod_name
            ),
        },
        polyfill_rule_id_suggestion: None,
        mod_name: Some(mod_name.to_string()),
        severity,
    }
}

/// Translates raw Java stacktraces & Lua errors into actionable cards.
pub fn translate_log_error(line: &str, counter: usize) -> Option<TranslatedErrorPayload> {
    let mut card = translate_log_error_rule(line, counter)?;
    card.severity = Severity::of_line(line);
    Some(card)
}

fn translate_log_error_rule(line: &str, counter: usize) -> Option<TranslatedErrorPayload> {
    // A card says something went wrong. The rules below match on names a mod puts in the log --
    // "FancyHandwork", "SaucedCarts", "dSAG" -- and the game writes those names when the mod
    // merely loads, so without this the Monitor reported `LOG : Mod f:0> loading FancyHandwork`
    // as an uncaught error on tick. Nothing but a line the game itself marked as trouble.
    let is_trouble = line.starts_with("ERROR")
        || line.starts_with("WARN")
        || line.contains("Exception")
        || line.contains("stack trace")
        || line.contains("Error:");
    if !is_trouble {
        return None;
    }
    if line.contains("isLocalPlayer()") || line.contains("ToggleDoorActual") || line.contains("ToggleWindow") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("zombie/iso/objects/IsoDoor.java".to_string()),
            line_number: None,
            title: "B42 IsoDoor / IsoWindow NPC Null Pointer Interop".to_string(),
            explanation: "A non-player entity (zombie or NPC) interacted with a door or window, triggering a Build 42 JVM check for local players on a null character object.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_OBJECT_INTERACT_SAFETY".to_string(),
            mod_name: None,
            severity: Severity::Exception,
            polyfill_rule_id_suggestion: Some("B42_OBJECT_INTERACT_SAFETY".to_string()),
        })
    } else if line.contains("BWORoomPrograms") || (line.contains("restaurant") && line.contains("getName")) {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/shared/BWORoomPrograms.lua".to_string()),
            line_number: None,
            title: "Bandits Week One Dining Room Safety (B42)".to_string(),
            explanation: "Bandits Week One room program attempted to query getName() on an outdoor/unzoned tile where getRoom() is nil, generating error floods on each AI tick.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_BANDITS_ROOM_SAFETY".to_string(),
            mod_name: None,
            severity: Severity::Exception,
            polyfill_rule_id_suggestion: Some("B42_BANDITS_ROOM_SAFETY".to_string()),
        })
    } else if line.contains("dSAG") || line.contains("onNewDay") || line.contains("ReportWindow") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/client/dSAG/dSAG_Window.lua".to_string()),
            line_number: None,
            title: "Daily Report Journal Callback Protection".to_string(),
            explanation: "Daily Report Journal rollover or player death event executed callbacks on an uninitialized UI window.".to_string(),
            recommended_action: "Apply Polyfill Rule: B42_DAILY_REPORT_SAFETY".to_string(),
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
            polyfill_rule_id_suggestion: Some("B42_DAILY_REPORT_SAFETY".to_string()),
        })
    } else if line.contains("FancyHandwork") || line.contains("fancyMP") || line.contains("aFancyHandwork") {
        Some(TranslatedErrorPayload {
            id: format!("err_{}", counter),
            raw_error: line.to_string(),
            source_file: Some("media/lua/client/aFancyHandwork.lua".to_string()),
            line_number: None,
            title: "Fancy Handwork Multiplayer Hand Sync Safety".to_string(),
            explanation: "Fancy Handwork fancyMP loop threw an uncaught error when evaluating local/remote player hand objects on tick.".to_string(),
            recommended_action: "Apply Universal Master Polyfills to guard FancyHandwork callbacks safely.".to_string(),
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
            mod_name: None,
            severity: Severity::Exception,
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
    sync_java_agents_for_launch(install_path, user_zomboid_dir);

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
    if !extra_args.iter().any(|a| a == "-modfolders") {
        cmd.args(crate::compat::launch_args(user_zomboid_dir));
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

/// Canonical bridge script from mods/Z_PZModStudio_Bridge, compiled in.
const BRIDGE_CLIENT_LUA: &str =
    include_str!("../../../mods/Z_PZModStudio_Bridge/media/lua/client/PZModStudio_Bridge.lua");

/// True when the bridge in `<user_zomboid_dir>/mods` is missing or differs from the scripts
/// bundled in this build (so fixes reach existing installs, not only new ones).
pub fn bridge_companion_mod_needs_update(user_zomboid_dir: &str) -> bool {
    let b42 = Path::new(user_zomboid_dir).join("mods").join("Z_PZModStudio_Bridge").join("42").join("media").join("lua");
    let same = |path: std::path::PathBuf, expected: &str| {
        std::fs::read_to_string(path).is_ok_and(|current| current == expected)
    };
    !(same(b42.join("client").join("PZModStudio_Bridge.lua"), BRIDGE_CLIENT_LUA)
        && same(b42.join("shared").join("Z_PZModStudio_Polyfills.lua"), crate::patch_generator::MASTER_POLYFILL_LUA)
        && !b42.join("server").join("PZModStudio_Bridge_Server.lua").exists())
}

/// Installs (or refreshes) the Z_PZModStudio_Bridge companion mod in the user's Zomboid/mods directory.
pub fn install_bridge_companion_mod(user_zomboid_dir: &str) -> Result<String, String> {
    let target_mod_dir = Path::new(user_zomboid_dir)
        .join("mods")
        .join("Z_PZModStudio_Bridge");

    let client_lua_dir = target_mod_dir.join("media").join("lua").join("client");
    let b42_dir = target_mod_dir.join("42");
    std::fs::create_dir_all(&client_lua_dir)
        .map_err(|e| format!("Failed to create directories for bridge mod: {}", e))?;
    std::fs::create_dir_all(&b42_dir)
        .map_err(|e| format!("Failed to create 42 directory for bridge mod: {}", e))?;

    let mod_info_content = r#"name=PZ Mod Studio Live Bridge
id=Z_PZModStudio_Bridge
description=Companion IPC Bridge for PZ Mod Studio and AI Agents to execute real-time game commands, equip items, and debug live sessions.
poster=poster.png
icon=icon.png
modversion=1.0.0
versionMin=41.00
"#;

    let b42_mod_info_content = r#"name=PZ Mod Studio Live Bridge
id=Z_PZModStudio_Bridge
description=Companion IPC Bridge for PZ Mod Studio and AI Agents to execute real-time game commands, equip items, and debug live sessions.
poster=poster.png
icon=icon.png
modversion=1.0.0
versionMin=42.0.0
"#;

    let lua_script_content = BRIDGE_CLIENT_LUA;

    let shared_lua_dir = target_mod_dir.join("media").join("lua").join("shared");
    let _ = std::fs::create_dir_all(&shared_lua_dir);

    let b42_media_dir = b42_dir.join("media");
    let b42_client_dir = b42_media_dir.join("lua").join("client");
    let b42_shared_dir = b42_media_dir.join("lua").join("shared");
    let _ = std::fs::create_dir_all(&b42_client_dir);
    let _ = std::fs::create_dir_all(&b42_shared_dir);

    // Older versions also installed the client script under server/, which made it load twice
    // in single player (two consumers racing for the same queue file). Remove those copies.
    for server_dir in [target_mod_dir.join("media").join("lua").join("server"), b42_media_dir.join("lua").join("server")] {
        let _ = std::fs::remove_file(server_dir.join("PZModStudio_Bridge_Server.lua"));
        let _ = std::fs::remove_dir(&server_dir); // only if now empty
    }

    let polyfills_content = crate::patch_generator::generate_master_polyfill_lua();
    let _ = std::fs::write(shared_lua_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfills_content);
    let _ = std::fs::write(b42_shared_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfills_content);

    let _ = std::fs::write(target_mod_dir.join("mod.info"), mod_info_content);
    let _ = std::fs::write(b42_dir.join("mod.info"), b42_mod_info_content);
    let _ = std::fs::write(client_lua_dir.join("PZModStudio_Bridge.lua"), lua_script_content);
    let _ = std::fs::write(b42_client_dir.join("PZModStudio_Bridge.lua"), lua_script_content);

    let png_bytes = crate::patch_generator::get_preview_png_bytes();
    let _ = std::fs::write(target_mod_dir.join("poster.png"), &png_bytes);
    let _ = std::fs::write(target_mod_dir.join("icon.png"), &png_bytes);
    let _ = std::fs::write(b42_dir.join("poster.png"), &png_bytes);
    let _ = std::fs::write(b42_dir.join("icon.png"), &png_bytes);

    let meta = serde_json::json!({
        "is_packaged": true,
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_bridge_script_is_valid_lua() {
        let parsed = crate::diff_engine::lua::validate_lua_syntax(BRIDGE_CLIENT_LUA);
        assert!(parsed.is_valid, "bridge Lua does not parse: {:?}", parsed.error_message);
        assert!(BRIDGE_CLIENT_LUA.contains("PRIVILEGED_ACTIONS"));
    }

    #[test]
    fn install_refreshes_stale_bridge_and_removes_server_copy() {
        let dir = std::env::temp_dir().join(format!("pzms-bridge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dir_str = dir.to_string_lossy().to_string();
        let server_copy = dir.join("mods/Z_PZModStudio_Bridge/42/media/lua/server/PZModStudio_Bridge_Server.lua");
        std::fs::create_dir_all(server_copy.parent().unwrap()).unwrap();
        std::fs::write(&server_copy, "-- old").unwrap();

        assert!(bridge_companion_mod_needs_update(&dir_str));
        install_bridge_companion_mod(&dir_str).unwrap();
        assert!(!server_copy.exists());
        assert!(!bridge_companion_mod_needs_update(&dir_str));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod blame_tests {
    use super::*;

    #[test]
    fn reads_the_mod_the_game_names() {
        let mut blame = ModBlame::default();
        let warn = "WARN : Lua          f:0 at Lua((MOD:Filibuster Rhymes' Certified Used Cars!)).FR_VehicleMechanics.lua> require(\"ISUI/ISVehicleMechanics\") failed";
        assert_eq!(blame.of(warn).as_deref(), Some("Filibuster Rhymes' Certified Used Cars!"));

        // The game also says who replaced each file; that covers lines with only a path.
        blame.observe("LOG  : Mod          f:0> mod \"CleanUI\" overrides media/lua/client/isui/isinventorypane.lua");
        assert_eq!(
            blame.of("ERROR: General  f:0> something broke in media/lua/client/ISUI/ISInventoryPane.lua").as_deref(),
            Some("CleanUI")
        );
        assert_eq!(blame.of("ERROR: General  f:0> media/lua/client/Untouched.lua").as_deref(), None);
        assert_eq!(blame.of("LOG  : General  f:0> nothing to do with mods"), None);
    }


    /// Runs the blame over a real log. PZMS_CONSOLE=C:\\Users\\you\\Zomboid\\console.txt
    /// cargo test blame_on_a_real_log -- --ignored --nocapture
    #[test]
    #[ignore]
    fn blame_on_a_real_log() {
        let path = std::env::var("PZMS_CONSOLE").expect("Set PZMS_CONSOLE to a console.txt");
        let text = std::fs::read_to_string(&path).expect("could not read it");
        let mut blame = ModBlame::default();
        let mut cards: Vec<(String, String)> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for line in text.lines() {
            blame.observe(line);
            let complaining = line.starts_with("ERROR") || line.starts_with("WARN");
            if let Some(name) = blame.of(line) {
                if complaining && seen.insert(format!("{}|{}", name, line.chars().take(80).collect::<String>())) {
                    let card = blame_card(line, &name, cards.len() + 1);
                    cards.push((card.mod_name.unwrap_or_default(), card.explanation));
                }
            }
        }
        println!("{} file overrides learned from the log", blame.overrides.len());
        println!("{} complaints attributed to a mod:", cards.len());
        for (name, what) in &cards {
            println!("  {name}: {}", what.chars().take(90).collect::<String>());
        }
        assert!(!blame.overrides.is_empty(), "the game logs which mod overrides each file");
    }

    #[test]
    fn a_named_mod_becomes_a_card() {
        let line = "WARN : Lua          f:0 at Lua((MOD:Nature's Call)).NC_Main.lua> require(\"NCUtils\") failed";
        let card = blame_card(line, "Nature's Call", 3);
        assert_eq!(card.mod_name.as_deref(), Some("Nature's Call"));
        assert_eq!(card.source_file.as_deref(), Some("NC_Main.lua"));
        assert!(card.title.contains("Nature's Call"));
        assert_eq!(card.explanation, "require(\"NCUtils\") failed");
        assert!(card.line_number.is_none(), "no line number is invented");
    }
}

#[cfg(test)]
mod card_gate_tests {
    use super::translate_log_error;

    #[test]
    fn a_mod_merely_loading_is_not_an_error() {
        // The line that produced a card claiming Fancy Handwork threw on tick.
        assert!(translate_log_error("LOG  : Mod          f:0> loading FancyHandworkB42_19", 1).is_none());
        assert!(translate_log_error("LOG  : Mod          f:0> loading SaucedCarts", 1).is_none());
        assert!(translate_log_error("LOG  : General      f:0> mod \"dSAG\" overrides media/x.lua", 1).is_none());
    }

    #[test]
    fn a_real_error_line_still_makes_its_card() {
        let card = translate_log_error(
            "ERROR: General      f:304> 20)).FHhandleKeybinds> Exception thrown aFancyHandwork.lua:126",
            1,
        );
        assert!(card.is_some());
        assert!(card.unwrap().title.contains("Fancy Handwork"));
    }

    /// The level the game wrote decides: a WARN is a warning even when it says "Exception".
    #[test]
    fn a_card_carries_the_level_the_game_gave_the_line() {
        use super::Severity;
        let translator = translate_log_error(
            "WARN : General      f:0> Translator.reportMissingArgumentsFromPastAbuse> Exception thrown java.util.UnknownFormatConversionException: Conversion = ')'",
            1,
        )
        .expect("a card");
        assert_eq!(translator.severity, Severity::Warning);

        let threw = translate_log_error(
            "ERROR: General      f:304> 20)).FHhandleKeybinds> Exception thrown aFancyHandwork.lua:126",
            2,
        )
        .expect("a card");
        assert_eq!(threw.severity, Severity::Exception);

        // A stack-trace line has no level prefix: it only exists because something threw.
        assert_eq!(
            Severity::of_line("java.lang.NullPointerException: Cannot invoke \"zombie.input.KeybindId.getId()\""),
            Severity::Exception
        );
        assert_eq!(
            Severity::of_line("WARN : Lua          f:0 at Lua((MOD:The Only Cure)).ZombiesAmputation.lua> require(\"TOC/Controllers/ItemsController\") failed"),
            Severity::Warning
        );
    }
}

#[cfg(test)]
mod live_card_tests {
    /// How many cards the real log makes, and which lines they come from.
    /// PZMS_CONSOLE=... cargo test --release the_real_cards -- --ignored --nocapture
    #[test]
    #[ignore]
    fn the_real_cards() {
        let Ok(path) = std::env::var("PZMS_CONSOLE") else { return };
        let text = std::fs::read_to_string(&path).expect("console.txt");
        let mut cards = Vec::new();
        let mut from_log_lines = 0;
        for (i, line) in text.lines().enumerate() {
            if let Some(card) = super::translate_log_error(line, i) {
                if !line.starts_with("ERROR") && !line.starts_with("WARN") {
                    from_log_lines += 1;
                }
                cards.push((card.title, line.to_string()));
            }
        }
        let mut titles: Vec<&String> = cards.iter().map(|(t, _)| t).collect();
        titles.sort();
        titles.dedup();
        println!("{} matching lines, {} distinct cards", cards.len(), titles.len());
        for t in &titles {
            let n = cards.iter().filter(|(title, _)| &title == t).count();
            let example = cards.iter().find(|(title, _)| &title == t).unwrap();
            println!("  {:>5}x {}", n, t);
            println!("          from: {}", example.1.trim().chars().take(100).collect::<String>());
        }
        println!("cards made from lines the game did not mark as trouble: {}", from_log_lines);
    }
}

#[cfg(test)]
mod error_stats_tests {
    use super::*;

    #[test]
    fn a_session_is_counted_per_mod_by_what_the_game_did() {
        let lines = [
            "LOG  : Mod          f:0> loading FancyHandworkB42_19",
            "WARN : Lua          f:0 at Lua((MOD:The Only Cure)).ZombiesAmputation.lua> require(\"TOC/Controllers/ItemsController\") failed",
            "\tLua((MOD:Fancy Handwork B42.20)).FHhandleKeybinds(aFancyHandwork.lua:126)",
            "ERROR: General      f:240> 20)).FHhandleKeybinds> Exception thrown",
            "\tLua((MOD:Fancy Handwork B42.20)).FHhandleKeybinds(aFancyHandwork.lua:126)",
            "ERROR: General      f:241> 20)).FHhandleKeybinds> Exception thrown",
            "	java.lang.NullPointerException: Cannot invoke \"zombie.input.KeybindId.getId()\"",
            "	at zombie.core.Core.getKey(Core.java:3023)",
            "LOG  : General      f:242> something else",
            "LOG  : General      f:243> and more",
            "LOG  : General      f:244> and more",
            "ERROR: General      f:0 at ImportedSkeleton.collectBoneFrames  > Could not find bone index for node name: \"Root\"",
        ];
        let stats = error_stats_per_mod(lines.iter().map(|s| s.to_string()));
        assert_eq!(stats.len(), 2, "{:?}", stats);
        assert_eq!(stats[0].mod_name, "Fancy Handwork B42.20");
        assert_eq!(stats[0].exceptions, 2);
        assert_eq!(stats[0].warnings, 0);
        assert_eq!(stats[1].mod_name, "The Only Cure");
        assert_eq!(stats[1].warnings, 1);
        assert_eq!(stats[1].exceptions, 0);
    }
}

#[cfg(test)]
mod blame_window_tests {
    use super::ModBlame;

    #[test]
    fn a_java_exception_is_blamed_on_the_lua_frame_just_above_it() {
        let mut blame = ModBlame::default();
        // Exactly as the game writes it.
        let lines = [
            "\tLua((MOD:Fancy Handwork B42.20)).FHhandleKeybinds(aFancyHandwork.lua:126)",
            "ERROR: General      f:240> 20)).FHhandleKeybinds> Exception thrown",
            "\tjava.lang.NullPointerException: Cannot invoke \"zombie.input.KeybindId.getId()\"",
        ];
        let mut blamed = Vec::new();
        for line in lines {
            blame.observe(line);
            blamed.push(blame.of(line));
        }
        assert_eq!(blamed[1].as_deref(), Some("Fancy Handwork B42.20"));
        assert_eq!(blamed[2].as_deref(), Some("Fancy Handwork B42.20"));
    }

    /// A package's copy of a mod file is named as such, not as a mod of its own.
    #[test]
    fn a_packages_copy_is_a_patched_copy_not_a_mod() {
        let card = super::blame_card(
            "WARN : Lua          f:0 at Lua((MOD:PZ Mod Studio Patch: MergedPatch)).MoodlesIn.lua> require(\"LSMoodleManager\") failed",
            "PZ Mod Studio Patch: MergedPatch",
            1,
        );
        assert_eq!(card.title, "MoodlesIn.lua, the patched copy in MergedPatch, reported a problem");
        assert!(card.recommended_action.contains("unmerge"));
        assert_eq!(card.severity, super::Severity::Warning);
    }

    #[test]
    fn a_name_does_not_carry_across_the_whole_log() {
        let mut blame = ModBlame::default();
        blame.observe("\tLua((MOD:Some Mod)).thing(file.lua:1)");
        for _ in 0..5 {
            blame.observe("LOG  : General      f:0> something else entirely");
        }
        assert_eq!(blame.of("ERROR: General      f:9> Exception thrown"), None);
    }
}
