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

fn link_files(user_zomboid_dir: &Path) -> [(PathBuf, &'static str); 3] {
    let target = user_zomboid_dir.join("mods").join(LINK_MOD_ID);
    [
        (target.join("mod.info"), MOD_INFO),
        (target.join("42").join("mod.info"), MOD_INFO_42),
        (target.join("42").join("media").join("lua").join("client").join("PZModStudio_Link.lua"), CLIENT_LUA),
    ]
}

/// Installs `Z_StudioLink` into `<Zomboid>/mods`, or brings it up to this build's version.
/// Files that are already right are not touched.
pub fn install_link_mod(user_zomboid_dir: &Path) -> Result<(), String> {
    let _ = std::fs::create_dir_all(user_zomboid_dir.join("mods").join(LINK_MOD_ID).join("common"));
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

/// The text of `PZModStudio_Link.txt` for a profile: its name and its mods in load order.
pub fn link_file_text(profile_name: &str, members: &[String]) -> String {
    let mut out = format!("profile={}\n", profile_name.replace(['\r', '\n'], " "));
    for id in members {
        out.push_str(&format!("member={}\n", id));
    }
    out
}

/// Writes what the game's Mods screen should show for the active profile.
pub fn write_link_file(user_zomboid_dir: &Path, profile_name: &str, members: &[String]) -> Result<(), String> {
    let lua_dir = user_zomboid_dir.join("Lua");
    std::fs::create_dir_all(&lua_dir).map_err(|e| format!("Cannot create {}: {}", lua_dir.display(), e))?;
    let path = lua_dir.join(LINK_FILE);
    let text = link_file_text(profile_name, members);
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
        loop {
            thread::sleep(Duration::from_secs(2));
            let chosen = crate::vfs::saved_user_zomboid_dir();
            let Some(z_dir) = crate::load_order::mod_info::get_existing_user_zomboid_dirs(&chosen).into_iter().next() else {
                continue;
            };
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
        let text = link_file_text("Vanilla+\nx", &ids(&["A", "B"]));
        assert_eq!(text, "profile=Vanilla+ x\nmember=A\nmember=B\n");
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
