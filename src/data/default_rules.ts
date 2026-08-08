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
];
