//! What the game's script files define, and who defines the same thing twice.
//!
//! Two mods shipping the same file at the same path is a conflict the Studio has always found,
//! because the game reads only one of the two copies. The quieter conflict is two mods defining
//! the same **thing** in differently named files: `item Base.Axe` in one mod's `items.txt` and
//! again in another's `myitems.txt`. No file collides, nothing is reported anywhere, and the game
//! simply keeps whichever definition was read last. That is how a patch mod is meant to work, and
//! also how two mods silently undo each other.
//!
//! So the scripts are parsed for what they declare. The parser walks braces rather than lines,
//! which is what the game's own parser does: a block's header may sit on the line above its brace,
//! blocks nest (a `craftRecipe` has `inputs` and `outputs`, a `vehicle` has `part`s), and comments
//! can appear anywhere. Nothing is rewritten here; this only reads.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use walkdir::WalkDir;

/// One thing a script file declares: `module Base { item Axe { ... } }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptDef {
    /// The module it is declared in, which is part of its full name (`Base.Axe`). Empty when the
    /// file declares blocks without a module around them.
    pub module: String,
    /// `item`, `recipe`, `craftRecipe`, `fluid`, `vehicle`, `model`, `sound`, anything.
    pub kind: String,
    pub name: String,
    /// The block's body with its whitespace collapsed, so two mods shipping the same definition
    /// are not reported as disagreeing about it.
    pub body: String,
}

/// The `Key = value` lines a block sets directly, with whatever is inside nested blocks left
/// out: those belong to the nested block, not to this one.
pub fn top_level_props(body: &str) -> BTreeMap<String, String> {
    let mut props = BTreeMap::new();
    let mut depth = 0usize;
    let mut statement = String::new();
    let take = |statement: &str, props: &mut BTreeMap<String, String>| {
        if let Some((key, value)) = statement.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            if !key.is_empty() && !key.contains(char::is_whitespace) {
                props.insert(key.to_string(), value.to_string());
            }
        }
    };
    for c in body.chars() {
        match c {
            '{' => {
                depth += 1;
                statement.clear();
            }
            '}' => {
                depth = depth.saturating_sub(1);
                statement.clear();
            }
            // A property ends at its comma. A semicolon does not end anything: it separates the
            // values inside one, as in `XPBoosts = Nimble=2;Sneak=2;Lockpicking=1`, and treating
            // it as an ending cut every such value down to its first entry — which made two mods
            // granting different XP look like they agreed.
            ',' if depth == 0 => {
                take(&statement, &mut props);
                statement.clear();
            }
            _ if depth == 0 => statement.push(c),
            _ => {}
        }
    }
    take(&statement, &mut props);
    props
}

impl ScriptDef {
    /// How the game would name it: `item Base.Axe`.
    pub fn full_name(&self) -> String {
        if self.module.is_empty() {
            format!("{} {}", self.kind, self.name)
        } else {
            format!("{} {}.{}", self.kind, self.module, self.name)
        }
    }
}

/// Removes `/* ... */` and `// ...` comments, keeping the rest of the text as it was.
fn without_comments(text: &str) -> String {
    let bytes: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == '/' && i + 1 < bytes.len() && bytes[i + 1] == '*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == '*' && bytes[i + 1] == '/') {
                // Newlines are kept so a header never swallows the line after a comment.
                if bytes[i] == '\n' {
                    out.push('\n');
                }
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        if bytes[i] == '/' && i + 1 < bytes.len() && bytes[i + 1] == '/' {
            while i < bytes.len() && bytes[i] != '\n' {
                i += 1;
            }
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Everything a script file declares, in the order it declares it.
pub fn parse_script_defs(text: &str) -> Vec<ScriptDef> {
    let clean = without_comments(text);
    let chars: Vec<char> = clean.chars().collect();

    let mut defs = Vec::new();
    // Each open block: its header, and where its body starts.
    let mut stack: Vec<(String, usize)> = Vec::new();
    let mut header = String::new();
    let mut module = String::new();

    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '{' => {
                let head = collapse(&header);
                header.clear();
                if stack.is_empty() && head.split_whitespace().next() == Some("module") {
                    module = head.split_whitespace().nth(1).unwrap_or_default().to_string();
                }
                stack.push((head, i + 1));
            }
            '}' => {
                if let Some((head, body_from)) = stack.pop() {
                    // A definition is a block one level inside a module, or a top-level block in a
                    // file with no module around it. Deeper blocks are parts of the definition.
                    let is_definition = match stack.len() {
                        0 => head.split_whitespace().next() != Some("module"),
                        1 => stack[0].0.split_whitespace().next() == Some("module"),
                        _ => false,
                    };
                    if is_definition {
                        let mut words = head.split_whitespace();
                        let kind = words.next().unwrap_or_default().to_string();
                        let name = words.collect::<Vec<_>>().join(" ");
                        // `imports { Base }` and other nameless blocks declare nothing.
                        if !kind.is_empty() && !name.is_empty() {
                            defs.push(ScriptDef {
                                module: if stack.is_empty() { String::new() } else { module.clone() },
                                kind,
                                name,
                                body: collapse(&chars[body_from..i].iter().collect::<String>()),
                            });
                        }
                    }
                }
                header.clear();
            }
            // A property ends at its comma; what comes after it is the next header.
            ',' | ';' => header.clear(),
            c => header.push(c),
        }
        i += 1;
    }
    defs
}

/// One property two mods set differently on the same thing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashingProperty {
    pub key: String,
    /// What each mod sets it to, in the same order as `mods`; `None` where a mod does not set it.
    pub values: Vec<Option<String>>,
}

/// The same thing declared by more than one active mod, and what they really disagree about.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptDefConflict {
    /// `item Base.Axe`, as the game would name it.
    pub definition: String,
    pub kind: String,
    /// The mods declaring it, in load order: for a clashing property, the last one decides.
    pub mod_ids: Vec<String>,
    pub mods: Vec<String>,
    /// The file each mod declares it in, in the same order.
    pub files: Vec<String>,
    /// Properties more than one of them sets, to different values. Everything else they set is
    /// theirs alone and survives whatever the order.
    pub clashing: Vec<ClashingProperty>,
}

/// Script files the game merges rather than overrides, where declaring the same name twice is
/// how they are meant to work.
fn is_additive(rel_path: &str) -> bool {
    crate::vfs::is_loaded_from_every_mod(rel_path)
}

/// Things declared by two or more active mods with different bodies, in load order. Identical
/// declarations are left out: there is nothing to decide about them.
pub fn script_definition_conflicts(
    catalog: &crate::catalog::ModCatalog,
    active: &[String],
) -> Vec<ScriptDefConflict> {
    let game = catalog.game_version_int();
    // definition -> the mods declaring it, in load order.
    type Declaration = (usize, String, String, String, String, BTreeMap<String, String>);
    let mut by_def: HashMap<String, Vec<Declaration>> = HashMap::new();
    let mut seen_mods = std::collections::HashSet::new();

    for (position, entry) in active.iter().enumerate() {
        if entry.starts_with("Z_PZModStudio_") || entry == "PZModStudioCarrier" {
            continue;
        }
        let Some(m) = catalog.resolve(entry.trim()) else { continue };
        if m.loadability != crate::catalog::Loadability::Loadable || !seen_mods.insert(m.id.clone()) {
            continue;
        }

        // The version folder's copy of a file replaces the mod's own `common/` copy, like the game.
        let mut files: std::collections::BTreeMap<String, std::path::PathBuf> = Default::default();
        for layer in crate::load_order::mod_info::media_layers_for_build(Path::new(&m.root_dir), game) {
            let scripts = layer.join("media").join("scripts");
            for e in WalkDir::new(&scripts).into_iter().filter_map(|e| e.ok()) {
                if !e.file_type().is_file() || !e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("txt")) {
                    continue;
                }
                let Ok(rel) = e.path().strip_prefix(layer.join("media")) else { continue };
                files.insert(
                    format!("media/{}", rel.to_string_lossy().replace('\\', "/")),
                    e.path().to_path_buf(),
                );
            }
        }

        for (rel, abs) in files {
            if is_additive(&rel) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&abs) else { continue };
            for def in parse_script_defs(&text) {
                let props = top_level_props(&def.body);
                by_def.entry(def.full_name()).or_default().push((
                    position,
                    m.id.clone(),
                    m.name.clone(),
                    rel.clone(),
                    def.body,
                    props,
                ));
            }
        }
    }

    let mut out: Vec<ScriptDefConflict> = Vec::new();
    for (definition, mut owners) in by_def {
        // One mod declaring something twice in its own files is its own business.
        owners.dedup_by(|a, b| a.1 == b.1);
        if owners.len() < 2 {
            continue;
        }
        owners.sort_by_key(|o| o.0);

        // The game applies each declaration to the same thing in turn, which is how a mod can
        // ship a three-line `item` block that only adds a model to someone else's item. So what
        // matters is not who declared it last, but which single properties two of them set to
        // different values: those are decided by the order, and nothing else is.
        let mut clashing: Vec<ClashingProperty> = Vec::new();
        let mut keys: Vec<&String> = owners.iter().flat_map(|o| o.5.keys()).collect();
        keys.sort();
        keys.dedup();
        for key in keys {
            let values: Vec<Option<String>> = owners.iter().map(|o| o.5.get(key).cloned()).collect();
            let set: Vec<&String> = values.iter().flatten().collect();
            if set.len() > 1 && set.iter().any(|v| *v != set[0]) {
                clashing.push(ClashingProperty { key: key.clone(), values });
            }
        }

        // Blocks with no properties at all (a recipe's ingredient lines, a model's own nesting)
        // cannot be compared this way: fall back to whether the text differs at all.
        let comparable = owners.iter().any(|o| !o.5.is_empty());
        if clashing.is_empty() {
            let first_body = owners[0].4.clone();
            if comparable || owners.iter().all(|o| o.4 == first_body) {
                continue;
            }
        }

        out.push(ScriptDefConflict {
            kind: definition.split_whitespace().next().unwrap_or_default().to_string(),
            definition,
            mod_ids: owners.iter().map(|o| o.1.clone()).collect(),
            mods: owners.iter().map(|o| o.2.clone()).collect(),
            files: owners.iter().map(|o| o.3.clone()).collect(),
            clashing,
        });
    }
    // Stable and readable: by what is declared.
    out.sort_by(|a, b| a.definition.cmp(&b.definition));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_nested_block_does_not_end_the_definition_around_it() {
        let text = r#"
module Base
{
    craftRecipe MakeAxe
    {
        inputs
        {
            item 1 [Base.AxeHandle],
            item 1 tags[Welder] mode:keep,
        }
        outputs
        {
            item 1 Base.Axe,
        }
        time = 100,
    }

    item Axe
    {
        DisplayName = Axe,
        Weight = 3,
    }
}
"#;
        let defs = parse_script_defs(text);
        let names: Vec<String> = defs.iter().map(|d| d.full_name()).collect();
        assert_eq!(names, vec!["craftRecipe Base.MakeAxe", "item Base.Axe"]);
        // The whole recipe came back, inputs and outputs included.
        assert!(defs[0].body.contains("Base.AxeHandle") && defs[0].body.contains("time = 100"));
    }

    #[test]
    fn comments_and_braces_on_their_own_line_are_read_the_way_the_game_reads_them() {
        let text = r#"
/* a header comment { with a brace in it } */
module Vehicles {
    // the car
    vehicle Van
    {
        mechanicType = 2,
        part Engine
        {
            category = engine,
        }
    }
}
"#;
        let defs = parse_script_defs(text);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].full_name(), "vehicle Vehicles.Van");
        assert!(defs[0].body.contains("part Engine"));
    }

    #[test]
    fn a_template_keeps_its_whole_header_so_two_templates_are_told_apart() {
        let text = "module Base { template item Clothing { Type = Clothing, } }";
        let defs = parse_script_defs(text);
        assert_eq!(defs[0].kind, "template");
        assert_eq!(defs[0].name, "item Clothing");
        assert_eq!(defs[0].full_name(), "template Base.item Clothing");
    }

    #[test]
    fn nameless_blocks_declare_nothing() {
        let text = "module Base { imports { Base } item Axe { Weight = 3, } }";
        let defs = parse_script_defs(text);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "Axe");
    }

    #[test]
    fn a_file_without_a_module_still_declares_its_blocks() {
        let text = "item Axe { Weight = 3, }\nitem Saw { Weight = 1, }";
        let defs = parse_script_defs(text);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].module, "");
        assert_eq!(defs[0].full_name(), "item Axe");
    }

    #[test]
    fn whitespace_does_not_make_two_mods_disagree() {
        let a = parse_script_defs("module Base { item Axe { Weight = 3, } }");
        let b = parse_script_defs("module Base\n{\n\titem Axe\n\t{\n\t\tWeight = 3,\n\t}\n}");
        assert_eq!(a[0].body, b[0].body);
    }

    /// Reads every script of the installed game and reports what it found.
    /// PZMS_PZ_DIR=... cargo test every_vanilla_script -- --ignored --nocapture
    #[test]
    #[ignore]
    fn every_vanilla_script_parses() {
        let Ok(pz) = std::env::var("PZMS_PZ_DIR") else { return };
        let scripts = Path::new(&pz).join("media").join("scripts");
        let mut files = 0;
        let mut defs = 0;
        let mut kinds: std::collections::BTreeMap<String, usize> = Default::default();
        let mut empty_files: Vec<String> = Vec::new();
        for e in WalkDir::new(&scripts).into_iter().filter_map(|e| e.ok()) {
            if !e.file_type().is_file() || !e.path().extension().is_some_and(|x| x == "txt") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            if text.trim().is_empty() {
                continue;
            }
            files += 1;
            let found = parse_script_defs(&text);
            if found.is_empty() {
                empty_files.push(e.path().display().to_string());
            }
            defs += found.len();
            for d in found {
                *kinds.entry(d.kind).or_default() += 1;
            }
        }
        println!("{} files, {} definitions", files, defs);
        for (kind, n) in &kinds {
            println!("  {:>6}  {}", n, kind);
        }
        println!("files with nothing in them: {}", empty_files.len());
        for f in empty_files.iter().take(20) {
            println!("  {}", f);
        }
        assert!(defs > 1000, "the game ships far more than this");
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// What a real mod list declares twice, and how long it takes to find out.
    /// PZMS_PZ_DIR=... PZMS_WORKSHOP_DIR=... PZMS_ZOMBOID_DIR=...
    /// cargo test --release the_same_thing_defined_twice -- --ignored --nocapture
    #[test]
    #[ignore]
    fn the_same_thing_defined_twice() {
        let (Ok(pz), Ok(workshop), Ok(zomboid)) = (
            std::env::var("PZMS_PZ_DIR"),
            std::env::var("PZMS_WORKSHOP_DIR"),
            std::env::var("PZMS_ZOMBOID_DIR"),
        ) else {
            return;
        };
        let paths = crate::vfs::StudioPaths {
            pz_install_dir: pz,
            workshop_dir: workshop.clone(),
            mod_list_ini_path: format!("{}/mods/default.txt", zomboid),
            user_zomboid_dir: zomboid.clone(),
            carrier_workshop_id: None,
            is_valid: true,
        };
        let active = crate::load_order::ini_parser::read_mod_list_ini(&paths.mod_list_ini_path)
            .map(|d| d.active_mods)
            .unwrap_or_default();
        let started = std::time::Instant::now();
        let catalog = crate::catalog::build_catalog(&workshop, &zomboid, None);
        let built = started.elapsed();
        let scanning = std::time::Instant::now();
        let conflicts = script_definition_conflicts(&catalog, &active);
        println!(
            "{} active mods: catalog in {:?}, scripts in {:?}, {} definitions declared twice",
            active.len(),
            built,
            scanning.elapsed(),
            conflicts.len()
        );
        for c in conflicts.iter().take(25) {
            println!("  {} <- {}", c.definition, c.mods.join(" , "));
        }
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;

    #[test]
    fn a_semicolon_separates_values_inside_a_property_and_does_not_end_it() {
        let props = top_level_props(
            "CharacterProfession = base:burglar, XPBoosts = Nimble=2;Sneak=2;Lockpicking=1, Cost = -6,",
        );
        assert_eq!(props.get("XPBoosts").map(String::as_str), Some("Nimble=2;Sneak=2;Lockpicking=1"));
        assert_eq!(props.get("Cost").map(String::as_str), Some("-6"));
        // Two professions granting different XP must not look the same.
        let other = top_level_props("XPBoosts = Nimble=2;Sneak=2,");
        assert_ne!(props.get("XPBoosts"), other.get("XPBoosts"));
    }

    #[test]
    fn what_a_nested_block_sets_belongs_to_the_nested_block() {
        let props = top_level_props(
            "mechanicType = 2, part Engine { category = engine, Weight = 9, } DisplayName = Van,",
        );
        assert_eq!(props.len(), 2, "{:?}", props);
        assert!(props.contains_key("mechanicType") && props.contains_key("DisplayName"));
        assert!(!props.contains_key("category"));
    }
}
