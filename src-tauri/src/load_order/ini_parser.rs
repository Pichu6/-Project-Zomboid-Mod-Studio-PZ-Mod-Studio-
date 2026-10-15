use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::load_order::mod_info::sanitize_mod_id;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListData {
    pub active_mods: Vec<String>,
    pub raw_ini_content: String,
}

/// Helper function to reliably resolve Zomboid/mods/default.txt path regardless of ini_path state
fn resolve_default_txt_path(ini_path: &str) -> PathBuf {
    if !ini_path.is_empty() {
        let p = Path::new(ini_path);
        if let Some(parent) = p.parent() {
            if parent.file_name().map_or(false, |n| n == "mods") {
                return parent.join("default.txt");
            } else if parent.file_name().map_or(false, |n| n == "Lua") {
                if let Some(pz_dir) = parent.parent() {
                    return pz_dir.join("mods").join("default.txt");
                }
            } else if parent.join("mods").is_dir() {
                // e.g. <Zomboid>/ModListData.ini
                return parent.join("mods").join("default.txt");
            }
        }
    }
    // Fallback to standard user home Zomboid/mods/default.txt
    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("C:\\"));
    home.join("Zomboid").join("mods").join("default.txt")
}

fn parse_ini_file(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("activeMods=") || trimmed.starts_with("Mods=") || trimmed.starts_with("mods=") {
                let parts: Vec<&str> = trimmed.split('=').collect();
                if parts.len() == 2 {
                    active = parts[1]
                        .split(';')
                        .map(|s| sanitize_mod_id(s.trim()))
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }
    }
    active
}

fn parse_default_txt(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        let mut in_mods_block = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "mods" || trimmed.starts_with("mods") {
                in_mods_block = true;
                continue;
            }
            if in_mods_block && (trimmed == "maps" || trimmed.starts_with("maps")) {
                break;
            }

            if in_mods_block && trimmed.starts_with("mod") {
                let raw_id = trimmed[3..]
                    .trim()
                    .trim_start_matches('=')
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim_end_matches(',')
                    .trim();

                let clean_id = sanitize_mod_id(raw_id);
                if !clean_id.is_empty() && clean_id != "{" && clean_id != "}" {
                    active.push(clean_id);
                }
            }
        }
    }
    active
}

fn parse_plain_list_file(path: &Path) -> Vec<String> {
    let mut active = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let clean = sanitize_mod_id(line);
            if !clean.is_empty() {
                active.push(clean);
            }
        }
    }
    active
}

/// Reads the active mods from Zomboid/mods/default.txt; when that file does not exist, falls back
/// to the most recently modified legacy list (ModListData.ini, mods.txt, Lua/loadorder.ini).
pub fn read_mod_list_ini(ini_path: &str) -> Result<ModListData, String> {
    let default_txt_path = resolve_default_txt_path(ini_path);
    let ini_p = Path::new(ini_path);

    let mut candidate_paths: Vec<(PathBuf, std::time::SystemTime, &str)> = Vec::new();

    // 1. ModListData.ini
    if !ini_path.is_empty() && ini_p.exists() {
        if let Ok(meta) = fs::metadata(ini_p) {
            if let Ok(mtime) = meta.modified() {
                candidate_paths.push((ini_p.to_path_buf(), mtime, "ini"));
            }
        }
    }

    // 2. mods/default.txt
    if default_txt_path.exists() {
        if let Ok(meta) = fs::metadata(&default_txt_path) {
            if let Ok(mtime) = meta.modified() {
                candidate_paths.push((default_txt_path.clone(), mtime, "default_txt"));
            }
        }
    }

    // 3. mods.txt
    if let Some(mods_dir) = default_txt_path.parent() {
        if let Some(z_dir) = mods_dir.parent() {
            let mods_txt_path = z_dir.join("mods.txt");
            if mods_txt_path.exists() {
                if let Ok(meta) = fs::metadata(&mods_txt_path) {
                    if let Ok(mtime) = meta.modified() {
                        candidate_paths.push((mods_txt_path, mtime, "plain"));
                    }
                }
            }

            // 4. loadorder.ini
            let loadorder_ini = z_dir.join("Lua").join("loadorder.ini");
            if loadorder_ini.exists() {
                if let Ok(meta) = fs::metadata(&loadorder_ini) {
                    if let Ok(mtime) = meta.modified() {
                        candidate_paths.push((loadorder_ini, mtime, "ini"));
                    }
                }
            }
        }
    }

    // mods/default.txt is the only list the game reads, so when it exists it is the truth,
    // even when it is empty (no mods active). The other files are legacy fallbacks only.
    if default_txt_path.exists() {
        return Ok(ModListData {
            active_mods: parse_default_txt(&default_txt_path),
            raw_ini_content: String::new(),
        });
    }

    // Sort candidates by modification time DESCENDING (newest file modified on disk wins!)
    candidate_paths.sort_by(|a, b| b.1.cmp(&a.1));

    let mut active_mods = Vec::new();

    for (path, _mtime, file_type) in candidate_paths {
        let parsed = match file_type {
            "ini" => parse_ini_file(&path),
            "default_txt" => parse_default_txt(&path),
            "plain" => parse_plain_list_file(&path),
            _ => Vec::new(),
        };

        if !parsed.is_empty() {
            active_mods = parsed;
            break;
        }
    }

    Ok(ModListData {
        active_mods,
        raw_ini_content: String::new(),
    })
}

/// Helper to detect custom map folders for active mods across workshop and local mod paths
pub fn detect_active_maps(active_mods: &[String], user_zomboid_str: &str) -> Vec<String> {
    let mut detected_maps = Vec::new();
    let mut seen_maps = HashSet::new();

    let paths = crate::vfs::auto_detect_paths();
    let mut search_dirs = Vec::new();

    if !paths.workshop_dir.is_empty() {
        search_dirs.push(PathBuf::from(&paths.workshop_dir));
    }
    if !paths.pz_install_dir.is_empty() {
        search_dirs.push(PathBuf::from(&paths.pz_install_dir).join("mods"));
    }
    for u_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_str) {
        search_dirs.push(u_dir.join("mods"));
    }

    let clean_active_ids: HashSet<String> = active_mods
        .iter()
        .map(|s| sanitize_mod_id(s).to_lowercase())
        .collect();

    // Map mod ID (lowercase) -> list of map folder names
    let mut mod_to_maps: HashMap<String, Vec<String>> = HashMap::new();

    for root in &search_dirs {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root).max_depth(6).into_iter().filter_map(|e| e.ok()) {
            if entry.file_name() == "map.info" {
                if let Some(map_dir) = entry.path().parent() {
                    let map_folder_name = map_dir.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if map_folder_name.is_empty() {
                        continue;
                    }

                    // Traverse up to find the enclosing mod.info
                    let mut current = map_dir.parent();
                    let mut found_mod_id = None;
                    for _ in 0..5 {
                        if let Some(p) = current {
                            let mod_info = p.join("mod.info");
                            if mod_info.exists() {
                                if let Some(manifest) = crate::load_order::mod_info::parse_mod_info(&mod_info) {
                                    let clean_id = sanitize_mod_id(&manifest.id).to_lowercase();
                                    if clean_active_ids.contains(&clean_id) {
                                        found_mod_id = Some(clean_id);
                                        break;
                                    }
                                }
                            }
                            current = p.parent();
                        } else {
                            break;
                        }
                    }

                    if let Some(mod_id) = found_mod_id {
                        let list = mod_to_maps.entry(mod_id).or_default();
                        if !list.contains(&map_folder_name) {
                            list.push(map_folder_name);
                        }
                    }
                }
            }
        }
    }

    // Preserve active_mods load order when ordering map folders
    for mod_id in active_mods {
        let clean = sanitize_mod_id(mod_id).to_lowercase();
        if let Some(maps) = mod_to_maps.get(&clean) {
            for m in maps {
                if seen_maps.insert(m.clone()) {
                    detected_maps.push(m.clone());
                }
            }
        }
    }

    detected_maps
}

/// Zomboid folder that owns the active mod list for `ini_path` (parent of `mods/default.txt`).
fn zomboid_dir_for(default_txt_path: &Path) -> Option<PathBuf> {
    default_txt_path.parent().and_then(|m| m.parent()).map(Path::to_path_buf)
}

/// Builds `mods/default.txt` the way the game writes it (ActiveModsFile, VERSION = 1).
/// The game splits values on every comma and never strips quotes, so values are written bare
/// and map names containing a comma (they cannot round-trip) are skipped.
pub fn build_default_txt(active_mods: &[String], maps: &[String]) -> String {
    // Same line ending as the game (Java's System.lineSeparator()).
    let eol = if cfg!(windows) { "\r\n" } else { "\n" };
    let mut out = format!("VERSION = 1,{eol}{eol}mods{eol}{{{eol}");
    for mod_id in active_mods {
        let clean_id = sanitize_mod_id(mod_id);
        if !clean_id.is_empty() && !clean_id.contains(',') {
            out.push_str(&format!("    mod = {},{eol}", clean_id));
        }
    }
    out.push_str(&format!("}}{eol}{eol}maps{eol}{{{eol}"));
    for map_name in maps {
        let clean = map_name.trim();
        if !clean.is_empty() && !clean.contains(',') {
            out.push_str(&format!("    map = {},{eol}", clean));
        }
    }
    out.push_str(&format!("}}{eol}"));
    out
}

/// Map entries currently in a default.txt `maps { }` block, in order.
fn read_existing_maps(path: &Path) -> Vec<String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut maps = Vec::new();
    let mut in_maps = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("maps") {
            in_maps = true;
            continue;
        }
        if in_maps {
            if trimmed.starts_with('}') {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("map") {
                let value = rest.trim().trim_start_matches('=').trim().trim_end_matches(',').trim();
                if !value.is_empty() {
                    maps.push(value.to_string());
                }
            }
        }
    }
    maps
}

/// Keeps the newest `keep` files in `dir` whose names start with `prefix`.
fn prune_backups(dir: &Path, prefix: &str, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut backups: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(prefix)))
        .collect();
    // Names embed a sortable timestamp, so name order is age order.
    backups.sort();
    let excess = backups.len().saturating_sub(keep);
    for old in backups.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
}

/// Replaces `path` with `content`: skips the write when nothing changed, copies the previous
/// version into `backup_dir` first, and writes through a temp file + rename so a crash can
/// never leave a truncated file behind.
pub fn write_file_with_backup(path: &Path, content: &str, backup_dir: &Path) -> Result<bool, String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == content {
            return Ok(false);
        }
        fs::create_dir_all(backup_dir)
            .map_err(|e| format!("Cannot create backup folder {}: {}", backup_dir.display(), e))?;
        let stem = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f");
        let backup_path = backup_dir.join(format!("{}.{}.bak", stem, stamp));
        fs::copy(path, &backup_path)
            .map_err(|e| format!("Cannot back up {}: {}", path.display(), e))?;
        prune_backups(backup_dir, &format!("{}.", stem), 20);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {}", parent.display(), e))?;
    }
    // Unique per writer so two writes can never share (and truncate) the same temp file.
    static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_path = path.with_extension(format!("pzms-tmp-{}-{}", std::process::id(), n));
    fs::write(&tmp_path, content).map_err(|e| format!("Cannot write {}: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Cannot replace {}: {}", path.display(), e)
    })?;
    Ok(true)
}

/// Writes the active mod list to `Zomboid/mods/default.txt`, the only global mod list file the
/// game reads (ZomboidFileSystem / ActiveModsFile). The previous file is backed up to
/// `Zomboid/PZModStudio_Backups/`. Save folders are not touched: the game rewrites each save's
/// own `mods.txt` itself whenever that save is loaded.
///
/// The `maps` block is kept as it is: the game only uses it to order conflicting map mods and
/// maintains it from its own mod selector, so it does not need a Workshop scan on every save.
pub fn write_mod_list_ini(ini_path: &str, active_mods: &[String]) -> Result<(), String> {
    let default_txt_path = resolve_default_txt_path(ini_path);
    let zomboid_dir = zomboid_dir_for(&default_txt_path)
        .ok_or_else(|| format!("Cannot resolve the Zomboid folder for {}", default_txt_path.display()))?;
    if !zomboid_dir.is_dir() {
        return Err(format!("Zomboid folder not found: {}", zomboid_dir.display()));
    }

    // Saves from the UI thread and background scans can overlap; one writer at a time.
    let _guard = MOD_LIST_WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let maps = read_existing_maps(&default_txt_path);
    let content = build_default_txt(active_mods, &maps);
    write_file_with_backup(&default_txt_path, &content, &zomboid_dir.join("PZModStudio_Backups"))?;
    Ok(())
}

static MOD_LIST_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway Zomboid folder under the system temp dir (never the user's real one).
    fn temp_zomboid(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pzms-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("mods")).unwrap();
        dir
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn default_txt_round_trips_and_keeps_workshop_prefixed_ids() {
        let mods = ids(&["ModA", "\\ModB", "2858201402/dailystatisticsandgains"]);
        let text = build_default_txt(&mods, &ids(&["MyMap", "Bad, Map"]));
        assert!(text.starts_with("VERSION = 1,"));
        assert!(!text.contains('"'), "the game does not strip quotes");
        assert!(!text.contains("Bad"), "comma map names cannot round-trip");

        let dir = temp_zomboid("roundtrip");
        let path = dir.join("mods").join("default.txt");
        fs::write(&path, &text).unwrap();
        assert_eq!(parse_default_txt(&path), ids(&["ModA", "ModB", "2858201402/dailystatisticsandgains"]));
        assert_eq!(read_existing_maps(&path), ids(&["MyMap"]));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_with_backup_keeps_previous_version_and_skips_no_ops() {
        let dir = temp_zomboid("backup");
        let path = dir.join("mods").join("default.txt");
        let backups = dir.join("PZModStudio_Backups");
        fs::write(&path, "old").unwrap();

        assert!(write_file_with_backup(&path, "new", &backups).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let saved: Vec<_> = fs::read_dir(&backups).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(saved.len(), 1);
        assert_eq!(fs::read_to_string(saved[0].path()).unwrap(), "old");
        assert!(!path.with_extension("pzms-tmp").exists());

        // Same content again: no write, no extra backup.
        assert!(!write_file_with_backup(&path, "new", &backups).unwrap());
        assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_mod_list_only_touches_default_txt() {
        let dir = temp_zomboid("writer");
        let save = dir.join("Saves").join("Sandbox").join("MySave");
        fs::create_dir_all(&save).unwrap();
        fs::write(save.join("mods.txt"), "save's own list").unwrap();
        let ini_path = dir.join("mods").join("default.txt");
        fs::write(&ini_path, "VERSION = 1,\nmods\n{\n    mod = Old,\n}\nmaps\n{\n}\n").unwrap();

        write_mod_list_ini(&ini_path.to_string_lossy(), &ids(&["A", "B"])).unwrap();

        assert_eq!(read_mod_list_ini(&ini_path.to_string_lossy()).unwrap().active_mods, ids(&["A", "B"]));
        assert_eq!(fs::read_to_string(save.join("mods.txt")).unwrap(), "save's own list");
        for never_written in ["mods.txt", "Lua"] {
            assert!(!dir.join(never_written).exists(), "{} was created", never_written);
        }
        assert_eq!(fs::read_dir(dir.join("PZModStudio_Backups")).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_default_txt_wins_over_stale_legacy_lists() {
        let dir = temp_zomboid("reader");
        let ini_path = dir.join("mods").join("default.txt");
        fs::write(&ini_path, build_default_txt(&[], &[])).unwrap();
        fs::write(dir.join("mods.txt"), "Stale\nList").unwrap();
        assert!(read_mod_list_ini(&ini_path.to_string_lossy()).unwrap().active_mods.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
