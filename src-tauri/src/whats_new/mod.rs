//! What's new since you last played: the Workshop mods whose version on disk was published after
//! the last session, and the ones with an update waiting in Steam, each with its change notes
//! and a mark when the update may break a save in progress.
//!
//! - "Last played" is the latest of the sessions the Studio Link recorded
//!   (`PZModStudio_SaveRefs.json`) and Steam's `TimeLastAppRan` for the game.
//! - Versions come from Steam's own record (`appworkshop_108600.acf`): offline, no key.
//! - Change notes come from the item's public change notes page, one `<p id="<unix time>">` per
//!   update. They are cached in `<Zomboid>/PZModStudio_Changelogs.json` and read again only
//!   when Steam knows a newer version than the cached one.
//! - "May break saves" is a guess, said as one: a map mod (its cells can change under a save),
//!   or notes that talk about new saves, wipes, removed or renamed things, reworks.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// One update of one item, as its change notes page has it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangeNote {
    /// When it was published (unix seconds).
    pub at: u64,
    pub text: String,
}

/// Why an update may break a save.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Risk {
    /// "map" or "notes".
    pub code: String,
    /// "breaks": may break a save in progress (a map mod, or notes saying so); "read": the
    /// notes talk about things taken out or redone, worth reading before loading a save.
    pub level: String,
    /// The words of the notes that raised it.
    pub detail: String,
}

/// One Workshop item that changed, or will.
#[derive(Debug, Clone, Serialize)]
pub struct UpdatedItem {
    pub workshop_id: String,
    pub title: String,
    pub mod_ids: Vec<String>,
    /// One of its mods is on in the list the game reads.
    pub active: bool,
    /// Publish time of the version on disk, and of the newest Steam knows.
    pub installed_time: Option<u64>,
    pub latest_time: Option<u64>,
    /// Steam knows a newer version it has not downloaded yet.
    pub pending: bool,
    /// The version on disk was published after the last session.
    pub since_last_play: bool,
    pub map_mod: bool,
    /// The notes of the updates since the last session (and of the waiting one), newest first.
    pub notes: Vec<ChangeNote>,
    /// Why the notes are missing: "later" (not read yet, to spare Steam), "busy" (Steam is
    /// limiting requests), or what went wrong.
    pub notes_error: Option<String>,
    pub risks: Vec<Risk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WhatsNew {
    /// When the game was last played (unix seconds), if known.
    pub last_played: Option<u64>,
    /// From when updates are listed: the last session, or the time the player picked.
    pub since: Option<u64>,
    pub items: Vec<UpdatedItem>,
}

const NOTES_KEPT: usize = 10;
/// Pages read in one go, half a second apart: Steam starts refusing after a few dozen quick ones.
const PAGES_PER_READ: usize = 12;
const CACHE_FILE: &str = "PZModStudio_Changelogs.json";

/// Words in change notes that say a save in progress may not take the update.
const BREAKS: &[&str] = &[
    "new save", "new game", "fresh save", "fresh start", "start a new", "wipe", "not save compatible", "not save-compatible",
    "save compatib", "break save", "breaks save", "broken save", "corrupt", "changed id", "id change", "ids changed", "migrat",
    "removed item", "removed vehicle", "removed recipe", "removed trait", "removed profession", "renamed item",
];
/// Words that only say something was taken out or redone: worth reading first.
const READ_FIRST: &[&str] = &["incompatible", "removed", "renamed", "rework", "reworked", "overhaul", "rewrite", "rewritten", "reset"];

fn decode(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// The notes on a change notes page, newest first.
pub fn parse_changelog(html: &str) -> Vec<ChangeNote> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("<p id=\"") {
        rest = &rest[i + 7..];
        let Some(q) = rest.find('"') else { break };
        let at = rest[..q].parse::<u64>().ok();
        let Some(open_end) = rest.find('>') else { break };
        let body_start = open_end + 1;
        let Some(close) = rest[body_start..].find("</p>") else { break };
        let raw = &rest[body_start..body_start + close];
        rest = &rest[body_start + close..];
        let Some(at) = at else { continue };
        // <br> to new lines, every other tag out.
        let mut text = String::new();
        let mut in_tag = false;
        let mut tag = String::new();
        for c in raw.chars() {
            if in_tag {
                if c == '>' {
                    in_tag = false;
                    let t = tag.to_ascii_lowercase();
                    if t.starts_with("br") || t.starts_with("/li") || t.starts_with("li") {
                        text.push('\n');
                    }
                    tag.clear();
                } else {
                    tag.push(c);
                }
            } else if c == '<' {
                in_tag = true;
            } else {
                text.push(c);
            }
        }
        let text = decode(&text).lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string();
        out.push(ChangeNote { at, text });
    }
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

/// The words of `list` in these notes, each once.
fn words_in(notes: &[ChangeNote], list: &[&str]) -> Vec<String> {
    let mut found = Vec::new();
    for note in notes {
        let low = note.text.to_lowercase();
        for w in list {
            if low.contains(w) && !found.iter().any(|f: &String| f == w) {
                found.push(w.to_string());
            }
        }
    }
    found
}

/// The words in these notes that say a save may not take the update.
pub fn risky_words(notes: &[ChangeNote]) -> Vec<String> {
    words_in(notes, BREAKS)
}

/// The words that only say something was taken out or redone (none of them when a stronger
/// one is there already).
pub fn read_first_words(notes: &[ChangeNote]) -> Vec<String> {
    let strong = risky_words(notes);
    words_in(notes, READ_FIRST).into_iter().filter(|w| !strong.iter().any(|s| s.contains(w.as_str()))).collect()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CachedNotes {
    /// The newest version Steam knew when the page was read.
    fetched_for: u64,
    notes: Vec<ChangeNote>,
}

fn read_cache(z: &Path) -> BTreeMap<String, CachedNotes> {
    std::fs::read_to_string(z.join(CACHE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_cache(z: &Path, cache: &BTreeMap<String, CachedNotes>) {
    let path = z.join(CACHE_FILE);
    if crate::load_order::ini_parser::guard_overwrite::<BTreeMap<String, CachedNotes>>(&path).is_err() {
        return;
    }
    if let Ok(text) = serde_json::to_string(cache) {
        let _ = crate::load_order::ini_parser::atomic_write(&path, text);
    }
}

/// The mods of a Workshop item folder: id, name, and whether it adds map cells.
fn item_mods(item_dir: &Path) -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    for m in std::fs::read_dir(item_dir.join("mods")).into_iter().flatten().flatten() {
        let root = m.path();
        let info = [root.join("42").join("mod.info"), root.join("mod.info")].into_iter().find(|p| p.is_file());
        let Some(info) = info else { continue };
        let Ok(text) = std::fs::read_to_string(&info) else { continue };
        let field = |k: &str| text.lines().find_map(|l| l.trim().strip_prefix(k).map(|v| v.trim().to_string()));
        let Some(id) = field("id=") else { continue };
        let name = field("name=").unwrap_or_else(|| id.clone());
        let has_maps = |d: &Path| std::fs::read_dir(d.join("media").join("maps")).map(|mut r| r.next().is_some()).unwrap_or(false);
        let map = has_maps(&root.join("42")) || has_maps(&root.join("common")) || has_maps(&root);
        out.push((crate::load_order::mod_info::sanitize_mod_id(&id), name, map));
    }
    out
}

/// When the game was last played: the latest recorded session, or Steam's last run of the game.
pub fn last_played(user_zomboid_dir: &Path, steam_last_ran: Option<u64>) -> Option<u64> {
    let session = crate::studio_link::save_references(user_zomboid_dir).values().map(|r| r.at).max();
    match (session, steam_last_ran) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    }
}

/// Everything updated since the last session, or waiting in Steam. With `with_notes`, each
/// item's change notes are read too (cached; Steam is asked only for items it has a newer
/// version of than the cache). Without, nothing leaves the PC.
pub fn whats_new(user_zomboid_dir: &Path, workshop_dir: &str, with_notes: bool, from: Option<u64>) -> WhatsNew {
    let state = crate::workshop::local_state(workshop_dir);
    let last = last_played(user_zomboid_dir, state.as_ref().and_then(|s| s.time_last_app_ran));
    let since = from.or(last);
    let Some(state) = state else { return WhatsNew { last_played: last, since, items: Vec::new() } };
    let active: Vec<String> = crate::load_order::ini_parser::try_parse_default_txt(&user_zomboid_dir.join("mods").join("default.txt")).unwrap_or_default();

    let mut items: Vec<UpdatedItem> = Vec::new();
    for (wid, s) in &state.items {
        let since_last_play = matches!((s.installed_time, since), (Some(i), Some(p)) if i > p);
        if !since_last_play && !s.update_pending {
            continue;
        }
        let mods = item_mods(&Path::new(workshop_dir).join(wid));
        if mods.is_empty() {
            continue;
        }
        items.push(UpdatedItem {
            workshop_id: wid.clone(),
            title: mods[0].1.clone(),
            mod_ids: mods.iter().map(|m| m.0.clone()).collect(),
            active: mods.iter().any(|m| active.contains(&m.0)),
            installed_time: s.installed_time,
            latest_time: s.latest_time,
            pending: s.update_pending,
            since_last_play,
            map_mod: mods.iter().any(|m| m.2),
            notes: Vec::new(),
            notes_error: None,
            risks: Vec::new(),
        });
    }
    // Mods that are on first, then the newest.
    items.sort_by(|a, b| b.active.cmp(&a.active).then(b.latest_time.cmp(&a.latest_time)));

    if with_notes {
        let mut cache = read_cache(user_zomboid_dir);
        let mut asked = 0;
        let mut refused = false;
        for item in items.iter_mut() {
            let newest = item.latest_time.or(item.installed_time).unwrap_or(0);
            let cached = cache.get(&item.workshop_id).filter(|c| c.fetched_for >= newest).cloned();
            let notes = match cached {
                Some(c) => Ok(c.notes),
                // Once Steam says "slow down", the rest wait for another read.
                None if refused => Err("busy".to_string()),
                None if asked >= PAGES_PER_READ => Err("later".to_string()),
                None => {
                    if asked > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                    asked += 1;
                    let url = format!("https://steamcommunity.com/sharedfiles/filedetails/changelog/{}", item.workshop_id);
                    let read = crate::workshop::fetch_page(&url).map(|html| parse_changelog(&html)).inspect(|notes| {
                        cache.insert(item.workshop_id.clone(), CachedNotes { fetched_for: newest, notes: notes.clone() });
                    });
                    if read.as_ref().is_err_and(|e| e.contains("429")) {
                        refused = true;
                        Err("busy".to_string())
                    } else {
                        read
                    }
                }
            };
            match notes {
                Ok(all) => {
                    // The updates after the last session; for a waiting one, after the version on disk.
                    let from = if item.pending { item.installed_time.unwrap_or(0).min(since.unwrap_or(u64::MAX)) } else { since.unwrap_or(0) };
                    item.notes = all.into_iter().filter(|n| n.at > from).take(NOTES_KEPT).collect();
                }
                Err(e) => item.notes_error = Some(e),
            }
        }
        write_cache(user_zomboid_dir, &cache);
    }

    for item in items.iter_mut() {
        if item.map_mod {
            item.risks.push(Risk { code: "map".into(), level: "breaks".into(), detail: String::new() });
        }
        let strong = risky_words(&item.notes);
        if !strong.is_empty() {
            item.risks.push(Risk { code: "notes".into(), level: "breaks".into(), detail: strong.join(", ") });
        }
        let weak = read_first_words(&item.notes);
        if !weak.is_empty() {
            item.risks.push(Risk { code: "notes".into(), level: "read".into(), detail: weak.join(", ") });
        }
    }
    WhatsNew { last_played: last, since, items }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_notes_are_read_with_their_dates_and_lines() {
        let html = r#"<div class="detailBox workshopAnnouncement noFooter changeLogCtn">
            <div class="changelog headline"> Update: 21 Sep @ 5:15am </div>
            <p id="1789992909">Version 1.0.9 &mdash; Cleanup<br><br>&middot; Removed leftover debug output.<br>&quot;Grid&quot; &amp; logs</p>
            </div><p id="1789654852">Version 1.0.9 (beta2)<ul><li>Added icons</li></ul></p><p id="x">not a note</p>"#;
        let notes = parse_changelog(html);
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].at, 1789992909);
        assert!(notes[0].text.starts_with("Version 1.0.9"));
        assert!(notes[0].text.contains("\n\n"));
        assert!(notes[0].text.ends_with("\"Grid\" & logs"));
        assert!(notes[1].text.contains("Added icons"));
        assert!(risky_words(&notes).is_empty(), "debug output taken out breaks nothing");
        assert_eq!(read_first_words(&notes), vec!["removed".to_string()]);
    }

    #[test]
    fn risky_words_are_found_once_and_harmless_notes_have_none() {
        let n = |t: &str| ChangeNote { at: 1, text: t.into() };
        assert!(risky_words(&[n("Fixed a typo in the tooltip.")]).is_empty());
        assert_eq!(
            risky_words(&[n("Big REWORK: start a new save."), n("Rework again, NOT save compatible")]),
            ["new save", "start a new", "not save compatible", "save compatib"].map(String::from).to_vec()
        );
        assert_eq!(read_first_words(&[n("Removed items: Axe. Rework of crafting.")]), vec!["rework".to_string()], "removed is already the strong one");
        assert_eq!(risky_words(&[n("Removed items: Axe.")]), vec!["removed item".to_string()]);
    }

    /// Live, on a copy of the list and sessions: `PZMS_REAL_ZOMBOID=<Zomboid> PZMS_REAL_WORKSHOP=<content/108600>
    /// cargo test -- --ignored live_whats_new --nocapture`. Reads Steam for the notes.
    #[test]
    #[ignore]
    fn live_whats_new() {
        let (Ok(real), Ok(workshop)) = (std::env::var("PZMS_REAL_ZOMBOID"), std::env::var("PZMS_REAL_WORKSHOP")) else { return };
        let z = std::env::temp_dir().join(format!("pzms-whatsnew-live-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&z);
        std::fs::create_dir_all(z.join("mods")).unwrap();
        let real = std::path::PathBuf::from(real);
        let _ = std::fs::copy(real.join("mods").join("default.txt"), z.join("mods").join("default.txt"));
        let _ = std::fs::copy(real.join("PZModStudio_SaveRefs.json"), z.join("PZModStudio_SaveRefs.json"));
        let started = std::time::Instant::now();
        let week = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - 7 * 86400;
        let w = whats_new(&z, &workshop, true, Some(week));
        println!("since {:?}; {} items in {:?}", w.since, w.items.len(), started.elapsed());
        for i in w.items.iter().take(15) {
            println!("{} {:?} active={} pending={} new={} map={} notes={} err={:?} risks={:?}", i.workshop_id, i.title, i.active, i.pending, i.since_last_play, i.map_mod, i.notes.len(), i.notes_error, i.risks);
        }
        if let Some(n) = w.items.iter().find_map(|i| i.notes.first()) {
            println!("first note: {}", n.text.chars().take(200).collect::<String>());
        }
        let cache_path = z.join(CACHE_FILE);
        println!("cache file: {:?} parse: {:?}", std::fs::metadata(&cache_path).map(|m| m.len()), std::fs::read_to_string(&cache_path).map(|t| serde_json::from_str::<BTreeMap<String, CachedNotes>>(&t).map(|m| m.len()).map_err(|e| e.to_string())));
        let again = std::time::Instant::now();
        let _ = whats_new(&z, &workshop, true, Some(week));
        println!("second read (cached) in {:?}", again.elapsed());
        let _ = std::fs::remove_dir_all(&z);
    }

    #[test]
    fn last_played_is_the_later_of_the_sessions_and_steam() {
        let z = std::env::temp_dir().join(format!("pzms-whatsnew-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&z);
        std::fs::create_dir_all(&z).unwrap();
        assert_eq!(last_played(&z, Some(50)), Some(50));
        std::fs::write(z.join("PZModStudio_SaveRefs.json"), r#"{"Sandbox/A":{"mods":[],"at":100},"Sandbox/B":{"mods":[],"at":70}}"#).unwrap();
        assert_eq!(last_played(&z, Some(50)), Some(100));
        assert_eq!(last_played(&z, Some(150)), Some(150));
        assert_eq!(last_played(&z, None), Some(100));
        let _ = std::fs::remove_dir_all(&z);
    }
}
