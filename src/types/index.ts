/**
 * Project Zomboid Mod Studio (PZ Mod Studio)
 * Core TypeScript Foundations & Type Definitions
 */

// ==========================================
// Module 1: Virtual Path Detector & Multi-Way (N-Way) Merger
// ==========================================

/**
 * 'SCRIPT_DEFINITION' is not a file two mods ship: it is one thing two mods declare in files of
 * their own, which the Studio settles with a small script of its own in the package.
 */
export type FileType = 'LUA' | 'SCRIPT_TXT' | 'SCRIPT_DEFINITION' | 'TRANSLATION';

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
// Module 2: The Build 42 shim
// ==========================================

/** One numbered part of the Build 42 shim, as the shim itself heads it. */
/** What one mod did to the last session's log. */
export interface ModErrorStat {
  mod_name: string;
  exceptions: number;
  warnings: number;
  last_exception: string | null;
  last_warning: string | null;
}

/** One entry of a player's list: a Workshop item by id, or any mod by its mod id. */
export interface ModListItem {
  workshop_id?: string | null;
  mod_id?: string | null;
  /** A Nexus mod not installed yet, by its id on Nexus. */
  nexus_id?: number | null;
  name: string;
  added_at?: string;
}

/** A list of the player's own (Favorites is always first), kept in Zomboid/PZModStudio_Lists.json. */
export interface ModList {
  id: string;
  name: string;
  created_at: string;
  items: ModListItem[];
}

/** How long each mod's files took to load in the last session, from the game's DebugLog. */
/** One event handler the in-game profiler timed. */
export interface HandlerCost {
  event: string;
  file: string;
  line: number;
  ms: number;
  calls: number;
  worst: number;
}

/** What one mod's event handlers cost the game while it ran (mod_id null: the game's own files). */
export interface ModCost {
  mod_id: string | null;
  name: string;
  ms: number;
  calls: number;
  worst: number;
  via_package: boolean;
  handlers: HandlerCost[];
}

export interface ProfileReport {
  window_ms: number;
  in_game: boolean;
  ticks: number;
  age_secs: number;
  total_ms: number;
  mods: ModCost[];
}

export interface ProfilerStatus {
  on: boolean;
  saves: string[];
  report: ProfileReport | null;
}

export interface LoadTimes {
  log_file: string | null;
  session: string | null;
  mods: { mod_id: string; millis: number }[];
}

/** A copy of a mod as it was installed on a day, kept so an update can be undone. */
export interface KeptVersion {
  mod_id: string;
  mod_name: string;
  folder: string;
  kept_at: string;
  version: string | null;
  workshop_id: string | null;
  source_dir: string;
  path: string;
  bytes: number;
}

/** One per-mod patch of the shim's part 7, with its switch. */
export interface ShimPatch {
  name: string;
  label: string;
  enabled: boolean;
}

export interface PolyfillSection {
  number: string;
  title: string;
  lines: number;
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
  /** `category=` of its mod.info (map, vehicle, features, modpack). */
  category?: string | null;
  is_packaged?: boolean;
  /** false: the installed game build cannot load this mod (B41-only or only newer folders). */
  loadable_on_installed_build?: boolean | null;
  /** Switched on in default.txt but no installed folder provides it (unsubscribed or deleted). */
  not_installed?: boolean;
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
  /** The mod the game named on the line, when it named one. */
  mod_name?: string;
  /**
   * The level the game wrote the line at: EXCEPTION for ERROR lines and stack traces (something
   * threw), WARNING for WARN lines (the game noticed and carried on).
   */
  severity: 'EXCEPTION' | 'WARNING';
  /** Which kind of card, and the values its texts are made of, for the chosen language (`backendText`). */
  code?: string;
  params?: Record<string, string>;
  /** The other mods on the stack the game printed before the error, nearest caller first. */
  called_from?: string[];
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
  /** What the sender's mod.info claimed. */
  version?: string | null;
  /** Publish time (unix seconds) of the Workshop copy the sender had. */
  updated_at?: number | null;
}

export interface ModPreset {
  id: string;
  name: string;
  description?: string;
  author?: string;
  created_at: string;
  mods: PresetModEntry[];
  load_order: string[];
  /** The game build the pack was made on. */
  game_version?: string | null;
  /** The sandbox settings the sender played this list with, when they included them. */
  sandbox?: PresetSandbox | null;
}

/** One mod whose copy here is not the copy a pack was made with. */
export interface PresetModDrift {
  mod_id: string;
  name: string;
  pack_version?: string | null;
  your_version?: string | null;
  pack_updated_at?: number | null;
  your_updated_at?: number | null;
  /** 'older' | 'newer' (by publish time) | 'different' (only the version string differs). */
  direction: string;
}

export interface MissingModsReport {
  missing_mods: PresetModEntry[];
  installed_count: number;
  total_count: number;
  /** Installed, but not the same copy the pack was made with. */
  drift?: PresetModDrift[];
  pack_game_version?: string | null;
  your_game_version?: string | null;
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
  /** The game build this profile was last played on from the Studio ("42.21"), if ever. */
  last_played_build?: string | null;
  /** The major build this profile is meant for ("41", "42"), set by hand; null = as last played. */
  target_build?: string | null;
  /** The mods that belong to the profile, on or off; null for an older profile (= its active mods). */
  members?: string[] | null;
}

/** The mod the Studio keeps on in every profile so the game's Mods screen shows the profile. */
export const STUDIO_LINK_MOD_ID = 'Z_StudioLink';

/** The profile's mods, on or off: the game's Mods screen shows these and nothing else. */
export const profileMembers = (p: AppInstance): string[] => {
  const set = new Set(p.members ?? p.active_mod_ids);
  for (const id of p.active_mod_ids) set.add(id);
  return [...set];
};

/** The major build a profile is for: set by hand, else the one it was last played on. */
export const profileBuildMajor = (p: AppInstance | null | undefined): string | null =>
  p?.target_build ?? (p?.last_played_build ? p.last_played_build.split('.')[0] : null);

export type AppProfile = AppInstance;

export type ActiveTab = 'MOD_LIST' | 'HEALTH' | 'BROWSE' | 'SERVERS' | 'PROFILES' | 'SAVES' | 'WHATS_NEW' | 'MAPS' | 'MERGER' | 'MONITOR' | 'DEVELOPER' | 'SETTINGS';

/** One map folder of one mod, and its cells (map_cells::MapFolder). */
export interface MapFolder {
  mod_id: string;
  mod_name: string;
  workshop_id: string | null;
  folder: string;
  title: string;
  lots: string[];
  active: boolean;
  cells: [number, number][];
  over_vanilla: number;
}

export interface MapClash {
  a: string;
  b: string;
  mod_a: string;
  mod_b: string;
  cells: [number, number][];
  both_active: boolean;
}

/** A mod about maps with no cells of its own (map_cells::MapRelated). */
export interface MapRelated {
  mod_id: string;
  mod_name: string;
  workshop_id: string | null;
  active: boolean;
  /** "spawn" (map folders with spawn points or a map list), "tiles" (pack= / tiledef=). */
  kinds: string[];
  detail: string[];
}

/** One tile definition number several mods use (map_cells::TiledefClash). */
export interface TiledefClash {
  number: number;
  /** [mod id, mod name, tiledef name, on]. */
  mods: [string, string, string, boolean][];
  both_active: boolean;
}

export interface MapCells {
  vanilla: [number, number][];
  maps: MapFolder[];
  related: MapRelated[];
  clashes: MapClash[];
  tiledef_clashes: TiledefClash[];
}

/** The player's notes on mods and groups of mods (mod_meta::ModMeta). */
export interface ModGroup {
  name: string;
  mods: string[];
  note?: string;
  /** The profile it belongs to (the app only ever gets the active profile's). */
  profile?: string | null;
}
export interface ModMeta {
  notes: Record<string, string>;
  groups: ModGroup[];
}

/** The Studio's window (window_prefs::WindowPrefs). */
export interface WindowPrefs {
  remember_window: boolean;
  close_to_tray: boolean;
  tray_open: string;
  tray_quit: string;
  tray_tip: string;
}

/** One server in Steam's list (server_browser::PublicServer). */
export interface PublicServer {
  name: string;
  address: string;
  query_address: string;
  players: number;
  max_players: number;
  map: string;
  version: string;
  dedicated: boolean;
  secure: boolean;
  tags: string;
  /** Whether it asks for a password (known from the Steam client's list). */
  password: boolean | null;
  ping_ms: number | null;
}

/** What one server says about itself (server_browser::ServerRules). */
export interface ServerRules {
  description: string;
  version: string;
  open: boolean;
  mods: string[];
  /** How many mods the server has: `mods` holds only the first few. */
  mod_count: number | null;
  pvp: boolean | null;
  last_wipe: number | null;
  ping_ms: number;
  raw: [string, string][];
  query_address: string;
}

/** A server the player keeps (server_browser::SavedServer); its password stays in Windows. */
export interface SavedServer {
  name: string;
  address: string;
  note: string;
  profile_id: string | null;
  has_password: boolean;
  starred: boolean;
  last_joined: number | null;
  /** The mods the game loaded on it last time, from that session's log. */
  mods: string[];
  items: string[];
  mods_seen: number | null;
  /** The player's account on it, filled into the game's connect window by the Studio Link. */
  username: string;
  /** The profile made from it with "Make a profile". */
  made_profile_id: string | null;
}

/** One real map image, placed in squares (map_cells::images::MapImage). */
export interface MapImage {
  id: string;
  folder: string;
  bounds: [number, number, number, number];
  width: number;
  height: number;
}

/** One update of one Workshop item (whats_new::ChangeNote). */
export interface ChangeNote {
  at: number;
  text: string;
}

export interface UpdatedItem {
  workshop_id: string;
  title: string;
  mod_ids: string[];
  active: boolean;
  installed_time: number | null;
  latest_time: number | null;
  /** A newer version waits in Steam. */
  pending: boolean;
  since_last_play: boolean;
  map_mod: boolean;
  notes: ChangeNote[];
  /** "later", "busy", or what went wrong reading the notes. */
  notes_error: string | null;
  risks: { code: string; level: 'breaks' | 'read'; detail: string }[];
  /** The entries of the mod's own changelog not read yet, newest first. */
  changelog: LogEntry[];
  changelog_file: string | null;
  /** The links its author put in it to support them (https only). */
  support: AuthorLink[];
  /** The newest entry was already shown in the game (its alert system). */
  read_in_game: boolean;
  /** A mod in Zomboid/mods, not from the Workshop: its changelog is what is new. */
  local: boolean;
}

export interface LogEntry {
  title: string;
  text: string;
}

export interface AuthorLink {
  name: string;
  url: string;
}

/** The changelog a mod ships in its own folder. */
export interface ModChangelog {
  file: string;
  entries: LogEntry[];
  links: AuthorLink[];
}

export interface WhatsNew {
  last_played: number | null;
  since: number | null;
  items: UpdatedItem[];
}

/** One item a subscription needs too (workshop::RequiredNode). */
export interface RequiredNode {
  workshop_id: string;
  title: string;
  preview_url: string | null;
  file_size: number;
  /** False when Steam no longer has it. */
  found: boolean;
  /** Titles of the items that list it. */
  required_by: string[];
  depth: number;
}

export interface RequiredChain {
  items: RequiredNode[];
  cut_short: boolean;
  /** Items whose page could not be read: the list may be incomplete. */
  unread: string[];
  asked: { workshop_id: string; title: string }[];
}

/** One backup of one save (save_backup::BackupEntry). */
export interface SaveBackupEntry {
  file: string;
  /** manual, exit, before-load, before-fix, before-restore */
  reason: string;
  /** Unix seconds. */
  at: number;
  zip_bytes: number;
  save_bytes: number;
  files: number;
  save_newest: number;
  mods: string[];
  /** Kept until the player removes it. */
  kept: boolean;
  /** Read back after writing, every CRC matching. */
  verified: boolean;
}

export interface SaveBackupOutcome {
  entry: SaveBackupEntry;
  /** Nothing changed since this backup, so nothing was written. */
  unchanged: boolean;
  pruned: string[];
}

export interface SaveSummary {
  /** <mode>/<world> */
  id: string;
  mode: string;
  world: string;
  bytes: number;
  files: number;
  /** Unix seconds of the newest change in the save. */
  modified: number;
  mods: string[];
  backups: SaveBackupEntry[];
  /** Unchanged since its newest backup. */
  backed_up: boolean;
  busy: boolean;
}

/** What changed for a save since its last session (studio_link::SessionDiff). */
export interface SessionDiff {
  at: number;
  added: string[];
  removed: string[];
  updated: string[];
  reordered: boolean;
}

export interface SavesOverview {
  saves: SaveSummary[];
  backup_dir: string;
  backups_bytes: number;
  free_bytes: number | null;
  total_bytes: number | null;
  keep_automatic: number;
}

/** One thing wrong in one file of a mod, as the Developer screen lists it. */
export interface FileProblem {
  path: string;
  line: number | null;
  col: number | null;
  message: string;
  kind: 'lua' | 'script';
  /** Set for the Studio's own problems (script_extra_close, script_unclosed, not_utf8); empty for the parser's words. */
  code?: string;
}

/** One call a mod's client code makes that the game routes through the server in multiplayer. */
export interface MpFinding {
  path: string;
  line: number;
  method: string;
  what: string;
  handler: string;
  evidence: string;
  snippet: string;
  guarded: boolean;
  aware: boolean;
}

export interface MpReport {
  root: string;
  files_checked: number;
  has_server_lua: boolean;
  findings: MpFinding[];
}

export interface MpModReport {
  mod_id: string;
  name: string;
  report: MpReport;
}

/** TileZed and WorldEd, where they were found, and where the Studio looked. */
export interface MapTools {
  tilezed: string | null;
  worlded: string | null;
  searched: string[];
}

/** What a new mod is made from. */
export interface NewMod {
  id: string;
  name: string;
  author: string;
  description: string;
  builds: string[];
}

export interface CreatedMod {
  folder: string;
  files: string[];
}

/** A Lua file of a mod changed since the last look. */
export interface ChangedFile {
  path: string;
  absolute: string;
  modified_ms: number;
}

/** What the game wrote back after reloading files: "ok <file>" or "failed <file>: <error>". */
export interface ReloadResult {
  id: string;
  results: string[];
}

/** A hosted server's Discord channel: which news go to its webhook. */
export interface DiscordSettings {
  enabled: boolean;
  status: boolean;
  players: boolean;
  restarts: boolean;
  updates: boolean;
  language: string;
  /** One message that says the server's state, edited as it changes. */
  status_message: boolean;
  status_message_id?: string;
  /** `!` commands read from a Discord channel while the Studio runs (the game's bot token). */
  commands: boolean;
  command_channel: string;
  command_role: string;
}

/** The game's own Discord bot, as the server's .ini has it (never the token itself). */
export interface GameBot {
  enabled: boolean;
  has_token: boolean;
  chat_channel: string;
  log_channel: string;
  /** Set by hand: anyone who can write there runs admin commands. */
  command_channel: string;
  invite_url: string | null;
}

/** How the Studio's Discord commands are doing. */
export interface DiscordCommandsStatus {
  server: string;
  listening: boolean;
  channel: string;
  /** "code: English text", empty while it works. */
  error: string;
}

export interface DiscordView {
  settings: DiscordSettings;
  /** A webhook is stored (the address itself never comes back). */
  has_webhook: boolean;
}

/** One stage of reloading a mod's Lua in the running game (the `dev-reload` event). */
export interface DevReloadEvent {
  /** syntax (files not sent), sent, applied, no_answer, not_running */
  stage: 'syntax' | 'sent' | 'applied' | 'no_answer' | 'not_running';
  id: string;
  files: string[];
  results: string[];
  problems: FileProblem[];
  detected_ms: number;
  sent_ms: number;
  applied_ms: number;
  answered_ms: number;
}

export interface ModValidation {
  root: string;
  lua_files: number;
  script_files: number;
  problems: FileProblem[];
}

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
  | { action: 'keep_version'; mod_id: string }
  | { action: 'remove_compatible_copy'; folder: string }
  | { action: 'merge_files'; relative_paths: string[] }
  | { action: 'open_in_merger'; relative_path: string }
  | { action: 'enable_shim_patch'; name: string };

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
  /** The same thing file by file, when the message lumps several (script conflicts). */
  details?: IssueDetail[];
  /** The values `message` is made of, for saying it in the chosen language (`backendText`). */
  params?: Record<string, string>;
}

/** One file of one mod, and the things in it another mod also declares. */
export interface IssueDetail {
  mod_id: string;
  mod_name: string;
  file: string;
  declares: { definition: string; merged_path: string; state: string }[];
}

/** One of the player's own load-order rules: `mod_id` must load after `after`. */
export interface UserRule {
  mod_id: string;
  after: string;
  note: string | null;
}

/** The installed game as Steam's app manifest describes it. */
export interface GameInstall {
  /** "stable" when no beta is opted into, else the beta's name ("unstable", "legacy41", ...). */
  branch: string;
  build_id: string | null;
  last_updated: string | null;
}

/** The community rules in use: how many, and when the copy was fetched. */
/** Whether a newer PZ Mod Studio is out (app_update.rs). */
export interface AppUpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  newer: boolean;
  dismissed: boolean;
  checked_at: number | null;
  error: string | null;
}

export interface CommunitySummary {
  rules: number;
  pairs: number;
  updated: string | null;
  fetched_at: number | null;
  /** Registries in the community mod index at hand. */
  mods: number;
  index_updated: string | null;
  /** Whether the Studio fetches the community files at all (Settings). */
  downloads: boolean;
}

/** How sure an entry of the community index is: the Studio checked it, or a person said so. */
export type CommunityStatus = 'verified' | 'reported';

export interface CommunityRelation {
  id: string;
  note?: string | null;
  build?: string | null;
  date?: string | null;
  source?: string | null;
  status?: CommunityStatus;
}

export type CommunityIssueFix =
  | { kind: 'shim_patch'; name: string }
  | { kind: 'require_path'; from: string; to: string }
  | { kind: 'compatible_copy' }
  | { kind: 'none' };

export interface CommunityIssue {
  title: string;
  note?: string | null;
  file?: string | null;
  line?: number | null;
  log?: string | null;
  fix: CommunityIssueFix;
  build?: string | null;
  date?: string | null;
  source?: string | null;
  status?: CommunityStatus;
}

/** One mod's registry in the community index (community/index/<id>.json). */
export interface CommunityRegistry {
  id: string;
  name?: string | null;
  workshop_id?: string | null;
  authors: string[];
  builds: string[];
  requires: string[];
  incompatible: CommunityRelation[];
  load_after: CommunityRelation[];
  successor?: { id: string; workshop_id?: string | null; note?: string | null } | null;
  issues: CommunityIssue[];
}

/** The pull request "Propose" opened with the saved GitHub token. */
/** A list another player shared through the community repository (community/lists). */
export interface SharedListItem {
  workshop_id?: string;
  mod_id?: string;
  nexus_id?: number;
  name: string;
}

export interface SharedList {
  id: string;
  name: string;
  author: string;
  description: string;
  build: string;
  updated: string;
  items: SharedListItem[];
}

export interface CommunityLists {
  version: number;
  updated: string | null;
  lists: SharedList[];
  fetched_at: number | null;
}

export interface ProposeResult {
  pr_url: string;
  fork: string;
  branch: string;
}

export interface CommunityIndex {
  version: number;
  updated: string | null;
  mods: Record<string, CommunityRegistry>;
  fetched_at: number | null;
}

export interface HealthReport {
  game_version: string | null;
  install?: GameInstall | null;
  community?: CommunitySummary | null;
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
  | { kind: 'url'; url: string; page_url: string | null; source: string }
  | { kind: 'compat'; workshop_id: string | null; source_dir: string; changes: string[] };

/** What a link turns out to offer, before anything is downloaded. */
export interface UrlInstallPlan {
  download_url: string;
  file_name: string;
  size: number | null;
  /** In words: "the latest release of owner/repo (v1.2.0)". */
  source: string;
  page_url: string | null;
}

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
  /** When it was first posted (unix seconds). */
  time_created?: number | null;
  subscriptions: number;
  favorited: number;
  file_size: number;
  tags: string[];
  builds: string[];
  is_project_zomboid: boolean;
  banned: boolean;
  page_url: string;
  /** A collection's items, in the author's order (empty for a normal mod). */
  children: string[];
  is_collection: boolean;
  /** Where to support its author (Ko-fi, Patreon...), from the full Workshop description. */
  support?: AuthorLink[];
}

/** What to list on the Workshop browse page. */
export interface WorkshopBrowseQuery {
  text?: string | null;
  sort?: WorkshopSort | null;
  /** '41' / '42'. */
  build?: string | null;
  category?: string | null;
  /** How far back "most popular" looks: 1, 7, 90 or 365 days. */
  days?: number | null;
  /** List collections instead of single mods. */
  collections?: boolean;
  page: number;
  perPage?: number;
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

/** What Steam accepted when subscribing or unsubscribing. */
export interface SubscribeOutcome {
  done: string[];
  /** [workshop id, reason]. */
  failed: [string, string][];
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

/** A module that exists, and where. */
export interface ModuleCandidate {
  module_path: string;
  phase: string;
  owner: string;
  same_path: boolean;
}

/** What became of one failed `require`. */
export interface RequireAnswer {
  wanted: string;
  candidates: ModuleCandidate[];
  summary: string;
}

/** One text file of an installed mod, as the game reads it. */
export interface ModFile {
  relative_path: string;
  absolute_path: string;
  bytes: number;
  kind: string;
}

/** One of the player's own sandbox presets. */
export interface SandboxPresetInfo {
  name: string;
  path: string;
  bytes: number;
  settings: number;
  /** How many of those settings belong to a mod (keys like `VTB.ServerValidation`). */
  mod_settings: number;
}

/** Sandbox settings travelling inside a pack. */
export interface PresetSandbox {
  name: string;
  contents: string;
  settings: number;
  mod_settings: number;
}

/** One earlier version of the mod list, kept in Zomboid/PZModStudio_Backups. */
export interface ModListVersion {
  file: string;
  saved_at: string;
  active_count: number;
  /** Mods this version had on that the current list does not. */
  added: string[];
  /** Mods the current list has on that this version did not. */
  removed: string[];
}

/** The three mod lines a dedicated server reads. */
export interface ServerLines {
  mods: string[];
  workshop_items: string[];
  maps: string[];
}

/** What a server's .ini says about mods, and what does not add up. */
export interface ServerModReport extends ServerLines {
  issues: HealthIssue[];
}

/** One answered launch of a hunt. */
export interface BisectRound {
  round: number;
  tried: number;
  suspects: number;
  answer: string;
}

/** Halving the mod list to find the one that breaks the game (src-tauri/src/bisect). */
export interface BisectSession {
  started_at: string;
  phase: 'Narrowing' | 'Confirming' | 'Done';
  original_active: string[];
  always_on: string[];
  candidates: string[];
  trial: string[];
  round: number;
  launches_left: number;
  history: BisectRound[];
  culprit: string | null;
  note: string | null;
}

export interface ModHealth {
  catalog: { game_version: string | null; mods: CatalogModSummary[] };
  report: HealthReport;
}
