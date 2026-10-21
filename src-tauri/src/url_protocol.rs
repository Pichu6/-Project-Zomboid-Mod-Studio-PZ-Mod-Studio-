//! `pzmodstudio://` opens the Studio. The game's Lua can open a URL and nothing else, so the
//! Link's "Open PZ Mod Studio" asks Windows for this one when the app is closed (when it runs,
//! the Link asks it through its request file instead). Registered for this Windows user only
//! (`HKCU\Software\Classes\pzmodstudio`), pointing at the exe that runs now, so moving the
//! portable folder is followed the next time it opens.

pub const SCHEME: &str = "pzmodstudio";

/// The registry values: (key under HKCU, value name, data). An empty name is the key's default.
pub fn entries(exe: &str) -> Vec<(String, String, String)> {
    let root = format!("Software\\Classes\\{}", SCHEME);
    vec![
        (root.clone(), String::new(), "URL:PZ Mod Studio".to_string()),
        (root.clone(), "URL Protocol".to_string(), String::new()),
        (format!("{}\\DefaultIcon", root), String::new(), format!("\"{}\",0", exe)),
        (format!("{}\\shell\\open\\command", root), String::new(), format!("\"{}\" \"%1\"", exe)),
    ]
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn set(key: &str, name: &str, data: &str) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_SZ};
    let mut handle: HKEY = std::ptr::null_mut();
    let k = wide(key);
    let status = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, k.as_ptr(), &mut handle) };
    if status != 0 {
        return Err(format!("could not open HKCU\\{} ({})", key, status));
    }
    let n = wide(name);
    let d = wide(data);
    let status = unsafe { RegSetValueExW(handle, if name.is_empty() { std::ptr::null() } else { n.as_ptr() }, 0, REG_SZ, d.as_ptr() as *const u8, (d.len() * 2) as u32) };
    unsafe { RegCloseKey(handle) };
    if status != 0 {
        return Err(format!("could not write HKCU\\{} ({})", key, status));
    }
    Ok(())
}

/// Points `pzmodstudio://` at this exe. Development builds leave it alone (it would point at a
/// build folder), and so do tests.
pub fn register() {
    if cfg!(debug_assertions) || cfg!(test) {
        return;
    }
    #[cfg(windows)]
    {
        let Ok(exe) = std::env::current_exe() else { return };
        let exe = exe.to_string_lossy().to_string();
        for (key, name, data) in entries(&exe) {
            if let Err(e) = set(&key, &name, &data) {
                crate::diagnostics::error(format!("[Link] pzmodstudio:// was not registered: {}", e));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_protocol_opens_this_exe_with_the_url() {
        let e = entries("C:\\PZ\\Project-Zomboid-Mod-Studio.exe");
        assert_eq!(e[0].0, "Software\\Classes\\pzmodstudio");
        assert!(e.iter().any(|(_, name, _)| name == "URL Protocol"));
        assert_eq!(e[3], ("Software\\Classes\\pzmodstudio\\shell\\open\\command".to_string(), String::new(), "\"C:\\PZ\\Project-Zomboid-Mod-Studio.exe\" \"%1\"".to_string()));
    }
}
