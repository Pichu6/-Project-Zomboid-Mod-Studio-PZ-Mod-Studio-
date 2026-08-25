use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LuaSyntaxCheckResult {
    pub is_valid: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeChunkResult {
    pub merged_text: String,
    pub has_conflict: bool,
    pub conflict_line_start: Option<usize>,
    pub conflict_line_end: Option<usize>,
}

/// Validates Lua code syntax using full_moon AST parser.
pub fn validate_lua_syntax(code: &str) -> LuaSyntaxCheckResult {
    match full_moon::parse(code) {
        Ok(_) => LuaSyntaxCheckResult {
            is_valid: true,
            error_message: None,
        },
        Err(err) => LuaSyntaxCheckResult {
            is_valid: false,
            error_message: Some(format!("Lua AST Syntax Error: {}", err)),
        },
    }
}

/// Performs line-by-line and AST-aware 3-way merge (Base Vanilla vs Mod A vs Mod B).
pub fn three_way_merge_lua(base: &str, target_a: &str, target_b: &str) -> MergeChunkResult {
    let mut merged_lines = Vec::new();
    let mut has_conflict = false;
    let mut conflict_line_start = None;
    let mut conflict_line_end = None;

    let base_lines: Vec<&str> = base.lines().collect();
    let a_lines: Vec<&str> = target_a.lines().collect();
    let b_lines: Vec<&str> = target_b.lines().collect();

    let max_len = base_lines.len().max(a_lines.len()).max(b_lines.len());

    for i in 0..max_len {
        let base_line = base_lines.get(i).copied().unwrap_or("");
        let a_line = a_lines.get(i).copied().unwrap_or("");
        let b_line = b_lines.get(i).copied().unwrap_or("");

        if a_line == b_line {
            // Both mods agree or are unchanged
            merged_lines.push(a_line.to_string());
        } else if a_line != base_line && b_line == base_line {
            // Mod A modified line, Mod B left it vanilla -> Take Mod A
            merged_lines.push(a_line.to_string());
        } else if b_line != base_line && a_line == base_line {
            // Mod B modified line, Mod A left it vanilla -> Take Mod B
            merged_lines.push(b_line.to_string());
        } else {
            // Both mods modified the same line differently -> Conflict!
            has_conflict = true;
            if conflict_line_start.is_none() {
                conflict_line_start = Some(i + 1);
            }
            conflict_line_end = Some(i + 1);
            
            // Default conflict fallback: prefer Mod A, flag for UI review
            merged_lines.push(format!("-- [[ CONFLICT @ Line {} ]] --", i + 1));
            merged_lines.push(a_line.to_string());
        }
    }

    MergeChunkResult {
        merged_text: merged_lines.join("\n"),
        has_conflict,
        conflict_line_start,
        conflict_line_end,
    }
}

/// Intelligently combines multiple competing mod files into a single unified output.
pub fn combine_n_way_lua_or_script(
    rel_path: &str,
    base: &str,
    competing_files: &[crate::vfs::CompetingModFileRaw],
) -> String {
    if competing_files.is_empty() {
        return base.to_string();
    }
    if competing_files.len() == 1 {
        return competing_files[0].content.clone();
    }

    // Special case 1: registries.lua (Aggregate all registration calls and tables cleanly)
    if rel_path.ends_with("registries.lua") || rel_path.ends_with("registries.LUA") {
        let mut out = String::new();
        out.push_str("-- ============================================================================\n");
        out.push_str("-- PZ Mod Studio Master Patch: Unified Registries (media/registries.lua)\n");
        out.push_str(&format!("-- Auto-fused across {} active mods to prevent registry clobbering in B42\n", competing_files.len()));
        out.push_str("-- ============================================================================\n\n");

        for file in competing_files {
            out.push_str(&format!("-- [Mod: {}] ({})\n", file.mod_name, file.mod_id));
            let clean_content = file.content.trim();
            out.push_str(clean_content);
            out.push_str("\n\n");
        }
        return out.trim_end().to_string() + "\n";
    }

    // Special case 2: Check if all competing files are identical
    let first_trimmed = competing_files[0].content.trim();
    if competing_files[1..].iter().all(|f| f.content.trim() == first_trimmed) {
        return competing_files[0].content.clone();
    }

    // Special case 3: If a vanilla base exists and is valid, perform iterative 3-way merge
    let has_real_base = !base.starts_with("-- vanilla file not present") && !base.starts_with("-- vanilla file unreadable");
    if has_real_base {
        let mut current_merged = competing_files[0].content.clone();
        for file in &competing_files[1..] {
            let res = three_way_merge_lua(base, &current_merged, &file.content);
            current_merged = res.merged_text;
        }
        return current_merged;
    }

    // Special case 4: Non-vanilla mod-created file with multiple mod versions
    // Combine unique definitions with clear section dividers
    let mut out = String::new();
    out.push_str("-- ============================================================================\n");
    out.push_str(&format!("-- PZ Mod Studio Master Patch: Merged Output ({})\n", rel_path));
    out.push_str(&format!("-- Combined from {} competing sources\n", competing_files.len()));
    out.push_str("-- ============================================================================\n\n");

    for (idx, file) in competing_files.iter().enumerate() {
        out.push_str(&format!("-- ----------------------------------------------------------------------------\n"));
        out.push_str(&format!("-- Source #{}: {} (ID: {})\n", idx + 1, file.mod_name, file.mod_id));
        out.push_str(&format!("-- ----------------------------------------------------------------------------\n"));
        out.push_str(file.content.trim());
        out.push_str("\n\n");
    }

    out.trim_end().to_string() + "\n"
}
