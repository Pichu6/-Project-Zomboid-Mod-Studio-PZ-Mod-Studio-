//! Subscribing through the Steam client that is already running, with no API key and no login.
//!
//! Project Zomboid ships `steam_api64.dll`, the same library the game uses to talk to Steam. The
//! Studio loads that copy (nothing is bundled or downloaded), asks the running Steam client to
//! subscribe or unsubscribe, and lets go of it again. Steam itself downloads the files, exactly as
//! if the user had pressed Subscribe on the Workshop page.
//!
//! While the library is loaded Steam counts Project Zomboid as running, so the user shows up as
//! in-game for the second or two a subscription takes. Only one of these may run at a time.

use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PZ_APP_ID: &str = "108600";
/// Steam's own cap on how long a subscription call may take before we stop waiting.
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// Only one Steam session at a time, however many windows ask for one.
static STEAM_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubscribeOutcome {
    /// Items Steam accepted.
    pub done: Vec<String>,
    /// Items it refused, with the reason.
    pub failed: Vec<(String, String)>,
}

type InitFlat = unsafe extern "C" fn(*mut c_char) -> i32;
type Accessor = unsafe extern "C" fn() -> *mut c_void;
type ItemCall = unsafe extern "C" fn(*mut c_void, u64) -> u64;
type Shutdown = unsafe extern "C" fn();
type RunCallbacks = unsafe extern "C" fn();
type IsCallDone = unsafe extern "C" fn(*mut c_void, u64, *mut bool) -> bool;
type CallResult = unsafe extern "C" fn(*mut c_void, u64, *mut c_void, i32, i32, *mut bool) -> bool;
type CountItems = unsafe extern "C" fn(*mut c_void, bool) -> u32;

/// `steam_api64.dll` as the game installs it.
fn library_path(pz_install_dir: &str) -> Result<PathBuf, String> {
    let file = Path::new(pz_install_dir).join("steam_api64.dll");
    if !file.is_file() {
        return Err(format!(
            "steam_api64.dll was not found in {}. Check your game folder in App Settings.",
            pz_install_dir
        ));
    }
    Ok(file)
}

/// A loaded `steam_api64.dll` with Steam initialised; closes itself when dropped.
struct SteamSession {
    module: isize,
    ugc: *mut c_void,
    utils: *mut c_void,
    shutdown: Shutdown,
    run_callbacks: RunCallbacks,
    is_call_done: IsCallDone,
}

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::FreeLibrary;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    pub fn load(path: &std::path::Path) -> Result<isize, String> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let handle = unsafe { LoadLibraryW(wide.as_ptr()) };
        if handle.is_null() {
            return Err(format!("{} could not be loaded ({}).", path.display(), std::io::Error::last_os_error()));
        }
        Ok(handle as isize)
    }

    pub fn symbol(module: isize, name: &str) -> Result<*const c_void, String> {
        let c_name = std::ffi::CString::new(name).map_err(|_| "bad symbol name".to_string())?;
        let address = unsafe { GetProcAddress(module as _, c_name.as_ptr() as *const u8) };
        match address {
            Some(a) => Ok(a as *const c_void),
            None => Err(format!("{} is missing from steam_api64.dll; your game install may be older.", name)),
        }
    }

    pub fn unload(module: isize) {
        unsafe { FreeLibrary(module as _) };
    }

    use std::os::windows::ffi::OsStrExt;
}

#[cfg(not(windows))]
mod ffi {
    use std::ffi::c_void;
    pub fn load(_path: &std::path::Path) -> Result<isize, String> {
        Err("Subscribing through the Steam client only works on Windows.".to_string())
    }
    pub fn symbol(_module: isize, _name: &str) -> Result<*const c_void, String> {
        Err("not Windows".to_string())
    }
    pub fn unload(_module: isize) {}
}

impl SteamSession {
    /// Loads the game's own Steam library and attaches to the running Steam client.
    fn open(pz_install_dir: &str) -> Result<Self, String> {
        let path = library_path(pz_install_dir)?;
        let module = ffi::load(&path)?;

        let close = |module: isize, e: String| {
            ffi::unload(module);
            e
        };
        let get = |name: &str| ffi::symbol(module, name);

        // Steam has to know which game is asking. Set before init, as the SDK expects.
        std::env::set_var("SteamAppId", PZ_APP_ID);
        std::env::set_var("SteamGameId", PZ_APP_ID);

        let init: InitFlat = match get("SteamAPI_InitFlat") {
            Ok(a) => unsafe { std::mem::transmute(a) },
            Err(e) => return Err(close(module, e)),
        };
        let mut message = [0 as c_char; 1024];
        let result = unsafe { init(message.as_mut_ptr()) };
        if result != 0 {
            let text = unsafe { std::ffi::CStr::from_ptr(message.as_ptr()) }.to_string_lossy().to_string();
            ffi::unload(module);
            return Err(match result {
                // 2 = no Steam client, 3 = this account does not own the game.
                2 => "Steam is not running. Start Steam, sign in, and try again.".to_string(),
                3 => "This Steam account does not own Project Zomboid.".to_string(),
                _ if !text.is_empty() => format!("Steam refused the connection: {}", text),
                _ => format!("Steam refused the connection (code {}).", result),
            });
        }

        let session = |name: &str| -> Result<*mut c_void, String> {
            let accessor: Accessor = unsafe { std::mem::transmute(get(name)?) };
            let pointer = unsafe { accessor() };
            if pointer.is_null() {
                return Err(format!("Steam did not hand over {}.", name));
            }
            Ok(pointer)
        };
        let shutdown: Shutdown = match get("SteamAPI_Shutdown") {
            Ok(a) => unsafe { std::mem::transmute(a) },
            Err(e) => return Err(close(module, e)),
        };
        let finish = |e: String| {
            unsafe { shutdown() };
            ffi::unload(module);
            e
        };
        let ugc = match session("SteamAPI_SteamUGC_v021") {
            Ok(p) => p,
            Err(e) => return Err(finish(e)),
        };
        let utils = match session("SteamAPI_SteamUtils_v010") {
            Ok(p) => p,
            Err(e) => return Err(finish(e)),
        };
        let run_callbacks: RunCallbacks = match get("SteamAPI_RunCallbacks") {
            Ok(a) => unsafe { std::mem::transmute(a) },
            Err(e) => return Err(finish(e)),
        };
        let is_call_done: IsCallDone = match get("SteamAPI_ISteamUtils_IsAPICallCompleted") {
            Ok(a) => unsafe { std::mem::transmute(a) },
            Err(e) => return Err(finish(e)),
        };
        Ok(SteamSession { module, ugc, utils, shutdown, run_callbacks, is_call_done })
    }

    /// Waits for one Steam call to come back, pumping callbacks meanwhile.
    fn wait_for(&self, call: u64) -> Result<(), String> {
        if call == 0 {
            return Err("Steam would not take the request.".to_string());
        }
        let deadline = Instant::now() + CALL_TIMEOUT;
        while Instant::now() < deadline {
            unsafe { (self.run_callbacks)() };
            let mut failed = false;
            if unsafe { (self.is_call_done)(self.utils, call, &mut failed) } {
                return if failed { Err("Steam reported the request failed.".to_string()) } else { Ok(()) };
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("Steam did not answer in time.".to_string())
    }

    /// Subscribes or unsubscribes one item and reads Steam's verdict: a call that completes can
    /// still be refused (a removed or private item), and that is not a success.
    fn call_per_item(&self, name: &str, id: u64, callback_id: i32) -> Result<(), String> {
        let function: ItemCall = unsafe { std::mem::transmute(ffi::symbol(self.module, name)?) };
        let call = unsafe { function(self.ugc, id) };
        self.wait_for(call)?;
        let Ok(get) = ffi::symbol(self.module, "SteamAPI_ISteamUtils_GetAPICallResult") else {
            return Ok(());
        };
        let get: CallResult = unsafe { std::mem::transmute(get) };
        // RemoteStorage(Un)SubscribePublishedFileResult_t: EResult, then the item id (pack 8).
        let mut result = [0u8; 16];
        let mut failed = false;
        let read = unsafe { get(self.utils, call, result.as_mut_ptr().cast(), result.len() as i32, callback_id, &mut failed) };
        if !read || failed {
            return Ok(()); // Steam completed it and would not say more: as before.
        }
        let e_result = i32::from_le_bytes([result[0], result[1], result[2], result[3]]);
        match e_result {
            1 => Ok(()),
            9 => Err("Steam says this item does not exist (removed or private).".to_string()),
            15 => Err("Steam refused it: access denied (private or hidden item).".to_string()),
            n => Err(format!("Steam refused it (result {}).", n)),
        }
    }

    /// How many Workshop items this account is subscribed to (a read, to prove the link works).
    fn subscribed_count(&self) -> Result<u32, String> {
        let count: CountItems = unsafe { std::mem::transmute(ffi::symbol(self.module, "SteamAPI_ISteamUGC_GetNumSubscribedItems")?) };
        Ok(unsafe { count(self.ugc, true) })
    }
}

impl Drop for SteamSession {
    fn drop(&mut self) {
        unsafe { (self.shutdown)() };
        ffi::unload(self.module);
    }
}

/// Subscribes or unsubscribes the signed-in Steam account, through the running Steam client.
/// Steam downloads or removes the files itself afterwards.
pub fn set_subscriptions(pz_install_dir: &str, ids: &[String], subscribe: bool) -> Result<SubscribeOutcome, String> {
    let _only_one = STEAM_LOCK.lock().map_err(|_| "Another subscription is still running.".to_string())?;
    let numbers: Vec<(String, u64)> = ids
        .iter()
        .filter_map(|id| id.trim().parse::<u64>().ok().map(|n| (id.clone(), n)))
        .collect();
    if numbers.is_empty() {
        return Err("No Workshop item to subscribe to.".to_string());
    }
    let session = SteamSession::open(pz_install_dir)?;
    // Callback ids: k_iSteamRemoteStorageCallbacks (1300) + 13 / + 15.
    let (name, callback_id) = if subscribe {
        ("SteamAPI_ISteamUGC_SubscribeItem", 1313)
    } else {
        ("SteamAPI_ISteamUGC_UnsubscribeItem", 1315)
    };
    let mut outcome = SubscribeOutcome::default();
    for (text, id) in numbers {
        match session.call_per_item(name, id, callback_id) {
            Ok(()) => outcome.done.push(text),
            Err(e) => outcome.failed.push((text, e)),
        }
    }
    Ok(outcome)
}

/// Whether the Steam client can be reached right now, and how many items it has subscribed.
/// Starts Steam's API, so it belongs in a process that does nothing else afterwards.
pub fn check(pz_install_dir: &str) -> Result<u32, String> {
    let _only_one = STEAM_LOCK.lock().map_err(|_| "Another subscription is still running.".to_string())?;
    SteamSession::open(pz_install_dir)?.subscribed_count()
}

/// Is subscribing from here possible: the game's library is there and Steam is signed in?
///
/// This only asks the library whether a Steam client is running. It deliberately does not start
/// Steam's API, both because that would show the user as in-game for no reason and because the
/// API may only be started once in a process: that one start belongs to the subscription itself.
pub fn is_ready(pz_install_dir: &str) -> bool {
    let Ok(path) = library_path(pz_install_dir) else { return false };
    let Ok(module) = ffi::load(&path) else { return false };
    let running = match ffi::symbol(module, "SteamAPI_IsSteamRunning") {
        Ok(address) => {
            let is_running: unsafe extern "C" fn() -> bool = unsafe { std::mem::transmute(address) };
            unsafe { is_running() }
        }
        Err(_) => false,
    };
    ffi::unload(module);
    running
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_where_the_library_should_be() {
        let err = library_path("Z:\\nowhere").unwrap_err();
        assert!(err.contains("steam_api64.dll") && err.contains("App Settings"));
    }

    #[test]
    fn ids_must_be_numbers() {
        let err = set_subscriptions("Z:\\nowhere", &["not an id".to_string()], true).unwrap_err();
        assert!(err.contains("No Workshop item"), "{}", err);
    }

    /// Reads from the running Steam client without changing anything. Steam must be signed in.
    /// PZMS_PZ_DIR=... cargo test steam_client_reads -- --ignored --nocapture
    #[test]
    #[ignore]
    fn steam_client_reads_subscriptions() {
        let dir = std::env::var("PZMS_PZ_DIR").expect("Set PZMS_PZ_DIR to your Project Zomboid folder.");
        match check(&dir) {
            Ok(count) => println!("Steam answered: {} subscribed Workshop items.", count),
            Err(e) => panic!("Could not reach Steam: {e}"),
        }
    }

    /// Subscribes to one small mod and unsubscribes again, through the Steam client.
    /// PZMS_PZ_DIR=... PZMS_TEST_ITEM=3041733782 cargo test steam_client_subscribes -- --ignored --nocapture
    #[test]
    #[ignore]
    fn steam_client_subscribes_and_undoes_it() {
        let dir = std::env::var("PZMS_PZ_DIR").expect("Set PZMS_PZ_DIR to your Project Zomboid folder.");
        let item = std::env::var("PZMS_TEST_ITEM").unwrap_or_else(|_| "3041733782".to_string());
        let ids = vec![item.clone()];
        println!("Subscribing to {item}: {:?}", set_subscriptions(&dir, &ids, true).unwrap());
        std::thread::sleep(Duration::from_secs(2));
        println!("Unsubscribing again: {:?}", set_subscriptions(&dir, &ids, false).unwrap());
    }
}
