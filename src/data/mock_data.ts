import { VfsConflict, ModInfo, TranslatedErrorCard } from '../types';

export const MOCK_CONFLICTS: VfsConflict[] = [
  {
    id: 'c1',
    relative_path: 'media/lua/client/ISUI/ISInventoryPane.lua',
    file_type: 'LUA',
    status: 'MANUAL_CONFLICT',
    start_line: 350,
    end_line: 356,
    conflict_line: 354,
    total_file_lines: 1420,
    base_content: `-- Vanilla ISInventoryPane.lua
function ISInventoryPane:renderDetails(item)
    local y = 10
    self:drawText(item:getName(), 10, y, 1, 1, 1, 1, UIFont.Medium)
end`,
    competing_mods: [
      {
        mod_id: 'AuthenticZ',
        mod_name: 'Authentic Z Overhaul',
        absolute_path: 'C:/Steam/workshop/content/108600/2335368829/media/lua/client/ISUI/ISInventoryPane.lua',
        content: `-- AuthenticZ Custom Inventory
function ISInventoryPane:renderDetails(item)
    local y = 10
    self:drawText("[AZ] " .. item:getName(), 10, y, 0.2, 0.8, 1.0, 1, UIFont.Medium)
    self:drawTexture(item:getTexture(), 150, y)
end`,
        is_selected: true,
      },
      {
        mod_id: 'ImprovedUI',
        mod_name: 'Improved UI Textures',
        absolute_path: 'C:/Steam/workshop/content/108600/2991122341/media/lua/client/ISUI/ISInventoryPane.lua',
        content: `-- ImprovedUI Render Details
function ISInventoryPane:renderDetails(item)
    local y = 10
    self:drawText(item:getName(), 10, y, 1, 1, 0.5, 1, UIFont.Medium)
    self:drawBadge(item:getCondition())
end`,
        is_selected: false,
      },
    ],
    merged_output: `-- Merged ISInventoryPane.lua (PZ Mod Studio)
function ISInventoryPane:renderDetails(item)
    local y = 10
    self:drawText("[AZ] " .. item:getName(), 10, y, 0.2, 0.8, 1.0, 1, UIFont.Medium)
    self:drawTexture(item:getTexture(), 150, y)
    self:drawBadge(item:getCondition())
end`,
  },
  {
    id: 'c2',
    relative_path: 'media/scripts/items_weapons.txt',
    file_type: 'SCRIPT_TXT',
    status: 'AUTO_MERGED',
    start_line: 112,
    end_line: 119,
    conflict_line: 115,
    total_file_lines: 850,
    base_content: `module Base {
    item BaseballBat {
        Weight = 2.0,
        Type = Weapon,
        MinDamage = 0.8,
        MaxDamage = 1.4,
    }
}`,
    competing_mods: [
      {
        mod_id: 'WeaponRebalance',
        mod_name: 'Realistic Weapons B42',
        absolute_path: 'C:/Steam/workshop/content/108600/11223344/media/scripts/items_weapons.txt',
        content: `module Base {
    item BaseballBat {
        Weight = 1.8,
        MinDamage = 1.0,
    }
}`,
      },
      {
        mod_id: 'MoreCraftingItems',
        mod_name: 'Crafting Overhaul',
        absolute_path: 'C:/Steam/workshop/content/108600/55667788/media/scripts/items_weapons.txt',
        content: `module Base {
    item BaseballBat {
        MaxDamage = 1.6,
        Tags = HeavyWeapon;Wooden,
    }
}`,
      },
    ],
    merged_output: `module Base {
    item BaseballBat {
        Weight = 1.8,
        Type = Weapon,
        MinDamage = 1.0,
        MaxDamage = 1.6,
        Tags = HeavyWeapon;Wooden,
    }
}`,
  },
];

export const MOCK_MODS: ModInfo[] = [
  {
    mod_id: 'ModManager',
    name: 'Mod Manager B42',
    description: 'Essential library for managing mod loading.',
    workshop_id: '2694448564',
    author: 'NSS',
    version: '42.1.0',
    dependencies: [],
    enabled: true,
    is_library: true,
    load_order_index: 0,
  },
  {
    mod_id: 'AuthenticZ',
    name: 'Authentic Z Overhaul',
    description: 'Adds hundreds of clothing variations and zombie attire.',
    workshop_id: '2335368829',
    author: 'AuthenticPeach',
    version: '3.2.0',
    dependencies: ['ModManager'],
    enabled: true,
    is_library: false,
    load_order_index: 1,
  },
  {
    mod_id: 'WeaponRebalance',
    name: 'Realistic Weapons B42',
    description: 'Adjusts weapon damages for Build 42 combat mechanics.',
    workshop_id: '11223344',
    author: 'GunnerPZ',
    version: '1.0.4',
    dependencies: ['ModManager'],
    enabled: true,
    is_library: false,
    load_order_index: 2,
  },
  {
    mod_id: 'RavenCreek',
    name: 'Raven Creek Map B42',
    description: 'Massive city map addition.',
    workshop_id: '2196159049',
    author: 'Eris',
    version: '2.1.0',
    dependencies: ['ModManager', 'AuthenticZ'],
    enabled: true,
    is_map_mod: true,
    load_order_index: 3,
  },
];

export const MOCK_ERROR_CARDS: TranslatedErrorCard[] = [
  {
    id: 'e1',
    raw_error: 'java.lang.UnknownFormatConversionException: Conversion = "%"',
    source_file: 'zombie/core/Translator.java',
    line_number: 142,
    title: 'Translator Format Exception (% character)',
    explanation: 'A mod called Translator.getText() with an unescaped % or . character. Java string formatting crashed while attempting to evaluate the string.',
    recommended_action: 'Apply Polyfill Rule: "SANITIZE_TRANSLATOR_FORMAT" to wrap all Translator.getText calls safely.',
    polyfill_rule_id_suggestion: 'SANITIZE_TRANSLATOR_FORMAT',
  },
  {
    id: 'e2',
    raw_error: 'KahluaThreadException: attempted index of non-table (ISInventoryPane)',
    source_file: 'media/lua/client/ISUI/ISInventoryPane.lua',
    line_number: 58,
    title: 'Uninitialized Global Table Access',
    explanation: 'Legacy mod code tried to read properties of ISInventoryPane before the global table was instantiated by PZ Build 42.',
    recommended_action: 'Apply Polyfill Rule: "SAFE_GLOBAL_TABLE_ACCESS" to inject a safe proxy metatable.',
    polyfill_rule_id_suggestion: 'SAFE_GLOBAL_TABLE_ACCESS',
  },
];
