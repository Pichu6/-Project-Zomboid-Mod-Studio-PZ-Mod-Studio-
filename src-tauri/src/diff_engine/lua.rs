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
/// Rewrites what Kahlua (the game's Lua) accepts but standard Lua 5.1 parsers reject, so syntax
/// checks agree with the game. Used for validation only, never for files written to disk:
/// - lone `\r` line endings (old Mac style; vanilla EditVehicleState.lua uses them),
/// - Java-style number suffixes like `0.0f` / `1d` (Kahlua parses numbers with Java's
///   Double.parseDouble, which accepts them; vanilla ISFluidEmptyAction.lua uses `0.0f`).
fn normalize_for_kahlua(code: &str) -> String {
    let code = code.replace("\r\n", "\n").replace('\r', "\n");
    let chars: Vec<char> = code.chars().collect();
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut out = String::with_capacity(code.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let starts_number = c.is_ascii_digit() && (i == 0 || !is_ident(chars[i - 1]));
        if !starts_number {
            out.push(c);
            i += 1;
            continue;
        }
        let start = i;
        if c == '0' && chars.get(i + 1).is_some_and(|x| *x == 'x' || *x == 'X') {
            // Hex literal: copied as is (f/d are hex digits there).
            i += 2;
            while i < chars.len() && chars[i].is_ascii_hexdigit() {
                i += 1;
            }
        } else {
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                i += 1;
                if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
                    i += 1;
                }
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
        }
        out.extend(&chars[start..i]);
        let suffix = chars.get(i).is_some_and(|x| matches!(x, 'f' | 'F' | 'd' | 'D'));
        if suffix && !chars.get(i + 1).is_some_and(|x| is_ident(*x)) {
            i += 1; // drop the Java suffix
        }
    }
    out
}

pub fn validate_lua_syntax(code: &str) -> LuaSyntaxCheckResult {
    // full_moon parses recursively; deeply nested real-world files (huge tables, long
    // concatenation chains) overflow a normal thread stack, and a stack overflow aborts the
    // whole app. Parse on a thread with a large stack instead.
    const PARSER_STACK: usize = 256 * 1024 * 1024;
    let owned = normalize_for_kahlua(code);
    let parsed = std::thread::Builder::new()
        .name("lua-parse".into())
        .stack_size(PARSER_STACK)
        .spawn(move || full_moon::parse(&owned).map(|_| ()))
        .map_err(|e| format!("could not start the Lua parser: {}", e))
        .and_then(|handle| handle.join().map_err(|_| "the Lua parser crashed".to_string()));
    let parsed = match parsed {
        Ok(result) => result,
        Err(msg) => {
            return LuaSyntaxCheckResult { is_valid: false, error_message: Some(msg) };
        }
    };
    match parsed {
        Ok(_) => LuaSyntaxCheckResult {
            is_valid: true,
            error_message: None,
        },
        Err(err) => LuaSyntaxCheckResult {
            is_valid: false,
            error_message: Some(format!(
                "Lua AST Syntax Error: {}",
                err.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; ")
            )),
        },
    }
}

/// One side's change relative to the base: base lines `start..end` become `lines`
/// (an insertion has `start == end`, a deletion has no `lines`).
#[derive(Debug, Clone)]
struct Hunk<'a> {
    start: usize,
    end: usize,
    lines: Vec<&'a str>,
}

/// Changes needed to turn `base` into `other`, as non-overlapping hunks sorted by position.
fn diff_hunks<'a>(base: &[&'a str], other: &[&'a str]) -> Vec<Hunk<'a>> {
    let mut hunks: Vec<Hunk<'a>> = Vec::new();
    for op in similar::capture_diff_slices(similar::Algorithm::Patience, base, other) {
        let (tag, old, new) = op.as_tag_tuple();
        if tag == similar::DiffTag::Equal {
            continue;
        }
        match hunks.last_mut() {
            // A delete directly followed by an insert is one replacement.
            Some(last) if last.end == old.start => {
                last.end = old.end;
                last.lines.extend_from_slice(&other[new]);
            }
            _ => hunks.push(Hunk { start: old.start, end: old.end, lines: other[new].to_vec() }),
        }
    }
    hunks
}

/// The text one side has for base lines `start..end`, given that side's hunks inside the range.
fn side_text<'a>(base: &[&'a str], hunks: &[Hunk<'a>], start: usize, end: usize) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut pos = start;
    for h in hunks {
        out.extend_from_slice(&base[pos..h.start]);
        out.extend_from_slice(&h.lines);
        pos = h.end;
    }
    out.extend_from_slice(&base[pos..end]);
    out
}

/// Longest run of `=` that would close a `--[==[ ]==]` comment early inside `lines`.
fn block_comment_level(lines: &[&str]) -> String {
    let mut level = 1;
    while lines.iter().any(|l| l.contains(&format!("]{}]", "=".repeat(level)))) {
        level += 1;
    }
    "=".repeat(level)
}

/// Real three-way merge (diff3) of two edited versions of a Lua file against the vanilla base.
///
/// Each side's edits are computed as a diff against the base, so inserted or removed lines no
/// longer shift everything below them. Edits to different parts of the file are all applied;
/// identical edits are applied once. Only edits that touch the same base lines differently are
/// conflicts: the merged text then keeps mod A's version active and includes mod B's version in
/// a Lua block comment right below it, so the output is still valid Lua and nothing is lost.
pub fn three_way_merge_lua(base: &str, target_a: &str, target_b: &str) -> MergeChunkResult {
    // Compare lines regardless of line-ending style (\r\n, \n, or old-Mac lone \r).
    let unify = |s: &str| if s.contains('\r') { s.replace("\r\n", "\n").replace('\r', "\n") } else { s.to_string() };
    let (base, target_a, target_b) = (unify(base), unify(target_a), unify(target_b));
    let (base, target_a, target_b) = (base.as_str(), target_a.as_str(), target_b.as_str());
    let base_lines: Vec<&str> = base.lines().collect();
    let a_lines: Vec<&str> = target_a.lines().collect();
    let b_lines: Vec<&str> = target_b.lines().collect();
    let a_hunks = diff_hunks(&base_lines, &a_lines);
    let b_hunks = diff_hunks(&base_lines, &b_lines);

    let mut merged: Vec<String> = Vec::new();
    let mut conflict_line_start = None;
    let mut conflict_line_end = None;
    let (mut ia, mut ib, mut pos) = (0usize, 0usize, 0usize);

    loop {
        let next_a = a_hunks.get(ia);
        let next_b = b_hunks.get(ib);
        // Earliest hunk; at the same position an insertion goes first (it sits before the line).
        let start = match (next_a, next_b) {
            (None, None) => break,
            (Some(a), None) => a.start,
            (None, Some(b)) => b.start,
            (Some(a), Some(b)) => a.start.min(b.start),
        };
        merged.extend(base_lines[pos..start].iter().map(|s| s.to_string()));

        // Build one group of hunks that touch the same base lines. Touching edits are merged by
        // diff_hunks, so each side has at most one hunk starting at `start`.
        let (a_from, b_from) = (ia, ib);
        let group_start = start;
        let is_insert_at = |h: Option<&Hunk>| h.is_some_and(|h| h.start == start && h.end == start);
        let mut group_end = start;
        if is_insert_at(a_hunks.get(ia)) || is_insert_at(b_hunks.get(ib)) {
            // Insertions before line `start`: they only collide with another insertion there.
            // An edit of the lines that follow is handled as its own group.
            if is_insert_at(a_hunks.get(ia)) {
                ia += 1;
            }
            if is_insert_at(b_hunks.get(ib)) {
                ib += 1;
            }
        } else {
            // Edits of base lines: absorb every hunk (from either side) starting inside the range.
            loop {
                if let Some(h) = a_hunks.get(ia).filter(|h| h.start == start || h.start < group_end) {
                    group_end = group_end.max(h.end);
                    ia += 1;
                } else if let Some(h) = b_hunks.get(ib).filter(|h| h.start == start || h.start < group_end) {
                    group_end = group_end.max(h.end);
                    ib += 1;
                } else {
                    break;
                }
            }
        }

        let a_group = &a_hunks[a_from..ia];
        let b_group = &b_hunks[b_from..ib];
        let a_text = side_text(&base_lines, a_group, group_start, group_end);
        let b_text = side_text(&base_lines, b_group, group_start, group_end);

        if b_group.is_empty() || a_text == b_text {
            merged.extend(a_text.iter().map(|s| s.to_string()));
        } else if a_group.is_empty() {
            merged.extend(b_text.iter().map(|s| s.to_string()));
        } else {
            if conflict_line_start.is_none() {
                conflict_line_start = Some(merged.len() + 1);
            }
            let eq = block_comment_level(&b_text);
            merged.push(format!(
                "-- [[ PZ Mod Studio CONFLICT (vanilla lines {}-{}): mod A's version is active, mod B's is in the comment below ]]",
                group_start + 1,
                group_end.max(group_start + 1)
            ));
            merged.extend(a_text.iter().map(|s| s.to_string()));
            merged.push(format!("--[{}[ PZ Mod Studio: mod B's version", eq));
            merged.extend(b_text.iter().map(|s| s.to_string()));
            merged.push(format!("]{}]", eq));
            merged.push("-- [[ END CONFLICT ]]".to_string());
            conflict_line_end = Some(merged.len());
        }
        pos = group_end;
    }
    merged.extend(base_lines[pos..].iter().map(|s| s.to_string()));

    let mut merged_text = merged.join("\n");
    if target_a.ends_with('\n') || (target_a.is_empty() && base.ends_with('\n')) {
        merged_text.push('\n');
    }
    MergeChunkResult {
        merged_text,
        has_conflict: conflict_line_start.is_some(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn lua(lines: &[&str]) -> String {
        lines.iter().map(|l| format!("{}\n", l)).collect()
    }

    fn assert_valid_lua(text: &str) {
        assert!(validate_lua_syntax(text).is_valid, "merged output is not valid Lua:\n{}", text);
    }

    const BASE: &[&str] = &[
        "local M = {}",
        "function M.a() return 1 end",
        "function M.b() return 2 end",
        "function M.c() return 3 end",
        "return M",
    ];

    #[test]
    fn insertion_in_one_mod_does_not_shift_the_other_mods_edit() {
        let mut a = BASE.to_vec();
        a.insert(1, "local extra = true"); // A adds a line near the top
        let mut b = BASE.to_vec();
        b[3] = "function M.c() return 30 end"; // B edits a line further down
        let r = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&b));
        assert!(!r.has_conflict, "{}", r.merged_text);
        assert!(r.merged_text.contains("local extra = true"));
        assert!(r.merged_text.contains("return 30"));
        assert!(!r.merged_text.contains("return 3 end"));
        assert_valid_lua(&r.merged_text);
    }

    #[test]
    fn edits_to_different_lines_and_deletions_are_all_applied() {
        let mut a = BASE.to_vec();
        a[1] = "function M.a() return 10 end";
        let mut b = BASE.to_vec();
        b.remove(2); // B deletes M.b
        let r = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&b));
        assert!(!r.has_conflict, "{}", r.merged_text);
        assert!(r.merged_text.contains("return 10"));
        assert!(!r.merged_text.contains("M.b"));
        assert_valid_lua(&r.merged_text);
    }

    #[test]
    fn identical_edits_are_applied_once() {
        let mut a = BASE.to_vec();
        a[2] = "function M.b() return 22 end";
        let r = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&a));
        assert!(!r.has_conflict);
        assert_eq!(r.merged_text, lua(&a));
    }

    #[test]
    fn conflicting_edits_keep_both_versions_and_stay_valid_lua() {
        let mut a = BASE.to_vec();
        a[2] = "function M.b() return \"from A\" end";
        let mut b = BASE.to_vec();
        b[2] = "function M.b() return \"from B\" ]] end";
        b[4] = "return M -- B touched the end too";
        let r = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&b));
        assert!(r.has_conflict);
        assert!(r.merged_text.contains("from A"));
        assert!(r.merged_text.contains("from B"), "mod B's version must not be lost");
        assert!(r.merged_text.contains("B touched the end too"), "non-conflicting edit still applied");
        let start = r.conflict_line_start.unwrap();
        let end = r.conflict_line_end.unwrap();
        let lines: Vec<&str> = r.merged_text.lines().collect();
        assert!(lines[start - 1].contains("CONFLICT"));
        assert!(lines[end - 1].contains("END CONFLICT"));
        assert_valid_lua(&r.merged_text);
    }

    #[test]
    fn insertions_at_the_same_place_conflict_but_an_insertion_before_an_edit_does_not() {
        let mut a = BASE.to_vec();
        a.insert(2, "local fromA = 1");
        let mut b = BASE.to_vec();
        b.insert(2, "local fromB = 2");
        let r = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&b));
        assert!(r.has_conflict);
        assert_valid_lua(&r.merged_text);

        let mut b2 = BASE.to_vec();
        b2[2] = "function M.b() return 200 end";
        let r2 = three_way_merge_lua(&lua(BASE), &lua(&a), &lua(&b2));
        assert!(!r2.has_conflict, "{}", r2.merged_text);
        let fa = r2.merged_text.find("fromA").unwrap();
        let fb = r2.merged_text.find("return 200").unwrap();
        assert!(fa < fb);
    }

    #[test]
    fn syntax_check_accepts_what_kahlua_accepts() {
        assert!(validate_lua_syntax("local r = x > 0.0f and 1d or 2.5F").is_valid);
        assert!(validate_lua_syntax("--\tcomment\rlocal a = 1\rreturn a").is_valid, "lone CR line endings");
        assert_eq!(normalize_for_kahlua("a = 0xff + x0f + 1.5e-3f"), "a = 0xff + x0f + 1.5e-3");
        assert!(!validate_lua_syntax("local = 1").is_valid);
        // Deep nesting must not crash the app (stack overflow aborts the process).
        let deep = format!("local x = {}1{}", "(".repeat(3000), ")".repeat(3000));
        let _ = validate_lua_syntax(&deep);
    }

    /// Read-only check that the parser accepts real game/mod Lua (the game itself runs it).
    /// PZMS_LUA_DIRS="<ProjectZomboid/media/lua>;<workshop/content/108600>" cargo test lua_corpus -- --ignored --nocapture
    #[test]
    #[ignore]
    fn lua_corpus_parses() {
        let Ok(dirs) = std::env::var("PZMS_LUA_DIRS") else { return };
        let (mut ok, mut failed) = (0, Vec::new());
        for dir in dirs.split(';') {
            for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
                if entry.path().extension().is_some_and(|e| e.eq_ignore_ascii_case("lua")) {
                    let Ok(bytes) = std::fs::read(entry.path()) else { continue };
                    let text = String::from_utf8_lossy(&bytes);
                    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
                    let result = validate_lua_syntax(text);
                    if result.is_valid {
                        ok += 1;
                    } else {
                        let msg: String = result.error_message.unwrap_or_default().chars().take(200).collect();
                        failed.push(format!("{} -> {}", entry.path().display(), msg));
                    }
                }
            }
        }
        println!("parsed: {ok}, rejected: {}", failed.len());
        for f in failed.iter().take(10) {
            println!("  {f}");
        }
    }

    #[test]
    fn unchanged_sides_return_the_other_side() {
        let mut b = BASE.to_vec();
        b.push("print('B')");
        let r = three_way_merge_lua(&lua(BASE), &lua(BASE), &lua(&b));
        assert!(!r.has_conflict);
        assert_eq!(r.merged_text, lua(&b));
    }
}
