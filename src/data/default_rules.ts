import { PolyfillRule } from '../types';

export const DEFAULT_POLYFILL_RULES: PolyfillRule[] = [
  {
    id: 'WRAP_STRING_TO_ENUM_BODY_LOCATION',
    name: 'Body Location String to Enum Wrapper',
    description: 'Intercepts legacy B41 calls passing String instead of ItemBodyLocation Enum in B42',
    category: 'ARGUMENT_TYPE_WRAPPER',
    severity: 'CRITICAL',
    enabled: true,
    pattern: {
      type: 'LUA_FUNCTION_CALL',
      target_function: 'player:getWornItem',
      arg_index: 0,
      expected_type: 'ENUM',
      received_type: 'STRING',
    },
    action: {
      type: 'AST_WRAPPER',
      wrapper_template: 'ItemBodyLocation.get({{arg_value}}) or {{arg_value}}',
    },
  },
  {
    id: 'SAFE_GLOBAL_TABLE_ACCESS',
    name: 'Safe Access to Uninitialized Globals',
    description: 'Prevents "attempted index of non-table" runtime crashes by wrapping missing global tables in safe proxies',
    category: 'SAFE_GLOBAL',
    severity: 'HIGH',
    enabled: true,
    pattern: {
      type: 'LUA_GLOBAL_INDEX',
      target_global: 'ISInventoryPane',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'if not ISInventoryPane then ISInventoryPane = {} setmetatable(ISInventoryPane, { __index = function() return function() end end }) end',
    },
  },
  {
    id: 'SANITIZE_TRANSLATOR_FORMAT',
    name: 'Sanitize Translator Format Strings',
    description: 'Cleans unescaped % and . in Translator.getText to prevent Java UnknownFormatConversionException crashes',
    category: 'TRANSLATOR_FIX',
    severity: 'CRITICAL',
    enabled: true,
    pattern: {
      type: 'JAVA_INTEROP_CALL',
      target_method: 'zombie.core.Translator.getText',
    },
    action: {
      type: 'REGEX_REPLACE',
      regex: 'Translator\\.getText\\((.*?)\\)',
      replacement: 'Z_PZModStudio_Polyfills.safeGetText($1)',
    },
  },
  {
    id: 'REQUIRE_PATH_REDIRECT',
    name: 'Redirect Legacy Require Paths',
    description: 'Maps moved or renamed B41 require paths to their updated B42 equivalents',
    category: 'REQUIRE_REDIRECT',
    severity: 'MEDIUM',
    enabled: true,
    pattern: {
      type: 'LUA_REQUIRE',
    },
    action: {
      type: 'PATH_MAP',
      mappings: {
        'ISUI/ISPanel': 'ISUI/ISPanelB42',
        'Vehicles/ISUI/ISVehicleMenu': 'Client/Vehicles/ISUI/ISVehicleMenu',
      },
    },
  },
  {
    id: 'DEPRECATED_EVENT_MIGRATION',
    name: 'Deprecated Event Hook Migration',
    description: 'Intercepts removed B41 event triggers (e.g. OnFillContainer) and routes them to B42 event equivalents',
    category: 'CUSTOM_SHIM',
    severity: 'HIGH',
    enabled: true,
    pattern: {
      type: 'EVENT_HOOK',
      target_event: 'Events.OnFillContainer',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'if Events.OnFillContainer == nil then Events.OnFillContainer = LuaEvent:new("OnFillContainer") end',
    },
  },
  {
    id: 'INVENTORY_ITEM_WRAPPER',
    name: 'Safe Inventory Item Methods',
    description: 'Wraps calls to item:getType() and item:getFullType() when legacy mods pass nil item instances',
    category: 'ARGUMENT_TYPE_WRAPPER',
    severity: 'HIGH',
    enabled: true,
    pattern: {
      type: 'LUA_METHOD_CALL',
      target_method: 'getType',
    },
    action: {
      type: 'AST_WRAPPER',
      wrapper_template: '(item and item:getType()) or ""',
    },
  },
  {
    id: 'FLUID_CONTAINER_POLYFILL',
    name: 'B42 Fluid Container API Polyfill',
    description: 'Converts legacy B41 drainable/liquid item method calls to the new B42 ItemFluidContainer API',
    category: 'ARGUMENT_TYPE_WRAPPER',
    severity: 'CRITICAL',
    enabled: true,
    pattern: {
      type: 'LUA_METHOD_CALL',
      target_method: 'getUsedDelta',
    },
    action: {
      type: 'AST_WRAPPER',
      wrapper_template: '(item and item:getFluidContainer() and item:getFluidContainer():getAmount()) or 0',
    },
  },
  {
    id: 'VEHICLE_PART_API_SHIM',
    name: 'Vehicle Part Device Data Compatibility',
    description: 'Bridges vehicle part API changes where getDeviceData() returned nil on non-radio vehicle parts',
    category: 'CUSTOM_SHIM',
    severity: 'MEDIUM',
    enabled: true,
    pattern: {
      type: 'LUA_METHOD_CALL',
      target_method: 'getDeviceData',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'if VehiclePart then local old = VehiclePart.getDeviceData; VehiclePart.getDeviceData = function(self) return old(self) or {} end end',
    },
  },
  {
    id: 'ISUI_ELEMENT_SAFE_CONSTRUCTOR',
    name: 'ISUI Panel Safe Font & Style Constructor',
    description: 'Ensures ISPanel:new and ISButton:new receive valid B42 font & style arguments',
    category: 'SAFE_GLOBAL',
    severity: 'MEDIUM',
    enabled: true,
    pattern: {
      type: 'LUA_FUNCTION_CALL',
      target_function: 'ISPanel:new',
    },
    action: {
      type: 'AST_WRAPPER',
      wrapper_template: 'ISPanel:new(x or 0, y or 0, width or 100, height or 50)',
    },
  },
  {
    id: 'CRAFTING_RECIPE_TAG_MAPPER',
    name: 'Crafting Recipe Tag & Fluid Mapper',
    description: 'Translates legacy B41 recipe item requirements into B42 Tag queries (e.g. Wooden;HeavyWeapon)',
    category: 'CUSTOM_SHIM',
    severity: 'HIGH',
    enabled: true,
    pattern: {
      type: 'PZ_SCRIPT_TAG',
    },
    action: {
      type: 'REGEX_REPLACE',
      regex: 'Result:(.*?),',
      replacement: 'Result:$1, Tags = CraftingIngredient,',
    },
  },
  {
    id: 'B42_OBJECT_INTERACT_SAFETY',
    name: 'B42 IsoDoor / IsoWindow / Thumpable Interop Safety',
    description: 'Safely wraps ToggleDoor, ToggleDoorActual, and ToggleWindow to prevent isLocalPlayer() NullPointerException during zombie thumping or NPC navigation',
    category: 'ARGUMENT_TYPE_WRAPPER',
    severity: 'CRITICAL',
    enabled: true,
    pattern: {
      type: 'LUA_METHOD_CALL',
      target_method: 'ToggleWindow',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'Z_PZModStudio_Polyfills (Universal Object Interop Guard)',
    },
  },
  {
    id: 'B42_BANDITS_ROOM_SAFETY',
    name: 'Bandits Week One Dining Room Safety',
    description: 'Guards square:getRoom() calls so outdoor or unzoned tiles safely fallback without throwing getName() of non-table exceptions',
    category: 'SAFE_GLOBAL',
    severity: 'CRITICAL',
    enabled: true,
    pattern: {
      type: 'LUA_GLOBAL_INDEX',
      target_global: 'BWORoomPrograms',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'Z_PZModStudio_Polyfills (BWORoomPrograms Dining Guard)',
    },
  },
  {
    id: 'B42_DAILY_REPORT_SAFETY',
    name: 'Daily Report Journal Window & Event Protection',
    description: 'Protects onNewDay, onPlayerDeath, and onDataReloaded callbacks from uninitialized ReportWindow method exceptions',
    category: 'CUSTOM_SHIM',
    severity: 'MEDIUM',
    enabled: true,
    pattern: {
      type: 'EVENT_HOOK',
      target_event: 'dSAG.onNewDay',
    },
    action: {
      type: 'RUNTIME_SHIM',
      shim_code: 'Z_PZModStudio_Polyfills (dSAG Window Protection)',
    },
  },
];
