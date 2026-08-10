use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptBlock {
    pub block_type: String, // "item", "recipe", "fluid", "vehicle"
    pub block_id: String,   // "BaseballBat"
    pub properties: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PzScriptMergeResult {
    pub merged_script: String,
    pub merged_blocks_count: usize,
}

/// Parses a PZ data script (.txt) or sandbox-options.txt into structured blocks and merges properties.
pub fn merge_pz_data_scripts(base: &str, mod_a: &str, mod_b: &str) -> PzScriptMergeResult {
    // If this is sandbox-options.txt or contains sandbox option definitions, use dedicated sandbox options merger!
    if base.contains("option ") || mod_a.contains("option ") || mod_b.contains("option ") || base.contains("VERSION =") {
        let merged = merge_sandbox_options(base, &[mod_a, mod_b]);
        let opt_count = merged.matches("option ").count();
        return PzScriptMergeResult {
            merged_script: merged,
            merged_blocks_count: opt_count,
        };
    }

    let base_blocks = parse_script_blocks(base);
    let a_blocks = parse_script_blocks(mod_a);
    let b_blocks = parse_script_blocks(mod_b);

    let mut merged_blocks: BTreeMap<String, ScriptBlock> = base_blocks;

    // Apply Mod A overrides
    for (id, block) in a_blocks {
        let entry = merged_blocks.entry(id).or_insert(block.clone());
        for (k, v) in block.properties {
            entry.properties.insert(k, v);
        }
    }

    // Apply Mod B overrides
    for (id, block) in b_blocks {
        let entry = merged_blocks.entry(id).or_insert(block.clone());
        for (k, v) in block.properties {
            entry.properties.insert(k, v);
        }
    }

    let mut output = String::from("module Base {\n");
    let count = merged_blocks.len();

    for block in merged_blocks.values() {
        output.push_str(&format!("    {} {} {{\n", block.block_type, block.block_id));
        for (key, val) in &block.properties {
            output.push_str(&format!("        {} = {},\n", key, val));
        }
        output.push_str("    }\n");
    }

    output.push_str("}\n");

    PzScriptMergeResult {
        merged_script: output,
        merged_blocks_count: count,
    }
}

pub fn merge_sandbox_options(base: &str, mods: &[&str]) -> String {
    let mut merged_options: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();

    let parse_options = |content: &str| -> BTreeMap<String, BTreeMap<String, String>> {
        let mut map = BTreeMap::new();
        let mut current_opt = String::new();
        let mut current_props = BTreeMap::new();
        let mut inside = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("option ") {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    current_opt = parts[1].replace('{', "").trim().to_string();
                    current_props.clear();
                    inside = true;
                }
            } else if trimmed == "}" && inside {
                if !current_opt.is_empty() {
                    map.insert(current_opt.clone(), current_props.clone());
                }
                inside = false;
            } else if inside && trimmed.contains('=') {
                let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
                if parts.len() == 2 {
                    let key = parts[0].trim().to_string();
                    let val = parts[1].trim().trim_matches(',').to_string();
                    current_props.insert(key, val);
                }
            }
        }
        map
    };

    for content in std::iter::once(&base).chain(mods.iter()) {
        let options = parse_options(content);
        for (opt_name, props) in options {
            let entry = merged_options.entry(opt_name).or_default();
            for (k, v) in props {
                entry.insert(k, v);
            }
        }
    }

    let mut output = String::from("VERSION = 1,\n\n");
    for (opt_name, props) in &merged_options {
        output.push_str(&format!("option {}\n{{\n", opt_name));
        for (key, val) in props {
            output.push_str(&format!("    {} = {},\n", key, val));
        }
        output.push_str("}\n\n");
    }

    output
}

fn parse_script_blocks(content: &str) -> BTreeMap<String, ScriptBlock> {
    let mut map = BTreeMap::new();
    let mut current_block_type = String::new();
    let mut current_block_id = String::new();
    let mut current_props = BTreeMap::new();
    let mut inside_block = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("item ") || trimmed.starts_with("recipe ") || trimmed.starts_with("fluid ") || trimmed.starts_with("vehicle ") || trimmed.starts_with("option ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                current_block_type = parts[0].to_string();
                current_block_id = parts[1].replace('{', "").trim().to_string();
                current_props.clear();
                inside_block = true;
            }
        } else if trimmed == "}" && inside_block {
            map.insert(
                format!("{}:{}", current_block_type, current_block_id),
                ScriptBlock {
                    block_type: current_block_type.clone(),
                    block_id: current_block_id.clone(),
                    properties: current_props.clone(),
                },
            );
            inside_block = false;
        } else if inside_block && trimmed.contains('=') {
            let parts: Vec<&str> = trimmed.split('=').collect();
            if parts.len() == 2 {
                let key = parts[0].trim().to_string();
                let val = parts[1].trim().trim_matches(',').to_string();
                current_props.insert(key, val);
            }
        }
    }

    map
}
