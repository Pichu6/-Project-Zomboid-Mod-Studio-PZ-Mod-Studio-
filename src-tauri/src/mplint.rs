//! The multiplayer check: what a mod's client code does directly that the game, in
//! multiplayer, only does on the server.
//!
//! The facts come from the game's own Lua (42.21): where client code would change the world, a
//! vehicle, an animal or the map, it does `if isClient() then sendClientCommand(...) else <do
//! it> end`, and `media/lua/server/ClientCommands.lua` and `Vehicles/VehicleCommands.lua` hold
//! the server's side — one handler per command, each calling the Java methods that do the work.
//! Those methods, called straight from a mod's client or shared Lua with no `isClient()` branch
//! around them, change only that client's copy of the world in multiplayer, or are refused.
//! Each rule names the handler, so every finding can be checked against the game's code.
//!
//! What the check does not claim: a player's own inventory (the engine syncs it), timed actions
//! (`forceComplete` and the like run under `isServer()` by design), and anything whose method
//! name is too plain to mean one thing (`rotate`, `remove`, `set`, `setCustomName` — items have
//! one too), nor the `transmit*` primitives, which multiplayer-aware mods call on purpose, nor
//! fluids and `setExplored`, which the engine syncs for items and the UI sets freely. Tried on
//! 113 real mods (2026-10-18): those were the noise. A file that mentions
//! `isClient()` or `sendClientCommand` anywhere is marked "aware": its author knows about
//! multiplayer, and the finding is a note, not a warning.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// One method the server does for the client in multiplayer.
pub struct Rule {
    /// `:method(` as it appears in Lua.
    pub method: &'static str,
    /// What it is about, for the reader.
    pub what: &'static str,
    /// The server handler that does it: `Commands.object.removeBush`.
    pub handler: &'static str,
    /// The file the handler lives in, under media/lua.
    pub file: &'static str,
}

const CC: &str = "server/ClientCommands.lua";
const VC: &str = "server/Vehicles/VehicleCommands.lua";

/// Read from the two handler files of 42.21; only methods whose name means one thing.
pub const RULES: &[Rule] = &[
    // The world
    Rule { method: "removeErosionObject", what: "removing a bush or erosion object", handler: "Commands.object.removeBush", file: CC },
    Rule { method: "toggleCurtain", what: "opening or closing a curtain", handler: "Commands.object.openCloseCurtain", file: CC },
    Rule { method: "setUsesExternalWaterSource", what: "plumbing an object", handler: "Commands.object.plumbObject", file: CC },
    Rule { method: "setExplosionTimer", what: "setting a bomb's timer", handler: "Commands.object.setBombTimer", file: CC },
    Rule { method: "setFuelAmount", what: "fuelling a fireplace or barbecue", handler: "Commands.fireplace.setFuel / Commands.bbq.setFuel", file: CC },
    Rule { method: "setMaxTemperature", what: "setting a stove", handler: "Commands.stove.setOvenParamsAndToggle", file: CC },
    Rule { method: "becomeCorpseItem", what: "turning a body into an item", handler: "Commands.deadBody.addBody", file: CC },
    Rule { method: "triggerThunderEvent", what: "triggering thunder", handler: "Commands.event.thunder", file: CC },
    Rule { method: "disableErosion", what: "disabling erosion on a square", handler: "Commands.erosion.disableForSquare", file: CC },
    // The player
    Rule { method: "setKnownInSquares", what: "revealing map", handler: "Commands.map.setKnownInSquares", file: CC },
    // Animals
    Rule { method: "killAnimal", what: "killing an animal", handler: "Commands.animal.kill", file: CC },
    Rule { method: "setWoolQuantity", what: "an animal's wool", handler: "Commands.animal.setWool", file: CC },
    Rule { method: "setMilkQuantity", what: "an animal's milk", handler: "Commands.animal.setMilk", file: CC },
    Rule { method: "setPregnant", what: "an animal's pregnancy", handler: "Commands.animal.pregnant", file: CC },
    Rule { method: "setFertilized", what: "an animal's fertilisation", handler: "Commands.animal.fertilized", file: CC },
    Rule { method: "addAnimalInside", what: "putting an animal in a hutch", handler: "Commands.animal.hutch", file: CC },
    Rule { method: "setHutchDirt", what: "a hutch's dirt", handler: "Commands.hutch.dirt", file: CC },
    // Vehicles
    Rule { method: "tryStartEngine", what: "starting a vehicle's engine", handler: "Commands.startEngine", file: VC },
    Rule { method: "setHeadlightsOn", what: "a vehicle's headlights", handler: "Commands.setHeadlightsOn", file: VC },
    Rule { method: "setStoplightsOn", what: "a vehicle's stop lights", handler: "Commands.setStoplightsOn", file: VC },
    Rule { method: "setTrunkLocked", what: "a vehicle's trunk lock", handler: "Commands.setTrunkLocked", file: VC },
    Rule { method: "setTireInflation", what: "a tire's pressure", handler: "Commands.setTirePressure", file: VC },
    Rule { method: "setLightbarLightsMode", what: "a lightbar's lights", handler: "Commands.setLightbarLightsMode", file: VC },
    Rule { method: "setLightbarSirenMode", what: "a lightbar's siren", handler: "Commands.setLightbarSirenMode", file: VC },
    Rule { method: "putKeyInIgnition", what: "a vehicle key in the ignition", handler: "Commands.putKeyInIgnition", file: VC },
    Rule { method: "removeKeyFromIgnition", what: "a vehicle key out of the ignition", handler: "Commands.removeKeyFromIgnition", file: VC },
    Rule { method: "putKeyOnDoor", what: "a vehicle key on the door", handler: "Commands.putKeyOnDoor", file: VC },
    Rule { method: "removeKeyFromDoor", what: "a vehicle key off the door", handler: "Commands.removeKeyFromDoor", file: VC },
    Rule { method: "createVehicleKey", what: "making a vehicle key", handler: "Commands.getKey", file: VC },
    Rule { method: "permanentlyRemove", what: "removing a vehicle", handler: "Commands.remove", file: VC },
    Rule { method: "setBloodIntensity", what: "blood on a vehicle", handler: "Commands.setBloodIntensity", file: VC },
    Rule { method: "setRust", what: "rust on a vehicle", handler: "Commands.setRust", file: VC },
    Rule { method: "setColorHSV", what: "a vehicle's colour", handler: "Commands.setHSV", file: VC },
    Rule { method: "setSkinIndex", what: "a vehicle's skin", handler: "Commands.setSkinIndex", file: VC },
    Rule { method: "setAlarmed", what: "a vehicle's alarm", handler: "Commands.setAlarmed", file: VC },
    Rule { method: "addPointConstraint", what: "attaching a trailer", handler: "Commands.attachTrailer", file: VC },
    Rule { method: "breakConstraint", what: "detaching a trailer", handler: "Commands.detachTrailer", file: VC },
    Rule { method: "cheatHotwire", what: "hotwiring a vehicle", handler: "Commands.cheatHotwire", file: VC },
    Rule { method: "setFocusingUp", what: "a headlight's focus", handler: "Commands.configHeadlight", file: VC },
    Rule { method: "damageObjects", what: "a vehicle damaging objects", handler: "Commands.damageObjects", file: VC },
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MpFinding {
    /// From the mod's root, with forward slashes.
    pub path: String,
    pub line: u32,
    pub method: String,
    pub what: String,
    pub handler: String,
    /// The game file with the handler, under media/lua.
    pub evidence: String,
    /// The line as written, trimmed.
    pub snippet: String,
    /// The call sits in an `if` that mentions isClient/isServer: the author handles multiplayer there.
    pub guarded: bool,
    /// The file mentions isClient() or sendClientCommand somewhere: the author knows about multiplayer.
    pub aware: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MpReport {
    pub root: String,
    pub files_checked: usize,
    /// The mod ships server-side Lua (media/lua/server), where these calls are right.
    pub has_server_lua: bool,
    pub findings: Vec<MpFinding>,
}

fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with("--")
}

/// Whether the nearest enclosing `if`/`elseif` (by indentation, looking up) mentions the
/// multiplayer checks. Lua has no fixed indentation, so this is the shape of the game's own
/// code and of most mods, not a parse.
fn guarded_by_mp_check(lines: &[&str], at: usize) -> bool {
    let indent = |l: &str| l.len() - l.trim_start().len();
    let my = indent(lines[at]);
    let mut i = at;
    while i > 0 {
        i -= 1;
        let l = lines[i];
        if l.trim().is_empty() || is_comment(l) {
            continue;
        }
        if indent(l) < my {
            let t = l.trim_start();
            if t.starts_with("if ") || t.starts_with("elseif ") {
                return t.contains("isClient()") || t.contains("isServer()");
            }
            if t.starts_with("else") {
                // The else of an `if isClient()`: find that if.
                let else_indent = indent(l);
                let mut k = i;
                while k > 0 {
                    k -= 1;
                    let lk = lines[k];
                    if !lk.trim().is_empty() && indent(lk) == else_indent && lk.trim_start().starts_with("if ") {
                        return lk.contains("isClient()") || lk.contains("isServer()");
                    }
                }
                return false;
            }
            if t.starts_with("function") || t.starts_with("local function") || t.starts_with("end") {
                return false;
            }
        }
    }
    false
}

/// Checks one Lua file's text; `path` is only carried into the findings.
pub fn check_text(path: &str, text: &str) -> Vec<MpFinding> {
    let lines: Vec<&str> = text.lines().collect();
    let aware = text.contains("isClient()") || text.contains("sendClientCommand") || text.contains("isServer()");
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if is_comment(line) {
            continue;
        }
        for rule in RULES {
            let needle = format!(":{}(", rule.method);
            if !line.contains(&needle) {
                continue;
            }
            out.push(MpFinding {
                path: path.to_string(),
                line: (i + 1) as u32,
                method: rule.method.to_string(),
                what: rule.what.to_string(),
                handler: rule.handler.to_string(),
                evidence: rule.file.to_string(),
                snippet: line.trim().chars().take(160).collect(),
                guarded: guarded_by_mp_check(&lines, i),
                aware,
            });
        }
    }
    out
}

/// Every client and shared Lua file of the mod (server Lua is where these calls belong, so it
/// is only noted), checked.
pub fn check_mod(root: &Path) -> Result<MpReport, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder.", root.display()));
    }
    let mut report = MpReport { root: root.to_string_lossy().to_string(), ..Default::default() };
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || !path.extension().map(|e| e.eq_ignore_ascii_case("lua")).unwrap_or(false) {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        let lower = rel.to_lowercase();
        if lower.contains("/media/lua/server/") || lower.starts_with("media/lua/server/") {
            report.has_server_lua = true;
            continue;
        }
        if !(lower.contains("/media/lua/client/") || lower.starts_with("media/lua/client/") || lower.contains("/media/lua/shared/") || lower.starts_with("media/lua/shared/")) {
            continue;
        }
        report.files_checked += 1;
        if let Ok(text) = std::fs::read_to_string(path) {
            report.findings.extend(check_text(&rel, &text));
        }
    }
    report.findings.sort_by(|a, b| (a.guarded, &a.path, a.line).cmp(&(b.guarded, &b.path, b.line)));
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_direct_world_change_is_found_and_the_guarded_one_is_marked() {
        // Indentation matters to the guard check, so the lines are joined, not continued.
        let text = [
            "local function burn(square)",
            "    square:getObjects():get(0):setFuelAmount(10)",
            "end",
            "local function burnMp(square)",
            "    if isClient() then",
            "        sendClientCommand(getPlayer(), 'fireplace', 'setFuel', {})",
            "    else",
            "        square:getObjects():get(0):setFuelAmount(10)",
            "    end",
            "end",
            "-- vehicle:setHeadlightsOn(true) in a comment",
        ]
        .join("\n");
        let text = text.as_str();
        let f = check_text("media/lua/client/x.lua", text);
        assert_eq!(f.len(), 2, "{:#?}", f);
        assert_eq!((f[0].line, f[0].guarded, f[0].aware), (2, false, true));
        assert_eq!((f[1].line, f[1].guarded), (8, true));
        assert_eq!(f[0].handler, "Commands.fireplace.setFuel / Commands.bbq.setFuel");
        let blind = check_text("x.lua", "car:setHeadlightsOn(true)\n");
        assert!(!blind[0].aware && !blind[0].guarded);
    }

    #[test]
    fn server_lua_is_skipped_and_only_client_and_shared_are_checked() {
        let dir = std::env::temp_dir().join(format!("pzms-mplint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for d in ["42/media/lua/client", "42/media/lua/server", "42/media/lua/shared"] {
            std::fs::create_dir_all(dir.join(d)).unwrap();
        }
        std::fs::write(dir.join("42/media/lua/client/a.lua"), "v:setRust(1)\n").unwrap();
        std::fs::write(dir.join("42/media/lua/server/b.lua"), "v:setRust(1)\n").unwrap();
        std::fs::write(dir.join("42/media/lua/shared/c.lua"), "local x = 1\n").unwrap();
        let r = check_mod(&dir).unwrap();
        assert_eq!(r.files_checked, 2);
        assert!(r.has_server_lua);
        assert_eq!(r.findings.len(), 1);
        assert_eq!(r.findings[0].path, "42/media/lua/client/a.lua");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_rule_names_a_handler_in_one_of_the_two_files() {
        for r in RULES {
            assert!(r.handler.starts_with("Commands."), "{}", r.handler);
            assert!(r.file == CC || r.file == VC);
            assert!(r.method.len() > 6, "a short name would match too much: {}", r.method);
        }
    }
}
