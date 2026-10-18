import { CatalogModSummary, CommunityRegistry, ModInfo } from '../types';

/** The Studio's repository, where the index lives. */
export const COMMUNITY_REPO = 'https://github.com/Pichu6/-Project-Zomboid-Mod-Studio-PZ-Mod-Studio-';

/** A registry's file name: its id, with "/" written as "__" (dSAG's id has one). */
export const registryFileName = (modId: string) => `${modId.replace(/\//g, '__')}.json`;

/**
 * A registry filled with what the Studio already knows about an installed mod (mod.info, where
 * it came from, the build it runs on here), so a person proposing it adds only what they tested:
 * the mods it clashes with, the issues they saw. Every empty list is left in, as a prompt.
 */
export function draftRegistry(mod: ModInfo, catalog: CatalogModSummary | undefined, installedBuild: string | null): CommunityRegistry {
  const workshopId = mod.workshop_id ?? (catalog?.source.kind === 'workshop' ? catalog.source.workshop_id : undefined);
  const major = installedBuild?.match(/^\d{2}/)?.[0];
  const builds = mod.loadable_on_installed_build !== false && major ? [major] : [];
  return {
    id: mod.mod_id,
    name: mod.name,
    ...(workshopId ? { workshop_id: workshopId } : {}),
    authors: mod.author ? [mod.author] : [],
    builds,
    requires: mod.dependencies ?? [],
    incompatible: (mod.incompatible ?? []).map((id) => ({ id, note: 'per its mod.info', status: 'verified' as const })),
    load_after: [],
    issues: [],
  };
}

/**
 * GitHub's "new file" page for the registry, with the path and the content filled in: the
 * person signs in, reads it over, and presses "Propose changes"; GitHub forks and opens the pull
 * request for them. Nothing is sent from the app.
 */
export function proposeUrl(registry: CommunityRegistry): string {
  const value = JSON.stringify(registry, null, 2) + '\n';
  return `${COMMUNITY_REPO}/new/main/community/index?filename=${encodeURIComponent(registryFileName(registry.id))}&value=${encodeURIComponent(value)}`;
}
