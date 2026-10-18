//! How long each mod's files took to load in the last session, from the game's own DebugLog.
//!
//! console.txt carries no clock, only a frame counter, so nothing in it can be timed. The game
//! also writes `Zomboid/Logs/logs_<date>/<date>_DebugLog.txt` with a millisecond stamp on every
//! line, and one `LOG : Mod f:0> loading <id>.` line per mod as it reads the mod's files
//! (mod.info, overrides, translations). The gap to the next mod's line is what this mod's files
//! cost — measured 2 ms for most and 1.3 s for a tile pack. The Lua that runs after is loaded in
//! one pass with no line per mod, so it is not timed here, and the chip says so.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModLoadTime {
    /// The id the game wrote, which is the `id=` of mod.info.
    pub mod_id: String,
    pub millis: u64,
}

/// Everything measured in one log: per mod, and the log it came from.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadTimes {
    pub log_file: Option<String>,
    /// When that session started, as the log's first stamp says ("17-10-26 12:20:02").
    pub session: Option<String>,
    pub mods: Vec<ModLoadTime>,
}

/// `[17-10-26 12:20:18.962]` as milliseconds within the day (a session does not cross midnight
/// between two mods' lines, and only differences are used).
fn stamp_millis(line: &str) -> Option<(u64, &str)> {
    let inner = line.strip_prefix('[')?;
    let end = inner.find(']')?;
    let stamp = &inner[..end];
    let (_, time) = stamp.split_once(' ')?;
    let mut parts = time.split(':');
    let h: u64 = parts.next()?.parse().ok()?;
    let m: u64 = parts.next()?.parse().ok()?;
    let (s, ms) = parts.next()?.split_once('.')?;
    let s: u64 = s.parse().ok()?;
    let ms: u64 = ms.parse().ok()?;
    Some((((h * 60 + m) * 60 + s) * 1000 + ms, stamp))
}

/// The per-mod times out of the log's lines.
pub fn parse(lines: impl Iterator<Item = String>) -> LoadTimes {
    let mut out = LoadTimes::default();
    let mut pending: Option<(String, u64)> = None;
    for line in lines {
        let Some((at, stamp)) = stamp_millis(&line) else { continue };
        if out.session.is_none() {
            out.session = Some(stamp.to_string());
        }
        let rest = &line[line.find(']').map(|i| i + 1).unwrap_or(0)..];
        let is_mod_line = rest.trim_start().starts_with("LOG  : Mod");
        let loading = rest.split_once("> loading ").map(|(_, id)| id.trim().trim_end_matches('.').to_string());
        // A mod's files end where the next line of any kind begins after its last override line;
        // the next "loading" is the usual end, and the first non-Mod line closes the last mod.
        if let Some((id, start)) = pending.take() {
            if loading.is_some() || !is_mod_line {
                out.mods.push(ModLoadTime { mod_id: id, millis: at.saturating_sub(start) });
            } else {
                pending = Some((id, start));
            }
        }
        if let Some(id) = loading.filter(|_| is_mod_line) {
            pending = Some((id, at));
        }
    }
    // A log cut off right after a "loading" line: that mod's time is unknown, not zero.
    if let Some((id, _)) = pending {
        out.mods.push(ModLoadTime { mod_id: id, millis: 0 });
    }
    out
}

/// The newest DebugLog under `Zomboid/Logs` (in `logs_<date>/` folders and loose), by its
/// modification time.
pub fn newest_debug_log(user_zomboid_dir: &str) -> Option<PathBuf> {
    let logs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .map(|d| d.join("Logs"))
        .find(|p| p.is_dir())?;
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let mut consider = |path: &Path| {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with("_DebugLog.txt") {
            if let Ok(meta) = path.metadata() {
                candidates.push((meta.modified().unwrap_or(std::time::UNIX_EPOCH), path.to_path_buf()));
            }
        }
    };
    for entry in std::fs::read_dir(&logs).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            for inner in std::fs::read_dir(&path).ok().into_iter().flatten().flatten() {
                consider(&inner.path());
            }
        } else {
            consider(&path);
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().next().map(|(_, p)| p)
}

/// The last session's load times, or nothing when no DebugLog exists.
pub fn from_logs(user_zomboid_dir: &str) -> LoadTimes {
    let Some(path) = newest_debug_log(user_zomboid_dir) else { return LoadTimes::default() };
    let Ok(file) = std::fs::File::open(&path) else { return LoadTimes::default() };
    use std::io::BufRead;
    let mut times = parse(std::io::BufReader::new(file).lines().map_while(Result::ok));
    times.log_file = Some(path.to_string_lossy().to_string());
    times
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_mod_is_timed_to_the_next_mods_line_and_the_last_to_the_next_phase() {
        let log = [
            "[17-10-26 12:20:02.270] LOG  : General      f:0> 17-10-2026 12:20:02.",
            "[17-10-26 12:20:18.962] LOG  : Mod          f:0> loading ZombieBuddy.",
            "[17-10-26 12:20:18.963] LOG  : Mod          f:0> mod \"ZombieBuddy\" overrides media/lua/shared/translate/en/ui.json.",
            "[17-10-26 12:20:18.964] LOG  : Mod          f:0> loading Viewpoint.",
            "[17-10-26 12:20:20.255] LOG  : Mod          f:0> loading ViewpointTileFix.",
            "[17-10-26 12:20:21.546] LOG  : General      f:0> Loading models and animations",
            "LOG  : General      f:0> a console line without a stamp",
        ];
        let t = parse(log.iter().map(|l| l.to_string()));
        assert_eq!(t.session.as_deref(), Some("17-10-26 12:20:02.270"));
        assert_eq!(
            t.mods,
            vec![
                ModLoadTime { mod_id: "ZombieBuddy".into(), millis: 2 },
                ModLoadTime { mod_id: "Viewpoint".into(), millis: 1291 },
                ModLoadTime { mod_id: "ViewpointTileFix".into(), millis: 1291 },
            ]
        );
    }
}
