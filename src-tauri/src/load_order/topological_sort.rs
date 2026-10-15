use super::mod_info::{sanitize_mod_id, ModManifest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyAnalysisResult {
    /// Every input mod exactly once. Dependencies come before the mods that need them; apart
    /// from that the input order is kept. Mods stuck in a cycle are appended at the end.
    pub sorted_mod_ids: Vec<String>,
    pub missing_dependencies: Vec<String>,
    pub has_circular_dependency: bool,
    /// Mods that are part of (or depend on) a dependency cycle, in input order.
    #[serde(default)]
    pub circular_mod_ids: Vec<String>,
    /// IDs that appeared more than once in the input; only the first occurrence is sorted.
    #[serde(default)]
    pub duplicate_mod_ids: Vec<String>,
    /// Pairs of enabled mods where one declares `incompatible=` with the other.
    #[serde(default)]
    pub incompatible_pairs: Vec<(String, String)>,
}

fn find_manifest_id_by_req<'a>(req: &str, manifests: &'a [ModManifest]) -> Option<&'a str> {
    let clean_req = req.trim().to_lowercase();
    let sanitized_req = sanitize_mod_id(&clean_req);

    // 1. Pass 1: Exact match on ID or sanitized ID FIRST!
    if let Some(exact) = manifests.iter().find(|m| {
        let clean_m = m.id.trim().to_lowercase();
        let sanitized_m = sanitize_mod_id(&clean_m);
        clean_m == clean_req || sanitized_m == sanitized_req
    }) {
        return Some(&exact.id);
    }

    // 2. Pass 2: Filter candidates by prefix matching
    let candidates: Vec<&'a ModManifest> = manifests.iter().filter(|m| {
        let clean_m = m.id.trim().to_lowercase();
        let sanitized_m = sanitize_mod_id(&clean_m);
        sanitized_m.starts_with(&format!("{}_", sanitized_req)) || sanitized_m.starts_with(&format!("{}-", sanitized_req))
    }).collect();

    if candidates.is_empty() {
        return None;
    }

    // Prioritize enabled candidate
    if let Some(enabled_cand) = candidates.iter().find(|c| c.enabled) {
        return Some(&enabled_cand.id);
    }

    Some(&candidates[0].id)
}

/// Performs a stable topological sort on mod manifests based on `require=` and `loadModAfter=`.
///
/// Deterministic: among mods whose dependencies are already placed, the one that comes first in
/// the input is placed next, so the same input always gives the same order and an already valid
/// order is returned unchanged.
pub fn sort_dependencies_topologically(manifests: &[ModManifest]) -> DependencyAnalysisResult {
    // Unique nodes in input order.
    let mut index_of: HashMap<&str, usize> = HashMap::new();
    let mut nodes: Vec<&ModManifest> = Vec::new();
    let mut duplicate_mod_ids = Vec::new();
    for m in manifests {
        if index_of.contains_key(m.id.as_str()) {
            if !duplicate_mod_ids.contains(&m.id) {
                duplicate_mod_ids.push(m.id.clone());
            }
            continue;
        }
        index_of.insert(m.id.as_str(), nodes.len());
        nodes.push(m);
    }

    let n = nodes.len();
    let mut successors: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut in_degree = vec![0usize; n];
    let mut edges: HashSet<(usize, usize)> = HashSet::new();
    let mut missing_dependencies: Vec<String> = Vec::new();

    let mut add_edge = |before: usize, after: usize, successors: &mut Vec<Vec<usize>>, in_degree: &mut Vec<usize>| {
        if before != after && edges.insert((before, after)) {
            successors[before].push(after);
            in_degree[after] += 1;
        }
    };

    for (i, m) in nodes.iter().enumerate() {
        for req in &m.require {
            match find_manifest_id_by_req(req, manifests).and_then(|id| index_of.get(id)) {
                // target (library/framework) must come BEFORE m
                Some(&target) => add_edge(target, i, &mut successors, &mut in_degree),
                None => {
                    if !missing_dependencies.contains(req) {
                        missing_dependencies.push(req.clone());
                    }
                }
            }
        }

        // Optional load_mod_after ordering hints (do NOT trigger missing_deps if target is absent!)
        for after in &m.load_mod_after {
            if let Some(&target) = find_manifest_id_by_req(after, manifests).and_then(|id| index_of.get(id)) {
                add_edge(target, i, &mut successors, &mut in_degree);
            }
        }
    }

    // Kahn's algorithm, always taking the ready node with the lowest input index.
    let mut ready: BTreeSet<usize> = (0..n).filter(|&i| in_degree[i] == 0).collect();
    let mut placed = vec![false; n];
    let mut sorted_mod_ids = Vec::with_capacity(n);
    while let Some(i) = ready.pop_first() {
        placed[i] = true;
        sorted_mod_ids.push(nodes[i].id.clone());
        for &next in &successors[i] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                ready.insert(next);
            }
        }
    }

    // Whatever is left is in a cycle (or waits on one): keep it, in input order, at the end.
    let circular_mod_ids: Vec<String> = (0..n).filter(|&i| !placed[i]).map(|i| nodes[i].id.clone()).collect();
    sorted_mod_ids.extend(circular_mod_ids.iter().cloned());

    let mut incompatible_pairs = Vec::new();
    for m in nodes.iter().filter(|m| m.enabled) {
        for other in &m.incompatible {
            if let Some(other_id) = find_manifest_id_by_req(other, manifests) {
                let other_enabled = index_of.get(other_id).is_some_and(|&j| nodes[j].enabled);
                let pair = (m.id.clone(), other_id.to_string());
                let reversed = (pair.1.clone(), pair.0.clone());
                if other_enabled && pair.0 != pair.1 && !incompatible_pairs.contains(&pair) && !incompatible_pairs.contains(&reversed) {
                    incompatible_pairs.push(pair);
                }
            }
        }
    }

    DependencyAnalysisResult {
        sorted_mod_ids,
        missing_dependencies,
        has_circular_dependency: !circular_mod_ids.is_empty(),
        circular_mod_ids,
        duplicate_mod_ids,
        incompatible_pairs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str, require: &[&str], after: &[&str]) -> ModManifest {
        ModManifest {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            workshop_id: None,
            author: None,
            version: None,
            pzversion: None,
            url: None,
            require: require.iter().map(|s| s.to_string()).collect(),
            load_mod_after: after.iter().map(|s| s.to_string()).collect(),
            incompatible: Vec::new(),
            icon_path: None,
            poster_url: None,
            is_library: require.is_empty(),
            is_map_mod: false,
            enabled: true,
            is_packaged: None,
            loadable_on_installed_build: None,
        }
    }

    #[test]
    fn dependencies_come_first_and_order_is_otherwise_kept() {
        let mods = vec![
            manifest("Zeta", &[], &[]),
            manifest("UsesLib", &["Lib"], &[]),
            manifest("Alpha", &[], &[]),
            manifest("Lib", &[], &[]),
        ];
        let result = sort_dependencies_topologically(&mods);
        assert_eq!(result.sorted_mod_ids, vec!["Zeta", "Alpha", "Lib", "UsesLib"]);
        assert!(!result.has_circular_dependency);
    }

    #[test]
    fn sorting_is_deterministic_and_idempotent() {
        let mods: Vec<ModManifest> = (0..50)
            .map(|i| {
                let id = format!("Mod{:02}", i);
                if i % 7 == 0 && i > 0 {
                    manifest(&id, &["Mod01"], &[])
                } else {
                    manifest(&id, &[], &[])
                }
            })
            .collect();
        let first = sort_dependencies_topologically(&mods).sorted_mod_ids;
        for _ in 0..20 {
            assert_eq!(sort_dependencies_topologically(&mods).sorted_mod_ids, first);
        }
        let reordered: Vec<ModManifest> = first
            .iter()
            .map(|id| mods.iter().find(|m| &m.id == id).unwrap().clone())
            .collect();
        assert_eq!(sort_dependencies_topologically(&reordered).sorted_mod_ids, first);
    }

    #[test]
    fn cycle_members_are_kept_and_reported() {
        let mods = vec![
            manifest("Free", &[], &[]),
            manifest("A", &["B"], &[]),
            manifest("B", &["A"], &[]),
            manifest("NeedsA", &["A"], &[]),
        ];
        let result = sort_dependencies_topologically(&mods);
        assert_eq!(result.sorted_mod_ids.len(), 4);
        assert_eq!(result.sorted_mod_ids[0], "Free");
        assert!(result.has_circular_dependency);
        assert_eq!(result.circular_mod_ids, vec!["A", "B", "NeedsA"]);
    }

    #[test]
    fn duplicates_do_not_fake_a_cycle() {
        let mods = vec![manifest("Same", &[], &[]), manifest("Same", &[], &[]), manifest("Other", &[], &[])];
        let result = sort_dependencies_topologically(&mods);
        assert_eq!(result.sorted_mod_ids, vec!["Same", "Other"]);
        assert!(!result.has_circular_dependency);
        assert_eq!(result.duplicate_mod_ids, vec!["Same"]);
    }

    #[test]
    fn missing_dependencies_and_incompatibilities_are_reported() {
        let mut a = manifest("A", &["\\Missing"], &["NotInstalled"]);
        a.incompatible = vec!["\\B".to_string()];
        let mods = vec![a, manifest("B", &[], &[])];
        let result = sort_dependencies_topologically(&mods);
        assert_eq!(result.missing_dependencies, vec!["\\Missing"]);
        assert_eq!(result.incompatible_pairs, vec![("A".to_string(), "B".to_string())]);
    }
}
