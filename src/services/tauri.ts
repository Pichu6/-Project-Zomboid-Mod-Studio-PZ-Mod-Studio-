import { invoke } from '@tauri-apps/api/core';
import { cached, clearRemoteCache, prefetch } from './cache';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { StudioPathsUI } from '../components/settings/SettingsModule';
import { VfsConflict, ModInfo, TranslatedErrorCard, DedicatedServerStatus, ConnectedPlayer, ServerQuickSettings, PZServerConfig, ModHealth, SortResult, NexusSearchResult, NexusSort, InstallResult, ModOrigin, WorkshopItem, WorkshopLookup, WorkshopSearchResult, CompatResult, AutoMergeResult, NexusCategory, NexusModDetails, WorkshopItemDetails, WorkshopBrowseQuery, SubscribeOutcome, BisectSession, HealthIssue, ServerLines, ServerModReport, ModListVersion, PolyfillSection } from '../types';

export interface LuaSyntaxResult {
  is_valid: boolean;
  error_message?: string;
}

export interface MergeChunkResult {
  merged_text: string;
  has_conflict: boolean;
  conflict_line_start?: number;
  conflict_line_end?: number;
}

export interface ModListDataRaw {
  active_mods: string[];
  raw_ini_content: string;
}

export interface DependencyAnalysisRaw {
  sorted_mod_ids: string[];
  missing_dependencies: string[];
  has_circular_dependency: boolean;
  circular_mod_ids: string[];
  duplicate_mod_ids: string[];
  incompatible_pairs: [string, string][];
}

export interface SandboxLogPayload {
  line: string;
  is_error: boolean;
}

export interface MasterPatchResultUI {
  success: boolean;
  patch_mod_dir: string;
  files_written: number;
  polyfill_shim_written: boolean;
}

export interface MasterPatchStatusInfoUI {
  is_packaged: boolean;
  created_at?: string;
  packaged_mods: string[];
  merged_files: string[];
  missing_active_mods: string[];
}

export interface MergedPackageInfoUI {
  folder_name: string;
  display_name: string;
  mod_id: string;
  description?: string;
  is_packaged: boolean;
  is_active_in_modlist: boolean;
  is_companion_bridge: boolean;
  created_at?: string;
  packaged_mods: string[];
  merged_files: string[];
}

const STORAGE_KEY_PATHS = 'pz_mod_studio_paths_profile';

/** Window event fired when a backend operation fails; App shows it to the user. */
export const BACKEND_ERROR_EVENT = 'pzms-backend-error';

export interface BackendErrorDetail {
  action: string;
  message: string;
}

const errorMessage = (err: unknown): string =>
  typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err);

/** Logs a failed backend call and tells the UI about it, so failures never look like success. */
/**
 * Backend errors are written for the log, not for a player. This turns the ones we know about
 * into something a person can act on, and leaves anything else as it came.
 */
export function explainError(err: unknown): string {
  const raw = String(err ?? '').replace(/^Error:\s*/i, '').trim();
  const known: [RegExp, string][] = [
    [/Zomboid folder not found/i, 'The Studio cannot find your Zomboid folder. Set it in App Settings.'],
    [/ProjectZomboid64\.exe not found/i, 'Project Zomboid is not where the Studio is looking. Set your game folder in App Settings.'],
    [/steam_api64\.dll was not found/i, 'That is not a Project Zomboid folder. Check the game folder in App Settings.'],
    [/Steam is not running/i, 'Steam is not running. Start Steam, sign in, and try again.'],
    [/could not be reached|os error 10051|dns error/i, 'No connection. Check your internet and try again.'],
    [/rate-limit/i, 'Steam is rate-limiting requests. Try again in a minute.'],
    [/Access is denied|os error 5/i, 'Windows would not allow that. The file may be open in the game or another program.'],
    [/os error 2|No such file/i, 'That file is no longer there. Refresh and try again.'],
  ];
  const match = known.find(([pattern]) => pattern.test(raw));
  if (match) return match[1];
  // Nothing recognised: show it, but without the Rust decoration.
  return raw.replace(/^[A-Za-z_:]+Error\(|\)$/g, '') || 'Something went wrong.';
}

export const reportBackendError = (action: string, err: unknown): void => {
  console.error(`${action} failed:`, err);
  window.dispatchEvent(
    new CustomEvent<BackendErrorDetail>(BACKEND_ERROR_EVENT, { detail: { action, message: errorMessage(err) } })
  );
};

/**
 * Service layer wrapping all native Tauri Rust backend IPC calls
 */
export const TauriService = {
  /**
   * Opens any external web URL in the user's default system browser
   */
  openExternalUrl: async (url: string): Promise<void> => {
    try {
      await openUrl(url);
      return;
    } catch (pluginErr) {
      console.warn('Tauri openUrl plugin fallback:', pluginErr);
    }

    try {
      await invoke('open_external_url_cmd', { url });
      return;
    } catch (ipcErr) {
      console.warn('Tauri open_external_url_cmd fallback:', ipcErr);
    }

    try {
      window.open(url, '_blank');
    } catch (winErr) {
      console.error('Failed to open external URL:', winErr);
    }
  },

  /**
   * Loads saved directory paths profile from LocalStorage or Rust auto-detection
   */
  loadSavedPathsProfile: async (): Promise<StudioPathsUI> => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY_PATHS);
      if (cached) {
        const parsed = JSON.parse(cached) as StudioPathsUI;
        if (parsed.pz_install_dir) {
          // Re-validate cached paths with Rust
          return await invoke<StudioPathsUI>('set_and_validate_paths', { customPaths: parsed });
        }
      }
    } catch (err) {
      console.warn('Failed to load cached paths profile:', err);
    }
    // Fallback to Rust auto-detection
    return await TauriService.getAutoPaths();
  },

  /**
   * Saves directory paths profile persistently to LocalStorage
   */
  savePathsProfile: async (paths: StudioPathsUI): Promise<StudioPathsUI> => {
    const validated = await TauriService.validatePaths(paths);
    localStorage.setItem(STORAGE_KEY_PATHS, JSON.stringify(validated));
    return validated;
  },

  /**
   * Auto-detects Project Zomboid installation and user directories
   */
  getAutoPaths: async (): Promise<StudioPathsUI> => {
    try {
      return await invoke<StudioPathsUI>('get_auto_paths');
    } catch (err) {
      console.warn('Fallback to default paths:', err);
      return {
        pz_install_dir: '',
        workshop_dir: '',
        user_zomboid_dir: '',
        mod_list_ini_path: '',
        is_valid: false,
      };
    }
  },

  /**
   * Validates custom or manually entered directory paths
   */
  validatePaths: async (customPaths: StudioPathsUI): Promise<StudioPathsUI> => {
    try {
      return await invoke<StudioPathsUI>('set_and_validate_paths', { customPaths });
    } catch (err) {
      console.error('Failed to validate paths:', err);
      return customPaths;
    }
  },

  /**
   * Opens native Windows Explorer folder picker dialog
   */
  pickFolder: async (defaultPath?: string): Promise<string | null> => {
    try {
      return await invoke<string | null>('pick_folder_cmd', { defaultPath });
    } catch (err) {
      console.error('Folder picker error:', err);
      return null;
    }
  },

  /**
   * Scans Virtual File System for real conflicts between active mods
   */
  scanConflicts: async (paths: StudioPathsUI, packageFolder?: string | null): Promise<VfsConflict[]> => {
    try {
      const rawConflicts = await invoke<any[]>('scan_conflicts_cmd', { paths, packageFolder: packageFolder ?? null });
      if (!rawConflicts || rawConflicts.length === 0) {
        return [];
      }
      return rawConflicts.map((c) => ({
        id: c.id,
        relative_path: c.relative_path,
        file_type: c.file_type,
        start_line: c.start_line ?? 1,
        end_line: c.end_line ?? 10,
        conflict_line: c.conflict_line ?? 1,
        total_file_lines: c.total_file_lines ?? c.base_content.split('\n').length ?? 1,
        base_content: c.base_content,
        merged_output: c.merged_output || c.base_content,
        auto_ast_output: c.auto_ast_output || c.merged_output || c.base_content,
        is_identical_noise: c.is_identical_noise ?? false,
        competing_mods: c.competing_files.map((f: any) => ({
          mod_id: f.mod_id,
          mod_name: f.mod_name,
          absolute_path: f.absolute_path,
          content: f.content,
        })),
        status: (c.status as any) || (c.is_identical_noise ? ('AUTO_MERGED' as const) : ('MANUAL_CONFLICT' as const)),
        mod_changes: c.mod_changes ?? [],
        collisions: c.collisions ?? [],
        strategy: c.strategy ?? '',
      }));
    } catch (err) {
      console.warn('Scan conflicts error:', err);
      return [];
    }
  },

  /**
   * Scans all subscribed Workshop & local mods, ordering active ones first according to ModListData.ini
   */
  scanAllInstalledMods: async (paths: StudioPathsUI): Promise<ModInfo[]> => {
    try {
      const rawMods = await invoke<any[]>('scan_all_installed_mods_cmd', { paths });
      if (!rawMods || rawMods.length === 0) {
        return [];
      }
      return rawMods.map((m, idx) => ({
        mod_id: m.id,
        name: m.name || m.id,
        description: m.description,
        workshop_id: m.workshop_id,
        author: m.author,
        version: m.version,
        pzversion: m.pzversion,
        url: m.url,
        dependencies: m.require || [],
        load_mod_after: m.load_mod_after || [],
        incompatible: m.incompatible || [],
        enabled: m.enabled ?? false,
        icon_path: m.icon_path,
        poster_url: m.poster_url,
        is_library: m.is_library ?? false,
        is_map_mod: m.is_map_mod ?? false,
        is_packaged: m.is_packaged,
        loadable_on_installed_build: m.loadable_on_installed_build,
        load_order_index: idx + 1,
      }));
    } catch (err) {
      reportBackendError('Scanning installed mods', err);
      return [];
    }
  },

  /**
   * Read-only health check of the active load order (game rules: build, dependencies, order,
   * incompatibilities). Throws on backend failure so callers can show it.
   */
  getModHealth: async (paths: StudioPathsUI, active: string[]): Promise<ModHealth> => {
    return await invoke<ModHealth>('get_mod_health_cmd', { paths, active });
  },

  /** Project Zomboid mods on Nexus Mods (public API). Throws on failure. */
  nexusSearch: async (query: string, category: string | null, sort: NexusSort, offset: number, count: number): Promise<NexusSearchResult> => {
    return await cached(`nexus:search:${sort}:${category ?? ''}:${offset}:${count}:${query}`, () =>
      invoke<NexusSearchResult>('nexus_search_cmd', { query: query || null, category: category || null, sort, offset, count })
    );
  },

  /** Project Zomboid categories on Nexus with mod counts. Throws on failure. */
  nexusCategories: async (): Promise<NexusCategory[]> => {
    return await cached('nexus:categories', () => invoke<NexusCategory[]>('nexus_categories_cmd'));
  },

  /** Description, requirements and files of one Nexus mod. Throws on failure. */
  nexusModDetails: async (modId: number): Promise<NexusModDetails> => {
    return await cached(`nexus:mod:${modId}`, () => invoke<NexusModDetails>('nexus_mod_details_cmd', { modId }));
  },

  /** Full description, screenshots and required items of one Workshop item (no key). Throws on failure. */
  workshopItemDetails: async (id: string): Promise<WorkshopItemDetails> => {
    return await cached(`workshop:item:${id}`, () => invoke<WorkshopItemDetails>('workshop_item_details_cmd', { id }));
  },

  /**
   * Installs the mod(s) in a downloaded .zip or an extracted folder into Zomboid/mods.
   * Rejects with a message starting with INSTALL_CONFLICT: (JSON {existing_folders}) when
   * folders already exist and replaceExisting is false.
   */
  /** Forgets cached Workshop/Nexus answers (after installing, or on a manual refresh). */
  clearRemoteCache,
  /** Warms a cache key in the background. */
  prefetch,

  installMods: async (source: string, paths: StudioPathsUI, replaceExisting: boolean, origin?: ModOrigin): Promise<InstallResult> => {
    return await invoke<InstallResult>('install_mods_cmd', { source, paths, replaceExisting, origin: origin ?? null });
  },

  /** Steam Workshop details for item ids (no key needed). Throws on failure. */
  workshopDetails: async (ids: string[]): Promise<WorkshopItem[]> => {
    return await cached(`workshop:details:${[...ids].sort().join(',')}`, () => invoke<WorkshopItem[]>('workshop_details_cmd', { ids }));
  },

  /** Copies a mod the installed build won't load into Zomboid/mods and adapts it. Throws with the reason. */
  makeCompatibleCopy: async (paths: StudioPathsUI, modId: string, replaceExisting: boolean): Promise<CompatResult> => {
    return await invoke<CompatResult>('make_compatible_copy_cmd', { paths, modId, replaceExisting });
  },

  /** Merges the given conflicting files into the active patch package (safe cases only). Throws with the reason. */
  autoMergeConflicts: async (paths: StudioPathsUI, relativePaths: string[]): Promise<AutoMergeResult> => {
    return await invoke<AutoMergeResult>('auto_merge_conflicts_cmd', { paths, relativePaths });
  },

  /** Removes a compatible copy (moved to Zomboid/PZModStudio_Backups/mods). */
  removeCompatibleCopy: async (paths: StudioPathsUI, folder: string): Promise<void> => {
    await invoke('remove_compatible_copy_cmd', { paths, folder });
  },

  /** Whether a Steam Web API key is saved (the key is never returned). */
  steamKeyStatus: async (): Promise<boolean> => {
    return await invoke<boolean>('steam_key_status_cmd');
  },

  /** Verifies and saves the key in Windows Credential Manager. Throws with the reason on failure. */
  setSteamKey: async (key: string): Promise<void> => {
    await invoke('set_steam_key_cmd', { key });
  },

  deleteSteamKey: async (): Promise<void> => {
    await invoke('delete_steam_key_cmd');
  },

  /** Workshop search with the saved key. Throws on failure (no key, rejected key, offline). */
  workshopSearch: async (query: WorkshopBrowseQuery): Promise<WorkshopSearchResult> => {
    return await cached(TauriService.workshopSearchKey(query), () =>
      invoke<WorkshopSearchResult>('workshop_search_cmd', {
        query: { perPage: 30, ...query, text: query.text || null, category: query.category || null, build: query.build || null },
      })
    );
  },

  /** The cache key for a search, so a page can be warmed before the user asks for it. */
  workshopSearchKey: (q: WorkshopBrowseQuery): string =>
    `workshop:search:${q.collections ? 'c' : 'm'}:${q.sort ?? ''}:${q.days ?? ''}:${q.build ?? ''}:${q.category ?? ''}:${q.page}:${q.text ?? ''}`,

  /**
   * Subscribes or unsubscribes through the Steam client that is already signed in (no API key).
   * Steam downloads or removes the files itself. Throws with the reason.
   */
  workshopSubscribe: async (paths: StudioPathsUI, ids: string[], subscribe: boolean): Promise<SubscribeOutcome> => {
    const outcome = await invoke<SubscribeOutcome>('workshop_subscribe_cmd', { paths, ids, subscribe });
    clearRemoteCache('workshop:');
    return outcome;
  },

  /** Whether subscribing from here works right now (Steam running and signed in). */
  steamClientReady: async (paths: StudioPathsUI): Promise<boolean> => {
    try {
      return await invoke<boolean>('steam_client_ready_cmd', { paths });
    } catch {
      return false;
    }
  },

  /** A mod's own poster/icon on disk, as a data URL the webview can show. Throws with the reason. */
  readModImage: async (paths: StudioPathsUI, path: string): Promise<string> => {
    return await invoke<string>('read_mod_image_cmd', { paths, path });
  },

  /** Looks up pasted Workshop links / ids / a collection link. Throws on failure. */
  workshopLookup: async (input: string): Promise<WorkshopLookup> => {
    // Pasted text is looked up fresh; only the two helpers below are cached.
    return await invoke<WorkshopLookup>('workshop_lookup_cmd', { input });
  },

  /**
   * Game-exact load-order sort: moves only what require/loadModAfter/loadModBefore force,
   * keeps everything else in place, Studio packages last.
   */
  sortLoadOrder: async (paths: StudioPathsUI, order: string[]): Promise<SortResult> => {
    try {
      return await invoke<SortResult>('sort_load_order_cmd', { paths, order });
    } catch (err) {
      reportBackendError('Sorting the load order', err);
      throw err;
    }
  },

  /**
   * Validates Lua AST syntax using Rust full_moon parser
   */
  validateLuaSyntax: async (code: string): Promise<LuaSyntaxResult> => {
    try {
      return await invoke<LuaSyntaxResult>('validate_lua_syntax_cmd', { code });
    } catch (err) {
      return { is_valid: false, error_message: String(err) };
    }
  },

  /**
   * Performs 3-way AST merge on Lua code
   */
  threeWayMergeLua: async (base: string, targetA: string, targetB: string): Promise<MergeChunkResult> => {
    try {
      return await invoke<MergeChunkResult>('three_way_merge_lua_cmd', { base, targetA, targetB });
    } catch (err) {
      return { merged_text: base, has_conflict: true };
    }
  },

  /**
   * Reads ModListData.ini file
   */
  readModListIni: async (iniPath: string): Promise<ModListDataRaw> => {
    try {
      return await invoke<ModListDataRaw>('read_mod_list_ini_cmd', { iniPath });
    } catch (err) {
      return { active_mods: [], raw_ini_content: '' };
    }
  },

  /**
   * Writes active mod load order back to ModListData.ini
   */
  writeModListIni: async (iniPath: string, activeMods: string[]): Promise<void> => {
    try {
      await invoke('write_mod_list_ini_cmd', { iniPath, activeMods });
    } catch (err) {
      reportBackendError('Saving the mod list', err);
      throw err;
    }
  },

  /**
   * Generates the synthetic master patch mod under Zomboid/mods/Z_PZModStudio_MergedPatch
   */
  generateMasterPatch: async (req: {
    workshop_dir?: string;
    pz_install_dir?: string;
    user_zomboid_dir: string;
    mod_list_ini_path: string;
    merged_files: { relative_path: string; content: string }[];
    package_folder_name?: string;
  }): Promise<MasterPatchResultUI> => {
    try {
      return await invoke<MasterPatchResultUI>('generate_master_patch_cmd', { req });
    } catch (err) {
      reportBackendError('Generating the merge package', err);
      throw err;
    }
  },

  /**
   * Safely removes Z_PZModStudio_MergedPatch synthetic patch files from disk
   */
  cleanMasterPatch: async (req: {
    workshop_dir?: string;
    pz_install_dir?: string;
    user_zomboid_dir: string;
    mod_list_ini_path: string;
    merged_files?: { relative_path: string; content: string }[];
    package_folder_name?: string;
  }): Promise<boolean> => {
    try {
      return await invoke<boolean>('clean_master_patch_cmd', {
        req: {
          ...req,
          merged_files: req.merged_files || [],
        },
      });
    } catch (err) {
      reportBackendError('Unpacking the merge package', err);
      return false;
    }
  },

  /**
   * Reads current packaging status and metadata for Z_PZModStudio_MergedPatch
   */
  getMasterPatchStatus: async (userZomboidDir: string, modListIniPath: string, packageFolderName?: string): Promise<MasterPatchStatusInfoUI> => {
    try {
      return await invoke<MasterPatchStatusInfoUI>('get_master_patch_status_cmd', {
        userZomboidDir,
        modListIniPath,
        packageFolderName: packageFolderName || null,
      });
    } catch (err) {
      console.error('Failed to get master patch status:', err);
      return {
        is_packaged: false,
        packaged_mods: [],
        merged_files: [],
        missing_active_mods: [],
      };
    }
  },

  /**
   * Lists all existing merged packages under Zomboid/mods/Z_PZModStudio_*
   */
  listMergedPackages: async (userZomboidDir: string, modListIniPath: string): Promise<MergedPackageInfoUI[]> => {
    try {
      return await invoke<MergedPackageInfoUI[]>('list_merged_packages_cmd', { userZomboidDir, modListIniPath });
    } catch (err) {
      console.error('Failed to list merged packages:', err);
      return [];
    }
  },

  /**
   * Creates a new named merged package (e.g. "Mix Mods" -> Z_PZModStudio_MixMods)
   */
  createMergedPackage: async (userZomboidDir: string, modListIniPath: string, name: string, description?: string): Promise<MergedPackageInfoUI | null> => {
    try {
      return await invoke<MergedPackageInfoUI>('create_merged_package_cmd', { userZomboidDir, modListIniPath, name, description });
    } catch (err) {
      reportBackendError('Creating the package', err);
      return null;
    }
  },

  /**
   * Renames an existing merged package
   */
  renameMergedPackage: async (userZomboidDir: string, modListIniPath: string, oldFolder: string, newName: string, description?: string): Promise<MergedPackageInfoUI | null> => {
    try {
      return await invoke<MergedPackageInfoUI>('rename_merged_package_cmd', { userZomboidDir, modListIniPath, oldFolder, newName, description });
    } catch (err) {
      reportBackendError('Renaming the package', err);
      return null;
    }
  },

  /**
   * Toggles a merged package presence (active/hidden) in ModListData.ini / default.txt
   */
  togglePackageInModlist: async (
    userZomboidDir: string,
    modListIniPath: string,
    folderName: string,
    enabled: boolean
  ): Promise<boolean> => {
    try {
      return await invoke<boolean>('toggle_package_in_modlist_cmd', {
        userZomboidDir,
        modListIniPath,
        folderName,
        enabled,
      });
    } catch (err) {
      reportBackendError('Updating the package in the mod list', err);
      return false;
    }
  },


  /**
   * Deletes a merged package directory from disk
   */
  deleteMergedPackage: async (userZomboidDir: string, modListIniPath: string, folderName: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('delete_merged_package_cmd', {
        userZomboidDir,
        modListIniPath,
        folderName,
      });
    } catch (err) {
      reportBackendError('Deleting the package', err);
      return false;
    }
  },

  saveDraftResolution: async (
    userZomboidDir: string,
    packageFolderName: string,
    relativePath: string,
    resolvedContent: string,
    status: string
  ): Promise<boolean> => {
    try {
      return await invoke<boolean>('save_draft_resolution_cmd', {
        userZomboidDir,
        packageFolderName,
        relativePath,
        resolvedContent,
        status,
      });
    } catch (err) {
      reportBackendError('Saving the draft', err);
      return false;
    }
  },

  clearDraftResolutions: async (
    userZomboidDir: string,
    packageFolderName: string
  ): Promise<boolean> => {
    try {
      return await invoke<boolean>('clear_draft_resolutions_cmd', {
        userZomboidDir,
        packageFolderName,
      });
    } catch (err) {
      reportBackendError('Clearing drafts', err);
      return false;
    }
  },
  exportMergedPackage: async (
    userZomboidDir: string,
    packageFolderName: string,
    targetFilePath: string
  ): Promise<boolean> => {
    try {
      return await invoke<boolean>('export_merged_package_cmd', {
        userZomboidDir,
        packageFolderName,
        targetFilePath,
      });
    } catch (err) {
      reportBackendError('Exporting the package', err);
      throw err;
    }
  },

  importMergedPackage: async (
    userZomboidDir: string,
    modListIniPath: string,
    sourceFilePath: string
  ): Promise<MergedPackageInfoUI> => {
    try {
      return await invoke<MergedPackageInfoUI>('import_merged_package_cmd', {
        userZomboidDir,
        modListIniPath,
        sourceFilePath,
      });
    } catch (err) {
      reportBackendError('Importing the package', err);
      throw err;
    }
  },

  /**
   * Things two or more active mods declare: the same item or recipe in differently named files,
   * which collide nowhere on disk. Asked for separately because it reads every script.
   */
  scriptConflicts: async (paths: StudioPathsUI, active: string[]): Promise<HealthIssue[]> => {
    try {
      return await invoke<HealthIssue[]>('script_conflicts_cmd', { paths, active });
    } catch {
      // Nothing is broken if this cannot be read; the rest of the health check stands on its own.
      return [];
    }
  },

  /** What the Build 42 shim covers, read from the shim that ships. */
  polyfillSections: async (): Promise<PolyfillSection[]> => {
    try {
      return await invoke<PolyfillSection[]>('polyfill_sections_cmd');
    } catch {
      return [];
    }
  },

  /** Every earlier version of the mod list the Studio kept, newest first. */
  modListHistory: async (paths: StudioPathsUI): Promise<ModListVersion[]> => {
    try {
      return await invoke<ModListVersion[]>('mod_list_history_cmd', { paths });
    } catch {
      // No history is not an error: there may simply be no saved versions yet.
      return [];
    }
  },

  /** Puts one back and returns the mods it switches on. Throws with the reason. */
  restoreModListVersion: async (paths: StudioPathsUI, backupFile: string): Promise<string[]> => {
    return await invoke<string[]>('restore_mod_list_version_cmd', { paths, backupFile });
  },

  /** The hunt for a culprit mod that the player left running, if there is one. */
  bisectState: async (paths: StudioPathsUI): Promise<BisectSession | null> => {
    try {
      return await invoke<BisectSession | null>('bisect_state_cmd', { paths });
    } catch {
      // A hunt that cannot be read is simply no hunt; the Monitor offers to start one.
      return null;
    }
  },

  /** Starts halving the list. The mods switched on now are the suspects. Throws with the reason. */
  bisectStart: async (paths: StudioPathsUI, mods: ModInfo[]): Promise<BisectSession> => {
    return await invoke<BisectSession>('bisect_start_cmd', {
      paths,
      mods: mods.map((m) => ({
        mod_id: m.mod_id,
        dependencies: m.dependencies ?? [],
        enabled: m.enabled,
      })),
    });
  },

  /** Answers the trial and switches the next one on. Throws with the reason. */
  bisectAnswer: async (paths: StudioPathsUI, stillHappens: boolean): Promise<BisectSession> => {
    return await invoke<BisectSession>('bisect_answer_cmd', { paths, stillHappens });
  },

  /** Ends the hunt and puts the player's list back, optionally without one mod. */
  bisectStop: async (paths: StudioPathsUI, switchOff: string | null): Promise<string[]> => {
    return await invoke<string[]>('bisect_stop_cmd', { paths, switchOff });
  },

  /**
   * Spawns isolated sandbox test run
   */
  launchSandbox: async (config: { pz_install_dir: string; user_zomboid_dir: string; test_mode: string }): Promise<number> => {
    try {
      return await invoke<number>('launch_sandbox_cmd', { config });
    } catch (err) {
      reportBackendError('Launching the game', err);
      throw err;
    }
  },

  /**
   * Listens to realtime log streaming events from Rust sandbox
   */
  listenSandboxLogs: async (callback: (payload: SandboxLogPayload) => void): Promise<UnlistenFn> => {
    return await listen<SandboxLogPayload>('sandbox-log', (event) => {
      callback(event.payload);
    });
  },

  /**
   * Listens to translated crash error cards from Rust log watcher
   */
  /**
   * Listens to translated crash error cards from Rust log watcher
   */
  listenSandboxErrorCards: async (callback: (card: TranslatedErrorCard) => void): Promise<UnlistenFn> => {
    return await listen<TranslatedErrorCard>('sandbox-error-card', (event) => {
      callback(event.payload);
    });
  },



  // ==========================================
  // Presets & File Dialogs (.pzpack, .pzmerge)
  // ==========================================
  pickSaveFile: async (defaultName?: string, filterName?: string, filterExt?: string): Promise<string | null> => {
    try {
      return await invoke<string | null>('pick_save_file_cmd', {
        defaultName,
        filterName,
        filterExt,
      });
    } catch (err) {
      return null;
    }
  },

  pickOpenFile: async (filterName?: string, filterExt?: string): Promise<string | null> => {
    try {
      return await invoke<string | null>('pick_open_file_cmd', {
        filterName,
        filterExt,
      });
    } catch (err) {
      return null;
    }
  },

  /**
   * One Markdown file describing an error — the log line, the build, the mod, the code — so it
   * can be handed to someone, or to an AI agent, away from this machine. Throws with the reason.
   */
  buildErrorReport: async (
    paths: StudioPathsUI,
    request: {
      rawError: string;
      title: string;
      explanation: string;
      modName?: string | null;
      sourceFile?: string | null;
      logContext: string[];
    }
  ): Promise<string> => {
    return await invoke<string>('error_report_cmd', { paths, request });
  },

  /** Writes text where the user chose. Throws with the reason. */
  saveTextFile: async (path: string, contents: string): Promise<void> => {
    await invoke('save_text_file_cmd', { path, contents });
  },

  /** Where this Studio's MCP server is, for the config snippet. */
  mcpServerPath: async (): Promise<string> => {
    try {
      return await invoke<string>('mcp_server_path_cmd');
    } catch {
      return 'pz-mcp-server.exe';
    }
  },

  /** Shows a mod's folder in Explorer. Throws with the reason. */
  openModFolder: async (paths: StudioPathsUI, folder: string): Promise<void> => {
    try {
      await invoke('open_mod_folder_cmd', { paths, folder });
    } catch (err) {
      reportBackendError('Opening the folder', err);
    }
  },

  openPackageFolder: async (userZomboidDir: string, packageFolderName: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('open_package_folder_cmd', {
        userZomboidDir,
        packageFolderName,
      });
    } catch (err) {
      console.error('Failed to open package folder in explorer:', err);
      return false;
    }
  },

  openLogsFolder: async (userZomboidDir: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('open_logs_folder_cmd', { userZomboidDir });
    } catch (err) {
      console.error('Failed to open logs folder in explorer:', err);
      return false;
    }
  },

  listAvailableLogFiles: async (userZomboidDir: string): Promise<any[]> => {
    try {
      return await invoke<any[]>('list_available_log_files_cmd', { userZomboidDir });
    } catch (err) {
      console.error('Failed to list available log files:', err);
      return [];
    }
  },

  readLogFile: async (filePath: string, maxLines?: number): Promise<string[]> => {
    try {
      return await invoke<string[]>('read_log_file_cmd', { filePath, maxLines });
    } catch (err) {
      console.error('Failed to read log file:', err);
      return [];
    }
  },

  /**
   * Writes a .pzpack. Each mod's version and the publish time of the copy on disk are filled in
   * by the backend from this install, so the pack records what the list was really tested with.
   */
  exportPresetFile: async (paths: StudioPathsUI, preset: any, filePath: string): Promise<any> => {
    return await invoke('export_preset_file', { paths, preset, filePath });
  },

  importPresetFile: async (filePath: string): Promise<any> => {
    return await invoke('import_preset_file', { filePath });
  },

  checkMissingPresetMods: async (preset: any, userZomboidDir: string, workshopDir: string): Promise<any> => {
    return await invoke('check_missing_preset_mods', { preset, userZomboidDir, workshopDir });
  },

  // ==========================================
  // Server Manager & Dedicated Sync
  // ==========================================
  listServerConfigs: async (userZomboidDir: string): Promise<any[]> => {
    return await invoke('list_server_configs', { userZomboidDir });
  },

  /**
   * Writes this mod list into a server's .ini: Mods=, WorkshopItems= and Map=. The Workshop ids
   * and map names come from the installed mods, so the caller does not have to work them out.
   * Returns what was written; throws with the reason.
   */
  syncClientToServer: async (
    paths: StudioPathsUI,
    filePath: string,
    activeModIds: string[]
  ): Promise<ServerLines> => {
    return await invoke<ServerLines>('sync_client_to_server', { paths, filePath, activeModIds });
  },

  /** Everything in a server's .ini that will not do what the admin meant. */
  checkServerMods: async (paths: StudioPathsUI, filePath: string): Promise<ServerModReport | null> => {
    try {
      return await invoke<ServerModReport>('check_server_mods', { paths, filePath });
    } catch {
      // An .ini that cannot be read is reported by the list itself; no need to shout twice.
      return null;
    }
  },

  createNewServerConfig: async (
    userZomboidDir: string,
    serverName: string
  ): Promise<PZServerConfig> => {
    return await invoke('create_new_server_config', { userZomboidDir, serverName });
  },

  deleteServerConfig: async (
    userZomboidDir: string,
    filePath: string,
    serverName?: string
  ): Promise<boolean> => {
    return await invoke('delete_server_config', { userZomboidDir, filePath, serverName });
  },

  launchDedicatedServer: async (
    pzInstallDir: string,
    userZomboidDir: string,
    serverName: string,
    memoryGb?: number,
    nosteam?: boolean,
    adminPassword?: string
  ): Promise<number> => {
    return await invoke('launch_dedicated_server', {
      pzInstallDir,
      userZomboidDir,
      serverName,
      memoryGb,
      nosteam,
      adminPassword,
    });
  },

  stopDedicatedServer: async (userZomboidDir: string, pid?: number): Promise<boolean> => {
    return await invoke('stop_dedicated_server', { userZomboidDir, pid });
  },

  getDedicatedServerStatus: async (userZomboidDir: string): Promise<DedicatedServerStatus> => {
    return await invoke('get_dedicated_server_status', { userZomboidDir });
  },

  getDedicatedServerLogs: async (userZomboidDir: string, maxLines?: number): Promise<string[]> => {
    return await invoke('get_dedicated_server_logs', { userZomboidDir, maxLines });
  },

  saveServerLogSnapshot: async (
    userZomboidDir: string,
    serverName: string,
    customLines?: string[]
  ): Promise<string> => {
    return await invoke('save_server_log_snapshot', {
      userZomboidDir,
      serverName,
      customLines,
    });
  },

  getConnectedPlayers: async (userZomboidDir: string): Promise<ConnectedPlayer[]> => {
    return await invoke('get_connected_players', { userZomboidDir });
  },

  sendServerCommand: async (
    userZomboidDir: string,
    action: string,
    target?: string,
    message?: string,
    reason?: string
  ): Promise<boolean> => {
    return await invoke('send_server_command', {
      userZomboidDir,
      action,
      target,
      message,
      reason,
    });
  },

  getServerQuickSettings: async (filePath: string): Promise<ServerQuickSettings> => {
    return await invoke('get_server_quick_settings', { filePath });
  },

  saveServerQuickSettings: async (filePath: string, settings: ServerQuickSettings): Promise<boolean> => {
    return await invoke('save_server_quick_settings', { filePath, settings });
  },

  // ==========================================
  // Modrinth-Style Instance & Profile Manager
  // ==========================================
  listInstances: async (userZomboidDir: string): Promise<any[]> => {
    return await invoke('list_instances', { userZomboidDir });
  },

  createInstance: async (
    userZomboidDir: string,
    name: string,
    description: string | undefined,
    activeModIds: string[],
    loadOrder: string[]
  ): Promise<any> => {
    return await invoke('create_instance', { userZomboidDir, name, description, activeModIds, loadOrder });
  },

  activateInstance: async (userZomboidDir: string, instanceId: string): Promise<void> => {
    return await invoke('activate_instance', { userZomboidDir, instanceId });
  },

  deleteInstance: async (userZomboidDir: string, instanceId: string): Promise<void> => {
    return await invoke('delete_instance', { userZomboidDir, instanceId });
  },

  updateInstance: async (userZomboidDir: string, instance: any): Promise<any> => {
    return await invoke('update_instance', { userZomboidDir, instance });
  },

  saveMasterLoadOrder: async (
    userZomboidDir: string,
    loadOrder: string[],
    activeModIds: string[]
  ): Promise<void> => {
    return await invoke('save_master_load_order', { userZomboidDir, loadOrder, activeModIds });
  },
};
