//! Steam Workshop details for Project Zomboid items through Steam's public Web API (no key):
//! `ISteamRemoteStorage/GetPublishedFileDetails` and `GetCollectionDetails`.
//! Searching the Workshop (`IPublishedFileService/QueryFiles`) needs a Steam Web API key and is
//! not done here; subscribing happens in the Steam client (`steam://` links).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const DETAILS_URL: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTION_URL: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";
const QUERY_URL: &str = "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/";
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

/// What Steam has installed for one subscribed item (from appworkshop_108600.acf, offline).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstalledItemState {
    /// Publish time (unix seconds) of the version on disk.
    pub installed_time: Option<u64>,
    /// Publish time of the newest version Steam knows about.
    pub latest_time: Option<u64>,
    pub size: Option<u64>,
    /// Steam knows a newer version that is not downloaded yet (the usual cause of
    /// "Workshop item version is different than the server's").
    pub update_pending: bool,
    /// The version on disk was published after the game last ran.
    pub updated_since_last_play: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkshopLocalState {
    /// When Project Zomboid last ran (unix seconds).
    pub time_last_app_ran: Option<u64>,
    pub items: std::collections::BTreeMap<String, InstalledItemState>,
}

/// Reads Steam's record of installed Project Zomboid Workshop items. `workshop_content_dir` is
/// `.../steamapps/workshop/content/108600`; the record is `.../steamapps/workshop/appworkshop_108600.acf`.
pub fn local_state(workshop_content_dir: &str) -> Option<WorkshopLocalState> {
    let acf = std::path::Path::new(workshop_content_dir).parent()?.parent()?.join("appworkshop_108600.acf");
    let text = std::fs::read_to_string(acf).ok()?;
    let root = crate::vdf::parse(&text);
    let app = root.get("AppWorkshop")?;
    let last_ran = app.u64("TimeLastAppRan").filter(|t| *t > 0);
    let details = app.get("WorkshopItemDetails");
    let mut items = std::collections::BTreeMap::new();
    for (id, installed) in app.get("WorkshopItemsInstalled").and_then(|b| b.block()).into_iter().flatten() {
        let detail = details.and_then(|d| d.get(id));
        let installed_time = installed.u64("timeupdated").or_else(|| detail.and_then(|d| d.u64("timeupdated")));
        let latest_time = detail.and_then(|d| d.u64("latest_timeupdated")).or(installed_time);
        let manifest = installed.str("manifest").or_else(|| detail.and_then(|d| d.str("manifest")));
        let latest_manifest = detail.and_then(|d| d.str("latest_manifest"));
        let update_pending = matches!((latest_time, installed_time), (Some(l), Some(i)) if l > i)
            || matches!((latest_manifest, manifest), (Some(l), Some(m)) if l != m && l != "0");
        items.insert(
            id.clone(),
            InstalledItemState {
                installed_time,
                latest_time,
                size: installed.u64("size"),
                update_pending,
                updated_since_last_play: matches!((installed_time, last_ran), (Some(i), Some(r)) if i > r),
            },
        );
    }
    Some(WorkshopLocalState { time_last_app_ran: last_ran, items })
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
        // GetPublishedFileDetails sends "description"; QueryFiles "short_description"/"file_description".
        summary: ["short_description", "description", "file_description"]
            .iter()
            .find_map(|k| v.get(*k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()))
            .map(summarize)
            .unwrap_or_default(),
        preview_url: v.get("preview_url").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string),
        time_updated: num("time_updated"),
        subscriptions: num("subscriptions").unwrap_or(0),
        favorited: num("favorited").unwrap_or(0),
        file_size: num("file_size").unwrap_or(0),
        is_project_zomboid: num("consumer_app_id").or_else(|| num("consumer_appid")) == Some(PZ_APP_ID),
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkshopSort {
    /// Best text match (used automatically when there is search text).
    Relevance,
    Trending,
    MostSubscribed,
    RecentlyUpdated,
    Newest,
    TopRated,
}

impl WorkshopSort {
    /// EPublishedFileQueryType values.
    fn query_type(self) -> u32 {
        match self {
            WorkshopSort::TopRated => 0,
            WorkshopSort::Newest => 1,
            WorkshopSort::Trending => 3,
            WorkshopSort::MostSubscribed => 9,
            WorkshopSort::Relevance => 12,
            WorkshopSort::RecentlyUpdated => 21,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopSearchResult {
    pub total: u64,
    pub page: u32,
    pub items: Vec<WorkshopItem>,
}

/// Searches Project Zomboid Workshop items with the user's own Steam Web API key.
/// `build` ("41" / "42") keeps only items tagged "Build NN".
pub fn search(key: &str, text: Option<&str>, sort: WorkshopSort, build: Option<&str>, page: u32, per_page: u32) -> Result<WorkshopSearchResult, String> {
    let text = text.map(str::trim).filter(|t| !t.is_empty());
    // Text search only works with the relevance ranking; without text, relevance means trending.
    let sort = match (text.is_some(), sort) {
        (true, _) => WorkshopSort::Relevance,
        (false, WorkshopSort::Relevance) => WorkshopSort::Trending,
        (false, s) => s,
    };
    let page = page.max(1);
    let mut req = agent()
        .get(QUERY_URL)
        .query("key", key)
        .query("appid", PZ_APP_ID.to_string())
        .query("query_type", sort.query_type().to_string())
        .query("page", page.to_string())
        .query("numperpage", per_page.clamp(1, 100).to_string())
        .query("filetype", "0")
        .query("return_tags", "true")
        .query("return_previews", "true")
        .query("return_short_description", "true")
        .query("return_vote_data", "false");
    if sort == WorkshopSort::Trending {
        req = req.query("days", "7");
    }
    if let Some(t) = text {
        req = req.query("search_text", t);
    }
    if let Some(b) = build.filter(|b| !b.is_empty() && b.chars().all(|c| c.is_ascii_digit())) {
        req = req.query("requiredtags[0]", format!("Build {}", b)).query("match_all_tags", "true");
    }
    let response = req.call().map_err(|e| match e {
        ureq::Error::StatusCode(401) | ureq::Error::StatusCode(403) => {
            "Steam rejected the Web API key. Check it in Browse Mods > Steam Workshop (or create a new one at steamcommunity.com/dev/apikey).".to_string()
        }
        ureq::Error::StatusCode(429) => "Steam is rate-limiting searches; try again in a minute.".to_string(),
        other => format!("Steam could not be reached: {}", other),
    })?;
    let v: Value = response.into_body().read_json().map_err(|e| format!("Unexpected answer from Steam: {}", e))?;
    let r = v.get("response").ok_or("Unexpected answer from Steam (no response)")?;
    Ok(WorkshopSearchResult {
        total: r.get("total").and_then(|t| t.as_u64()).unwrap_or(0),
        page,
        items: r
            .get("publishedfiledetails")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(parse_item).collect())
            .unwrap_or_default(),
    })
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
        // QueryFiles field names.
        let q = parse_item(&json!({ "publishedfileid": "2", "result": 1, "consumer_appid": 108600,
            "short_description": "Short [b]text[/b]", "tags": [{ "tag": "Build 41", "display_name": "Build 41" }] })).unwrap();
        assert!(q.is_project_zomboid);
        assert_eq!(q.summary, "Short text");
        assert_eq!(q.builds, vec!["41"]);
    }

    #[test]
    fn reads_install_state_from_the_acf() {
        let root = std::env::temp_dir().join(format!("pzms-acf-{}", std::process::id()));
        let content = root.join("steamapps/workshop/content/108600");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(root.join("steamapps/workshop/appworkshop_108600.acf"), r#""AppWorkshop"
{
	"TimeLastAppRan"		"2000"
	"WorkshopItemsInstalled"
	{
		"1" { "size" "10" "timeupdated" "1500" "manifest" "a" }
		"2" { "size" "20" "timeupdated" "2500" "manifest" "b" }
		"3" { "size" "30" "timeupdated" "1000" "manifest" "c" }
	}
	"WorkshopItemDetails"
	{
		"1" { "manifest" "a" "timeupdated" "1500" "latest_timeupdated" "1500" "latest_manifest" "a" }
		"2" { "manifest" "b" "timeupdated" "2500" "latest_timeupdated" "2500" "latest_manifest" "b" }
		"3" { "manifest" "c" "timeupdated" "1000" "latest_timeupdated" "3000" "latest_manifest" "d" }
	}
}"#).unwrap();
        let state = local_state(&content.to_string_lossy()).unwrap();
        assert_eq!(state.time_last_app_ran, Some(2000));
        assert!(!state.items["1"].update_pending && !state.items["1"].updated_since_last_play);
        assert!(state.items["2"].updated_since_last_play);
        assert!(state.items["3"].update_pending);
        assert_eq!(state.items["3"].latest_time, Some(3000));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Live Steam call with a deliberately invalid key: must come back as a clear key error.
    #[test]
    #[ignore]
    fn workshop_live_search_rejects_bad_key() {
        let err = search("00000000000000000000000000000000", Some("horror"), WorkshopSort::Relevance, Some("42"), 1, 5).unwrap_err();
        println!("{}", err);
        assert!(err.contains("rejected the Web API key"), "{}", err);
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
