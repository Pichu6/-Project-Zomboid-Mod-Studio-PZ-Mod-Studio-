import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { StudioPathsUI } from '../components/settings/SettingsModule';
import { VfsConflict, TranslatedErrorCard } from '../types';

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

/**
 * Service layer wrapping all native Tauri Rust backend IPC calls
 */
export const TauriService = {
  /**
   * Auto-detects Project Zomboid installation and user directories
   */
  getAutoPaths: async (): Promise<StudioPathsUI> => {
    try {
      return await invoke<StudioPathsUI>('get_auto_paths');
    } catch (err) {
      console.warn('Fallback to default paths:', err);
      return {
        pz_install_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\ProjectZomboid',
        workshop_dir: 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\108600',
        user_zomboid_dir: 'C:\\Users\\User\\Zomboid',
        mod_list_ini_path: 'C:\\Users\\User\\Zomboid\\Lua\\ModManager\\ModListData.ini',
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
