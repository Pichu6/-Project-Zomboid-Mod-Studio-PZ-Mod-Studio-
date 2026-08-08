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

/// Parses a PZ data script (.txt) into structured blocks and merges properties from Base, Mod A, and Mod B.
pub fn merge_pz_data_scripts(base: &str, mod_a: &str, mod_b: &str) -> PzScriptMergeResult {
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

fn parse_script_blocks(content: &str) -> BTreeMap<String, ScriptBlock> {
    let mut map = BTreeMap::new();
    let mut current_block_type = String::new();
    let mut current_block_id = String::new();
    let mut current_props = BTreeMap::new();
    let mut inside_block = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("item ") || trimmed.starts_with("recipe ") || trimmed.starts_with("fluid ") || trimmed.starts_with("vehicle ") {
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
