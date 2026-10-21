//! Discord, one way: the dedicated server the Studio hosts tells a channel what happens to it,
//! through a webhook the player makes in their Discord server (Channel settings > Integrations >
//! Webhooks) and pastes in the Studio.
//!
//! What is posted, each on or off per server: the server up, stopped by the Studio, stopped
//! without being asked (a crash, or closed outside the Studio), back after a restart; players
//! joining and leaving (gathered over a few seconds, so a restart is one message, not twenty);
//! and the server's Workshop mods updated since it started, which players with the new version
//! cannot join with until it restarts.
//!
//! The webhook address is a secret (whoever has it can post as it): it lives in the Windows
//! Credential Manager, never in a file, and only a Discord webhook address is accepted. Messages
//! never ping anyone (`allowed_mentions` empty). It works while the Studio runs and hosts the
//! server; the window says so.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

pub const SETTINGS_FILE: &str = "PZModStudio_Discord.json";
/// A stop the Studio was asked for, this long ago at most, is not a crash.
const STOP_GRACE_SECS: u64 = 180;
/// Joins and leaves are gathered this long before one message says them all.
const PLAYERS_GATHER_SECS: u64 = 10;
/// How often the server's Workshop mods are looked up while it runs.
const UPDATES_EVERY_SECS: u64 = 600;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiscordSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "yes")]
    pub status: bool,
    #[serde(default = "yes")]
    pub players: bool,
    #[serde(default = "yes")]
    pub restarts: bool,
    #[serde(default = "yes")]
    pub updates: bool,
    /// "en" or "es": the language of the messages (the Studio's when they were saved).
    #[serde(default)]
    pub language: String,
}

impl Default for DiscordSettings {
    fn default() -> Self {
        DiscordSettings { enabled: false, status: true, players: true, restarts: true, updates: true, language: "en".into() }
    }
}

/// What the window shows: the settings, and whether a webhook is stored (never the address).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordView {
    pub settings: DiscordSettings,
    pub has_webhook: bool,
}

fn secret_name(server: &str) -> String {
    format!("discord_webhook:{}", server)
}

fn settings_path(user_zomboid_dir: &Path) -> PathBuf {
    user_zomboid_dir.join(SETTINGS_FILE)
}

fn read_all(user_zomboid_dir: &Path) -> BTreeMap<String, DiscordSettings> {
    std::fs::read_to_string(settings_path(user_zomboid_dir))
        .ok()
        .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub fn view(user_zomboid_dir: &Path, server: &str) -> DiscordView {
    DiscordView {
        settings: read_all(user_zomboid_dir).get(server).cloned().unwrap_or_default(),
        has_webhook: crate::secrets::get(&secret_name(server)).ok().flatten().is_some(),
    }
}

/// A Discord webhook address: `https://discord.com/api/webhooks/<id>/<token>` (or discordapp.com,
/// ptb., canary.). Nothing else is ever posted to.
pub fn is_webhook_url(url: &str) -> bool {
    let Some(rest) = url.trim().strip_prefix("https://") else { return false };
    let Some((host, path)) = rest.split_once('/') else { return false };
    let host_ok = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"].contains(&host);
    let Some(tail) = path.strip_prefix("api/webhooks/") else { return false };
    let mut parts = tail.split('/');
    let (Some(id), Some(token)) = (parts.next(), parts.next()) else { return false };
    let token = token.split('?').next().unwrap_or("");
    host_ok && !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) && token.len() >= 20 && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Saves a server's settings; `webhook` Some("") forgets the stored address, Some(url) stores it.
pub fn save(user_zomboid_dir: &Path, server: &str, settings: DiscordSettings, webhook: Option<String>) -> Result<DiscordView, String> {
    if let Some(url) = webhook {
        let url = url.trim().to_string();
        if url.is_empty() {
            crate::secrets::delete(&secret_name(server))?;
        } else if is_webhook_url(&url) {
            crate::secrets::set(&secret_name(server), &url)?;
        } else {
            return Err("not_webhook: That is not a Discord webhook address (https://discord.com/api/webhooks/...).".to_string());
        }
    }
    let mut all = read_all(user_zomboid_dir);
    all.insert(server.to_string(), settings);
    let text = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    crate::load_order::ini_parser::atomic_write(settings_path(user_zomboid_dir), text).map_err(|e| e.to_string())?;
    Ok(view(user_zomboid_dir, server))
}

fn agent() -> ureq::Agent {
    // Windows' own certificate store: Discord's chain ends at a root the bundled list lacks
    // ("unable to find any user-specified roots in the final cert chain").
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .user_agent(format!("PZModStudio/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// The JSON a message is sent as: no one is ever pinged.
pub fn message_body(text: &str) -> serde_json::Value {
    let mut content: String = text.chars().take(1900).collect();
    if content.len() < text.len() {
        content.push('…');
    }
    serde_json::json!({ "content": content, "username": "PZ Mod Studio", "allowed_mentions": { "parse": [] } })
}

/// Posts one message. Discord limits a webhook to about 30 a minute: when it says to wait, the
/// message waits (once) and goes.
pub fn post(webhook: &str, text: &str) -> Result<(), String> {
    if !is_webhook_url(webhook) {
        return Err("not_webhook: Not a Discord webhook address.".to_string());
    }
    let body = message_body(text);
    for _ in 0..2 {
        let mut response = agent().post(webhook).send_json(&body).map_err(|e| format!("unreachable: Discord could not be reached: {}", e))?;
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(());
        }
        if status == 429 {
            let wait = response
                .body_mut()
                .read_json::<serde_json::Value>()
                .ok()
                .and_then(|v| v.get("retry_after").and_then(|r| r.as_f64()))
                .unwrap_or(2.0);
            std::thread::sleep(Duration::from_millis((wait.clamp(0.5, 30.0) * 1000.0) as u64));
            continue;
        }
        return Err(match status {
            401 | 403 | 404 => "unknown_webhook: Discord does not know this webhook any more (deleted, or the address is wrong). Make a new one and paste it.".to_string(),
            _ => format!("status: Discord answered {}.", status),
        });
    }
    Err("rate_limited: Discord asked to wait twice; the message was dropped.".to_string())
}

// ------------------------------------------------------------------ the messages

/// One message in the settings' language (English, or Spanish), with `{n}` filled in.
pub fn say(language: &str, key: &str, args: &[&str]) -> String {
    let es = language.starts_with("es");
    let template = match (key, es) {
        ("test", false) => "✅ PZ Mod Studio is connected: news of **{0}** will show here.",
        ("test", true) => "✅ PZ Mod Studio está conectado: las novedades de **{0}** se van a ver acá.",
        ("up", false) => "🟢 **{0}** is up.",
        ("up", true) => "🟢 **{0}** está en línea.",
        ("restarted", false) => "🔄 **{0}** restarted and is up again.",
        ("restarted", true) => "🔄 **{0}** se reinició y está en línea de nuevo.",
        ("stopping", false) => "🔴 **{0}** was stopped from PZ Mod Studio.",
        ("stopping", true) => "🔴 **{0}** se detuvo desde PZ Mod Studio.",
        ("crashed", false) => "⚠️ **{0}** stopped without being asked (a crash, or closed outside PZ Mod Studio).",
        ("crashed", true) => "⚠️ **{0}** se detuvo sin que se lo pidieran (un cierre inesperado, o se cerró fuera de PZ Mod Studio).",
        ("joined", false) => "➡️ {0} joined ({1} online).",
        ("joined", true) => "➡️ Entró {0} ({1} en línea).",
        ("left", false) => "⬅️ {0} left ({1} online).",
        ("left", true) => "⬅️ Salió {0} ({1} en línea).",
        ("updates", false) => "📦 {0} of **{1}**'s Workshop mods were updated since it started: {2}. Players who have the new version cannot join until it restarts.",
        ("updates", true) => "📦 {0} mod(s) del Workshop de **{1}** se actualizaron desde que arrancó: {2}. Quien tenga la versión nueva no puede entrar hasta que se reinicie.",
        _ => key,
    };
    let mut out = template.to_string();
    for (i, a) in args.iter().enumerate() {
        out = out.replace(&format!("{{{}}}", i), a);
    }
    out
}

/// "Ana, Beto and Carl" (or "Ana, Beto y Carl"); more than five are counted.
pub fn names(language: &str, list: &[String]) -> String {
    let and = if language.starts_with("es") { " y " } else { " and " };
    let mut shown: Vec<String> = list.iter().take(5).cloned().collect();
    if list.len() > 5 {
        shown.push(if language.starts_with("es") { format!("{} más", list.len() - 5) } else { format!("{} more", list.len() - 5) });
    }
    match shown.len() {
        0 => String::new(),
        1 => shown[0].clone(),
        n => format!("{}{}{}", shown[..n - 1].join(", "), and, shown[n - 1]),
    }
}

// ------------------------------------------------------------------ what the server does

static STOP_ASKED_AT: AtomicU64 = AtomicU64::new(0);
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Called when the Studio is asked to stop the server: what follows is not a crash.
pub fn note_stop_asked() {
    STOP_ASKED_AT.store(now_secs(), Ordering::Relaxed);
}

/// The test message the window's button sends.
pub fn send_test(user_zomboid_dir: &Path, server: &str) -> Result<(), String> {
    let webhook = crate::secrets::get(&secret_name(server))?.ok_or("no_webhook: No webhook saved for this server yet.")?;
    let language = view(user_zomboid_dir, server).settings.language;
    post(&webhook, &say(&language, "test", &[server]))
}

/// What the watcher remembers between looks.
#[derive(Default)]
struct Seen {
    running: Option<bool>,
    server: Option<String>,
    started_at: Option<u64>,
    players: BTreeSet<String>,
    joined: Vec<String>,
    left: Vec<String>,
    gathering_since: Option<u64>,
    updates_checked_at: u64,
    updates_said: BTreeSet<String>,
    /// The stop request a restart already used: the next stop without a new one is a crash.
    stop_spent: u64,
}

/// What changed since the last look, as messages (the decisions, without the network or the
/// clock, so they can be tested).
fn step(seen: &mut Seen, running: bool, server: &str, started_at: Option<u64>, players: Option<BTreeSet<String>>, now: u64, stop_asked_at: u64, s: &DiscordSettings) -> Vec<String> {
    let mut out = Vec::new();
    let lang = s.language.as_str();
    let stop_asked = stop_asked_at > 0 && stop_asked_at != seen.stop_spent && now.saturating_sub(stop_asked_at) <= STOP_GRACE_SECS;
    match (seen.running, running) {
        (Some(false), true) => {
            if stop_asked && s.restarts {
                out.push(say(lang, "restarted", &[server]));
            } else if s.status {
                out.push(say(lang, "up", &[server]));
            }
            // Up again: that stop request is used, whatever comes next is not it.
            if stop_asked {
                seen.stop_spent = stop_asked_at;
            }
            seen.players.clear();
            seen.updates_said.clear();
            seen.updates_checked_at = 0;
        }
        (Some(true), false) => {
            let name = seen.server.clone().unwrap_or_else(|| server.to_string());
            if stop_asked {
                if s.status {
                    out.push(say(lang, "stopping", &[&name]));
                }
            } else if s.status {
                out.push(say(lang, "crashed", &[&name]));
            }
            seen.players.clear();
            seen.joined.clear();
            seen.left.clear();
            seen.gathering_since = None;
        }
        _ => {}
    }
    seen.running = Some(running);
    if running {
        seen.server = Some(server.to_string());
        seen.started_at = started_at;
    }
    // Players: gathered, then said in one message each way.
    if let (true, Some(now_players)) = (running, players) {
        // Back before the message went: the leave is not said (and the other way round).
        for p in now_players.difference(&seen.players) {
            if seen.left.contains(p) {
                seen.left.retain(|x| x != p);
            } else if !seen.joined.contains(p) {
                seen.joined.push(p.clone());
            }
        }
        for p in seen.players.difference(&now_players) {
            if seen.joined.contains(p) {
                seen.joined.retain(|x| x != p);
            } else if !seen.left.contains(p) {
                seen.left.push(p.clone());
            }
        }
        if seen.joined.is_empty() && seen.left.is_empty() {
            seen.gathering_since = None;
        } else if seen.gathering_since.is_none() {
            seen.gathering_since = Some(now);
        }
        seen.players = now_players;
        if seen.gathering_since.is_some_and(|t| now.saturating_sub(t) >= PLAYERS_GATHER_SECS) {
            let online = seen.players.len().to_string();
            if s.players && !seen.joined.is_empty() {
                out.push(say(lang, "joined", &[&names(lang, &seen.joined), &online]));
            }
            if s.players && !seen.left.is_empty() {
                out.push(say(lang, "left", &[&names(lang, &seen.left), &online]));
            }
            seen.joined.clear();
            seen.left.clear();
            seen.gathering_since = None;
        }
    }
    out
}

/// The server's Workshop mods published after it started and not said yet: their titles.
fn updated_since_start(seen: &mut Seen, items: &[crate::workshop::WorkshopItem]) -> Vec<String> {
    let Some(start) = seen.started_at else { return Vec::new() };
    let mut out = Vec::new();
    for item in items {
        if let Some(t) = item.time_updated.filter(|t| *t > start) {
            let key = format!("{}@{}", item.workshop_id, t);
            if seen.updates_said.insert(key) {
                out.push(if item.title.is_empty() { item.workshop_id.clone() } else { item.title.clone() });
            }
        }
    }
    out
}

/// Follows the hosted server while the Studio runs and posts what changes to each server's
/// webhook, when it has one and it is on.
pub fn watch() {
    if WATCHER_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    std::thread::spawn(|| {
        let mut seen = Seen::default();
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let chosen = crate::vfs::saved_user_zomboid_dir();
            let Some(z) = crate::load_order::mod_info::get_existing_user_zomboid_dirs(&chosen).into_iter().next() else { continue };
            let all = read_all(&z);
            if !all.values().any(|s| s.enabled) {
                continue;
            }
            let z_str = z.to_string_lossy().to_string();
            let Ok(status) = crate::server_manager::get_dedicated_server_status(z_str.clone()) else { continue };
            let server = status.server_name.clone().or_else(|| seen.server.clone()).unwrap_or_default();
            let Some(settings) = all.get(&server).filter(|s| s.enabled).cloned() else {
                seen.running = Some(status.is_running);
                continue;
            };
            let Ok(Some(webhook)) = crate::secrets::get(&secret_name(&server)) else { continue };
            let players = if status.is_running {
                crate::server_manager::get_connected_players(z_str.clone()).ok().map(|list| list.into_iter().map(|p| p.username).collect::<BTreeSet<String>>())
            } else {
                None
            };
            let now = now_secs();
            let mut messages = step(&mut seen, status.is_running, &server, status.start_timestamp, players, now, STOP_ASKED_AT.load(Ordering::Relaxed), &settings);
            if status.is_running && settings.updates && now.saturating_sub(seen.updates_checked_at) >= UPDATES_EVERY_SECS {
                seen.updates_checked_at = now;
                let ids = crate::server_manager::list_server_configs(z_str.clone())
                    .ok()
                    .and_then(|list| list.into_iter().find(|c| c.name == server))
                    .map(|c| c.workshop_items)
                    .unwrap_or_default();
                if !ids.is_empty() {
                    if let Ok(items) = crate::workshop::get_details(&ids) {
                        let titles = updated_since_start(&mut seen, &items);
                        if !titles.is_empty() {
                            let lang = settings.language.as_str();
                            messages.push(say(lang, "updates", &[&titles.len().to_string(), &server, &names(lang, &titles)]));
                        }
                    }
                }
            }
            for m in messages {
                if let Err(e) = post(&webhook, &m) {
                    crate::diagnostics::error(format!("[Discord] {}", e));
                }
                std::thread::sleep(Duration::from_millis(1200));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// Posts one real message: PZMS_WEBHOOK=<url> cargo test real_discord_post -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_discord_post() {
        let Ok(url) = std::env::var("PZMS_WEBHOOK") else { return };
        post(&url, &say("es", "test", &["pZMSDiscordTest (cargo test)"])).unwrap();
    }

    #[test]
    fn only_a_discord_webhook_is_accepted() {
        assert!(is_webhook_url("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-12"));
        assert!(is_webhook_url("https://canary.discord.com/api/webhooks/1/abcdefghijklmnopqrstuvwxyz"));
        assert!(!is_webhook_url("http://discord.com/api/webhooks/1/abcdefghijklmnopqrstuvwxyz"), "not https");
        assert!(!is_webhook_url("https://evil.com/api/webhooks/1/abcdefghijklmnopqrstuvwxyz"));
        assert!(!is_webhook_url("https://discord.com.evil.com/api/webhooks/1/abcdefghijklmnopqrstuvwxyz"));
        assert!(!is_webhook_url("https://discord.com/api/webhooks/x/abcdefghijklmnopqrstuvwxyz"));
        assert!(!is_webhook_url("https://discord.com/channels/1/2"));
    }

    #[test]
    fn messages_never_ping_and_say_names_in_the_language() {
        let body = message_body("@everyone hi");
        assert_eq!(body["allowed_mentions"]["parse"], serde_json::json!([]));
        assert_eq!(names("en", &["Ana".into(), "Beto".into(), "Carl".into()]), "Ana, Beto and Carl");
        assert_eq!(names("es", &["Ana".into(), "Beto".into()]), "Ana y Beto");
        assert_eq!(names("en", &(1..=7).map(|i| i.to_string()).collect::<Vec<_>>()), "1, 2, 3, 4, 5 and 2 more");
        assert_eq!(say("es", "joined", &["Ana", "3"]), "➡️ Entró Ana (3 en línea).");
    }

    #[test]
    fn the_server_s_life_becomes_a_few_messages() {
        let s = DiscordSettings { enabled: true, ..Default::default() };
        let mut seen = Seen::default();
        // The first look only learns how things are.
        assert!(step(&mut seen, false, "Coop", None, None, 100, 0, &s).is_empty());
        let up = step(&mut seen, true, "Coop", Some(100), Some(set(&[])), 105, 0, &s);
        assert_eq!(up, vec!["🟢 **Coop** is up."]);
        // Three join over a few seconds: one message once they settle.
        assert!(step(&mut seen, true, "Coop", Some(100), Some(set(&["Ana"])), 110, 0, &s).is_empty());
        assert!(step(&mut seen, true, "Coop", Some(100), Some(set(&["Ana", "Beto", "Carl"])), 115, 0, &s).is_empty());
        let joined = step(&mut seen, true, "Coop", Some(100), Some(set(&["Ana", "Beto", "Carl"])), 121, 0, &s);
        assert_eq!(joined, vec!["➡️ Ana, Beto and Carl joined (3 online)."]);
        // One leaves and comes back before the message: nothing to say.
        step(&mut seen, true, "Coop", Some(100), Some(set(&["Ana", "Beto"])), 130, 0, &s);
        assert!(step(&mut seen, true, "Coop", Some(100), Some(set(&["Ana", "Beto", "Carl"])), 141, 0, &s).is_empty());
        // Gone without being asked: a crash.
        assert_eq!(step(&mut seen, false, "Coop", None, None, 150, 0, &s), vec!["⚠️ **Coop** stopped without being asked (a crash, or closed outside PZ Mod Studio)."]);
        // Stopped from the Studio and back within minutes: a restart.
        step(&mut seen, true, "Coop", Some(160), Some(set(&[])), 160, 0, &s);
        assert_eq!(step(&mut seen, false, "Coop", None, None, 200, 195, &s), vec!["🔴 **Coop** was stopped from PZ Mod Studio."]);
        assert_eq!(step(&mut seen, true, "Coop", Some(230), Some(set(&[])), 230, 195, &s), vec!["🔄 **Coop** restarted and is up again."]);
        // Killed a minute later, the same stop request long used: a crash (seen live 2026-10-21).
        assert_eq!(step(&mut seen, false, "Coop", None, None, 300, 195, &s), vec!["⚠️ **Coop** stopped without being asked (a crash, or closed outside PZ Mod Studio)."]);
        // What is switched off is not said.
        let quiet = DiscordSettings { enabled: true, status: false, ..Default::default() };
        assert!(step(&mut seen, false, "Coop", None, None, 900, 0, &quiet).is_empty());
    }

    #[test]
    fn a_mod_updated_after_the_start_is_said_once() {
        let item = |id: &str, title: &str, t: u64| crate::workshop::WorkshopItem {
            workshop_id: id.into(), found: true, title: title.into(), summary: String::new(), preview_url: None,
            time_updated: Some(t), time_created: None, subscriptions: 0, favorited: 0, file_size: 0, tags: vec![], builds: vec![],
            is_project_zomboid: true, banned: false, page_url: String::new(), children: vec![], is_collection: false,
        };
        let mut seen = Seen { started_at: Some(1000), ..Default::default() };
        let items = vec![item("1", "Old", 900), item("2", "Fresh", 1500)];
        assert_eq!(updated_since_start(&mut seen, &items), vec!["Fresh"]);
        assert!(updated_since_start(&mut seen, &items).is_empty(), "said once");
        assert_eq!(updated_since_start(&mut seen, &[item("2", "Fresh", 1800)]), vec!["Fresh"], "a newer update is said again");
    }
}
