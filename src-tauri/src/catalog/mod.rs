//! The mod catalog: a read-only picture of every installed mod as the game sees it, and a
//! health report of what will go wrong with an active mod list. Nothing here writes to disk.
//!
//! Game rules reproduced (decompiled 42.20.4):
//! - mod folders are searched Workshop uploads (`Zomboid/Workshop/*/Contents/mods`), then
//!   subscribed Workshop items, then `Zomboid/mods`; the first copy of an id wins;
//! - each mod's mod.info comes from its version folder for the installed build, else `common/`
//!   (`select_mod_info_for_build`); Build 41 reads the root;
//! - a mod is unavailable outside versionMin..versionMax or when a required mod (at any depth)
//!   is missing or unavailable.

pub mod modinfo;

use crate::load_order::mod_info::{
    get_existing_user_zomboid_dirs, get_subscribed_workshop_ids, read_installed_game_version,
    select_mod_info_for_build, version_dir_int,
};
use modinfo::{format_game_version, parse_game_mod_info, GameModInfo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModSource {
    /// A Workshop item the user uploads (Zomboid/Workshop/<item>/Contents/mods).
    WorkshopUpload { item_folder: String },
    /// A subscribed Steam Workshop item.
    Workshop { workshop_id: String },
    /// Zomboid/mods.
    Local,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Loadability {
    Loadable,
    /// No mod.info the installed build reads (B41-only, or only folders for newer builds).
    NoFolderForBuild { available_folders: Vec<String> },
    /// mod.info found, but the build is outside versionMin..versionMax.
    OutsideVersionRange { version_min: Option<String>, version_max: Option<String> },
    /// The game rejects the mod.info (no id, invalid version string).
    InvalidModInfo { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogMod {
    pub id: String,
    pub name: String,
    pub source: ModSource,
    /// The mod folder (direct child of a `mods` folder).
    pub root_dir: String,
    /// The mod.info the game reads on the installed build (or the one used for listing).
    pub mod_info_path: Option<String>,
    /// Version folders present (`42`, `42.13`, ...) and whether `common/` / a root mod.info exist.
    pub version_folders: Vec<String>,
    pub has_common: bool,
    pub has_root_mod_info: bool,
    pub loadability: Loadability,
    /// When another copy with the same id is found first, the root of that copy: this one is ignored.
    pub shadowed_by: Option<String>,
    /// For mods in Zomboid/mods installed by the Studio: where they were downloaded from.
    #[serde(default)]
    pub origin: Option<crate::origins::ModOrigin>,
    pub info: GameModInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModCatalog {
    /// "42.21" when Zomboid/version.txt was found.
    pub game_version: Option<String>,
    /// In game search order; shadowed duplicates included (marked with `shadowed_by`).
    pub mods: Vec<CatalogMod>,
}

impl ModCatalog {
    /// The copy of `id` the game uses (the first one found), if installed.
    pub fn get(&self, id: &str) -> Option<&CatalogMod> {
        self.mods.iter().find(|m| m.id == id && m.shadowed_by.is_none())
    }
}

fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// Every `mods` folder the game searches, in its order, with the source each one represents.
fn mod_folders_in_game_order(workshop_dir: &str, user_zomboid_dir: &str) -> Vec<(PathBuf, ModSource)> {
    let mut folders = Vec::new();
    let user_dir = get_existing_user_zomboid_dirs(user_zomboid_dir).into_iter().next();

    if let Some(user_dir) = &user_dir {
        for item in child_dirs(&user_dir.join("Workshop")) {
            let mods = item.join("Contents").join("mods");
            if mods.is_dir() {
                let item_folder = item.file_name().unwrap_or_default().to_string_lossy().to_string();
                folders.push((mods, ModSource::WorkshopUpload { item_folder }));
            }
        }
    }

    let workshop = Path::new(workshop_dir);
    if !workshop_dir.is_empty() && workshop.is_dir() {
        let subscribed = get_subscribed_workshop_ids(workshop);
        let mut items: Vec<(u64, PathBuf, String)> = child_dirs(workshop)
            .into_iter()
            .filter_map(|p| {
                let id = p.file_name()?.to_string_lossy().to_string();
                Some((id.parse::<u64>().ok()?, p, id))
            })
            .filter(|(_, _, id)| subscribed.as_ref().is_none_or(|s| s.contains(id)))
            .collect();
        items.sort();
        for (_, item, workshop_id) in items {
            let mods = item.join("mods");
            if mods.is_dir() {
                folders.push((mods, ModSource::Workshop { workshop_id }));
            }
        }
    }

    if let Some(user_dir) = &user_dir {
        folders.push((user_dir.join("mods"), ModSource::Local));
    }
    folders
}

fn read_game_mod_info(path: &Path) -> Option<GameModInfo> {
    let bytes = fs::read(path).ok()?;
    Some(parse_game_mod_info(&String::from_utf8_lossy(&bytes)))
}

/// Builds the catalog for the installed game build (read from `Zomboid/version.txt` unless
/// `game_version_override` is given, e.g. 42_015).
pub fn build_catalog(workshop_dir: &str, user_zomboid_dir: &str, game_version_override: Option<u32>) -> ModCatalog {
    let game_version = game_version_override.or_else(|| read_installed_game_version(user_zomboid_dir));
    let mut mods: Vec<CatalogMod> = Vec::new();
    let mut first_copy: HashMap<String, String> = HashMap::new();
    let recorded_origins = get_existing_user_zomboid_dirs(user_zomboid_dir)
        .first()
        .map(|dir| crate::origins::load(dir))
        .unwrap_or_default();

    for (mods_dir, source) in mod_folders_in_game_order(workshop_dir, user_zomboid_dir) {
        for root in child_dirs(&mods_dir) {
            let folder_name = root.file_name().unwrap_or_default().to_string_lossy().to_string();
            if folder_name.eq_ignore_ascii_case("examplemod") {
                continue; // the game refuses to list it
            }
            let mut version_folders: Vec<String> = child_dirs(&root)
                .iter()
                .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
                .filter(|n| version_dir_int(n).is_some())
                .collect();
            version_folders.sort_by_key(|n| version_dir_int(n));
            let has_common = root.join("common").is_dir();
            let has_root_mod_info = root.join("mod.info").is_file();

            let selected = select_mod_info_for_build(&root, game_version);
            // Not loadable on this build: still list it from its newest mod.info, else the root one.
            let listed = selected.clone().or_else(|| select_mod_info_for_build(&root, None)).or_else(|| {
                let r = root.join("mod.info");
                r.is_file().then_some(r)
            });
            let Some(mod_info_path) = listed else {
                continue; // not a mod folder
            };
            let Some(info) = read_game_mod_info(&mod_info_path) else { continue };

            let loadability = if let Some(reason) = &info.invalid_reason {
                Loadability::InvalidModInfo { reason: reason.clone() }
            } else if info.id.is_none() {
                Loadability::InvalidModInfo {
                    reason: "mod.info has no line starting with \"id=\" (check spelling, case and a UTF-8 BOM)".into(),
                }
            } else if selected.is_none() {
                let mut available = version_folders.clone();
                if has_common {
                    available.push("common".into());
                }
                if has_root_mod_info {
                    available.push("(root, Build 41 layout)".into());
                }
                Loadability::NoFolderForBuild { available_folders: available }
            } else if game_version.is_some_and(|v| !info.fits_version(v)) {
                Loadability::OutsideVersionRange {
                    version_min: info.version_min.map(format_game_version),
                    version_max: info.version_max.map(format_game_version),
                }
            } else {
                Loadability::Loadable
            };

            let id = info.id.clone().unwrap_or_else(|| folder_name.clone());
            let root_str = root.to_string_lossy().to_string();
            let shadowed_by = match first_copy.get(&id) {
                Some(first) => Some(first.clone()),
                None => {
                    first_copy.insert(id.clone(), root_str.clone());
                    None
                }
            };
            mods.push(CatalogMod {
                name: info.name.clone().map(|n| n.trim().to_string()).unwrap_or_else(|| id.clone()),
                id,
                source: source.clone(),
                root_dir: root_str,
                mod_info_path: Some(mod_info_path.to_string_lossy().to_string()),
                version_folders,
                has_common,
                has_root_mod_info,
                loadability,
                shadowed_by,
                origin: if source == ModSource::Local { recorded_origins.get(&folder_name).map(|r| r.origin.clone()) } else { None },
                info,
            });
        }
    }

    ModCatalog { game_version: game_version.map(format_game_version), mods }
}

/// The catalog and the health report of an active list, as returned to the UI and MCP clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModHealth {
    pub catalog: ModCatalog,
    pub report: HealthReport,
}

pub fn mod_health(workshop_dir: &str, user_zomboid_dir: &str, active: &[String]) -> ModHealth {
    let catalog = build_catalog(workshop_dir, user_zomboid_dir, None);
    let report = health_report(&catalog, active);
    ModHealth { catalog, report }
}

// ---------------------------------------------------------------------------------------------
// Health report
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// The game will not load the mod, or it will break.
    Error,
    /// Likely problems (load order, duplicates).
    Warning,
    /// Worth knowing, nothing to fix.
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum SuggestedFix {
    EnableMod { mod_id: String },
    DisableMod { mod_id: String },
    MoveBefore { mod_id: String, before: String },
    RemoveFromList { entry: String },
    SubscribeWorkshop { hint: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthIssue {
    pub severity: Severity,
    /// Stable machine code: missing_mod, not_for_build, outside_version_range, invalid_mod_info,
    /// missing_dependency, dependency_not_enabled, dependency_unavailable, dependency_after,
    /// load_after_order, load_before_order, incompatible, duplicate_entry, shadowed_copy.
    pub code: String,
    pub mod_id: Option<String>,
    pub message: String,
    pub fixes: Vec<SuggestedFix>,
    /// The other mod ids involved (the dependency, the incompatible mod, ...), for UIs that
    /// show the issue next to each mod.
    pub related: Vec<String>,
}

/// Collects issues; `related` is filled from the fixes (every fix names the other mod).
struct IssueList(Vec<HealthIssue>);

impl IssueList {
    fn push(&mut self, severity: Severity, code: &str, mod_id: Option<&str>, message: String, fixes: Vec<SuggestedFix>) {
        let mut related: Vec<String> = Vec::new();
        for fix in &fixes {
            let other = match fix {
                SuggestedFix::EnableMod { mod_id: m } | SuggestedFix::DisableMod { mod_id: m } => Some(m),
                SuggestedFix::MoveBefore { mod_id: m, before } => Some(if Some(m.as_str()) == mod_id { before } else { m }),
                SuggestedFix::SubscribeWorkshop { hint } => Some(hint),
                SuggestedFix::RemoveFromList { .. } => None,
            };
            if let Some(other) = other.filter(|o| Some(o.as_str()) != mod_id && !related.contains(o)) {
                related.push(other.clone());
            }
        }
        self.0.push(HealthIssue { severity, code: code.to_string(), mod_id: mod_id.map(str::to_string), message, fixes, related });
    }

    fn relate_last(&mut self, other: &str) {
        if let Some(last) = self.0.last_mut() {
            last.related.push(other.to_string());
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthReport {
    pub game_version: Option<String>,
    pub active_count: usize,
    pub errors: usize,
    pub warnings: usize,
    pub issues: Vec<HealthIssue>,
}

/// A default.txt entry may be `ModId` or `<workshopId>/<ModId>` (newer B42 builds use the second
/// form to tell apart mods that share an id).
fn resolve_entry<'a>(catalog: &'a ModCatalog, entry: &str) -> Option<&'a CatalogMod> {
    // Some mods put a slash in their own id (e.g. "2858201402/dailystatisticsandgains").
    if let Some(exact) = catalog.get(entry) {
        return Some(exact);
    }
    match entry.split_once('/') {
        Some((workshop_id, id)) if workshop_id.chars().all(|c| c.is_ascii_digit()) => catalog
            .mods
            .iter()
            .find(|m| m.id == id && m.source == ModSource::Workshop { workshop_id: workshop_id.to_string() })
            .or_else(|| catalog.get(id)),
        _ => catalog.get(entry),
    }
}

fn entry_mod_id(entry: &str) -> &str {
    match entry.split_once('/') {
        Some((ws, id)) if ws.chars().all(|c| c.is_ascii_digit()) => id,
        _ => entry,
    }
}

fn describe(m: &CatalogMod) -> String {
    if m.name == m.id {
        m.id.clone()
    } else {
        format!("{} ({})", m.name, m.id)
    }
}

fn near_match<'a>(catalog: &'a ModCatalog, id: &str) -> Option<&'a CatalogMod> {
    catalog.mods.iter().find(|m| m.shadowed_by.is_none() && m.id.eq_ignore_ascii_case(id))
}

/// Everything that will go wrong when the game loads `active` (the default.txt list, in order).
pub fn health_report(catalog: &ModCatalog, active: &[String]) -> HealthReport {
    let mut list = IssueList(Vec::new());

    let active_ids: Vec<&str> = active
        .iter()
        .map(|e| {
            let e = e.trim();
            resolve_entry(catalog, e).map(|m| m.id.as_str()).unwrap_or_else(|| entry_mod_id(e))
        })
        .collect();
    let position: HashMap<&str, usize> = active_ids.iter().enumerate().rev().map(|(i, id)| (*id, i)).collect();

    // Availability like ChooseGameInfo.isAvailable (self + required mods, at any depth).
    let mut unavailable_memo: HashMap<String, Option<String>> = HashMap::new();
    fn why_unavailable(
        catalog: &ModCatalog,
        id: &str,
        seen: &mut HashSet<String>,
        memo: &mut HashMap<String, Option<String>>,
    ) -> Option<String> {
        if let Some(r) = memo.get(id) {
            return r.clone();
        }
        if !seen.insert(id.to_string()) {
            return None; // cycle: the game stops following it as well
        }
        let reason = match catalog.get(id) {
            None => Some(format!("{} is not installed", id)),
            Some(m) if m.loadability != Loadability::Loadable => Some(format!("{} cannot load on this build", describe(m))),
            Some(m) => m.info.require.iter().find_map(|r| why_unavailable(catalog, r, seen, memo)),
        };
        memo.insert(id.to_string(), reason.clone());
        reason
    }

    let mut seen_entries: HashSet<&str> = HashSet::new();
    for (idx, entry) in active.iter().enumerate() {
        let entry = entry.trim();
        let id = active_ids[idx];
        if !seen_entries.insert(id) {
            list.push(Severity::Warning, "duplicate_entry", Some(id), format!("{} is in the active list more than once", id),
                vec![SuggestedFix::RemoveFromList { entry: entry.to_string() }]);
            continue;
        }
        let Some(m) = resolve_entry(catalog, entry) else {
            let mut fixes = vec![SuggestedFix::RemoveFromList { entry: entry.to_string() }];
            let message = match near_match(catalog, id) {
                Some(similar) => {
                    fixes.insert(0, SuggestedFix::EnableMod { mod_id: similar.id.clone() });
                    format!("{} is not installed. Mod ids are case-sensitive: did you mean {}?", id, similar.id)
                }
                None => {
                    fixes.push(SuggestedFix::SubscribeWorkshop { hint: id.to_string() });
                    format!("{} is enabled but not installed (unsubscribed or deleted)", id)
                }
            };
            list.push(Severity::Error, "missing_mod", Some(id), message, fixes);
            continue;
        };

        match &m.loadability {
            Loadability::Loadable => {}
            Loadability::NoFolderForBuild { available_folders } => list.push(
                Severity::Error, "not_for_build", Some(id),
                format!("{} has no files for game build {} (it has: {}). The game will not load it.",
                    describe(m), catalog.game_version.as_deref().unwrap_or("?"),
                    if available_folders.is_empty() { "nothing usable".to_string() } else { available_folders.join(", ") }),
                vec![SuggestedFix::DisableMod { mod_id: m.id.clone() }],
            ),
            Loadability::OutsideVersionRange { version_min, version_max } => list.push(
                Severity::Error, "outside_version_range", Some(id),
                format!("{} supports game versions {} to {}; you have {}. The game will not load it.",
                    describe(m), version_min.as_deref().unwrap_or("any"), version_max.as_deref().unwrap_or("any"),
                    catalog.game_version.as_deref().unwrap_or("?")),
                vec![SuggestedFix::DisableMod { mod_id: m.id.clone() }],
            ),
            Loadability::InvalidModInfo { reason } => list.push(
                Severity::Error, "invalid_mod_info", Some(id),
                format!("{}: {}", describe(m), reason),
                vec![SuggestedFix::DisableMod { mod_id: m.id.clone() }],
            ),
        }

        for req in &m.info.require {
            match catalog.get(req) {
                None => {
                    let message = match near_match(catalog, req) {
                        Some(similar) => format!("{} requires {}, which is not installed (an installed mod is called {}: ids are case-sensitive)", describe(m), req, similar.id),
                        None => format!("{} requires {}, which is not installed", describe(m), req),
                    };
                    list.push(Severity::Error, "missing_dependency", Some(id), message,
                        vec![SuggestedFix::SubscribeWorkshop { hint: req.clone() }, SuggestedFix::DisableMod { mod_id: m.id.clone() }]);
                }
                Some(dep) => match position.get(req.as_str()) {
                    None => list.push(Severity::Error, "dependency_not_enabled", Some(id),
                        format!("{} requires {}, which is installed but not enabled", describe(m), describe(dep)),
                        vec![
                            SuggestedFix::EnableMod { mod_id: dep.id.clone() },
                            // ...and place it before the mod that needs it.
                            SuggestedFix::MoveBefore { mod_id: dep.id.clone(), before: m.id.clone() },
                        ]),
                    Some(&dep_pos) if dep_pos > idx => list.push(Severity::Warning, "dependency_after", Some(id),
                        format!("{} requires {}, but {} loads after it", describe(m), dep.id, dep.id),
                        vec![SuggestedFix::MoveBefore { mod_id: dep.id.clone(), before: m.id.clone() }]),
                    Some(_) => {
                        if let Some(reason) = why_unavailable(catalog, req, &mut HashSet::new(), &mut unavailable_memo) {
                            list.push(Severity::Error, "dependency_unavailable", Some(id),
                                format!("{} requires {}, which is unavailable: {}", describe(m), dep.id, reason), vec![]);
                            list.relate_last(&dep.id);
                        }
                    }
                },
            }
        }

        for after in &m.info.load_after {
            if let Some(&p) = position.get(after.as_str()) {
                if p > idx {
                    list.push(Severity::Warning, "load_after_order", Some(id),
                        format!("{} asks to load after {}, but {} comes later in the list", describe(m), after, after),
                        vec![SuggestedFix::MoveBefore { mod_id: after.clone(), before: m.id.clone() }]);
                }
            }
        }
        for before in &m.info.load_before {
            if let Some(&p) = position.get(before.as_str()) {
                if p < idx {
                    list.push(Severity::Warning, "load_before_order", Some(id),
                        format!("{} asks to load before {}, but {} comes earlier in the list", describe(m), before, before),
                        vec![SuggestedFix::MoveBefore { mod_id: m.id.clone(), before: before.clone() }]);
                }
            }
        }
        for other in &m.info.incompatible {
            if let Some(&p) = position.get(other.as_str()) {
                // Report each pair once, on the later mod.
                if p < idx || !catalog.get(other).is_some_and(|o| o.info.incompatible.contains(&m.id)) {
                    list.push(Severity::Error, "incompatible", Some(id),
                        format!("{} is marked incompatible with {}, and both are enabled", describe(m), other),
                        vec![SuggestedFix::DisableMod { mod_id: m.id.clone() }, SuggestedFix::DisableMod { mod_id: other.clone() }]);
                }
            }
        }

        for copy in catalog.mods.iter().filter(|c| c.id == m.id && c.shadowed_by.is_some()) {
            list.push(Severity::Info, "shadowed_copy", Some(id),
                format!("Another copy of {} at {} is ignored: the game uses the one at {}", m.id, copy.root_dir, m.root_dir), vec![]);
        }
    }

    let mut issues = list.0;
    issues.sort_by(|a, b| a.severity.cmp(&b.severity));
    let errors = issues.iter().filter(|i| i.severity == Severity::Error).count();
    let warnings = issues.iter().filter(|i| i.severity == Severity::Warning).count();
    HealthReport { game_version: catalog.game_version.clone(), active_count: active.len(), errors, warnings, issues }
}

// ---------------------------------------------------------------------------------------------
// Load-order sort
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortResult {
    /// The new order: every input entry exactly once.
    pub order: Vec<String>,
    /// Entries whose position changed.
    pub moved: Vec<String>,
    /// Entries caught in a require/loadModAfter/loadModBefore cycle (kept in their old order).
    pub cycle: Vec<String>,
}

/// Studio merge packages go last so they override the mods they merge.
fn is_studio_package(id: &str) -> bool {
    id.starts_with("Z_PZModStudio_") && id != "Z_PZModStudio_Bridge"
}

/// Sorts `order` (the full list, enabled and disabled) so every mod comes after what it
/// requires and its loadModAfter mods, and before its loadModBefore mods, using the
/// mod.info data the game reads. Everything else keeps the user's order: among mods that are
/// free to go next, the one that was earliest goes first, so an already valid list is unchanged.
pub fn sort_load_order(catalog: &ModCatalog, order: &[String]) -> SortResult {
    let ids: Vec<String> = order
        .iter()
        .map(|e| resolve_entry(catalog, e.trim()).map(|m| m.id.clone()).unwrap_or_else(|| e.trim().to_string()))
        .collect();
    let (regular, packages): (Vec<usize>, Vec<usize>) = (0..ids.len()).partition(|&i| !is_studio_package(&ids[i]));
    let index_of: HashMap<&str, usize> = regular.iter().rev().map(|&i| (ids[i].as_str(), i)).collect();

    let mut successors: Vec<Vec<usize>> = vec![Vec::new(); ids.len()];
    let mut in_degree = vec![0usize; ids.len()];
    let mut edges: HashSet<(usize, usize)> = HashSet::new();
    let mut add_edge = |before: usize, after: usize| {
        if before != after && edges.insert((before, after)) {
            successors[before].push(after);
            in_degree[after] += 1;
        }
    };
    for &i in &regular {
        if index_of.get(ids[i].as_str()) != Some(&i) {
            continue; // duplicate entry: only the first one carries constraints
        }
        let Some(m) = catalog.get(&ids[i]) else { continue };
        for dep in m.info.require.iter().chain(&m.info.load_after) {
            if let Some(&d) = index_of.get(dep.as_str()) {
                add_edge(d, i);
            }
        }
        for later in &m.info.load_before {
            if let Some(&l) = index_of.get(later.as_str()) {
                add_edge(i, l);
            }
        }
    }

    let mut ready: std::collections::BTreeSet<usize> = regular.iter().copied().filter(|&i| in_degree[i] == 0).collect();
    let mut placed = vec![false; ids.len()];
    let mut sorted: Vec<usize> = Vec::with_capacity(ids.len());
    while let Some(i) = ready.pop_first() {
        placed[i] = true;
        sorted.push(i);
        for &n in &successors[i] {
            in_degree[n] -= 1;
            if in_degree[n] == 0 {
                ready.insert(n);
            }
        }
    }
    let cycle: Vec<usize> = regular.iter().copied().filter(|&i| !placed[i]).collect();
    sorted.extend(&cycle);
    sorted.extend(&packages);

    let new_order: Vec<String> = sorted.iter().map(|&i| order[i].clone()).collect();
    let moved = sorted.iter().enumerate().filter(|(pos, &i)| *pos != i).map(|(_, &i)| order[i].clone()).collect();
    SortResult { order: new_order, moved, cycle: cycle.iter().map(|&i| order[i].clone()).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// A fake Zomboid folder + Workshop folder under the temp dir.
    fn fixture(tag: &str) -> Fixture {
        let root = std::env::temp_dir().join(format!("pzms-catalog-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Zomboid/mods")).unwrap();
        fs::create_dir_all(root.join("workshop")).unwrap();
        Fixture { root }
    }

    fn write_mod(dir: &Path, info: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("mod.info"), info).unwrap();
    }

    fn paths(f: &Fixture) -> (String, String) {
        (f.root.join("workshop").to_string_lossy().into(), f.root.join("Zomboid").to_string_lossy().into())
    }

    fn codes(report: &HealthReport) -> Vec<(String, String)> {
        report.issues.iter().map(|i| (i.code.clone(), i.mod_id.clone().unwrap_or_default())).collect()
    }

    #[test]
    fn catalog_follows_game_search_order_and_version_folders() {
        let f = fixture("order");
        let ws = f.root.join("workshop");
        write_mod(&ws.join("111/mods/Lib/42"), "id=Lib\nname=Library\n");
        write_mod(&ws.join("111/mods/Lib/42.30"), "id=Lib\nname=Too new\n");
        write_mod(&ws.join("222/mods/OldMod"), "id=OldMod\nname=B41 only\n");
        write_mod(&f.root.join("Zomboid/mods/Lib/42"), "id=Lib\nname=Local copy\n");
        let (w, z) = paths(&f);

        let cat = build_catalog(&w, &z, Some(42_021));
        assert_eq!(cat.game_version.as_deref(), Some("42.21"));
        let lib = cat.get("Lib").unwrap();
        assert_eq!(lib.name, "Library", "42.30 is newer than the build; Workshop copy wins over local");
        assert_eq!(lib.source, ModSource::Workshop { workshop_id: "111".into() });
        assert!(cat.mods.iter().any(|m| m.id == "Lib" && m.source == ModSource::Local && m.shadowed_by.is_some()));
        assert!(matches!(cat.get("OldMod").unwrap().loadability, Loadability::NoFolderForBuild { .. }));
        // Build 41 reads only the root.
        let b41 = build_catalog(&w, &z, Some(41_078));
        assert_eq!(b41.get("OldMod").unwrap().loadability, Loadability::Loadable);
    }

    #[test]
    fn health_report_finds_what_the_game_would_trip_on() {
        let f = fixture("health");
        let ws = f.root.join("workshop");
        write_mod(&ws.join("1/mods/Lib/42"), "id=Lib\n");
        write_mod(&ws.join("2/mods/UsesLib/42"), "id=UsesLib\nrequire=\\Lib\n");
        write_mod(&ws.join("3/mods/NeedsMissing/42"), "id=NeedsMissing\nrequire=\\Ghost,\\lib\n");
        write_mod(&ws.join("4/mods/Old/"), "id=Old\n");
        write_mod(&ws.join("5/mods/NeedsOld/42"), "id=NeedsOld\nrequire=Old\n");
        write_mod(&ws.join("6/mods/A/42"), "id=A\nincompatible=\\B\n");
        write_mod(&ws.join("7/mods/B/42"), "id=B\n");
        write_mod(&ws.join("8/mods/Ranged/42"), "id=Ranged\nversionMax=42.15\n");
        write_mod(&ws.join("9/mods/Broken/42"), "id=Broken\nversionMin=42\n");
        write_mod(&ws.join("10/mods/Late/42"), "id=Late\nloadModAfter=B\n");
        write_mod(&ws.join("11/mods/Slashy/42"), "id=11/slashy\n");
        let (w, z) = paths(&f);
        let cat = build_catalog(&w, &z, Some(42_021));

        let active: Vec<String> = ["UsesLib", "Lib", "NeedsMissing", "Old", "NeedsOld", "A", "Late", "B", "Ranged", "Broken", "Gone", "a", "A"]
            .iter().map(|s| s.to_string()).collect();
        let report = health_report(&cat, &active);
        let got = codes(&report);
        let has = |code: &str, id: &str| got.contains(&(code.to_string(), id.to_string()));

        assert!(has("dependency_after", "UsesLib"));
        assert!(has("missing_dependency", "NeedsMissing"), "Ghost and lowercase lib are not installed");
        assert!(has("not_for_build", "Old"));
        assert!(has("dependency_unavailable", "NeedsOld"));
        assert!(has("incompatible", "A"));
        assert!(has("load_after_order", "Late"));
        assert!(has("outside_version_range", "Ranged"));
        assert!(has("invalid_mod_info", "Broken"));
        assert!(has("missing_mod", "Gone"));
        assert!(has("missing_mod", "a"), "ids are case-sensitive");
        assert!(has("duplicate_entry", "A"));
        assert_eq!(report.issues.iter().filter(|i| i.code == "incompatible").count(), 1);
        let related = |code: &str, id: &str| {
            report.issues.iter().find(|i| i.code == code && i.mod_id.as_deref() == Some(id)).unwrap().related.clone()
        };
        assert_eq!(related("dependency_after", "UsesLib"), vec!["Lib"]);
        assert_eq!(related("dependency_unavailable", "NeedsOld"), vec!["Old"]);
        assert_eq!(related("incompatible", "A"), vec!["B"]);
        assert_eq!(related("load_after_order", "Late"), vec!["B"]);
        assert!(report.issues.windows(2).all(|w| w[0].severity <= w[1].severity), "errors first");

        // A clean list has no issues.
        let clean = health_report(&cat, &["Lib".to_string(), "UsesLib".to_string()]);
        assert!(clean.issues.is_empty(), "{:?}", clean.issues);
        // Workshop-qualified entries resolve to that item.
        let qualified = health_report(&cat, &["1/Lib".to_string()]);
        assert!(qualified.issues.is_empty(), "{:?}", qualified.issues);
        // ...and an id that itself contains a slash (real mod 2858201402) is matched exactly.
        let slashy = health_report(&cat, &["11/slashy".to_string()]);
        assert!(slashy.issues.is_empty(), "{:?}", slashy.issues);
    }

    #[test]
    fn sort_moves_only_what_the_rules_require() {
        let f = fixture("sort");
        let ws = f.root.join("workshop");
        write_mod(&ws.join("1/mods/Lib/42"), "id=Lib\n");
        write_mod(&ws.join("2/mods/UsesLib/42"), "id=UsesLib\nrequire=\\Lib\n");
        write_mod(&ws.join("3/mods/Late/42"), "id=Late\nloadModAfter=Zed\n");
        write_mod(&ws.join("4/mods/Early/42"), "id=Early\nloadModBefore=Alpha\n");
        write_mod(&ws.join("5/mods/Alpha/42"), "id=Alpha\n");
        write_mod(&ws.join("6/mods/Zed/42"), "id=Zed\n");
        write_mod(&ws.join("7/mods/CycA/42"), "id=CycA\nrequire=CycB\n");
        write_mod(&ws.join("8/mods/CycB/42"), "id=CycB\nrequire=CycA\n");
        let (w, z) = paths(&f);
        let cat = build_catalog(&w, &z, Some(42_021));
        let list = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        let r = sort_load_order(&cat, &list(&["Z_PZModStudio_Pack", "UsesLib", "Alpha", "Late", "Lib", "Early", "Zed", "NotInstalled"]));
        // Lib moves up to just before UsesLib, Early before Alpha, Zed before Late; the rest keeps its order.
        assert_eq!(r.order, list(&["Lib", "UsesLib", "Early", "Alpha", "Zed", "Late", "NotInstalled", "Z_PZModStudio_Pack"]));
        let pos = |id: &str| r.order.iter().position(|x| x == id).unwrap();
        assert!(pos("Lib") < pos("UsesLib"));
        assert!(pos("Zed") < pos("Late"));
        assert!(pos("Early") < pos("Alpha"));
        assert_eq!(r.order.last().unwrap(), "Z_PZModStudio_Pack", "Studio packages go last");
        assert!(r.cycle.is_empty());

        // An already valid order is left alone.
        let valid = list(&["Lib", "UsesLib", "Zed", "Late", "Early", "Alpha"]);
        let again = sort_load_order(&cat, &valid);
        assert_eq!(again.order, valid);
        assert!(again.moved.is_empty());

        // Cycles are kept (not dropped) and reported.
        let c = sort_load_order(&cat, &list(&["CycA", "Lib", "CycB"]));
        assert_eq!(c.order.len(), 3);
        assert_eq!(c.cycle, list(&["CycA", "CycB"]));
    }

    /// Read-only report over the real install. Run with:
    /// PZMS_WORKSHOP_DIR=... PZMS_ZOMBOID_DIR=... cargo test real_health -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_health_report() {
        let (Ok(w), Ok(z)) = (std::env::var("PZMS_WORKSHOP_DIR"), std::env::var("PZMS_ZOMBOID_DIR")) else { return };
        let cat = build_catalog(&w, &z, None);
        let active = crate::load_order::ini_parser::read_mod_list_ini(&format!("{}/mods/default.txt", z)).unwrap().active_mods;
        let report = health_report(&cat, &active);
        println!("build {:?}: {} mods in catalog, {} active, {} errors, {} warnings",
            cat.game_version, cat.mods.len(), report.active_count, report.errors, report.warnings);
        for i in &report.issues {
            println!("  [{:?}] {}: {}", i.severity, i.code, i.message);
        }
        let mut by_source: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        for m in cat.mods.iter().filter(|m| m.shadowed_by.is_none()) {
            let key = match &m.source { ModSource::Workshop { .. } => "workshop", ModSource::WorkshopUpload { .. } => "upload", ModSource::Local => "local" };
            by_source.entry(key.to_string()).or_default().push(m.id.clone());
        }
        for (k, v) in &by_source {
            println!("source {}: {} {:?}", k, v.len(), if v.len() <= 10 { v.clone() } else { vec![] });
        }
        let sorted = sort_load_order(&cat, &active);
        println!("sort: {} moved, {} in cycles: {:?}", sorted.moved.len(), sorted.cycle.len(), sorted.moved);
    }
}
