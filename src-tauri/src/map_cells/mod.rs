//! Which cells of the world each map mod covers, and where two of them clash.
//!
//! A map is a folder under `media/maps/` with one `X_Y.lotheader` per cell it has (a B42 cell
//! is 256 x 256 tiles). The game's own world is `media/maps/Muldraugh, KY` in the install folder.
//! A map mod's cells over the game's world replace what was there; two map mods with cells in
//! common fight over them (the one loaded later wins, the other's buildings there are gone),
//! unless one builds on the other: its `map.info` names the other in `lots=`.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

/// The game's own world.
pub const VANILLA_MAP: &str = "Muldraugh, KY";

/// One map folder of one mod.
#[derive(Debug, Clone, Serialize)]
pub struct MapFolder {
    pub mod_id: String,
    pub mod_name: String,
    pub workshop_id: Option<String>,
    /// The folder under media/maps (what map lists and map.info's `lots=` name).
    pub folder: String,
    /// map.info's `title`.
    pub title: String,
    /// map.info's `lots=`: the maps it builds on.
    pub lots: Vec<String>,
    /// Its mod is on in the list the game reads.
    pub active: bool,
    pub cells: Vec<[i32; 2]>,
    /// How many of its cells are over the game's own world.
    pub over_vanilla: usize,
}

/// Two map folders with cells in common, neither building on the other.
#[derive(Debug, Clone, Serialize)]
pub struct Clash {
    pub a: String,
    pub b: String,
    pub mod_a: String,
    pub mod_b: String,
    pub cells: Vec<[i32; 2]>,
    /// Both mods are on: they clash in the next game.
    pub both_active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapCells {
    pub vanilla: Vec<[i32; 2]>,
    pub maps: Vec<MapFolder>,
    pub clashes: Vec<Clash>,
}

/// The cells of one map folder, from its `X_Y.lotheader` files.
pub fn folder_cells(dir: &Path) -> Vec<[i32; 2]> {
    let mut out: Vec<[i32; 2]> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let stem = name.strip_suffix(".lotheader")?;
            let (x, y) = stem.split_once('_')?;
            Some([x.parse().ok()?, y.parse().ok()?])
        })
        .collect();
    out.sort();
    out
}

fn map_info(dir: &Path) -> (String, Vec<String>) {
    let text = std::fs::read_to_string(dir.join("map.info")).unwrap_or_default();
    let field = |k: &str| text.lines().find_map(|l| l.trim().strip_prefix(k).map(|v| v.trim().to_string()));
    let lots = field("lots=").map(|v| v.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default();
    (field("title=").unwrap_or_default(), lots)
}

/// Every mod folder installed: the Workshop's (`<item>/mods/<mod>`) and the local ones.
fn mod_roots(workshop_dir: &str, user_zomboid_dir: &Path) -> Vec<(PathBuf, Option<String>)> {
    let mut out = Vec::new();
    if !workshop_dir.is_empty() {
        for item in std::fs::read_dir(workshop_dir).into_iter().flatten().flatten() {
            let wid = item.file_name().to_string_lossy().to_string();
            for m in std::fs::read_dir(item.path().join("mods")).into_iter().flatten().flatten() {
                out.push((m.path(), Some(wid.clone())));
            }
        }
    }
    for m in std::fs::read_dir(user_zomboid_dir.join("mods")).into_iter().flatten().flatten() {
        if m.path().is_dir() {
            out.push((m.path(), None));
        }
    }
    out
}

fn mod_id_and_name(root: &Path) -> Option<(String, String)> {
    let info = [root.join("42").join("mod.info"), root.join("mod.info")].into_iter().find(|p| p.is_file())?;
    let text = std::fs::read_to_string(info).ok()?;
    let field = |k: &str| text.lines().find_map(|l| l.trim().strip_prefix(k).map(|v| v.trim().to_string()));
    let id = crate::load_order::mod_info::sanitize_mod_id(&field("id=")?);
    let name = field("name=").unwrap_or_else(|| id.clone());
    Some((id, name))
}

/// Where map folders clash: cells in common, neither naming the other in `lots=`.
pub fn clashes(maps: &[MapFolder]) -> Vec<Clash> {
    let sets: Vec<HashSet<[i32; 2]>> = maps.iter().map(|m| m.cells.iter().copied().collect()).collect();
    let mut out = Vec::new();
    for i in 0..maps.len() {
        for j in (i + 1)..maps.len() {
            let (a, b) = (&maps[i], &maps[j]);
            if a.mod_id == b.mod_id || a.folder == b.folder {
                continue;
            }
            if a.lots.iter().any(|l| l == &b.folder) || b.lots.iter().any(|l| l == &a.folder) {
                continue;
            }
            let mut common: Vec<[i32; 2]> = sets[i].intersection(&sets[j]).copied().collect();
            if common.is_empty() {
                continue;
            }
            common.sort();
            out.push(Clash { a: a.folder.clone(), b: b.folder.clone(), mod_a: a.mod_id.clone(), mod_b: b.mod_id.clone(), cells: common, both_active: a.active && b.active });
        }
    }
    out.sort_by(|x, y| y.both_active.cmp(&x.both_active).then(y.cells.len().cmp(&x.cells.len())));
    out
}

/// The game's world and every installed map mod's cells, and their clashes.
pub fn map_cells(pz_install_dir: &str, workshop_dir: &str, user_zomboid_dir: &Path) -> MapCells {
    let vanilla = folder_cells(&Path::new(pz_install_dir).join("media").join("maps").join(VANILLA_MAP));
    let vanilla_set: BTreeSet<[i32; 2]> = vanilla.iter().copied().collect();
    let game = crate::load_order::mod_info::read_installed_game_version(&user_zomboid_dir.to_string_lossy());
    let active: Vec<String> = crate::load_order::ini_parser::try_parse_default_txt(&user_zomboid_dir.join("mods").join("default.txt")).unwrap_or_default();

    // One entry per (mod, folder): the version folder wins over common for the same map.
    let mut found: BTreeMap<(String, String), MapFolder> = BTreeMap::new();
    for (root, wid) in mod_roots(workshop_dir, user_zomboid_dir) {
        let Some((mod_id, mod_name)) = mod_id_and_name(&root) else { continue };
        for layer in crate::load_order::mod_info::media_layers_for_build(&root, game) {
            for dir in std::fs::read_dir(layer.join("media").join("maps")).into_iter().flatten().flatten() {
                let cells = folder_cells(&dir.path());
                if cells.is_empty() {
                    continue; // spawn points or a map list, no cells of its own
                }
                let folder = dir.file_name().to_string_lossy().to_string();
                let (title, lots) = map_info(&dir.path());
                let over_vanilla = cells.iter().filter(|c| vanilla_set.contains(*c)).count();
                found.insert(
                    (mod_id.clone(), folder.clone()),
                    MapFolder {
                        mod_id: mod_id.clone(),
                        mod_name: mod_name.clone(),
                        workshop_id: wid.clone(),
                        title: if title.is_empty() { folder.clone() } else { title },
                        folder,
                        lots,
                        active: active.contains(&mod_id),
                        cells,
                        over_vanilla,
                    },
                );
            }
        }
    }
    let mut maps: Vec<MapFolder> = found.into_values().collect();
    maps.sort_by(|a, b| b.active.cmp(&a.active).then(a.mod_name.to_lowercase().cmp(&b.mod_name.to_lowercase())));
    let clashes = clashes(&maps);
    MapCells { vanilla, maps, clashes }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(mod_id: &str, folder: &str, lots: &[&str], active: bool, cells: &[[i32; 2]]) -> MapFolder {
        MapFolder {
            mod_id: mod_id.into(),
            mod_name: mod_id.into(),
            workshop_id: None,
            folder: folder.into(),
            title: folder.into(),
            lots: lots.iter().map(|s| s.to_string()).collect(),
            active,
            cells: cells.to_vec(),
            over_vanilla: 0,
        }
    }

    #[test]
    fn cells_come_from_lotheader_names() {
        let dir = std::env::temp_dir().join(format!("pzms-cells-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["3_4.lotheader", "10_2.lotheader", "world_3_4.lotpack", "map.info", "x_y.lotheader"] {
            std::fs::write(dir.join(f), "").unwrap();
        }
        assert_eq!(folder_cells(&dir), vec![[3, 4], [10, 2]]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn maps_sharing_cells_clash_unless_one_builds_on_the_other() {
        let maps = vec![
            map("A", "TownA", &[], true, &[[1, 1], [1, 2], [5, 5]]),
            map("B", "TownB", &[], true, &[[1, 2], [5, 5], [9, 9]]),
            map("C", "AddOnA", &["TownA"], true, &[[1, 1]]),
            map("D", "Far", &[], false, &[[9, 9]]),
        ];
        let c = clashes(&maps);
        let pairs: Vec<(String, String, usize, bool)> = c.iter().map(|x| (x.a.clone(), x.b.clone(), x.cells.len(), x.both_active)).collect();
        assert_eq!(pairs, vec![("TownA".into(), "TownB".into(), 2, true), ("TownB".into(), "Far".into(), 1, false)]);
    }

    /// Live: `cargo test -- --ignored live_map_cells --nocapture` on this PC's game and mods.
    #[test]
    #[ignore]
    fn live_map_cells() {
        let p = crate::vfs::studio_paths();
        let m = map_cells(&p.pz_install_dir, &p.workshop_dir, Path::new(&p.user_zomboid_dir));
        println!("vanilla {} cells", m.vanilla.len());
        if let Ok(out) = std::env::var("PZMS_DUMP") {
            std::fs::write(out, serde_json::to_string(&m).unwrap()).unwrap();
        }
        for f in &m.maps {
            println!("{} / {} ({}) active={} cells={} over_vanilla={} lots={:?}", f.mod_name, f.folder, f.title, f.active, f.cells.len(), f.over_vanilla, f.lots);
        }
        for c in &m.clashes {
            println!("CLASH {} x {}: {} cells, both on={}", c.a, c.b, c.cells.len(), c.both_active);
        }
    }
}
