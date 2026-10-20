//! Studio Link: the game shows the profile that is active in the Studio, and what the player
//! changes in the game comes back to that profile.
//!
//! - `Z_StudioLink` (source: `mods/Z_StudioLink/`) is a companion mod that is always on. It reads
//!   `<Zomboid>/Lua/PZModStudio_Link.txt` (`profile=` and one `member=` line per mod of the
//!   profile, on or off), leaves everything else out of the game's Mods screen and refuses a save
//!   that uses a mod outside the profile.
//! - Turning mods on or off or reordering them in the game makes the game rewrite
//!   `mods/default.txt`; [`watch_mod_list`] notices and puts that into the active profile.
//! - Zombie Buddy's core is not loaded through the mod list but by `-agentlib:zbNative` in the
//!   game's `ProjectZomboid64.json`, so it ran whatever the profile said. [`sync_java_agents`]
//!   takes that line out for a profile without Zombie Buddy and puts it back for one with it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::Emitter;

pub const LINK_MOD_ID: &str = "Z_StudioLink";
pub const LINK_FILE: &str = "PZModStudio_Link.txt";
/// Sent to the window when the game changed the mod list of the active profile.
pub const PROFILE_CHANGED_EVENT: &str = "profile-changed-in-game";

const MOD_INFO: &str = include_str!("../../../mods/Z_StudioLink/mod.info");
const MOD_INFO_42: &str = include_str!("../../../mods/Z_StudioLink/42/mod.info");
const CLIENT_LUA: &str = include_str!("../../../mods/Z_StudioLink/42/media/lua/client/PZModStudio_Link.lua");

const UI_EN: &str = include_str!("../../../mods/Z_StudioLink/42/media/lua/shared/Translate/EN/UI.json");
const UI_ES: &str = include_str!("../../../mods/Z_StudioLink/42/media/lua/shared/Translate/ES/UI.json");

fn link_files(user_zomboid_dir: &Path) -> [(PathBuf, &'static str); 5] {
    let target = user_zomboid_dir.join("mods").join(LINK_MOD_ID);
    let lua = target.join("42").join("media").join("lua");
    let translate = lua.join("shared").join("Translate");
    [
        (target.join("mod.info"), MOD_INFO),
        (target.join("42").join("mod.info"), MOD_INFO_42),
        (lua.join("client").join("PZModStudio_Link.lua"), CLIENT_LUA),
        (translate.join("EN").join("UI.json"), UI_EN),
        (translate.join("ES").join("UI.json"), UI_ES),
    ]
}

/// The Workshop folder of a subscribed copy of `Z_StudioLink`, if the player has one.
fn workshop_copy() -> Option<PathBuf> {
    let workshop = crate::vfs::studio_paths().workshop_dir;
    if workshop.is_empty() {
        return None;
    }
    std::fs::read_dir(&workshop).ok()?.flatten().find_map(|item| {
        let dir = item.path().join("mods").join(LINK_MOD_ID);
        dir.join("mod.info").is_file().then_some(dir)
    })
}

/// Installs `Z_StudioLink` into `<Zomboid>/mods`, or brings it up to this build's version.
/// Files that are already right are not touched. With the mod subscribed on the Workshop the
/// local copy goes instead: two copies with one id would leave the game picking one (the
/// Workshop's, by its folder order), and which version runs would depend on that.
pub fn install_link_mod(user_zomboid_dir: &Path) -> Result<(), String> {
    let local = user_zomboid_dir.join("mods").join(LINK_MOD_ID);
    if !cfg!(test) && workshop_copy().is_some() {
        // Only ever the Studio's own files: anything else the player put there stays.
        for (path, _) in link_files(user_zomboid_dir) {
            let _ = std::fs::remove_file(path);
        }
        let lua = local.join("42").join("media").join("lua");
        let translate = lua.join("shared").join("Translate");
        for dir in [translate.join("EN"), translate.join("ES"), translate.clone(), lua.join("shared"), lua.join("client"), lua.clone(), local.join("42").join("media"), local.join("42"), local.join("common"), local.clone()] {
            let _ = std::fs::remove_dir(dir); // only when empty
        }
        return Ok(());
    }
    let _ = std::fs::create_dir_all(local.join("common"));
    for (path, content) in link_files(user_zomboid_dir) {
        if std::fs::read_to_string(&path).is_ok_and(|now| now == content) {
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {}", parent.display(), e))?;
        }
        std::fs::write(&path, content).map_err(|e| format!("Cannot write {}: {}", path.display(), e))?;
    }
    Ok(())
}

/// The text of `PZModStudio_Link.txt` for a profile: its name, its mods in load order, and the
/// mods other profiles hold (so the game can tell a mod that is in no profile at all, a new one).
pub fn link_file_text(profile_name: &str, members: &[String], others: &[String]) -> String {
    let mut out = format!("profile={}\n", profile_name.replace(['\r', '\n'], " "));
    for id in members {
        out.push_str(&format!("member={}\n", id));
    }
    for id in others {
        if !members.contains(id) {
            out.push_str(&format!("other={}\n", id));
        }
    }
    out
}

/// Writes what the game's Mods screen should show for the active profile.
pub fn write_link_file(user_zomboid_dir: &Path, profile_name: &str, members: &[String], others: &[String]) -> Result<(), String> {
    let lua_dir = user_zomboid_dir.join("Lua");
    std::fs::create_dir_all(&lua_dir).map_err(|e| format!("Cannot create {}: {}", lua_dir.display(), e))?;
    let path = lua_dir.join(LINK_FILE);
    let text = link_file_text(profile_name, members, others);
    if std::fs::read_to_string(&path).is_ok_and(|now| now == text) {
        return Ok(());
    }
    crate::load_order::ini_parser::atomic_write(&path, text).map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}

/// The load order after the game reordered or switched mods: the inactive mods stay where they
/// were and the active ones fill, in the game's order, the places active mods had before. Active
/// mods the profile had never placed go last.
pub fn merge_game_order(previous: &[String], game_active: &[String]) -> Vec<String> {
    let active: std::collections::HashSet<&String> = game_active.iter().collect();
    let mut queue = game_active.iter();
    let mut out = Vec::with_capacity(previous.len().max(game_active.len()));
    for id in previous {
        if active.contains(id) {
            if let Some(next) = queue.next() {
                out.push(next.clone());
            }
        } else {
            out.push(id.clone());
        }
    }
    out.extend(queue.cloned());
    out
}

// ------------------------------------------------------------------ talking with the game
//
// Everything goes through small text files in `<Zomboid>/Lua`, the only folder the game's Lua can
// read and write. Both sides poll; nothing waits on the other.
//
//   PZModStudio_LinkApp.txt       app  -> game  protocol, version, alive=<unix seconds> (every few
//                                               seconds while the app runs)
//   PZModStudio_LinkRequests.txt  game -> app   <id>\t<verb>\t<argument> per request; the app reads
//                                               and removes it
//   PZModStudio_LinkAcks.txt      app  -> game  <id>\tok|error\t<text> per request handled (the
//                                               last ACKS_KEPT)
//   PZModStudio_LinkGame.txt      game -> app   where the player is: state=menu|ingame, the save,
//                                               its mods (written on entering the menu or a game)

/// Bumped when one of the files above changes meaning. The Link mod says which one it speaks in
/// the game file, the app in its own.
pub const PROTOCOL: u32 = 2;
pub const APP_FILE: &str = "PZModStudio_LinkApp.txt";
pub const REQUESTS_FILE: &str = "PZModStudio_LinkRequests.txt";
pub const ACKS_FILE: &str = "PZModStudio_LinkAcks.txt";
pub const GAME_FILE: &str = "PZModStudio_LinkGame.txt";
/// Sent to the window when the game file changed: the player entered the menu or a game.
pub const GAME_STATE_EVENT: &str = "link-game-state";
const ACKS_KEPT: usize = 50;

/// One thing the game asked for. `id` is empty for the first protocol's `add=<mod id>` lines.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkRequest {
    pub id: String,
    pub verb: String,
    pub arg: String,
}

/// The requests in a requests file, each (verb, argument) once.
pub fn parse_requests(text: &str) -> Vec<LinkRequest> {
    let mut out: Vec<LinkRequest> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let request = if let Some(id) = line.strip_prefix("add=") {
            LinkRequest { id: String::new(), verb: "add".into(), arg: id.trim().into() }
        } else {
            let mut parts = line.splitn(3, '\t');
            let (Some(id), Some(verb)) = (parts.next(), parts.next()) else { continue };
            LinkRequest { id: id.trim().into(), verb: verb.trim().into(), arg: parts.next().unwrap_or("").trim().into() }
        };
        if request.verb.is_empty() || (request.verb == "add" && request.arg.is_empty()) || out.iter().any(|r| r.verb == request.verb && r.arg == request.arg) {
            continue;
        }
        out.push(request);
    }
    out
}

/// The app file: which protocol and version this app speaks, and when it last said so.
pub fn app_file_text(now_secs: u64) -> String {
    format!("protocol={}\nversion={}\nalive={}\n", PROTOCOL, env!("CARGO_PKG_VERSION"), now_secs)
}

/// The acks file after these answers: the newest `ACKS_KEPT` lines, the given ones last.
pub fn acks_text(previous: &str, answers: &[(String, bool, String)]) -> String {
    let clean = |s: &str| s.replace(['\t', '\r', '\n'], " ");
    let mut lines: Vec<String> = previous.lines().filter(|l| !l.trim().is_empty()).map(str::to_string).collect();
    for (id, ok, text) in answers {
        if id.is_empty() {
            continue; // first-protocol requests carry no id to answer to
        }
        lines.push(format!("{}\t{}\t{}", clean(id), if *ok { "ok" } else { "error" }, clean(text)));
    }
    let skip = lines.len().saturating_sub(ACKS_KEPT);
    lines.into_iter().skip(skip).map(|l| l + "\n").collect()
}

/// Where the player is, as the Link mod last wrote it.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GameState {
    pub protocol: u32,
    /// The Link mod's version (`modversion` of its mod.info).
    pub link_version: String,
    /// "menu" or "ingame".
    pub state: String,
    /// The save folder (`<mode>/<world>`), empty on the menu.
    pub save: String,
    /// The mods the game runs with, in load order.
    pub mods: Vec<String>,
    /// Unix seconds, from the game's clock.
    pub at: u64,
}

pub fn parse_game_state(text: &str) -> Option<GameState> {
    let mut state = GameState::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        match key.trim() {
            "protocol" => state.protocol = value.parse().unwrap_or(0),
            "link" => state.link_version = value.to_string(),
            "state" => state.state = value.to_string(),
            "save" => state.save = value.to_string(),
            "mod" if !value.is_empty() => state.mods.push(value.to_string()),
            "at" => state.at = value.parse().unwrap_or(0),
            _ => {}
        }
    }
    (!state.state.is_empty()).then_some(state)
}

/// What a save last ran with, recorded each time the player enters it: the base for telling,
/// before it loads again, what changed since.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SaveReference {
    pub mods: Vec<String>,
    pub at: u64,
}

/// `<Zomboid>/PZModStudio_SaveRefs.json`: save folder -> its reference.
const SAVE_REFS_FILE: &str = "PZModStudio_SaveRefs.json";

pub fn save_references(user_zomboid_dir: &Path) -> std::collections::BTreeMap<String, SaveReference> {
    std::fs::read_to_string(user_zomboid_dir.join(SAVE_REFS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Notes what a save ran with. Only games, and only a list that changed, are written.
pub fn record_save_reference(user_zomboid_dir: &Path, state: &GameState) -> Result<bool, String> {
    if state.state != "ingame" || state.save.is_empty() {
        return Ok(false);
    }
    let mut refs = save_references(user_zomboid_dir);
    if refs.get(&state.save).is_some_and(|r| r.mods == state.mods) {
        return Ok(false);
    }
    refs.insert(state.save.clone(), SaveReference { mods: state.mods.clone(), at: state.at });
    let text = serde_json::to_string_pretty(&refs).map_err(|e| e.to_string())?;
    let path = user_zomboid_dir.join(SAVE_REFS_FILE);
    crate::load_order::ini_parser::atomic_write(&path, text).map_err(|e| format!("Cannot write {}: {}", path.display(), e))?;
    Ok(true)
}

/// What the app knows about the game side: the last game file and the saves' references.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct LinkStatus {
    pub game: Option<GameState>,
    pub saves: std::collections::BTreeMap<String, SaveReference>,
}

pub fn link_status(user_zomboid_dir: &Path) -> LinkStatus {
    LinkStatus {
        game: std::fs::read_to_string(user_zomboid_dir.join("Lua").join(GAME_FILE)).ok().and_then(|t| parse_game_state(&t)),
        saves: save_references(user_zomboid_dir),
    }
}

/// Does what the game asked and says how it went, per request.
fn handle_requests<R: tauri::Runtime>(app: &tauri::AppHandle<R>, z_dir: &Path, requests: &[LinkRequest]) -> Vec<(String, bool, String)> {
    let mut answers = Vec::new();
    let adds: Vec<&LinkRequest> = requests.iter().filter(|r| r.verb == "add" && !r.arg.is_empty()).collect();
    if !adds.is_empty() {
        let ids: Vec<String> = adds.iter().map(|r| r.arg.clone()).collect();
        let result = crate::instance_manager::add_members_to_active(z_dir, &ids);
        match &result {
            Ok(Some(profile)) => {
                let _ = app.emit(PROFILE_CHANGED_EVENT, profile.clone());
            }
            Ok(None) => {}
            Err(e) => eprintln!("[StudioLink] could not add the mods the game asked for: {}", e),
        }
        for r in &adds {
            answers.push(match &result {
                Ok(_) => (r.id.clone(), true, String::new()),
                Err(e) => (r.id.clone(), false, e.clone()),
            });
        }
    }
    for r in requests.iter().filter(|r| r.verb == "backup") {
        // "<mode>/<world>\t<reason>": answered when the backup is done, from its own thread.
        let (save, reason) = r.arg.split_once('\t').unwrap_or((r.arg.as_str(), ""));
        let reason = match reason.trim() {
            crate::save_backup::REASON_BEFORE_FIX => crate::save_backup::REASON_BEFORE_FIX,
            _ => crate::save_backup::REASON_BEFORE_LOAD,
        };
        start_backup(app, z_dir, save.trim(), reason, Some(r.id.clone()));
    }
    for r in requests.iter().filter(|r| r.verb != "add" && r.verb != "backup") {
        answers.push((r.id.clone(), false, format!("This version of PZ Mod Studio does not know \"{}\".", r.verb)));
    }
    answers
}

// ------------------------------------------------------------------ save backups

/// app -> game: what the Link needs to know of each save before it loads, one line per save:
/// `save\t<mode>/<world>\tbacked=0|1\tbytes=<n>\tsession=<unix seconds>\tupdated=<n>\tmods=<a;b;...>`.
/// `backed`: unchanged since its newest backup. `session` and `mods`: its last session (0 and
/// empty when the Studio never saw it played). `updated`: mods of that session whose Workshop
/// version on disk was published after it.
pub const SAVES_FILE: &str = "PZModStudio_LinkSaves.txt";
/// Sent to the window when a save's backups changed.
pub const SAVES_CHANGED_EVENT: &str = "save-backups-changed";

/// Mod id -> Workshop item, from the mod.info files in the Workshop folder (the B42 one too).
fn workshop_ids_by_mod(workshop_dir: &Path) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for item in std::fs::read_dir(workshop_dir).into_iter().flatten().flatten() {
        let wid = item.file_name().to_string_lossy().to_string();
        for m in std::fs::read_dir(item.path().join("mods")).into_iter().flatten().flatten() {
            for info in [m.path().join("mod.info"), m.path().join("42").join("mod.info")] {
                let Ok(text) = std::fs::read_to_string(&info) else { continue };
                if let Some(id) = text.lines().find_map(|l| l.trim().strip_prefix("id=")) {
                    out.insert(crate::load_order::mod_info::sanitize_mod_id(id), wid.clone());
                }
            }
        }
    }
    out
}

/// How many of a session's mods have a Workshop version on disk published after that session.
fn updated_since(session: &SaveReference, by_mod: &std::collections::HashMap<String, String>, state: Option<&crate::workshop::WorkshopLocalState>) -> usize {
    let Some(state) = state else { return 0 };
    session
        .mods
        .iter()
        .filter_map(|id| by_mod.get(&crate::load_order::mod_info::sanitize_mod_id(id)))
        .filter(|wid| state.items.get(*wid).and_then(|i| i.installed_time).is_some_and(|t| t > session.at))
        .count()
}

pub fn saves_file_text(user_zomboid_dir: &Path) -> String {
    let paths = crate::vfs::studio_paths();
    let by_mod = if paths.workshop_dir.is_empty() { Default::default() } else { workshop_ids_by_mod(Path::new(&paths.workshop_dir)) };
    let state = (!paths.workshop_dir.is_empty()).then(|| crate::workshop::local_state(&paths.workshop_dir)).flatten();
    let refs = save_references(user_zomboid_dir);
    let mut out = String::new();
    for id in crate::save_backup::list_saves(user_zomboid_dir) {
        let Some(summary) = crate::save_backup::summary(user_zomboid_dir, &id) else { continue };
        let session = refs.get(&id);
        out.push_str(&format!(
            "save\t{}\tbacked={}\tbytes={}\tsession={}\tupdated={}\tmods={}\n",
            id,
            u8::from(summary.backed_up),
            summary.bytes,
            session.map(|s| s.at).unwrap_or(0),
            session.map(|s| updated_since(s, &by_mod, state.as_ref())).unwrap_or(0),
            session.map(|s| s.mods.join(";")).unwrap_or_default()
        ));
    }
    out
}

pub fn write_saves_file(user_zomboid_dir: &Path) {
    let lua_dir = user_zomboid_dir.join("Lua");
    if !lua_dir.is_dir() {
        return;
    }
    let path = lua_dir.join(SAVES_FILE);
    let text = saves_file_text(user_zomboid_dir);
    if std::fs::read_to_string(&path).is_ok_and(|now| now == text) {
        return;
    }
    let _ = crate::load_order::ini_parser::atomic_write(path, text);
}

// The game's answers file is written from the watcher and from backup threads.
static ACKS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn write_acks(lua_dir: &Path, answers: &[(String, bool, String)]) {
    if !answers.iter().any(|(id, _, _)| !id.is_empty()) {
        return;
    }
    let _guard = ACKS_LOCK.lock();
    let acks = lua_dir.join(ACKS_FILE);
    let previous = std::fs::read_to_string(&acks).unwrap_or_default();
    let _ = crate::load_order::ini_parser::atomic_write(&acks, acks_text(&previous, &answers));
}

/// Backs a save up on a thread of its own; when done, the saves file is rewritten first (so a
/// Link that reloads Lua finds the save backed up) and then the request, if any, is answered.
pub fn start_backup<R: tauri::Runtime>(app: &tauri::AppHandle<R>, z_dir: &Path, save_id: &str, reason: &'static str, request: Option<String>) {
    let app = app.clone();
    let z_dir = z_dir.to_path_buf();
    let save_id = save_id.to_string();
    thread::spawn(move || {
        let result = crate::save_backup::backup_save(&z_dir, &save_id, reason, false);
        if let Err(e) = &result {
            eprintln!("[StudioLink] could not back up {}: {}", save_id, e);
        }
        write_saves_file(&z_dir);
        let _ = app.emit(SAVES_CHANGED_EVENT, &save_id);
        if let Some(id) = request {
            let answer = match result {
                Ok(_) => (id, true, String::new()),
                Err(e) => (id, false, e),
            };
            write_acks(&z_dir.join("Lua"), &[answer]);
        }
    });
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Mod Health's warnings for the game's Mods screen, one per line: `<severity>\t<mod id>\t<text>`,
/// written by the app (already in the player's language) after each check.
pub const HEALTH_FILE: &str = "PZModStudio_LinkHealth.txt";

pub fn write_health_file(user_zomboid_dir: &Path, lines: &[(String, String, String)]) -> Result<(), String> {
    let lua_dir = user_zomboid_dir.join("Lua");
    std::fs::create_dir_all(&lua_dir).map_err(|e| format!("Cannot create {}: {}", lua_dir.display(), e))?;
    let clean = |s: &str| s.replace(['\t', '\r', '\n'], " ");
    let text: String = lines
        .iter()
        .map(|(severity, id, msg)| format!("{}\t{}\t{}\n", clean(severity), clean(id), clean(msg)))
        .collect();
    let path = lua_dir.join(HEALTH_FILE);
    if std::fs::read_to_string(&path).is_ok_and(|now| now == text) {
        return Ok(());
    }
    crate::load_order::ini_parser::atomic_write(&path, text).map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}

// ------------------------------------------------------------------ the game's mod list

static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Follows `mods/default.txt`. When it changes and no longer matches the active profile — the
/// player accepted the game's Mods screen — the profile takes what the game wrote and the window
/// is told to show it. The Studio's own writes match the profile and are let through.
pub fn watch_mod_list<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if WATCHER_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || {
        let mut last_seen: Option<(PathBuf, SystemTime)> = None;
        let mut game_seen: Option<SystemTime> = None;
        let mut app_written = 0u64;
        // The save the player is in, as the game file last said; backed up when they leave it.
        let mut playing: Option<String> = None;
        let mut saves_written = 0u64;
        let mut ticks = 0u64;
        loop {
            ticks += 1;
            thread::sleep(Duration::from_secs(2));
            let chosen = crate::vfs::saved_user_zomboid_dir();
            let Some(z_dir) = crate::load_order::mod_info::get_existing_user_zomboid_dirs(&chosen).into_iter().next() else {
                continue;
            };
            let lua_dir = z_dir.join("Lua");

            // The app is here: the game counts it gone when this is some seconds old.
            let now = now_secs();
            if now.saturating_sub(app_written) >= 4 && lua_dir.is_dir() {
                if crate::load_order::ini_parser::atomic_write(lua_dir.join(APP_FILE), app_file_text(now)).is_ok() {
                    app_written = now;
                }
            }

            // What the player asked for in the game, answered one by one.
            let requests = lua_dir.join(REQUESTS_FILE);
            if let Ok(text) = std::fs::read_to_string(&requests) {
                let _ = std::fs::remove_file(&requests);
                let answers = handle_requests(&app, &z_dir, &parse_requests(&text));
                write_acks(&lua_dir, &answers);
            }

            // Where the player is: a game entered becomes its save's reference.
            let game_file = lua_dir.join(GAME_FILE);
            let stamp = modified(&game_file);
            if stamp.is_some() && stamp != game_seen {
                game_seen = stamp;
                if let Some(state) = std::fs::read_to_string(&game_file).ok().and_then(|t| parse_game_state(&t)) {
                    if let Err(e) = record_save_reference(&z_dir, &state) {
                        eprintln!("[StudioLink] could not note the save's mods: {}", e);
                    }
                    if state.state == "ingame" && !state.save.is_empty() {
                        playing = Some(state.save.clone());
                    } else if state.state == "menu" {
                        // Back on the menu: the save just left is backed up (if it changed).
                        if let Some(save) = playing.take() {
                            start_backup(&app, &z_dir, &save, crate::save_backup::REASON_EXIT, None);
                        }
                    }
                    saves_written = 0;
                    let _ = app.emit(GAME_STATE_EVENT, state);
                }
            }
            // The game closed while in a save (quit to desktop, or a crash).
            if playing.is_some() && ticks % 5 == 0 && crate::sandbox::find_running_pz_pid().is_none() {
                if let Some(save) = playing.take() {
                    start_backup(&app, &z_dir, &save, crate::save_backup::REASON_EXIT, None);
                }
            }
            // What the Link needs to know of each save, about once a minute.
            if now.saturating_sub(saves_written) >= 60 {
                write_saves_file(&z_dir);
                saves_written = now;
            }

            let default_txt = z_dir.join("mods").join("default.txt");
            let Some(stamp) = modified(&default_txt) else { continue };
            let changed = match &last_seen {
                Some((path, seen)) => path != &default_txt || *seen != stamp,
                None => false, // the file as it was when the Studio opened is not a change
            };
            last_seen = Some((default_txt.clone(), stamp));
            if !changed || crate::load_order::ini_parser::is_own_write(&default_txt) {
                continue;
            }
            let game_active = crate::load_order::ini_parser::parse_default_txt(&default_txt);
            match crate::instance_manager::take_mod_list_from_game(&z_dir, &game_active) {
                Ok(Some(profile)) => {
                    let _ = app.emit(PROFILE_CHANGED_EVENT, profile);
                }
                Ok(None) => {}
                Err(e) => eprintln!("[StudioLink] could not update the profile from the game: {}", e),
            }
        }
    });
}

// ------------------------------------------------------------------ Java agents

/// A Java agent some mod puts in `ProjectZomboid64.json`, and the mod it belongs to.
struct JavaAgent {
    mod_id: &'static str,
    vm_arg: &'static str,
}

const JAVA_AGENTS: &[JavaAgent] = &[JavaAgent { mod_id: "ZombieBuddy", vm_arg: "-agentlib:zbNative" }];

/// Where the Studio notes the agent lines it took out, so it only ever puts back its own.
fn removed_agents_file(user_zomboid_dir: &Path) -> PathBuf {
    user_zomboid_dir.join("PZModStudio_JavaAgents.json")
}

fn read_removed(user_zomboid_dir: &Path) -> Vec<String> {
    std::fs::read_to_string(removed_agents_file(user_zomboid_dir))
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

/// What changed in `ProjectZomboid64.json`, for the log.
#[derive(Debug, Default, serde::Serialize)]
pub struct AgentChanges {
    pub removed: Vec<String>,
    pub restored: Vec<String>,
}

/// Puts each mod's Java agent line in `ProjectZomboid64.json` when the mod is on and takes it out
/// when it is off. A line is only put back if the Studio took it out (the mod's own installer is
/// what adds it the first time), and every change keeps a copy of the file before it in
/// `<Zomboid>/PZModStudio_Backups`.
pub fn sync_java_agents(pz_install_dir: &Path, user_zomboid_dir: &Path, active_mods: &[String]) -> Result<AgentChanges, String> {
    let json_path = pz_install_dir.join("ProjectZomboid64.json");
    let Ok(text) = std::fs::read_to_string(&json_path) else {
        return Ok(AgentChanges::default());
    };
    let mut json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {}", json_path.display(), e))?;
    let Some(vm_args) = json.get_mut("vmArgs").and_then(|v| v.as_array_mut()) else {
        return Ok(AgentChanges::default());
    };

    let mut removed_by_studio = read_removed(user_zomboid_dir);
    let mut changes = AgentChanges::default();
    for agent in JAVA_AGENTS {
        let wanted = active_mods.iter().any(|m| m == agent.mod_id);
        let present = vm_args.iter().any(|a| a.as_str() == Some(agent.vm_arg));
        if !wanted && present {
            vm_args.retain(|a| a.as_str() != Some(agent.vm_arg));
            if !removed_by_studio.iter().any(|r| r == agent.vm_arg) {
                removed_by_studio.push(agent.vm_arg.to_string());
            }
            changes.removed.push(agent.mod_id.to_string());
        } else if wanted && !present && removed_by_studio.iter().any(|r| r == agent.vm_arg) {
            // First, where its installer had it: agents load before the other VM options.
            vm_args.insert(0, serde_json::Value::String(agent.vm_arg.to_string()));
            removed_by_studio.retain(|r| r != agent.vm_arg);
            changes.restored.push(agent.mod_id.to_string());
        }
    }
    if changes.removed.is_empty() && changes.restored.is_empty() {
        return Ok(changes);
    }

    // Two-space indent, as the game ships it.
    let new_text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    crate::load_order::ini_parser::write_file_with_backup(&json_path, &new_text, &user_zomboid_dir.join("PZModStudio_Backups"))?;
    let _ = crate::load_order::ini_parser::atomic_write(
        removed_agents_file(user_zomboid_dir),
        serde_json::to_string_pretty(&removed_by_studio).unwrap_or_default(),
    );
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_game_order_fills_the_places_of_the_active_mods() {
        let previous = ids(&["A", "x", "B", "y", "C"]);
        // The game moved C before A and switched B off.
        let merged = merge_game_order(&previous, &ids(&["C", "A"]));
        assert_eq!(merged, ids(&["C", "x", "B", "y", "A"]));
        // A mod switched on that the profile had never placed goes last.
        let merged = merge_game_order(&previous, &ids(&["A", "B", "C", "N"]));
        assert_eq!(merged, ids(&["A", "x", "B", "y", "C", "N"]));
    }

    #[test]
    fn the_link_file_lists_the_profile_and_its_mods() {
        let text = link_file_text("Vanilla+\nx", &ids(&["A", "B"]), &ids(&["B", "C"]));
        assert_eq!(text, "profile=Vanilla+ x\nmember=A\nmember=B\nother=C\n");
    }

    #[test]
    fn requests_from_the_game_are_read_once_each() {
        let args = |text: &str| parse_requests(text).into_iter().map(|r| (r.id, r.verb, r.arg)).collect::<Vec<_>>();
        let s = |a: &str, b: &str, c: &str| (a.to_string(), b.to_string(), c.to_string());
        // The first protocol's lines, which carry no id.
        assert_eq!(args("add=A\r\nadd= B \nnoise\nadd=A\nadd=\n"), vec![s("", "add", "A"), s("", "add", "B")]);
        // The second's, mixed with an old one asking for the same thing.
        assert_eq!(
            args("17-1\tadd\tC\r\nadd=C\n17-2\tbisect\t\n\n"),
            vec![s("17-1", "add", "C"), s("17-2", "bisect", "")]
        );
    }

    #[test]
    fn every_link_text_has_its_translations() {
        let start = CLIENT_LUA.find("local TEXT = {").unwrap();
        let block = &CLIENT_LUA[start..start + CLIENT_LUA[start..].find("\n}").unwrap()];
        let mut keys: Vec<String> = block
            .lines()
            .filter_map(|l| l.trim().split_once(" = \"").map(|(k, _)| format!("UI_StudioLink_{}", k)))
            .collect();
        keys.sort();
        assert!(keys.len() > 10);
        for json in [UI_EN, UI_ES] {
            let map: std::collections::BTreeMap<String, String> = serde_json::from_str(json).unwrap();
            assert_eq!(map.keys().cloned().collect::<Vec<_>>(), keys);
            assert!(map.values().all(|v| !v.contains('%')), "a % would be read by the game as a format");
        }
    }

    #[test]
    fn a_session_counts_the_mods_published_after_it() {
        let session = SaveReference { mods: ids(&["A", "\\B", "C", "Local"]), at: 1000 };
        let by_mod: std::collections::HashMap<String, String> =
            [("A", "1"), ("B", "2"), ("C", "3")].into_iter().map(|(m, w)| (m.to_string(), w.to_string())).collect();
        let item = |t: u64| crate::workshop::InstalledItemState { installed_time: Some(t), latest_time: Some(t), size: None, update_pending: false, updated_since_last_play: false };
        let state = crate::workshop::WorkshopLocalState {
            time_last_app_ran: None,
            items: [("1".to_string(), item(900)), ("2".to_string(), item(1500)), ("3".to_string(), item(2000))].into_iter().collect(),
        };
        assert_eq!(updated_since(&session, &by_mod, Some(&state)), 2);
        assert_eq!(updated_since(&session, &by_mod, None), 0);
    }

    #[test]
    fn the_link_lua_uses_only_what_the_games_lua_has() {
        // Kahlua has no `next` (seen live: "Object tried to call nil"), and no goto or integer
        // division.
        for missing in ["next(", "goto ", "//"] {
            let used = CLIENT_LUA.lines().filter(|l| !l.trim_start().starts_with("--")).any(|l| l.split("--").next().unwrap().contains(missing));
            assert!(!used, "PZModStudio_Link.lua uses {}", missing);
        }
    }

    #[test]
    fn answers_keep_the_newest_and_skip_requests_without_an_id() {
        let mut text = String::new();
        for i in 0..60 {
            text = acks_text(&text, &[(format!("r{}", i), i % 2 == 0, format!("line\twith\ntabs {}", i))]);
        }
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), ACKS_KEPT);
        assert_eq!(lines[0], "r10\tok\tline with tabs 10");
        assert_eq!(*lines.last().unwrap(), "r59\terror\tline with tabs 59");
        assert_eq!(acks_text("", &[(String::new(), true, String::new())]), "");
        assert!(app_file_text(42).contains("alive=42\n") && app_file_text(42).starts_with("protocol=2\n"));
    }

    #[test]
    fn a_game_entered_becomes_its_saves_reference() {
        let z = temp("saverefs");
        let text = "protocol=2\nlink=1.1.0\nstate=ingame\nsave=Sandbox/World 1\nmod=A\nmod=B\nat=100\n";
        let state = parse_game_state(text).unwrap();
        assert_eq!(state.mods, ids(&["A", "B"]));
        assert_eq!(state.save, "Sandbox/World 1");
        assert!(record_save_reference(&z, &state).unwrap());
        // The same list again is not a change; the menu never is.
        assert!(!record_save_reference(&z, &GameState { at: 200, ..state.clone() }).unwrap());
        assert!(!record_save_reference(&z, &parse_game_state("state=menu\n").unwrap()).unwrap());
        assert_eq!(save_references(&z)["Sandbox/World 1"], SaveReference { mods: ids(&["A", "B"]), at: 100 });
        assert!(parse_game_state("noise\n").is_none());
        let _ = std::fs::remove_dir_all(&z);
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pzms-link-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn zombie_buddy_comes_out_and_back_with_a_backup() {
        let game = temp("game");
        let zomboid = temp("zomboid");
        let json = game.join("ProjectZomboid64.json");
        std::fs::write(&json, r#"{"mainClass":"x","vmArgs":["-agentlib:zbNative","-Xmx6144m"]}"#).unwrap();

        let c = sync_java_agents(&game, &zomboid, &ids(&["Other"])).unwrap();
        assert_eq!(c.removed, ids(&["ZombieBuddy"]));
        let now = std::fs::read_to_string(&json).unwrap();
        assert!(!now.contains("zbNative") && now.contains("-Xmx6144m"));
        assert_eq!(std::fs::read_dir(zomboid.join("PZModStudio_Backups")).unwrap().count(), 1);

        let c = sync_java_agents(&game, &zomboid, &ids(&["ZombieBuddy"])).unwrap();
        assert_eq!(c.restored, ids(&["ZombieBuddy"]));
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
        assert_eq!(v["vmArgs"][0], "-agentlib:zbNative");

        // Never added on its own: without the Studio having taken it out, it stays out.
        std::fs::write(&json, r#"{"vmArgs":["-Xmx6144m"]}"#).unwrap();
        let _ = std::fs::remove_file(removed_agents_file(&zomboid));
        let c = sync_java_agents(&game, &zomboid, &ids(&["ZombieBuddy"])).unwrap();
        assert!(c.restored.is_empty());
    }
}
