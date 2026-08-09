import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { StudioPathsUI } from '../components/settings/SettingsModule';
import { VfsConflict, ModInfo, TranslatedErrorCard } from '../types';

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
}

export interface SandboxLogPayload {
  line: string;
  is_error: boolean;
}

export interface MasterPatchResultUI {
  success: boolean;
  patch_mod_dir: string;
  files_written: number;
  polyfills_injected: number;
}

const STORAGE_KEY_PATHS = 'pz_mod_studio_paths_profile';

/**
 * Service layer wrapping all native Tauri Rust backend IPC calls
 */
export const TauriService = {
  /**
   * Opens any external web URL in the user's default system browser
   */
  openExternalUrl: async (url: string): Promise<void> => {
    try {
      await invoke('open_external_url_cmd', { url });
    } catch (err) {
      console.error('Failed to open external URL:', err);
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
  scanConflicts: async (paths: StudioPathsUI): Promise<VfsConflict[]> => {
    try {
      const rawConflicts = await invoke<any[]>('scan_conflicts_cmd', { paths });
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
        competing_mods: c.competing_files.map((f: any) => ({
          mod_id: f.mod_id,
          mod_name: f.mod_name,
          absolute_path: f.absolute_path,
          content: f.content,
        })),
        status: 'MANUAL_CONFLICT' as const,
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
        dependencies: m.require || [],
        enabled: m.enabled ?? false,
        icon_path: m.icon_path,
        poster_url: m.poster_url,
        is_library: m.is_library ?? false,
        is_map_mod: m.is_map_mod ?? false,
        load_order_index: idx + 1,
      }));
    } catch (err) {
      console.warn('Failed to scan installed mods:', err);
      return [];
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
      console.error('Failed to write ModListData.ini:', err);
    }
  },

  /**
   * Generates the synthetic master patch mod under Zomboid/mods/Z_PZModStudio_MergedPatch
   */
  generateMasterPatch: async (req: {
    pz_install_dir?: string;
    user_zomboid_dir: string;
    mod_list_ini_path: string;
    merged_files: { relative_path: string; content: string }[];
    active_polyfill_ids: string[];
  }): Promise<MasterPatchResultUI> => {
    try {
      return await invoke<MasterPatchResultUI>('generate_master_patch_cmd', { req });
    } catch (err) {
      console.error('Failed to generate master patch:', err);
      return { success: false, patch_mod_dir: '', files_written: 0, polyfills_injected: 0 };
    }
  },

  /**
   * Spawns isolated sandbox test run
   */
  launchSandbox: async (config: { pz_install_dir: string; user_zomboid_dir: string; test_mode: string }): Promise<number> => {
    try {
      return await invoke<number>('launch_sandbox_cmd', { config });
    } catch (err) {
      console.error('Sandbox launch failed:', err);
      return 0;
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
  listenSandboxErrorCards: async (callback: (card: TranslatedErrorCard) => void): Promise<UnlistenFn> => {
    return await listen<TranslatedErrorCard>('sandbox-error-card', (event) => {
      callback(event.payload);
    });
  },
};
