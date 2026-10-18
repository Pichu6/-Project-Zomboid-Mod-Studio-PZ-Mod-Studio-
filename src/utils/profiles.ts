import { AppInstance } from '../types';
import { TauriService } from '../services/tauri';

/**
 * Puts a mod in a profile from outside it (a Browse card, a Mod List row): switched on, at the
 * end of its order, once. Returns the profile as saved, or null when the mod was already in it.
 */
export async function addModToProfile(userZomboidDir: string, profile: AppInstance, modId: string): Promise<AppInstance | null> {
  if (profile.active_mod_ids.includes(modId)) return null;
  const updated: AppInstance = {
    ...profile,
    active_mod_ids: [...profile.active_mod_ids, modId],
    load_order: profile.load_order.includes(modId) ? profile.load_order : [...profile.load_order, modId],
  };
  await TauriService.updateInstance(userZomboidDir, updated);
  return updated;
}
