//! The player's own lists of mods — Favorites and any they make — kept in
//! `Zomboid/PZModStudio_Lists.json`. What a Workshop collection is, but the player's, offline,
//! and able to hold a mod from anywhere: a Workshop item by its id, a local or Nexus mod by its
//! mod id. A list is for keeping, subscribing all at once, or making a profile from.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::load_order::mod_info::get_existing_user_zomboid_dirs;

const LISTS_FILE: &str = "PZModStudio_Lists.json";
/// The list every player has, made on first use.
pub const FAVORITES: &str = "favorites";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ListItem {
    #[serde(default)]
    pub workshop_id: Option<String>,
    #[serde(default)]
    pub mod_id: Option<String>,
    /// A Nexus mod not installed yet, by its id on Nexus.
    #[serde(default)]
    pub nexus_id: Option<u64>,
    /// What to call it when nothing else is at hand (the Workshop title, the mod's name).
    pub name: String,
    #[serde(default)]
    pub added_at: String,
}

impl ListItem {
    /// What makes two items the same: the Workshop item, else the Nexus mod, else the mod id.
    pub fn key(&self) -> String {
        self.workshop_id
            .clone()
            .map(|w| format!("w:{}", w))
            .or_else(|| self.nexus_id.map(|n| format!("n:{}", n)))
            .or_else(|| self.mod_id.clone().map(|m| format!("m:{}", m)))
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModList {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub items: Vec<ListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ListsFile {
    #[serde(default)]
    lists: Vec<ModList>,
}

fn lists_path(user_zomboid_dir: &str) -> Result<PathBuf, String> {
    get_existing_user_zomboid_dirs(user_zomboid_dir)
        .into_iter()
        .next()
        .map(|d| d.join(LISTS_FILE))
        .ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Every list, Favorites first; Favorites exists even before anything is in it.
pub fn load_lists(user_zomboid_dir: &str) -> Vec<ModList> {
    let mut lists = lists_path(user_zomboid_dir)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<ListsFile>(&t).ok())
        .map(|f| f.lists)
        .unwrap_or_default();
    if let Some(i) = lists.iter().position(|l| l.id == FAVORITES) {
        if i != 0 {
            let fav = lists.remove(i);
            lists.insert(0, fav);
        }
    } else {
        lists.insert(0, ModList { id: FAVORITES.into(), name: "Favorites".into(), created_at: now(), items: vec![] });
    }
    lists
}

fn save(user_zomboid_dir: &str, lists: &[ModList]) -> Result<(), String> {
    let path = lists_path(user_zomboid_dir)?;
    let json = serde_json::to_string_pretty(&ListsFile { lists: lists.to_vec() }).map_err(|e| e.to_string())?;
    crate::load_order::ini_parser::guard_overwrite::<ListsFile>(&path)?;
    crate::load_order::ini_parser::atomic_write(path, json).map_err(|e| e.to_string())
}

/// A readable id from the name, unique among the lists.
fn id_for(name: &str, lists: &[ModList]) -> String {
    let base: String = name.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() { "list".to_string() } else { base };
    let mut id = base.clone();
    let mut n = 2;
    while lists.iter().any(|l| l.id == id) {
        id = format!("{}-{}", base, n);
        n += 1;
    }
    id
}

pub fn create_list(user_zomboid_dir: &str, name: &str) -> Result<ModList, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A list needs a name.".to_string());
    }
    let mut lists = load_lists(user_zomboid_dir);
    if lists.iter().any(|l| l.name.eq_ignore_ascii_case(name)) {
        return Err(format!("There is already a list called {}.", name));
    }
    let list = ModList { id: id_for(name, &lists), name: name.to_string(), created_at: now(), items: vec![] };
    lists.push(list.clone());
    save(user_zomboid_dir, &lists)?;
    Ok(list)
}

pub fn rename_list(user_zomboid_dir: &str, list_id: &str, name: &str) -> Result<ModList, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A list needs a name.".to_string());
    }
    let mut lists = load_lists(user_zomboid_dir);
    let list = lists.iter_mut().find(|l| l.id == list_id).ok_or_else(|| format!("There is no list {}.", list_id))?;
    list.name = name.to_string();
    let out = list.clone();
    save(user_zomboid_dir, &lists)?;
    Ok(out)
}

/// Favorites stays; any other list can go.
pub fn delete_list(user_zomboid_dir: &str, list_id: &str) -> Result<Vec<ModList>, String> {
    if list_id == FAVORITES {
        return Err("Favorites cannot be deleted; take the mods out of it instead.".to_string());
    }
    let mut lists = load_lists(user_zomboid_dir);
    let before = lists.len();
    lists.retain(|l| l.id != list_id);
    if lists.len() == before {
        return Err(format!("There is no list {}.", list_id));
    }
    save(user_zomboid_dir, &lists)?;
    Ok(lists)
}

/// Puts a mod in a list, once: the same Workshop item or mod id twice is one entry.
pub fn add_to_list(user_zomboid_dir: &str, list_id: &str, mut item: ListItem) -> Result<ModList, String> {
    if item.key().is_empty() {
        return Err("A list entry needs a Workshop id or a mod id.".to_string());
    }
    let mut lists = load_lists(user_zomboid_dir);
    let list = lists.iter_mut().find(|l| l.id == list_id).ok_or_else(|| format!("There is no list {}.", list_id))?;
    if !list.items.iter().any(|i| i.key() == item.key()) {
        if item.added_at.is_empty() {
            item.added_at = now();
        }
        list.items.push(item);
    }
    let out = list.clone();
    save(user_zomboid_dir, &lists)?;
    Ok(out)
}

/// Takes a mod out of a list, by its key (`w:<workshop id>` or `m:<mod id>`), a Workshop id, or a mod id.
pub fn remove_from_list(user_zomboid_dir: &str, list_id: &str, key: &str) -> Result<ModList, String> {
    let mut lists = load_lists(user_zomboid_dir);
    let list = lists.iter_mut().find(|l| l.id == list_id).ok_or_else(|| format!("There is no list {}.", list_id))?;
    let before = list.items.len();
    list.items.retain(|i| !(i.key() == key || i.workshop_id.as_deref() == Some(key) || i.mod_id.as_deref() == Some(key)));
    if list.items.len() == before {
        return Err(format!("{} is not in {}.", key, list.name));
    }
    let out = list.clone();
    save(user_zomboid_dir, &lists)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn zomboid(tag: &str) -> (Tmp, String) {
        let t = Tmp(std::env::temp_dir().join(format!("pzms-lists-{}-{}", tag, std::process::id())));
        let _ = fs::remove_dir_all(&t.0);
        fs::create_dir_all(t.0.join("mods")).unwrap();
        let z = t.0.to_string_lossy().to_string();
        (t, z)
    }

    fn item(w: Option<&str>, m: Option<&str>) -> ListItem {
        ListItem { workshop_id: w.map(str::to_string), mod_id: m.map(str::to_string), nexus_id: None, name: "X".into(), added_at: String::new() }
    }

    #[test]
    fn favorites_is_always_there_and_a_mod_goes_in_once() {
        let (_t, z) = zomboid("fav");
        let lists = load_lists(&z);
        assert_eq!(lists[0].id, FAVORITES);
        add_to_list(&z, FAVORITES, item(Some("123"), Some("Mod"))).unwrap();
        let fav = add_to_list(&z, FAVORITES, item(Some("123"), None)).unwrap();
        assert_eq!(fav.items.len(), 1, "the same Workshop item twice is one entry");
        assert!(!fav.items[0].added_at.is_empty());
        assert!(add_to_list(&z, FAVORITES, item(None, None)).is_err());
        assert!(delete_list(&z, FAVORITES).is_err());
        let fav = remove_from_list(&z, FAVORITES, "123").unwrap();
        assert!(fav.items.is_empty());
    }

    #[test]
    fn a_list_gets_a_readable_unique_id_and_can_be_renamed_and_deleted() {
        let (_t, z) = zomboid("make");
        let a = create_list(&z, "Zombie overhauls!").unwrap();
        assert_eq!(a.id, "zombie-overhauls");
        assert!(create_list(&z, "zombie overhauls!").is_err(), "the same name twice is refused");
        let b = create_list(&z, "zombie-overhauls").unwrap();
        assert_eq!(b.id, "zombie-overhauls-2");
        add_to_list(&z, &a.id, item(None, Some("LocalMod"))).unwrap();
        let renamed = rename_list(&z, &a.id, "Overhauls").unwrap();
        assert_eq!(renamed.name, "Overhauls");
        assert_eq!(renamed.items[0].key(), "m:LocalMod");
        let left = delete_list(&z, &b.id).unwrap();
        assert_eq!(left.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), vec![FAVORITES, "zombie-overhauls"]);
        assert!(remove_from_list(&z, &a.id, "nope").is_err());
    }
}
