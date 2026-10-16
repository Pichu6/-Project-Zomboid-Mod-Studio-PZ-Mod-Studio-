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
  auto_ast_output?: string;
  is_identical_noise?: boolean;
  status: ConflictStatus;
  has_syntax_errors?: boolean;
  syntax_error_message?: string;
  /** What each mod changes compared to vanilla (empty when vanilla has no such file). */
  mod_changes?: ModChangeSummary[];
  /** Vanilla line ranges that several mods change differently. */
  collisions?: CollisionRegion[];
  /** How the merged output was built, in plain words. */
  strategy?: string;
}

export interface ChangeRegion {
  kind: 'added' | 'removed' | 'changed';
  base_start: number;
  base_end: number;
  mod_start: number;
  mod_end: number;
}

export interface ModChangeSummary {
  mod_id: string;
  mod_name: string;
  lines_added: number;
  lines_removed: number;
  regions: ChangeRegion[];
}

export interface CollisionRegion {
  base_start: number;
  base_end: number;
  mods: string[];
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
  load_mod_after?: string[]; // loadModAfter= directives (optional ordering hints)
  incompatible?: string[]; // incompatible= directives
  enabled: boolean;
  is_library?: boolean;
  is_map_mod?: boolean;
  is_packaged?: boolean;
  /** false: the installed game build cannot load this mod (B41-only or only newer folders). */
  loadable_on_installed_build?: boolean | null;
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

export type GameLaunchMode =
  | 'DEBUG_FULLSCREEN'
  | 'DEBUG_WINDOWED'
  | 'NORMAL_FULLSCREEN'
  | 'NORMAL_WINDOWED'
  | 'MONITORED'
  | 'WINDOWED'
  | 'NORMAL';

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

export interface DedicatedServerStatus {
  is_running: boolean;
  pid?: number | null;
  server_name?: string | null;
  memory_gb?: number | null;
  start_timestamp?: number | null;
}

export interface ConnectedPlayer {
  username: string;
  role: string;
  ping: number;
  health: number;
  is_godmode: boolean;
  x: number;
  y: number;
  z: number;
  steam_id: string;
}

export interface ServerQuickSettings {
  public_name: string;
  public_description: string;
  password: string;
  max_players: number;
  pvp: boolean;
  pause_empty: boolean;
  open: boolean;
  port: number;
  rcon_port: number;
  rcon_password: string;
  map_names: string;
}

export interface LogFileInfoUI {
  file_name: string;
  absolute_path: string;
  size_bytes: number;
  modified_timestamp: number;
  is_active_console: boolean;
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

export type AppProfile = AppInstance;

export type ActiveTab = 'MOD_LIST' | 'HEALTH' | 'BROWSE' | 'SERVERS' | 'PROFILES' | 'MERGER' | 'MONITOR' | 'SETTINGS';

// ---- Mod health (Rust catalog module) ----
export type HealthSeverity = 'error' | 'warning' | 'info';

export type HealthFix =
  | { action: 'enable_mod'; mod_id: string }
  | { action: 'disable_mod'; mod_id: string }
  | { action: 'move_before'; mod_id: string; before: string }
  | { action: 'remove_from_list'; entry: string }
  | { action: 'subscribe_workshop'; hint: string }
  | { action: 'open_workshop_page'; workshop_id: string }
  | { action: 'make_compatible_copy'; mod_id: string }
  | { action: 'remove_compatible_copy'; folder: string }
  | { action: 'merge_files'; relative_paths: string[] }
  | { action: 'open_in_merger'; relative_path: string };

/** Result of merging file conflicts automatically into the active patch package. */
export interface AutoMergeResult {
  package_folder: string;
  merged: string[];
  skipped: string[];
}

export interface HealthIssue {
  severity: HealthSeverity;
  code: string;
  mod_id: string | null;
  message: string;
  fixes: HealthFix[];
  /** Other mod ids involved (dependency, incompatible mod, ...). */
  related: string[];
}

export interface HealthReport {
  game_version: string | null;
  active_count: number;
  errors: number;
  warnings: number;
  issues: HealthIssue[];
}

export interface WorkshopInstallState {
  installed_time: number | null;
  latest_time: number | null;
  size: number | null;
  update_pending: boolean;
  updated_since_last_play: boolean;
}

export interface CatalogModSummary {
  id: string;
  name: string;
  source: CatalogSource;
  origin: ModOrigin | null;
  workshop_state: WorkshopInstallState | null;
  root_dir: string;
  shadowed_by: string | null;
  loadability: { status: 'loadable' | 'no_folder_for_build' | 'outside_version_range' | 'invalid_mod_info' };
}

export type NexusSort = 'updated' | 'downloads' | 'endorsements' | 'newest';

export interface NexusMod {
  mod_id: number;
  name: string;
  summary: string | null;
  author: string | null;
  uploader: string | null;
  version: string | null;
  updated_at: string | null;
  created_at: string | null;
  downloads: number;
  endorsements: number;
  picture_url: string | null;
  thumbnail_url: string | null;
  adult_content: boolean;
  page_url: string;
  /** '41', '42' or '41+42' when the name/summary says so (Nexus has no build tag). */
  build_hint: string | null;
  /** Nexus category ("Gameplay", "Items", ...). */
  category: string | null;
}

export interface NexusCategory {
  name: string;
  count: number;
}

export interface NexusRequirement {
  mod_id: number | null;
  name: string;
  url: string | null;
  /** Hosted outside Nexus (often the Steam Workshop). */
  external: boolean;
  notes: string | null;
}

export interface NexusFile {
  name: string;
  version: string | null;
  /** MAIN, UPDATE, OPTIONAL, MISCELLANEOUS. */
  category: string;
  size_bytes: number | null;
  uploaded: number | null;
  description: string | null;
}

export interface NexusModDetails {
  mod: NexusMod;
  /** BBCode. */
  description: string;
  requirements: NexusRequirement[];
  files: NexusFile[];
}

export interface NexusSearchResult {
  total: number;
  offset: number;
  mods: NexusMod[];
}

export type ModOrigin =
  | { kind: 'nexus'; mod_id: number; page_url: string; name: string | null }
  | { kind: 'manual'; file_name: string | null }
  | { kind: 'compat'; workshop_id: string | null; source_dir: string; changes: string[] };

export type CatalogSource =
  | { kind: 'workshop'; workshop_id: string }
  | { kind: 'workshop_upload'; item_folder: string }
  | { kind: 'local' };

export interface WorkshopItem {
  workshop_id: string;
  found: boolean;
  title: string;
  summary: string;
  preview_url: string | null;
  time_updated: number | null;
  subscriptions: number;
  favorited: number;
  file_size: number;
  tags: string[];
  builds: string[];
  is_project_zomboid: boolean;
  banned: boolean;
  page_url: string;
}

export interface WorkshopRequiredItem {
  workshop_id: string;
  title: string;
}

export interface WorkshopItemDetails {
  item: WorkshopItem;
  /** Steam BBCode. */
  description: string;
  time_created: number | null;
  author: string | null;
  screenshots: string[];
  /** YouTube video ids. */
  videos: string[];
  required_items: WorkshopRequiredItem[];
}

export type WorkshopSort = 'relevance' | 'trending' | 'most_subscribed' | 'recently_updated' | 'newest' | 'top_rated';

export interface WorkshopSearchResult {
  total: number;
  page: number;
  /** Pages available for this search (Steam stops at 1000). */
  pages: number;
  items: WorkshopItem[];
}

export interface WorkshopLookup {
  collection: WorkshopItem | null;
  items: WorkshopItem[];
}

export interface CompatResult {
  mod_id: string;
  folder: string;
  destination: string;
  changes: string[];
  warnings: string[];
}

export interface InstalledMod {
  folder: string;
  mod_id: string | null;
  name: string | null;
  destination: string;
  replaced: boolean;
  backup: string | null;
}

export interface InstallResult {
  installed: InstalledMod[];
  warnings: string[];
}

export interface SortResult {
  order: string[];
  moved: string[];
  cycle: string[];
}

export interface ModHealth {
  catalog: { game_version: string | null; mods: CatalogModSummary[] };
  report: HealthReport;
}
