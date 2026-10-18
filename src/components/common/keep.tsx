import React, { useState } from 'react';
import { FolderPlus, ListPlus, Star } from 'lucide-react';
import { AppInstance, ModListItem } from '../../types';
import { MenuItem } from './ContextMenu';
import { ChooseDialog } from './ChooseDialog';
import { useModLists } from '../../services/modLists';
import { addModToProfile } from '../../utils/profiles';
import { StudioPathsUI } from '../settings/SettingsModule';

/** A mod as a card or a row knows it: where it comes from, and which installed mods it is. */
export interface KeepTarget {
  workshop_id?: string | null;
  nexus_id?: number | null;
  mod_id?: string | null;
  name: string;
  /** The installed mod ids this is (a Workshop item can hold several); empty when not installed. */
  installedModIds: string[];
}

const asItem = (t: KeepTarget): ModListItem => ({
  workshop_id: t.workshop_id ?? null,
  nexus_id: t.nexus_id ?? null,
  mod_id: t.mod_id ?? (t.workshop_id || t.nexus_id ? null : t.installedModIds[0] ?? null),
  name: t.name,
});

export interface KeepActions {
  isFavorite: (t: KeepTarget) => boolean;
  toggleFavorite: (t: KeepTarget) => Promise<void>;
  /** Favorite, Add to a list…, Add to a profile…: the same three wherever a mod is shown. */
  menuItems: (t: KeepTarget) => MenuItem[];
  /** The dialogs and the note: render once, anywhere in the screen. */
  node: React.ReactNode;
}

/**
 * The three ways of keeping a mod — star it, put it in a list, put it in a profile — as menu
 * items and a star, for the Browse cards, the detail page and the Mod List row alike.
 */
export function useKeepActions(paths: StudioPathsUI, profiles: AppInstance[], onProfilesChanged?: () => void, toast?: (message: string, ms?: number) => void): KeepActions {
  const lists = useModLists(paths.user_zomboid_dir);
  const [picking, setPicking] = useState<{ kind: 'list' | 'profile'; target: KeepTarget } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const say = (message: string) => {
    if (toast) toast(message, 4000);
    else {
      setNote(message);
      setTimeout(() => setNote(null), 4000);
    }
  };

  const isFavorite = (t: KeepTarget) => lists.isFavorite(asItem(t));
  const toggleFavorite = async (t: KeepTarget) => {
    const was = isFavorite(t);
    await lists.toggleFavorite(asItem(t));
    say(was ? `${t.name} is out of Favorites.` : `${t.name} is in Favorites (Browse Mods > My lists).`);
  };

  const menuItems = (t: KeepTarget): MenuItem[] => [
    {
      label: isFavorite(t) ? 'Unfavorite' : 'Favorite',
      icon: Star,
      separatorBefore: true,
      onSelect: () => void toggleFavorite(t),
      title: isFavorite(t) ? 'Takes it out of Favorites' : 'Puts it in Favorites, a list of yours (Browse Mods > My lists)',
    },
    {
      label: 'Add to a list…',
      icon: ListPlus,
      onSelect: () => setPicking({ kind: 'list', target: t }),
      title: 'A list of yours: for keeping, subscribing to all at once, or making a profile from',
    },
    {
      label: 'Add to a profile…',
      icon: FolderPlus,
      onSelect: () => setPicking({ kind: 'profile', target: t }),
      disabled: t.installedModIds.length === 0 || profiles.length === 0,
      disabledReason: profiles.length === 0 ? 'There is no profile yet (Profiles)' : 'Install it first: a profile holds installed mods',
      title: 'Switches it on in a profile of yours, at the end of its order',
    },
  ];

  const node = (
    <>
      {picking?.kind === 'list' && (
        <ChooseDialog
          title={`Add ${picking.target.name} to a list`}
          blurb="Your lists are in Browse Mods > My lists."
          options={lists.lists.map((l) => {
            const has = l.items.some((i) => (i.workshop_id && i.workshop_id === picking.target.workshop_id) || (i.nexus_id && i.nexus_id === picking.target.nexus_id) || (i.mod_id && i.mod_id === asItem(picking.target).mod_id));
            return { id: l.id, label: l.name, hint: `${l.items.length}`, disabledReason: has ? 'Already in it' : undefined };
          })}
          onPick={(id) => {
            const target = picking.target;
            setPicking(null);
            void lists.addTo(id, asItem(target)).then(() => say(`${target.name} is in ${lists.lists.find((l) => l.id === id)?.name ?? 'the list'}.`));
          }}
          onClose={() => setPicking(null)}
          allowNew={{
            placeholder: 'New list: a name',
            onCreate: async (name) => {
              const target = picking.target;
              const list = await lists.create(name);
              await lists.addTo(list.id, asItem(target));
              setPicking(null);
              say(`${target.name} is in ${list.name}, a new list.`);
            },
          }}
        />
      )}
      {picking?.kind === 'profile' && (
        <ChooseDialog
          title={`Add ${picking.target.name} to a profile`}
          blurb="Switched on at the end of the profile's order; Auto-Sort there puts it in place."
          options={profiles.map((p) => {
            const all = picking.target.installedModIds.every((id) => p.active_mod_ids.includes(id));
            return { id: p.id, label: p.name, hint: `${p.active_mod_ids.length} mods${p.is_active ? ' · active' : ''}`, disabledReason: all ? 'Already in it' : undefined };
          })}
          onPick={(id) => {
            const target = picking.target;
            const profile = profiles.find((p) => p.id === id);
            setPicking(null);
            if (!profile) return;
            void (async () => {
              let current = profile;
              for (const modId of target.installedModIds) {
                current = (await addModToProfile(paths.user_zomboid_dir, current, modId)) ?? current;
              }
              onProfilesChanged?.();
              say(`${target.name} is on in ${profile.name}${profile.is_active ? '; the Mod List shows it after a refresh' : ''}.`);
            })();
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {note && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-xs text-slate-100 shadow-2xl">{note}</div>
      )}
    </>
  );

  return { isFavorite, toggleFavorite, menuItems, node };
}

/** A star to click, for a card's chips or a detail page's header. */
export const StarButton: React.FC<{ keep: KeepActions; target: KeepTarget; className?: string }> = ({ keep, target, className = '' }) => {
  const on = keep.isFavorite(target);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void keep.toggleFavorite(target);
      }}
      aria-pressed={on}
      title={on ? 'In Favorites. Click: take it out' : 'Favorite: keep it in a list of yours (Browse Mods > My lists)'}
      className={`p-1 rounded-md border cursor-pointer transition ${on ? 'border-amber-500/70 bg-amber-950/50 text-amber-300' : 'border-slate-700 text-slate-500 hover:text-amber-300 hover:border-amber-700'} ${className}`}
    >
      <Star className={`w-3.5 h-3.5 ${on ? 'fill-amber-400' : ''}`} aria-hidden="true" />
    </button>
  );
};
