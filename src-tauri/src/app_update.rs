//! Whether a newer PZ Mod Studio is out: the repository's latest release on GitHub, asked once a
//! day while the check is on (Settings). Nothing is downloaded or installed here: the app shows a
//! notice whose Download button opens the release page in the browser.

use serde::{Deserialize, Serialize};
use std::fs;

use crate::rules::community::{cache_path, fetch_text, is_fresh, now};

/// GitHub's latest published release (drafts and pre-releases are never "latest").
const LATEST_URL: &str = "https://api.github.com/repos/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-/releases/latest";
/// The setting, the last answer and the version the player said "not now" to.
const STATE_FILE: &str = "PZModStudio_UpdateCheck.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct State {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    checked_at: Option<i64>,
    #[serde(default)]
    latest: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    dismissed: Option<String>,
}

/// What the notice and Settings show.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateStatus {
    pub enabled: bool,
    /// This build's version.
    pub current: String,
    /// The latest release's version, without the "v" (None until one answer came).
    pub latest: Option<String>,
    /// The release page, opened by Download.
    pub url: Option<String>,
    /// The latest release is newer than this build.
    pub newer: bool,
    /// The player said "not now" to this very version: no notice until the next one.
    pub dismissed: bool,
    pub checked_at: Option<i64>,
    /// The last attempt failed (offline, GitHub refused): the notice stays quiet.
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

fn load(user_zomboid_dir: &str) -> State {
    cache_path(user_zomboid_dir, STATE_FILE)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(user_zomboid_dir: &str, state: &State) -> Result<(), String> {
    let path = cache_path(user_zomboid_dir, STATE_FILE).ok_or_else(|| format!("Zomboid folder not found: {}", user_zomboid_dir))?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// "v1.2.0" or "1.2.0" as numbers; anything after a "-" (a pre-release) is left out.
fn parse_version(v: &str) -> Option<Vec<u64>> {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let parts: Option<Vec<u64>> = core.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| !p.is_empty())
}

/// Whether `latest` is a later version than `current` (1.10.0 is later than 1.9.0).
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(mut a), Some(mut b)) => {
            let n = a.len().max(b.len());
            a.resize(n, 0);
            b.resize(n, 0);
            a > b
        }
        _ => false,
    }
}

fn status(state: &State, error: Option<String>) -> UpdateStatus {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let newer = state.latest.as_deref().is_some_and(|l| is_newer(l, &current));
    UpdateStatus {
        enabled: state.enabled.unwrap_or(true),
        dismissed: newer && state.dismissed.is_some() && state.dismissed == state.latest,
        current,
        latest: state.latest.clone(),
        url: state.url.clone(),
        newer,
        checked_at: state.checked_at,
        error,
    }
}

/// The status, asking GitHub when the check is on and the last answer is a day old (or `force`,
/// Settings' "Check now"). A failed request keeps the last answer and says why.
pub fn check(user_zomboid_dir: &str, force: bool) -> UpdateStatus {
    let mut state = load(user_zomboid_dir);
    let enabled = state.enabled.unwrap_or(true);
    if !enabled && !force {
        return status(&state, None);
    }
    if !force && state.checked_at.is_some_and(is_fresh) {
        return status(&state, None);
    }
    let error = match fetch_text(LATEST_URL).and_then(|t| serde_json::from_str::<Release>(&t).map_err(|e| e.to_string())) {
        Ok(r) => {
            state.latest = Some(r.tag_name.trim_start_matches(['v', 'V']).to_string());
            state.url = Some(r.html_url);
            None
        }
        Err(e) => Some(e),
    };
    // A failure is not asked again before tomorrow either: no hammering while offline.
    state.checked_at = Some(now());
    let _ = save(user_zomboid_dir, &state);
    status(&state, error)
}

pub fn set_enabled(user_zomboid_dir: &str, on: bool) -> Result<UpdateStatus, String> {
    let mut state = load(user_zomboid_dir);
    state.enabled = Some(on);
    save(user_zomboid_dir, &state)?;
    Ok(status(&state, None))
}

/// "Not now": no notice for this version; the next release shows one again.
pub fn dismiss(user_zomboid_dir: &str, version: &str) -> Result<(), String> {
    let mut state = load(user_zomboid_dir);
    state.dismissed = Some(version.to_string());
    save(user_zomboid_dir, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(is_newer("v1.3.0", "1.2.0"));
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(is_newer("2.0", "1.9.9"));
        assert!(!is_newer("v1.2.0", "1.2.0"));
        assert!(!is_newer("1.1.9", "1.2.0"));
        assert!(!is_newer("1.2.0-beta", "1.2.0"));
        assert!(!is_newer("nightly", "1.2.0"));
    }

    #[test]
    fn dismissed_only_hides_that_version() {
        let mut s = State { latest: Some("99.0.0".into()), dismissed: Some("99.0.0".into()), ..Default::default() };
        assert!(status(&s, None).dismissed);
        s.latest = Some("99.1.0".into());
        assert!(!status(&s, None).dismissed);
        assert!(status(&s, None).newer);
    }

    /// GitHub's answer, read the way `check` reads it. cargo test --lib latest_release_reads -- --ignored --nocapture
    #[test]
    #[ignore]
    fn latest_release_reads() {
        let r: Release = serde_json::from_str(&fetch_text(LATEST_URL).unwrap()).unwrap();
        println!("latest {} at {}; newer than this build: {}", r.tag_name, r.html_url, is_newer(&r.tag_name, env!("CARGO_PKG_VERSION")));
        assert!(parse_version(&r.tag_name).is_some());
    }
}
