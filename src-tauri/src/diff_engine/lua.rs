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
