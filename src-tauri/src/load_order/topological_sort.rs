use super::mod_info::{sanitize_mod_id, ModManifest};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyAnalysisResult {
    pub sorted_mod_ids: Vec<String>,
    pub missing_dependencies: Vec<String>,
    pub has_circular_dependency: bool,
}

fn find_manifest_id_by_req<'a>(req: &str, manifests: &'a [ModManifest]) -> Option<&'a str> {
    let clean_req = req.trim().to_lowercase();
    let sanitized_req = sanitize_mod_id(&clean_req);

    let is_match = |m: &ModManifest| -> bool {
        let clean_m = m.id.trim().to_lowercase();
        let sanitized_m = sanitize_mod_id(&clean_m);
        clean_m == clean_req || sanitized_m == sanitized_req || (sanitized_req.len() > 3 && sanitized_m.contains(&sanitized_req))
    };

    let candidates: Vec<&'a ModManifest> = manifests.iter().filter(|m| is_match(m)).collect();
    if candidates.is_empty() {
        return None;
    }
    if candidates.len() == 1 {
        return Some(&candidates[0].id);
    }

    // 1. Prioritize enabled candidate
    if let Some(enabled_cand) = candidates.iter().find(|c| c.enabled) {
        return Some(&enabled_cand.id);
    }

    // 2. Prefer candidate with "main" or "2.0" in ID/name
    if let Some(main_cand) = candidates.iter().find(|c| {
        let id_lower = c.id.to_lowercase();
        let name_lower = c.name.to_lowercase();
        id_lower.contains("main") || id_lower.contains("2.0") || name_lower.contains("main") || name_lower.contains("2.0")
    }) {
        return Some(&main_cand.id);
    }

    // 3. Fallback to first candidate
    Some(&candidates[0].id)
}

/// Performs topological sort on mod manifests based on require= directives.
pub fn sort_dependencies_topologically(manifests: &[ModManifest]) -> DependencyAnalysisResult {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    let mut missing_deps = Vec::new();

    for m in manifests {
        in_degree.entry(m.id.clone()).or_insert(0);
        graph.entry(m.id.clone()).or_default();
    }

    for m in manifests {
        for req in &m.require {
            if let Some(target_id) = find_manifest_id_by_req(req, manifests) {
                if target_id != m.id {
                    // target_id (library/framework) must come BEFORE m.id
                    graph.entry(target_id.to_string()).or_default().push(m.id.clone());
                    *in_degree.entry(m.id.clone()).or_insert(0) += 1;
                }
            } else {
                if !missing_deps.contains(req) {
                    missing_deps.push(req.clone());
                }
            }
        }
    }

    // Kahn's algorithm for topological sorting
    let mut queue = VecDeque::new();
    for (id, &deg) in &in_degree {
        if deg == 0 {
            queue.push_back(id.clone());
        }
    }

    let mut sorted = Vec::new();
    while let Some(node) = queue.pop_front() {
        sorted.push(node.clone());
        if let Some(neighbors) = graph.get(&node) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
    }

    let has_circular = sorted.len() < manifests.len();

    DependencyAnalysisResult {
        sorted_mod_ids: sorted,
        missing_dependencies: missing_deps,
        has_circular_dependency: has_circular,
    }
}
