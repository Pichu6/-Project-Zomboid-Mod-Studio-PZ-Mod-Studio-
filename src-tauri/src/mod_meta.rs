//! The player's own notes on mods and their own groups of mods, kept by the app in
//! `<Zomboid>/PZModStudio_ModMeta.json`. The Link reads them in the game from
//! `<Zomboid>/Lua/PZModStudio_LinkMeta.txt` (`note=<id>\t<text>`, `group=<name>\t<id;id;...>`),
//! written whenever they change: in the game they are shown, and a group can be turned on or
//! off; making and editing them is the app's.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const META_FILE: &str = "PZModStudio_ModMeta.json";
pub const LINK_META_FILE: &str = "PZModStudio_LinkMeta.txt";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ModGroup {
    pub name: String,
    pub mods: Vec<String>,
    /// The player's note on the group.
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ModMeta {
    /// Mod id -> the player's note.
    #[serde(default)]
    pub notes: BTreeMap<String, String>,
    #[serde(default)]
    pub groups: Vec<ModGroup>,
}

fn path(user_zomboid_dir: &Path) -> PathBuf {
    user_zomboid_dir.join(META_FILE)
}

pub fn read(user_zomboid_dir: &Path) -> ModMeta {
    std::fs::read_to_string(path(user_zomboid_dir)).ok().and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}

/// One line per note and per group; tabs and line breaks in a note become spaces (one line each).
pub fn link_text(meta: &ModMeta) -> String {
    let clean = |s: &str| s.replace(['\t', '\r', '\n'], " ").trim().to_string();
    let mut out = String::new();
    for (id, note) in &meta.notes {
        if !note.trim().is_empty() {
            out.push_str(&format!("note={}\t{}\n", id, clean(note)));
        }
    }
    for g in &meta.groups {
        out.push_str(&format!("group={}\t{}\n", clean(&g.name), g.mods.join(";")));
        if !g.note.trim().is_empty() {
            out.push_str(&format!("groupnote={}\t{}\n", clean(&g.name), clean(&g.note)));
        }
    }
    out
}

/// Saves, and writes the Link's copy (only when the game's Lua folder is there).
pub fn write(user_zomboid_dir: &Path, meta: &ModMeta) -> Result<(), String> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    crate::load_order::ini_parser::atomic_write(path(user_zomboid_dir), text).map_err(|e| e.to_string())?;
    write_link_copy(user_zomboid_dir, meta);
    Ok(())
}

pub fn write_link_copy(user_zomboid_dir: &Path, meta: &ModMeta) {
    let lua = user_zomboid_dir.join("Lua");
    if !lua.is_dir() {
        return;
    }
    let file = lua.join(LINK_META_FILE);
    let text = link_text(meta);
    if std::fs::read_to_string(&file).is_ok_and(|now| now == text) {
        return;
    }
    let _ = crate::load_order::ini_parser::atomic_write(file, text);
}

pub fn set_note(user_zomboid_dir: &Path, mod_id: &str, note: &str) -> Result<ModMeta, String> {
    let mut meta = read(user_zomboid_dir);
    if note.trim().is_empty() {
        meta.notes.remove(mod_id);
    } else {
        meta.notes.insert(mod_id.to_string(), note.trim().to_string());
    }
    write(user_zomboid_dir, &meta)?;
    Ok(meta)
}

/// Puts a mod in a group or takes it out; a group named for the first time is made, one left
/// empty goes away.
pub fn set_in_group(user_zomboid_dir: &Path, group: &str, mod_ids: &[String], inside: bool) -> Result<ModMeta, String> {
    let name = group.trim();
    if name.is_empty() {
        return Err("A group needs a name.".to_string());
    }
    let mut meta = read(user_zomboid_dir);
    let at = match meta.groups.iter().position(|g| g.name.eq_ignore_ascii_case(name)) {
        Some(i) => i,
        None => {
            meta.groups.push(ModGroup { name: name.to_string(), mods: Vec::new(), note: String::new() });
            meta.groups.len() - 1
        }
    };
    for id in mod_ids {
        let mods = &mut meta.groups[at].mods;
        if inside {
            if !mods.contains(id) {
                mods.push(id.clone());
            }
        } else {
            mods.retain(|m| m != id);
        }
    }
    meta.groups.retain(|g| !g.mods.is_empty());
    meta.groups.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    write(user_zomboid_dir, &meta)?;
    Ok(meta)
}

pub fn rename_group(user_zomboid_dir: &Path, from: &str, to: &str) -> Result<ModMeta, String> {
    let to = to.trim();
    if to.is_empty() {
        return Err("A group needs a name.".to_string());
    }
    let mut meta = read(user_zomboid_dir);
    if meta.groups.iter().any(|g| g.name.eq_ignore_ascii_case(to) && !g.name.eq_ignore_ascii_case(from)) {
        return Err(format!("There is already a group called {}.", to));
    }
    for g in meta.groups.iter_mut() {
        if g.name == from {
            g.name = to.to_string();
        }
    }
    write(user_zomboid_dir, &meta)?;
    Ok(meta)
}

pub fn set_group_note(user_zomboid_dir: &Path, name: &str, note: &str) -> Result<ModMeta, String> {
    let mut meta = read(user_zomboid_dir);
    let Some(g) = meta.groups.iter_mut().find(|g| g.name == name) else { return Err(format!("There is no group called {}.", name)) };
    g.note = note.trim().to_string();
    write(user_zomboid_dir, &meta)?;
    Ok(meta)
}

pub fn delete_group(user_zomboid_dir: &Path, name: &str) -> Result<ModMeta, String> {
    let mut meta = read(user_zomboid_dir);
    meta.groups.retain(|g| g.name != name);
    write(user_zomboid_dir, &meta)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("pzms-meta-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(d.join("Lua")).unwrap();
        d
    }

    #[test]
    fn notes_and_groups_are_kept_and_written_for_the_link() {
        let d = dir();
        set_note(&d, "A", "breaks with B\tsometimes\nreally").unwrap();
        set_in_group(&d, "Weapons", &["A".into(), "B".into()], true).unwrap();
        set_in_group(&d, "weapons", &["C".into()], true).unwrap();
        let meta = set_in_group(&d, "UI", &["D".into()], true).unwrap();
        assert_eq!(meta.groups.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(), vec!["UI", "Weapons"]);
        assert_eq!(meta.groups[1].mods, vec!["A", "B", "C"], "names match without case");
        let link = std::fs::read_to_string(d.join("Lua").join(LINK_META_FILE)).unwrap();
        assert!(link.contains("note=A\tbreaks with B sometimes really\n"));
        assert!(link.contains("group=Weapons\tA;B;C\n"));
        let meta = set_in_group(&d, "UI", &["D".into()], false).unwrap();
        assert_eq!(meta.groups.len(), 1, "an empty group goes away");
        let meta = set_note(&d, "A", "  ").unwrap();
        assert!(meta.notes.is_empty(), "an empty note is taken away");
        assert!(rename_group(&d, "Weapons", "").is_err());
        assert_eq!(rename_group(&d, "Weapons", "Guns").unwrap().groups[0].name, "Guns");
        set_group_note(&d, "Guns", "load\tlast").unwrap();
        assert!(std::fs::read_to_string(d.join("Lua").join(LINK_META_FILE)).unwrap().contains("groupnote=Guns\tload last\n"));
        assert!(set_group_note(&d, "Nope", "x").is_err());
        assert!(delete_group(&d, "Guns").unwrap().groups.is_empty());
        let _ = std::fs::remove_dir_all(d);
    }
}
