/**
 * Project Zomboid Mod Studio (PZ Mod Studio)
 * Core TypeScript Foundations & Type Definitions
 */

// ==========================================
// Module 1: Virtual Path Detector & 3-Way Merger
// ==========================================

export type FileType = 'LUA' | 'SCRIPT_TXT';

export type ConflictStatus = 'AUTO_MERGED' | 'MANUAL_CONFLICT' | 'RESOLVED' | 'PENDING';

export interface CompetingModFile {
  mod_id: string;
  mod_name: string;
  absolute_path: string;
  content: string;
  is_selected?: boolean;
}

export interface VfsConflict {
  id: string;
  relative_path: string; // e.g. "media/lua/client/ISUI/ISInventoryPane.lua"
  file_type: FileType;
  base_content: string; // Vanilla file content
  competing_mods: CompetingModFile[];
  merged_output?: string;
  status: ConflictStatus;
  has_syntax_errors?: boolean;
  syntax_error_message?: string;
}

// ==========================================
// Module 2: JSON-Driven Polyfill Engine
// ==========================================

export type RuleCategory =
  | 'ARGUMENT_TYPE_WRAPPER'
  | 'SAFE_GLOBAL'
  | 'TRANSLATOR_FIX'
  | 'REQUIRE_REDIRECT'
  | 'CUSTOM_SHIM';

export type RuleSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PolyfillRule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  enabled: boolean;
  pattern: {
    type: string;
    target_function?: string;
    target_global?: string;
    target_method?: string;
    [key: string]: unknown;
  };
  action: {
    type: string;
    wrapper_template?: string;
    shim_code?: string;
    regex?: string;
    replacement?: string;
    mappings?: Record<string, string>;
  };
}

// ==========================================
// Module 3: Load Order & Dependency Manager
// ==========================================

export interface ModInfo {
  mod_id: string;
  name: string;
  description?: string;
  workshop_id?: string;
  author?: string;
  version?: string;
  icon_path?: string;
  dependencies: string[]; // require= directives
  enabled: boolean;
  is_library?: boolean;
  is_map_mod?: boolean;
  load_order_index: number;
}

export interface DependencyIssue {
  mod_id: string;
  missing_dependency_id: string;
  issue_type: 'MISSING' | 'WRONG_ORDER' | 'CIRCULAR';
  severity: 'WARNING' | 'ERROR';
  description: string;
}

export interface ModProfile {
  id: string;
  profile_name: string;
  created_at: string;
  pz_version: string;
  mod_count: number;
  load_order: string[]; // list of mod_ids
}

// ==========================================
// Module 4: Test Sandbox & Crash Diagnostics
// ==========================================

export type SandboxStatus = 'IDLE' | 'BOOTING' | 'RUNNING' | 'SUCCESS' | 'CRASHED';

export interface TranslatedErrorCard {
  id: string;
  raw_error: string;
  source_file?: string;
  line_number?: number;
  title: string;
  explanation: string;
  recommended_action: string;
  polyfill_rule_id_suggestion?: string;
}

export interface SandboxSession {
  status: SandboxStatus;
  test_mode: 'BACKGROUND_QUICK' | 'WINDOWED_DEEP';
  start_time?: string;
  elapsed_seconds: number;
  log_lines: string[];
  error_cards: TranslatedErrorCard[];
}

// ==========================================
// App Navigation State
// ==========================================

export type ActiveTab = 'MERGER' | 'POLYFILLS' | 'LOAD_ORDER' | 'SANDBOX' | 'SETTINGS';
