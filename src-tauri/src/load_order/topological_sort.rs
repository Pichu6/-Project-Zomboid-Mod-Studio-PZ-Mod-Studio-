use super::mod_info::ModManifest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyAnalysisResult {
    pub sorted_mod_ids: Vec<String>,
    pub missing_dependencies: Vec<String>,
    pub has_circular_dependency: bool,
}

/// Performs topological sort on mod manifests based on require= directives.
pub fn sort_dependencies_topologically(manifests: &[ModManifest]) -> DependencyAnalysisResult {
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    let mut known_mods: HashSet<String> = HashSet::new();
    let mut missing_deps = Vec::new();

    for m in manifests {
        known_mods.insert(m.id.clone());
        in_degree.entry(m.id.clone()).or_insert(0);
        graph.entry(m.id.clone()).or_default();
    }

    for m in manifests {
        for req in &m.require {
            if !known_mods.contains(req) {
                if !missing_deps.contains(req) {
                    missing_deps.push(req.clone());
                }
            } else {
                // req must come BEFORE m.id -> graph edge req -> m.id
                graph.entry(req.clone()).or_default().push(m.id.clone());
                *in_degree.entry(m.id.clone()).or_insert(0) += 1;
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
