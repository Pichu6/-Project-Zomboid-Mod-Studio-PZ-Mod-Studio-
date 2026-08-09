/**
 * Project Zomboid Mod Studio (PZ Mod Studio)
 * Core TypeScript Foundations & Type Definitions
 */

// ==========================================
// Module 1: Virtual Path Detector & Multi-Way (N-Way) Merger
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
  start_line?: number; // e.g. 1
  end_line?: number;   // e.g. 20
  conflict_line?: number; // e.g. 5
  total_file_lines?: number; // e.g. 20
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
// Module 3: Mod List & Workshop Inspector
// ==========================================

export interface ModInfo {
  mod_id: string;
  name: string;
  description?: string;
  workshop_id?: string;
  author?: string;
  version?: string;
  pzversion?: string;
  icon_path?: string;
  poster_url?: string;
  url?: string;
  dependencies: string[]; // require= directives
  incompatible?: string[]; // incompatible= directives
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
// Module 4: Monitor Center & Crash Diagnostics
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

export interface StudioPathsUI {
  pz_install_dir: string;
  workshop_dir: string;
  user_zomboid_dir: string;
  mod_list_ini_path: string;
  carrier_workshop_id?: string;
  is_valid: boolean;
}

// ==========================================
// Module 5: Presets, Server Manager & Instances
// ==========================================

export interface PresetModEntry {
  mod_id: string;
  name: string;
  workshop_id?: string;
  enabled: boolean;
}

export interface ModPreset {
  id: string;
  name: string;
  description?: string;
  author?: string;
  created_at: string;
  mods: PresetModEntry[];
  load_order: string[];
}

export interface MissingModsReport {
  missing_mods: PresetModEntry[];
  installed_count: number;
  total_count: number;
}

export interface PZServerConfig {
  name: string;
  file_path: string;
  mods: string[];
  workshop_items: string[];
}

export interface AppInstance {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  is_active: boolean;
  active_mod_ids: string[];
  load_order: string[];
}

export type ActiveTab = 'MOD_LIST' | 'PRESETS' | 'SERVERS' | 'INSTANCES' | 'MERGER' | 'MONITOR' | 'SETTINGS';
