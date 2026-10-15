//! Nexus Mods browsing for Project Zomboid through the public GraphQL v2 API (no API key).
//!
//! Only reads public listings the user asks for; downloads stay on the Nexus website (the user
//! downloads there and installs the file with `mod_install`). A public release that also downloads
//! through the API must first be registered with Nexus (see docs/ROADMAP.md, Phase 2).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

const GRAPHQL_URL: &str = "https://api.nexusmods.com/v2/graphql";
const GAME_DOMAIN: &str = "projectzomboid";
/// Nexus asks every client to identify itself; Cloudflare also rejects anonymous user agents.
const APP_NAME: &str = "PZ Mod Studio";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusMod {
    pub mod_id: u64,
    pub name: String,
    pub summary: Option<String>,
    pub author: Option<String>,
    pub uploader: Option<String>,
    pub version: Option<String>,
    pub updated_at: Option<String>,
    pub created_at: Option<String>,
    pub downloads: u64,
    pub endorsements: u64,
    pub picture_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub adult_content: bool,
    /// The mod page; files are on `<page_url>?tab=files`.
    pub page_url: String,
    /// "41" / "42" when the name or summary says which build it is for (Nexus has no build tag).
    pub build_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NexusSearchResult {
    pub total: u64,
    pub offset: u64,
    pub mods: Vec<NexusMod>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NexusSort {
    Updated,
    Downloads,
    Endorsements,
    Newest,
}

impl NexusSort {
    fn field(self) -> &'static str {
        match self {
            NexusSort::Updated => "updatedAt",
            NexusSort::Downloads => "downloads",
            NexusSort::Endorsements => "endorsements",
            NexusSort::Newest => "createdAt",
        }
    }
}

pub fn mod_page_url(mod_id: u64) -> String {
    format!("https://www.nexusmods.com/{}/mods/{}", GAME_DOMAIN, mod_id)
}

/// "B42", "Build 42", "build42", "(42.13)" -> "42"; same for 41.
pub fn build_hint(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let mut found: Vec<&str> = Vec::new();
    for build in ["41", "42"] {
        let patterns = [format!("b{}", build), format!("build {}", build), format!("build{}", build), format!("{}.", build)];
        let hit = patterns.iter().any(|p| {
            lower.match_indices(p.as_str()).any(|(i, m)| {
                let before_ok = i == 0 || !lower[..i].chars().last().is_some_and(|c| c.is_ascii_alphanumeric());
                let after = lower[i + m.len()..].chars().next();
                // "42." must be followed by a digit (a version), the others by a non-digit.
                let after_ok = if m.ends_with('.') { after.is_some_and(|c| c.is_ascii_digit()) } else { !after.is_some_and(|c| c.is_ascii_digit()) };
                before_ok && after_ok
            })
        });
        if hit {
            found.push(build);
        }
    }
    match found.as_slice() {
        [one] => Some(one.to_string()),
        [_, _] => Some("41+42".to_string()),
        _ => None,
    }
}

fn agent() -> ureq::Agent {
    let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(Duration::from_secs(20)))
        .user_agent(format!("PZModStudio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

fn parse_mod(node: &Value) -> Option<NexusMod> {
    let mod_id = node.get("modId")?.as_u64()?;
    let name = str_field(node, "name")?;
    let summary = str_field(node, "summary");
    let hint_source = format!("{} {}", name, summary.as_deref().unwrap_or(""));
    Some(NexusMod {
        mod_id,
        build_hint: build_hint(&hint_source),
        page_url: mod_page_url(mod_id),
        summary,
        author: str_field(node, "author"),
        uploader: node.get("uploader").and_then(|u| str_field(u, "name")),
        version: str_field(node, "version"),
        updated_at: str_field(node, "updatedAt"),
        created_at: str_field(node, "createdAt"),
        downloads: node.get("downloads").and_then(|x| x.as_u64()).unwrap_or(0),
        endorsements: node.get("endorsements").and_then(|x| x.as_u64()).unwrap_or(0),
        picture_url: str_field(node, "pictureUrl"),
        thumbnail_url: str_field(node, "thumbnailUrl"),
        adult_content: node.get("adultContent").and_then(|x| x.as_bool()).unwrap_or(false),
        name,
    })
}

/// One page of Project Zomboid mods on Nexus, optionally filtered by name (case-insensitive words).
pub fn search_mods(query: Option<&str>, sort: NexusSort, offset: u64, count: u64) -> Result<NexusSearchResult, String> {
    let count = count.clamp(1, 50);
    let mut filter = json!({ "gameDomainName": [{ "value": GAME_DOMAIN }] });
    if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
        // The name filter matches words; wildcards ("*") make it match nothing.
        filter["name"] = json!([{ "value": q.replace('*', " ").trim(), "op": "WILDCARD" }]);
    }
    let body = json!({
        "query": "query($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) { mods(filter: $filter, sort: $sort, offset: $offset, count: $count) { totalCount nodes { modId name summary author uploader { name } version updatedAt createdAt downloads endorsements pictureUrl thumbnailUrl adultContent } } }",
        "variables": {
            "filter": filter,
            "sort": [{ sort.field(): { "direction": "DESC" } }],
            "offset": offset,
            "count": count,
        }
    });

    let response: Value = agent()
        .post(GRAPHQL_URL)
        .header("Application-Name", APP_NAME)
        .header("Application-Version", env!("CARGO_PKG_VERSION"))
        .send_json(&body)
        .map_err(|e| format!("Nexus Mods could not be reached: {}", e))?
        .into_body()
        .read_json()
        .map_err(|e| format!("Unexpected answer from Nexus Mods: {}", e))?;

    if let Some(errors) = response.get("errors") {
        return Err(format!("Nexus Mods rejected the search: {}", errors));
    }
    let mods = response.pointer("/data/mods").ok_or("Unexpected answer from Nexus Mods (no data)")?;
    Ok(NexusSearchResult {
        total: mods.get("totalCount").and_then(|t| t.as_u64()).unwrap_or(0),
        offset,
        mods: mods
            .get("nodes")
            .and_then(|n| n.as_array())
            .map(|nodes| nodes.iter().filter_map(parse_mod).collect())
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_hints_from_names() {
        assert_eq!(build_hint("B42 PROJECT RV Interior").as_deref(), Some("42"));
        assert_eq!(build_hint("RV Interior for Build 42.20 Stable").as_deref(), Some("42"));
        assert_eq!(build_hint("MorePlayers (B41.65)").as_deref(), Some("41"));
        assert_eq!(build_hint("Works on build41 and build 42").as_deref(), Some("41+42"));
        assert_eq!(build_hint("Ultimate Horror Sounds"), None);
        assert_eq!(build_hint("Pack of 420 items"), None, "420 is not a build");
        assert_eq!(build_hint("version 1.42"), None);
    }

    #[test]
    fn parses_api_nodes() {
        let node = json!({
            "modId": 248, "name": "B42 PROJECT RV Interior", "summary": "RV Interior",
            "author": "Mickey Knox", "uploader": { "name": "M1ckeyKnox" }, "version": "2.4",
            "updatedAt": "2026-08-03T00:11:02Z", "downloads": 6611, "endorsements": 51,
            "thumbnailUrl": "https://example/t.png", "adultContent": false
        });
        let m = parse_mod(&node).unwrap();
        assert_eq!(m.page_url, "https://www.nexusmods.com/projectzomboid/mods/248");
        assert_eq!(m.uploader.as_deref(), Some("M1ckeyKnox"));
        assert_eq!(m.build_hint.as_deref(), Some("42"));
    }

    /// Live call to Nexus (network). cargo test nexus_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn nexus_live_search() {
        let r = search_mods(Some("horror"), NexusSort::Downloads, 0, 5).unwrap();
        println!("{} results: {:?}", r.total, r.mods.iter().map(|m| &m.name).collect::<Vec<_>>());
        let all = search_mods(None, NexusSort::Updated, 0, 3).unwrap();
        assert!(all.total > 100);
    }
}
