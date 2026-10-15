//! Steam Workshop details for Project Zomboid items through Steam's public Web API (no key):
//! `ISteamRemoteStorage/GetPublishedFileDetails` and `GetCollectionDetails`.
//! Searching the Workshop (`IPublishedFileService/QueryFiles`) needs a Steam Web API key and is
//! not done here; subscribing happens in the Steam client (`steam://` links).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const DETAILS_URL: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTION_URL: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";
const PZ_APP_ID: u64 = 108600;
const BATCH: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopItem {
    pub workshop_id: String,
    /// False when Steam has no public item with this id (deleted, private, wrong id).
    pub found: bool,
    pub title: String,
    pub summary: String,
    pub preview_url: Option<String>,
    /// Unix seconds.
    pub time_updated: Option<u64>,
    pub subscriptions: u64,
    pub favorited: u64,
    pub file_size: u64,
    pub tags: Vec<String>,
    /// "41", "42"... from the "Build NN" tags.
    pub builds: Vec<String>,
    /// False for items of another game.
    pub is_project_zomboid: bool,
    pub banned: bool,
    pub page_url: String,
    /// Opens the item in the Steam client, where the user can subscribe.
    pub steam_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopLookup {
    /// Set when the input was a collection.
    pub collection: Option<WorkshopItem>,
    pub items: Vec<WorkshopItem>,
}

pub fn page_url(id: &str) -> String {
    format!("https://steamcommunity.com/sharedfiles/filedetails/?id={}", id)
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

/// Workshop ids in free text: links (`...filedetails/?id=123`, `steam://url/CommunityFilePage/123`)
/// or bare numbers, in order, without duplicates.
pub fn parse_ids(input: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for token in input.split(|c: char| c.is_whitespace() || c == ',' || c == ';') {
        let token = token.trim();
        let candidate = if let Some(pos) = token.find("id=") {
            token[pos + 3..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>()
        } else if let Some(pos) = token.find("CommunityFilePage/") {
            token[pos + 18..].chars().take_while(|c| c.is_ascii_digit()).collect()
        } else if token.chars().all(|c| c.is_ascii_digit()) {
            token.to_string()
        } else {
            String::new()
        };
        if candidate.len() >= 4 && !ids.contains(&candidate) {
            ids.push(candidate);
        }
    }
    ids
}

/// Plain-text start of a BBCode description.
fn summarize(description: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in description.chars() {
        match c {
            '[' => in_tag = true,
            ']' if in_tag => in_tag = false,
            _ if !in_tag => out.push(if c == '\r' || c == '\n' { ' ' } else { c }),
            _ => {}
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 280 {
        format!("{}...", collapsed.chars().take(280).collect::<String>())
    } else {
        collapsed
    }
}

fn parse_item(v: &Value) -> Option<WorkshopItem> {
    let id = v.get("publishedfileid")?.as_str()?.to_string();
    let num = |key: &str| v.get(key).and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.parse().ok())));
    let found = v.get("result").and_then(|r| r.as_u64()) == Some(1);
    let tags: Vec<String> = v
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|a| a.iter().filter_map(|t| t.get("tag").and_then(|x| x.as_str()).map(str::to_string)).collect())
        .unwrap_or_default();
    let builds = tags
        .iter()
        .filter_map(|t| t.strip_prefix("Build ").map(|b| b.trim().to_string()))
        .filter(|b| !b.is_empty() && b.chars().all(|c| c.is_ascii_digit()))
        .collect();
    Some(WorkshopItem {
        found,
        title: v.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        summary: v.get("description").and_then(|x| x.as_str()).map(summarize).unwrap_or_default(),
        preview_url: v.get("preview_url").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string),
        time_updated: num("time_updated"),
        subscriptions: num("subscriptions").unwrap_or(0),
        favorited: num("favorited").unwrap_or(0),
        file_size: num("file_size").unwrap_or(0),
        is_project_zomboid: num("consumer_app_id") == Some(PZ_APP_ID),
        banned: num("banned").unwrap_or(0) != 0,
        page_url: page_url(&id),
        steam_url: format!("steam://url/CommunityFilePage/{}", id),
        tags,
        builds,
        workshop_id: id,
    })
}

fn form(prefix: &str, count_key: &str, ids: &[String]) -> Vec<(String, String)> {
    let mut pairs = vec![(count_key.to_string(), ids.len().to_string())];
    for (i, id) in ids.iter().enumerate() {
        pairs.push((format!("{}[{}]", prefix, i), id.clone()));
    }
    pairs
}

fn post_form(url: &str, pairs: Vec<(String, String)>) -> Result<Value, String> {
    agent()
        .post(url)
        .send_form(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .map_err(|e| format!("Steam could not be reached: {}", e))?
        .into_body()
        .read_json()
        .map_err(|e| format!("Unexpected answer from Steam: {}", e))
}

/// Details for Workshop ids, in the same order (100 per request).
pub fn get_details(ids: &[String]) -> Result<Vec<WorkshopItem>, String> {
    let mut items = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(BATCH) {
        let v = post_form(DETAILS_URL, form("publishedfileids", "itemcount", chunk))?;
        let list = v.pointer("/response/publishedfiledetails").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        items.extend(list.iter().filter_map(parse_item));
    }
    Ok(items)
}

/// Child item ids when `id` is a collection, None when it is not one.
fn collection_children(id: &str) -> Result<Option<Vec<String>>, String> {
    let v = post_form(COLLECTION_URL, form("publishedfileids", "collectioncount", &[id.to_string()]))?;
    let details = v.pointer("/response/collectiondetails/0");
    if details.and_then(|d| d.get("result")).and_then(|r| r.as_u64()) != Some(1) {
        return Ok(None);
    }
    let children = details
        .and_then(|d| d.get("children"))
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(|c| c.get("publishedfileid").and_then(|x| x.as_str()).map(str::to_string)).collect())
        .unwrap_or_default();
    Ok(Some(children))
}

/// Looks up whatever the user pasted: item links/ids, or one collection link (expanded).
pub fn lookup(input: &str) -> Result<WorkshopLookup, String> {
    let ids = parse_ids(input);
    if ids.is_empty() {
        return Err("No Workshop link or id found. Paste a link like https://steamcommunity.com/sharedfiles/filedetails/?id=2699828474".to_string());
    }
    if ids.len() == 1 {
        if let Some(children) = collection_children(&ids[0])? {
            let collection = get_details(&ids).ok().and_then(|mut v| v.pop());
            return Ok(WorkshopLookup { collection, items: get_details(&children)? });
        }
    }
    Ok(WorkshopLookup { collection: None, items: get_details(&ids)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_ids_in_pasted_text() {
        let text = "https://steamcommunity.com/sharedfiles/filedetails/?id=2699828474&searchtext=x \
                    steam://url/CommunityFilePage/3437629766, 2699828474 ; nope 12";
        assert_eq!(parse_ids(text), vec!["2699828474", "3437629766"]);
    }

    #[test]
    fn parses_details_and_build_tags() {
        let v = json!({
            "publishedfileid": "3437629766", "result": 1, "consumer_app_id": 108600, "title": "CleanUI [B42]",
            "description": "[h2]Project Zomboid Build 42.12.3[/h2]\r\nClean UI", "time_updated": 1791810633,
            "subscriptions": 859173, "favorited": 24247, "file_size": "13119426",
            "tags": [{ "tag": "Build 42" }, { "tag": "Interface" }]
        });
        let item = parse_item(&v).unwrap();
        assert!(item.found && item.is_project_zomboid);
        assert_eq!(item.builds, vec!["42"]);
        assert_eq!(item.file_size, 13_119_426);
        assert_eq!(item.summary, "Project Zomboid Build 42.12.3 Clean UI");
        assert_eq!(item.steam_url, "steam://url/CommunityFilePage/3437629766");
        assert!(!parse_item(&json!({ "publishedfileid": "1", "result": 9 })).unwrap().found);
    }

    /// Live Steam call. cargo test workshop_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn workshop_live_lookup() {
        let r = lookup("https://steamcommunity.com/sharedfiles/filedetails/?id=2699828474").unwrap();
        assert!(r.collection.is_none());
        println!("{:?}", r.items.iter().map(|i| (&i.title, &i.builds)).collect::<Vec<_>>());
        assert_eq!(r.items[0].title, "Rebalanced Prop Moving");
    }
}
