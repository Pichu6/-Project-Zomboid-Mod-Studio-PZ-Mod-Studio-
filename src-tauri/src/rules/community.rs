//! The community's rules: `community/rules.json` in the Studio's own repository, fetched once a
//! day and kept beside the player's own rules. A rule here is honoured like one of the
//! player's, and named as the community's with its source, so it can be checked and argued.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::load_order::mod_info::get_existing_user_zomboid_dirs;

/// Where the rules live: this repository, main branch. A pull request is how a rule gets in.
pub const RULES_URL: &str =
    "https://raw.githubusercontent.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/main/community/rules.json";
const CACHE_FILE: &str = "PZModStudio_CommunityRules.json";
/// How long a fetched copy is trusted before another look.
const FRESH_FOR_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommunityRule {
    pub mod_id: String,
    pub after: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommunityPair {
    pub a: String,
    pub b: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommunityRules {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub load_after: Vec<CommunityRule>,
    #[serde(default)]
    pub incompatible: Vec<CommunityPair>,
    /// When this copy was fetched (unix seconds); set by the Studio, not by the file.
    #[serde(default)]
    pub fetched_at: Option<i64>,
}

/// What the Health screen says about the copy in use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommunitySummary {
    pub rules: usize,
    pub pairs: usize,
    pub updated: Option<String>,
    pub fetched_at: Option<i64>,
}

impl CommunityRules {
    pub fn summary(&self) -> CommunitySummary {
        CommunitySummary { rules: self.load_after.len(), pairs: self.incompatible.len(), updated: self.updated.clone(), fetched_at: self.fetched_at }
    }

    /// The load-after rules in the player's own shape, for the sort.
    pub fn as_user_rules(&self) -> Vec<super::UserRule> {
        self.load_after
            .iter()
            .map(|r| super::UserRule { mod_id: r.mod_id.clone(), after: r.after.clone(), note: r.note.clone() })
            .collect()
    }
}

fn cache_path(user_zomboid_dir: &str) -> Option<PathBuf> {
    get_existing_user_zomboid_dirs(user_zomboid_dir).into_iter().next().map(|d| d.join(CACHE_FILE))
}

/// Reads the rules text, refusing anything that is not the shape expected.
pub fn parse(text: &str) -> Result<CommunityRules, String> {
    let rules: CommunityRules = serde_json::from_str(text).map_err(|e| format!("The community rules file is not readable: {}", e))?;
    for r in &rules.load_after {
        if r.mod_id.trim().is_empty() || r.after.trim().is_empty() || r.mod_id == r.after {
            return Err(format!("A community rule is malformed: {:?}", r));
        }
    }
    for p in &rules.incompatible {
        if p.a.trim().is_empty() || p.b.trim().is_empty() || p.a == p.b {
            return Err(format!("A community pair is malformed: {:?}", p));
        }
    }
    Ok(rules)
}

/// The last copy fetched, if any.
pub fn load_cached(user_zomboid_dir: &str) -> Option<CommunityRules> {
    let text = fs::read_to_string(cache_path(user_zomboid_dir)?).ok()?;
    parse(&text).ok()
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Fetches the rules now and keeps them. Says why when it cannot.
pub fn refresh(user_zomboid_dir: &str) -> Result<CommunityRules, String> {
    let path = cache_path(user_zomboid_dir).ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .user_agent(format!("PZModStudio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let text = agent
        .get(RULES_URL)
        .call()
        .map_err(|e| format!("The community rules could not be fetched: {}", e))?
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("The community rules could not be read: {}", e))?;
    let mut rules = parse(&text)?;
    rules.fetched_at = Some(now());
    let json = serde_json::to_string_pretty(&rules).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(rules)
}

/// The copy to use: the cached one while it is less than a day old, else a fresh fetch, else
/// the cached one however old, else none. Never fails: no network means no community rules.
pub fn current(user_zomboid_dir: &str) -> Option<CommunityRules> {
    let cached = load_cached(user_zomboid_dir);
    let fresh = cached.as_ref().and_then(|c| c.fetched_at).map(|t| now() - t < FRESH_FOR_SECS).unwrap_or(false);
    if fresh {
        return cached;
    }
    match refresh(user_zomboid_dir) {
        Ok(rules) => Some(rules),
        Err(_) => cached,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_file_in_this_repository_parses() {
        let text = include_str!("../../../community/rules.json");
        let rules = parse(text).expect("the seed parses");
        assert_eq!(rules.version, 1);
    }

    #[test]
    fn a_malformed_rule_is_refused_and_the_shape_round_trips() {
        assert!(parse(r#"{"load_after":[{"mod_id":"A","after":"A"}]}"#).is_err());
        assert!(parse(r#"{"incompatible":[{"a":"","b":"B"}]}"#).is_err());
        let rules = parse(r#"{"version":1,"updated":"2026-10-18","load_after":[{"mod_id":"Overhaul","after":"Library","note":"recipes","source":"tested on 42.21"}],"incompatible":[{"a":"X","b":"Y"}]}"#).unwrap();
        assert_eq!(rules.as_user_rules()[0].after, "Library");
        assert_eq!(rules.summary().pairs, 1);
    }
}
