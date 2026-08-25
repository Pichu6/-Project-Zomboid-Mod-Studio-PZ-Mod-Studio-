use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::load_order::ini_parser::{read_mod_list_ini, write_mod_list_ini};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedFilePayload {
    pub relative_path: String, // e.g. "media/lua/client/ISUI/ISInventoryPane.lua"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchRequest {
    pub workshop_dir: Option<String>,
    pub pz_install_dir: Option<String>,
    pub user_zomboid_dir: String,
    pub mod_list_ini_path: String,
    pub merged_files: Vec<MergedFilePayload>,
    pub active_polyfill_ids: Vec<String>,
    pub package_folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedPackageInfo {
    pub folder_name: String,
    pub display_name: String,
    pub mod_id: String,
    pub description: Option<String>,
    pub is_packaged: bool,
    pub is_active_in_modlist: bool,
    pub is_companion_bridge: bool,
    pub created_at: Option<String>,
    pub packaged_mods: Vec<String>,
    pub merged_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchMetadata {
    pub is_packaged: bool,
    pub created_at: String,
    pub packaged_mod_ids: Vec<String>,
    pub merged_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchStatusInfo {
    pub is_packaged: bool,
    pub created_at: Option<String>,
    pub packaged_mods: Vec<String>,
    pub merged_files: Vec<String>,
    pub missing_active_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPatchResult {
    pub success: bool,
    pub patch_mod_dir: String,
    pub files_written: usize,
    pub polyfills_injected: usize,
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let mut s1: u32 = 1;
    let mut s2: u32 = 0;
    for &b in data {
        s1 = (s1 + b as u32) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    (s2 << 16) | s1
}

pub fn generate_256x256_png_bytes() -> Vec<u8> {
    let mut png = Vec::new();
    png.extend_from_slice(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let mut ihdr_data = Vec::new();
    ihdr_data.extend_from_slice(&256u32.to_be_bytes());
    ihdr_data.extend_from_slice(&256u32.to_be_bytes());
    ihdr_data.push(8);
    ihdr_data.push(6);
    ihdr_data.push(0);
    ihdr_data.push(0);
    ihdr_data.push(0);

    let mut ihdr_chunk = Vec::new();
    ihdr_chunk.extend_from_slice(b"IHDR");
    ihdr_chunk.extend_from_slice(&ihdr_data);
    let ihdr_crc = crc32(&ihdr_chunk);

    png.extend_from_slice(&(ihdr_data.len() as u32).to_be_bytes());
    png.extend_from_slice(&ihdr_chunk);
    png.extend_from_slice(&ihdr_crc.to_be_bytes());

    let mut raw_data = Vec::with_capacity(262400);
    for _ in 0..256 {
        raw_data.push(0);
        for _ in 0..256 {
            raw_data.extend_from_slice(&[16, 185, 129, 255]);
        }
    }

    let adler = adler32(&raw_data);

    let mut zlib_stream = Vec::new();
    zlib_stream.extend_from_slice(&[0x78, 0x01]);

    let block_size = 65535;
    let mut offset = 0;
    while offset < raw_data.len() {
        let chunk_size = (raw_data.len() - offset).min(block_size);
        let is_final = (offset + chunk_size) == raw_data.len();
        let bfinal_btype = if is_final { 0x01 } else { 0x00 };

        zlib_stream.push(bfinal_btype);
        let len_u16 = chunk_size as u16;
        let nlen_u16 = !len_u16;

        zlib_stream.extend_from_slice(&len_u16.to_le_bytes());
        zlib_stream.extend_from_slice(&nlen_u16.to_le_bytes());
        zlib_stream.extend_from_slice(&raw_data[offset..offset + chunk_size]);

        offset += chunk_size;
    }

    zlib_stream.extend_from_slice(&adler.to_be_bytes());

    let mut idat_chunk = Vec::new();
    idat_chunk.extend_from_slice(b"IDAT");
    idat_chunk.extend_from_slice(&zlib_stream);
    let idat_crc = crc32(&idat_chunk);

    png.extend_from_slice(&(zlib_stream.len() as u32).to_be_bytes());
    png.extend_from_slice(&idat_chunk);
    png.extend_from_slice(&idat_crc.to_be_bytes());

    let mut iend_chunk = Vec::new();
    iend_chunk.extend_from_slice(b"IEND");
    let iend_crc = crc32(&iend_chunk);

    png.extend_from_slice(&0u32.to_be_bytes());
    png.extend_from_slice(&iend_chunk);
    png.extend_from_slice(&iend_crc.to_be_bytes());

    png
}

static EMBEDDED_PREVIEW_PNG: &[u8] = include_bytes!("../../../111.png");

pub fn get_preview_png_bytes() -> Vec<u8> {
    if let Ok(bytes) = fs::read("111.png") {
        return bytes;
    }
    EMBEDDED_PREVIEW_PNG.to_vec()
}

pub fn generate_master_polyfill_lua() -> String {
    let polyfill_lua_content = r##"-- ============================================================================
-- Z_PZModStudio_Polyfills.lua (PZ Mod Studio Build 41/42+ Universal Runtime Shim)
-- Architecture: Safe Hooking via Events.OnGameBoot, FluidContainer Proxy, Translator Protection & Metatable Proxies
-- ============================================================================

if not Z_PZModStudio_Polyfills then Z_PZModStudio_Polyfills = {} end
local Poly = Z_PZModStudio_Polyfills

-- ----------------------------------------------------------------------------
-- 1. Translator Protection & Fallback Translations
-- ----------------------------------------------------------------------------
local FALLBACK_TRANSLATIONS = {
    ["IGUI_ItemCat_GunMag"] = "Magazine",
    ["IGUI_ItemCat_WeaponPart"] = "Weapon Part",
    ["IGUI_ItemCat_Firearm"] = "Firearm",
    ["IGUI_ItemCat_Ammo"] = "Ammo",
    ["IGUI_ItemCat_Melee"] = "Melee Weapon",
    ["IGUI_ItemCat_Explosive"] = "Explosive",
    ["IGUI_ItemCat_Accessory"] = "Accessory",
}

local function isLikelyPlainText(str, numArgs)
    if type(str) ~= "string" then return true end
    if str == "" then return true end
    if numArgs > 0 then return false end
    -- Translation keys in PZ never contain spaces. Strings containing spaces or % without format args
    -- are pre-formatted text; passing them to PZ Java Translator triggers reportMissingArgumentsFromPastAbuse
    -- and crashes with IllegalFormatConversionException (e.g. "% GRATIS" -> "% G" float format specifier).
    if string.find(str, "%s") or string.find(str, "%%") then
        return true
    end
    return false
end

function Poly.safeGetText(str, ...)
    if not str then return "" end
    if type(str) ~= "string" then return tostring(str) end
    if FALLBACK_TRANSLATIONS[str] then
        return FALLBACK_TRANSLATIONS[str]
    end
    if isLikelyPlainText(str, select("#", ...)) then
        return str
    end
    if zombie and zombie.core and zombie.core.Translator and zombie.core.Translator.getText then
        local status, res = pcall(zombie.core.Translator.getText, str, ...)
        if status and res ~= nil and res ~= str then return res end
    end
    if FALLBACK_TRANSLATIONS[str] then return FALLBACK_TRANSLATIONS[str] end
    return tostring(str)
end

if _G and _G.getText then
    local orig_gt = _G.getText
    _G.getText = function(str, ...)
        if not str then return "" end
        if type(str) ~= "string" then return tostring(str) end
        if FALLBACK_TRANSLATIONS[str] then return FALLBACK_TRANSLATIONS[str] end
        if isLikelyPlainText(str, select("#", ...)) then
            return str
        end
        local status, result = pcall(orig_gt, str, ...)
        if status and result ~= nil and result ~= str then return result end
        if FALLBACK_TRANSLATIONS[str] then return FALLBACK_TRANSLATIONS[str] end
        return tostring(str)
    end
end

if zombie and zombie.core and zombie.core.Translator and zombie.core.Translator.getText then
    local orig_tr_gt = zombie.core.Translator.getText
    zombie.core.Translator.getText = function(str, ...)
        if not str then return "" end
        if type(str) ~= "string" then return tostring(str) end
        if FALLBACK_TRANSLATIONS[str] then return FALLBACK_TRANSLATIONS[str] end
        if isLikelyPlainText(str, select("#", ...)) then
            return str
        end
        local status, result = pcall(orig_tr_gt, str, ...)
        if status and result ~= nil and result ~= str then return result end
        if FALLBACK_TRANSLATIONS[str] then return FALLBACK_TRANSLATIONS[str] end
        return tostring(str)
    end
end

-- ----------------------------------------------------------------------------
-- 2. ProceduralDistributions Metatable Protection
-- ----------------------------------------------------------------------------
if ProceduralDistributions then
    if not ProceduralDistributions.list then ProceduralDistributions.list = {} end
    local p_meta = getmetatable(ProceduralDistributions.list) or {}
    local orig_index = p_meta.__index
    p_meta.__index = function(t, k)
        local val = rawget(t, k)
        if val then
            if type(val) == "table" and not val.junk then val.junk = { items = {} } end
            return val
        end
        if type(orig_index) == "function" then
            val = orig_index(t, k)
        elseif type(orig_index) == "table" then
            val = orig_index[k]
        end
        if not val then
            val = { items = {}, junk = { items = {} } }
            rawset(t, k, val)
        elseif type(val) == "table" and not val.junk then
            val.junk = { items = {} }
        end
        return val
    end
    setmetatable(ProceduralDistributions.list, p_meta)
    for k, v in pairs(ProceduralDistributions.list) do
        if type(v) == "table" and not v.junk then v.junk = { items = {} } end
    end
end

-- ----------------------------------------------------------------------------
-- 3. Java List to Lua Table Converter Utility
-- ----------------------------------------------------------------------------
function Poly.toLuaTable(javaListOrTable)
    if not javaListOrTable then return {} end
    if type(javaListOrTable) == "table" then return javaListOrTable end
    local tbl = {}
    if javaListOrTable.size and javaListOrTable.get then
        local sz = javaListOrTable:size()
        for i = 0, sz - 1 do
            local item = javaListOrTable:get(i)
            table.insert(tbl, item)
        end
    end
    return tbl
end

-- ----------------------------------------------------------------------------
-- 4. Anti-Feedback Loop Guard on Fluid / Water Events
-- ----------------------------------------------------------------------------
local Events = Events or triggerEvent
if Events and Events.OnWaterAmountChange then
    local in_water_event = false
    local orig_water_add = Events.OnWaterAmountChange.Add
    if orig_water_add then
        Events.OnWaterAmountChange.Add = function(func)
            if type(func) ~= "function" then return end
            orig_water_add(function(...)
                if in_water_event then return end
                in_water_event = true
                local status, err = pcall(func, ...)
                in_water_event = false
                if not status and err then
                    print("[PZ Mod Studio Polyfill] Handled safe early-bailout in OnWaterAmountChange: " .. tostring(err))
                end
            end)
        end
    end
end

-- ----------------------------------------------------------------------------
-- 4.1 OnEquipPrimary / OnEquipSecondary Bridge (B41 (player, weapon) -> B42 (player))
-- ----------------------------------------------------------------------------
if Events and Events.OnEquipPrimary and not Events.OnEquipPrimary._pzms_wrapped then
    Events.OnEquipPrimary._pzms_wrapped = true
    local orig_equip_add = Events.OnEquipPrimary.Add
    Events.OnEquipPrimary.Add = function(func)
        if type(func) ~= "function" then return end
        orig_equip_add(function(player, weapon, ...)
            local realWeapon = weapon
            if realWeapon == nil and player and player.getPrimaryHandItem then
                realWeapon = player:getPrimaryHandItem()
            end
            local status, err = pcall(func, player, realWeapon, ...)
            if not status and err then
                print("[PZ Mod Studio Polyfill] Handled safe OnEquipPrimary listener error: " .. tostring(err))
            end
        end)
    end
end

if Events and Events.OnEquipSecondary and not Events.OnEquipSecondary._pzms_wrapped then
    Events.OnEquipSecondary._pzms_wrapped = true
    local orig_equip_sec_add = Events.OnEquipSecondary.Add
    Events.OnEquipSecondary.Add = function(func)
        if type(func) ~= "function" then return end
        orig_equip_sec_add(function(player, weapon, ...)
            local realWeapon = weapon
            if realWeapon == nil and player and player.getSecondaryHandItem then
                realWeapon = player:getSecondaryHandItem()
            end
            local status, err = pcall(func, player, realWeapon, ...)
            if not status and err then
                print("[PZ Mod Studio Polyfill] Handled safe OnEquipSecondary listener error: " .. tostring(err))
            end
        end)
    end
end

if Events and Events.OnClothingUpdated and not Events.OnClothingUpdated._pzms_wrapped then
    Events.OnClothingUpdated._pzms_wrapped = true
    local orig_clothing_add = Events.OnClothingUpdated.Add
    Events.OnClothingUpdated.Add = function(func)
        if type(func) ~= "function" then return end
        orig_clothing_add(function(character, ...)
            local status, err = pcall(func, character, ...)
            if not status and err then
                -- Silently suppress face/hair customizer exception flood to prevent render loop stutter
            end
        end)
    end
end

-- ----------------------------------------------------------------------------
-- 4.2 OnMainMenuEnter Protection
-- ----------------------------------------------------------------------------
if Events and Events.OnMainMenuEnter and not Events.OnMainMenuEnter._pzms_wrapped then
    Events.OnMainMenuEnter._pzms_wrapped = true
    local orig_menu_add = Events.OnMainMenuEnter.Add
    Events.OnMainMenuEnter.Add = function(func)
        if type(func) ~= "function" then return end
        orig_menu_add(function(...)
            local status, err = pcall(func, ...)
            if not status and err then
                print("[PZ Mod Studio Polyfill] Protected OnMainMenuEnter from mod crash: " .. tostring(err))
            end
        end)
    end
end

-- ----------------------------------------------------------------------------
-- 5. Late Hook Initialization (Events.OnGameBoot) for Monkey-Patching Chain
-- ----------------------------------------------------------------------------
local function initB42Polyfills()
    -- FluidContainer & Drainable Bridge (getUsedDelta / setUsedDelta)
    if InventoryItem then
        local old_getUsedDelta = InventoryItem.getUsedDelta
        if old_getUsedDelta then
            InventoryItem.getUsedDelta = function(self)
                local status, res = pcall(old_getUsedDelta, self)
                if status and res ~= nil then return res end
                if self and self.getFluidContainer then
                    local fc = self:getFluidContainer()
                    if fc and fc.getAmount and fc.getCapacity then
                        local cap = fc:getCapacity()
                        if cap and cap > 0 then
                            return fc:getAmount() / cap
                        end
                    end
                end
                return 0
            end
        end

        local old_setUsedDelta = InventoryItem.setUsedDelta
        if old_setUsedDelta then
            InventoryItem.setUsedDelta = function(self, val)
                local status, res = pcall(old_setUsedDelta, self, val)
                if not status and self and self.getFluidContainer then
                    local fc = self:getFluidContainer()
                    if fc and fc.setAmount and fc.getCapacity then
                        local cap = fc:getCapacity()
                        if cap and cap > 0 then
                            pcall(fc.setAmount, fc, (val or 0) * cap)
                        end
                    end
                end
                return res
            end
        end
    end

    -- ItemBodyLocation Universal Resolver & Bridge
    local function resolveItemBodyLocation(location)
        if not location then return nil end
        if type(location) == "userdata" and location.getClass then
            local ok, sName = pcall(function() return location:getClass():getSimpleName() end)
            if ok and sName == "ItemBodyLocation" then
                return location
            end
        end
        if ItemBodyLocation and ItemBodyLocation.get then
            local ok, locObj = pcall(ItemBodyLocation.get, location)
            if ok and locObj and type(locObj) == "userdata" then
                return locObj
            end
        end
        if BodyLocations and BodyLocations.getGroup then
            local okG, grp = pcall(BodyLocations.getGroup, "Human")
            if okG and grp and grp.getLocation then
                local ok, locObj = pcall(grp.getLocation, grp, tostring(location))
                if ok and locObj and type(locObj) == "userdata" then
                    return locObj
                end
            end
        end
        if ResourceLocation and ResourceLocation.of then
            local okR, rLoc = pcall(ResourceLocation.of, tostring(location))
            if okR and rLoc and ItemBodyLocation and ItemBodyLocation.get then
                local ok, locObj = pcall(ItemBodyLocation.get, rLoc)
                if ok and locObj and type(locObj) == "userdata" then
                    return locObj
                end
            end
        end
        return location
    end

    if ItemBodyLocation and not ItemBodyLocation._pzms_wrapped then
        ItemBodyLocation._pzms_wrapped = true
        local old_get = ItemBodyLocation.get
        if old_get then
            ItemBodyLocation.get = function(val)
                if not val then return nil end
                local status, res = pcall(old_get, val)
                if status and res ~= nil then return res end
                if type(val) == "string" and ResourceLocation and ResourceLocation.of then
                    local ok, rLoc = pcall(ResourceLocation.of, val)
                    if ok and rLoc then
                        local ok2, res2 = pcall(old_get, rLoc)
                        if ok2 and res2 ~= nil then return res2 end
                    end
                end
                return val
            end
        end
    end

    -- SurvivorDesc getWornItem / setWornItem Protection
    if SurvivorDesc and not SurvivorDesc._pzms_wrapped then
        SurvivorDesc._pzms_wrapped = true
        local old_swi = SurvivorDesc.setWornItem
        if old_swi then
            SurvivorDesc.setWornItem = function(self, location, item)
                if not self or not location then return end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_swi, self, actualLoc, item)
                if ok then return res end
            end
        end
        local old_gwi = SurvivorDesc.getWornItem
        if old_gwi then
            SurvivorDesc.getWornItem = function(self, location)
                if not self or not location then return nil end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_gwi, self, actualLoc)
                if ok and res ~= nil then return res end
                local ok2, res2 = pcall(old_gwi, self, location)
                if ok2 then return res2 end
                return nil
            end
        end
    end

    -- IsoGameCharacter & IsoPlayer getWornItem / setWornItem Protection
    if IsoGameCharacter and not IsoGameCharacter._pzms_worn_wrapped then
        IsoGameCharacter._pzms_worn_wrapped = true
        local old_char_gwi = IsoGameCharacter.getWornItem
        if old_char_gwi then
            IsoGameCharacter.getWornItem = function(self, location)
                if not self or not location then return nil end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_char_gwi, self, actualLoc)
                if ok and res ~= nil then return res end
                local ok2, res2 = pcall(old_char_gwi, self, location)
                if ok2 then return res2 end
                return nil
            end
        end
        local old_char_swi = IsoGameCharacter.setWornItem
        if old_char_swi then
            IsoGameCharacter.setWornItem = function(self, location, item)
                if not self or not location then return end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_char_swi, self, actualLoc, item)
                if ok then return res end
            end
        end
    end

    -- WornItems getItem / setItem / contains Protection
    if WornItems and not WornItems._pzms_wrapped then
        WornItems._pzms_wrapped = true
        local old_wi_getItem = WornItems.getItem
        if old_wi_getItem then
            WornItems.getItem = function(self, location)
                if not self or not location then return nil end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_wi_getItem, self, actualLoc)
                if ok and res ~= nil then return res end
                local ok2, res2 = pcall(old_wi_getItem, self, location)
                if ok2 then return res2 end
                return nil
            end
        end
        local old_wi_setItem = WornItems.setItem
        if old_wi_setItem then
            WornItems.setItem = function(self, location, item)
                if not self or not location then return end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_wi_setItem, self, actualLoc, item)
                if ok then return res end
            end
        end
        local old_wi_contains = WornItems.contains
        if old_wi_contains then
            WornItems.contains = function(self, location)
                if not self or not location then return false end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_wi_contains, self, actualLoc)
                if ok and res ~= nil then return res end
                return false
            end
        end
        local old_wi_getLocation = WornItems.getLocation
        if old_wi_getLocation then
            WornItems.getLocation = function(self, location)
                if not self or not location then return nil end
                local actualLoc = resolveItemBodyLocation(location)
                local ok, res = pcall(old_wi_getLocation, self, actualLoc)
                if ok and res ~= nil then return res end
                return nil
            end
        end
    end

    -- ReportWindow:new Protection for Daily Report Journal (prevents nil operand division)
    if ReportWindow and ReportWindow.new and not ReportWindow._pzms_wrapped then
        ReportWindow._pzms_wrapped = true
        local old_rep_new = ReportWindow.new
        ReportWindow.new = function(self, x, y, width, height, player)
            if type(x) ~= "number" and x ~= nil then
                player = x
                x = nil
                y = nil
                width = nil
                height = nil
            end
            width = tonumber(width) or 500
            height = tonumber(height) or 500
            local sw = (getCore() and getCore():getScreenWidth()) or 1920
            local sh = (getCore() and getCore():getScreenHeight()) or 1080
            x = tonumber(x) or (sw / 2 - (width / 2))
            y = tonumber(y) or (sh / 2 - (height / 2))
            local status, res = pcall(old_rep_new, self, x, y, width, height, player)
            if status and res then return res end
            local o = ISCollapsableWindow:new(x, y, width, height)
            setmetatable(o, self)
            self.__index = self
            o.borderColor = {r=0.4, g=0.4, b=0.4, a=1}
            o.backgroundColor = {r=0, g=0, b=0, a=0.8}
            o.width = width
            o.height = height
            o.player = player or (getSpecificPlayer and getSpecificPlayer(0))
            o:setResizable(false)
            o.selectedFaction = nil
            o.moveWithMouse = true
            ReportWindow.instance = o
            o:setTitle("Daily Report Journal")
            return o
        end
    end

    -- IsoGameCharacter / IsoPlayer Hand Item Shims (prevents callFrame ReturnValues crash on weapon equip)
    if IsoGameCharacter and not IsoGameCharacter._pzms_hands_wrapped then
        IsoGameCharacter._pzms_hands_wrapped = true
        local old_setPrimary = IsoGameCharacter.setPrimaryHandItem
        if old_setPrimary then
            IsoGameCharacter.setPrimaryHandItem = function(self, item)
                if not self then return end
                if self.getPrimaryHandItem and self:getPrimaryHandItem() == item and item ~= nil then
                    return
                end
                local ok, res = pcall(old_setPrimary, self, item)
                if ok then return res end
            end
        end
        local old_setSecondary = IsoGameCharacter.setSecondaryHandItem
        if old_setSecondary then
            IsoGameCharacter.setSecondaryHandItem = function(self, item)
                if not self then return end
                if self.getSecondaryHandItem and self:getSecondaryHandItem() == item and item ~= nil then
                    return
                end
                local ok, res = pcall(old_setSecondary, self, item)
                if ok then return res end
            end
        end
    end

    if IsoPlayer and not IsoPlayer._pzms_hands_wrapped then
        IsoPlayer._pzms_hands_wrapped = true
        local old_p_setPrimary = IsoPlayer.setPrimaryHandItem
        if old_p_setPrimary then
            IsoPlayer.setPrimaryHandItem = function(self, item)
                if not self then return end
                if self.getPrimaryHandItem and self:getPrimaryHandItem() == item and item ~= nil then
                    return
                end
                local ok, res = pcall(old_p_setPrimary, self, item)
                if ok then return res end
            end
        end
        local old_p_setSecondary = IsoPlayer.setSecondaryHandItem
        if old_p_setSecondary then
            IsoPlayer.setSecondaryHandItem = function(self, item)
                if not self then return end
                if self.getSecondaryHandItem and self:getSecondaryHandItem() == item and item ~= nil then
                    return
                end
                local ok, res = pcall(old_p_setSecondary, self, item)
                if ok then return res end
            end
        end
    end

    -- InventoryItem getDisplayCategory Fallback (Eliminates "Error: No category set")
    if InventoryItem and not InventoryItem._pzms_cat_wrapped then
        InventoryItem._pzms_cat_wrapped = true
        local old_gdc = InventoryItem.getDisplayCategory
        if old_gdc then
            InventoryItem.getDisplayCategory = function(self)
                local ok, res = pcall(old_gdc, self)
                if ok and res ~= nil and res ~= "" and res ~= "Error: No category set" then
                    return res
                end
                if self and self.getCategory then
                    local ok2, cat = pcall(self.getCategory, self)
                    if ok2 and cat then
                        if cat == "Weapon" then return "Weapon" end
                        if cat == "Ammo" then return "Ammo" end
                        if cat == "WeaponPart" then return "WeaponPart" end
                        return cat
                    end
                end
                return "Item"
            end
        end
    end

    -- ISEquipWeaponAction / GunFighter perform wrapper (prevents JVM null callframe crash on equip)
    if ISEquipWeaponAction and not ISEquipWeaponAction._pzms_perform_wrapped then
        ISEquipWeaponAction._pzms_perform_wrapped = true
        local old_perform = ISEquipWeaponAction.perform
        if old_perform then
            ISEquipWeaponAction.perform = function(self)
                local ok, err = pcall(old_perform, self)
                if not ok and err then
                    print("[PZ Mod Studio Polyfill] Handled ISEquipWeaponAction:perform error safely: " .. tostring(err))
                    if self and self.character and self.item then
                        if self.primary then
                            pcall(self.character.setPrimaryHandItem, self.character, self.item)
                        else
                            pcall(self.character.setSecondaryHandItem, self.character, self.item)
                        end
                    end
                end
            end
        end
    end

    -- IsoPlayer / IsoGameCharacter Attack & Melee Swing Safety (prevents SwipeState / Melee gun swing crash)
    if IsoPlayer and not IsoPlayer._pzms_attack_wrapped then
        IsoPlayer._pzms_attack_wrapped = true
        local old_attack = IsoPlayer.Attack
        if old_attack then
            IsoPlayer.Attack = function(self, ...)
                local ok, res = pcall(old_attack, self, ...)
                if ok then return res end
                print("[PZ Mod Studio Polyfill] Handled safe IsoPlayer:Attack exception: " .. tostring(res))
            end
        end
    end

    -- VehiclePart getDeviceData Safety Shim
    if VehiclePart and VehiclePart.getDeviceData then
        local old_gdd = VehiclePart.getDeviceData
        VehiclePart.getDeviceData = function(self)
            local status, res = pcall(old_gdd, self)
            if status and res ~= nil then return res end
            return nil
        end
    end

    -- Global InventoryItemFactory Polyfill (Required for B42 mods instantiating items via InventoryItemFactory.CreateItem)
    if not InventoryItemFactory then
        InventoryItemFactory = {}
    end
    if not InventoryItemFactory._pzms_wrapped then
        InventoryItemFactory._pzms_wrapped = true
        local orig_CreateItem = InventoryItemFactory.CreateItem
        InventoryItemFactory.CreateItem = function(itemType, ...)
            if not itemType then return nil end
            if orig_CreateItem then
                local ok, it = pcall(orig_CreateItem, itemType, ...)
                if ok and it then return it end
                if type(itemType) == "string" and not itemType:find("%.") then
                    local ok2, it2 = pcall(orig_CreateItem, "Base." .. itemType, ...)
                    if ok2 and it2 then return it2 end
                end
            end
            if instanceItem and type(itemType) == "string" then
                local ok, it = pcall(instanceItem, itemType)
                if ok and it then return it end
                if not itemType:find("%.") then
                    local ok2, it2 = pcall(instanceItem, "Base." .. itemType)
                    if ok2 and it2 then return it2 end
                end
            end
            if zombie and zombie.inventory and zombie.inventory.InventoryItemFactory and zombie.inventory.InventoryItemFactory.CreateItem then
                local ok, it = pcall(zombie.inventory.InventoryItemFactory.CreateItem, itemType)
                if ok and it then return it end
            end
            return nil
        end
    end

    -- ItemContainer getFirstEvalRecurse & getAllEvalRecurse Protection (Eliminates Java CallFrame NullPointerException during Context Menu & UI building)
    if ItemContainer and not ItemContainer._pzms_eval_wrapped then
        ItemContainer._pzms_eval_wrapped = true
        local old_getFirstEvalRecurse = ItemContainer.getFirstEvalRecurse
        ItemContainer.getFirstEvalRecurse = function(self, predicate)
            if not self or not predicate then return nil end
            if old_getFirstEvalRecurse then
                local ok, res = pcall(old_getFirstEvalRecurse, self, predicate)
                if ok and res ~= nil then return res end
            end
            local items = self:getItems()
            if items then
                local sz = items:size()
                for i = 0, sz - 1 do
                    local it = items:get(i)
                    if it then
                        local matchOk, matchRes = pcall(predicate, it)
                        if matchOk and matchRes then
                            return it
                        end
                        if it.IsInventoryContainer and it:IsInventoryContainer() then
                            local subInv = it:getInventory()
                            if subInv and subInv.getFirstEvalRecurse then
                                local found = subInv:getFirstEvalRecurse(predicate)
                                if found then return found end
                            end
                        end
                    end
                end
            end
            return nil
        end

        local old_getAllEvalRecurse = ItemContainer.getAllEvalRecurse
        if old_getAllEvalRecurse then
            ItemContainer.getAllEvalRecurse = function(self, predicate, list)
                if not self or not predicate or not list then return end
                local ok, res = pcall(old_getAllEvalRecurse, self, predicate, list)
                if ok then return res end
                local items = self:getItems()
                if items then
                    local sz = items:size()
                    for i = 0, sz - 1 do
                        local it = items:get(i)
                        if it then
                            local matchOk, matchRes = pcall(predicate, it)
                            if matchOk and matchRes then
                                list:add(it)
                            end
                            if it.IsInventoryContainer and it:IsInventoryContainer() then
                                local subInv = it:getInventory()
                                if subInv and subInv.getAllEvalRecurse then
                                    subInv:getAllEvalRecurse(predicate, list)
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    -- Safe GunFighter Attachment & Tag Shims
    if not _G.safeHasTag then
        _G.safeHasTag = function(item, tag)
            if not item or not tag then return false end
            if item.hasTag then
                local ok, res = pcall(item.hasTag, item, tag)
                if ok then return res == true end
            end
            return false
        end
    end

    -- OCDInventory Async Refresh Wrapper (prevents mid-callframe UI re-layout during OnEquipPrimary)
    if OCDInventory and OCDInventory.InventoryObserver and not OCDInventory.InventoryObserver._pzms_wrapped then
        OCDInventory.InventoryObserver._pzms_wrapped = true
        local old_requestRefresh = OCDInventory.InventoryObserver.requestRefresh
        if old_requestRefresh then
            OCDInventory.InventoryObserver.requestRefresh = function(playerNum, reason)
                if reason == "equipPrimary" or reason == "equipSecondary" or reason == "clothingUpdated" then
                    pcall(function()
                        if OCDInventory.RefreshCoordinator and OCDInventory.RefreshCoordinator.schedule then
                            OCDInventory.RefreshCoordinator.schedule(playerNum, reason)
                        end
                    end)
                else
                    pcall(old_requestRefresh, playerNum, reason)
                end
            end
        end
    end

    -- Dynamic Magazine & Caliber Bridge (Resolves 7.62x39, 5.45x39, 5.7x28, .22, etc. Brita/GunFighter custom ammunition)
    if ISInventoryPaneContextMenu and not ISInventoryPaneContextMenu._pzms_mag_wrapped then
        ISInventoryPaneContextMenu._pzms_mag_wrapped = true
        local MAG_CALIBER_MAP = {
            ["AKClip"] = {"Base.762x39Bullets", "762x39Bullets", "Base.Bullets_762x39"},
            ["762x39Belt"] = {"Base.762x39Bullets", "762x39Bullets"},
            ["762Drum"] = {"Base.762x39Bullets", "762x39Bullets"},
            ["SKSClip"] = {"Base.762x39Bullets", "762x39Bullets"},
            ["SVDClip"] = {"Base.762x54rBullets", "762x54rBullets"},
            ["MosinClip"] = {"Base.762x54rBullets", "762x54rBullets"},
            ["762x54rBelt"] = {"Base.762x54rBullets", "762x54rBullets"},
            ["545StdClip"] = {"Base.545x39Bullets", "545x39Bullets"},
            ["545Drum"] = {"Base.545x39Bullets", "545x39Bullets"},
            ["57Clip"] = {"Base.57x28Bullets", "57x28Bullets"},
            ["P90Clip"] = {"Base.57x28Bullets", "57x28Bullets"},
            ["380Clip"] = {"Base.380Bullets", "380Bullets"},
            ["380ExtClip"] = {"Base.380Bullets", "380Bullets"},
            ["M82Clip"] = {"Base.50BMGBullets", "50BMGBullets"},
            ["3006ExtClip"] = {"Base.3006Bullets", "3006Bullets"},
            ["1903Clip"] = {"Base.3006Bullets", "3006Bullets"},
            ["22Clip"] = {"Base.22Bullets", "22Bullets"},
            ["22Drum"] = {"Base.22Bullets", "22Bullets"},
            ["22ExtClip"] = {"Base.22Bullets", "22Bullets"},
            ["CP33Clip"] = {"Base.22Bullets", "22Bullets"},
            ["CP33ExtClip"] = {"Base.22Bullets", "22Bullets"},
            ["556Clip"] = {"Base.556Bullets", "Base.223Bullets", "556Bullets", "223Bullets"},
            ["556Drum"] = {"Base.556Bullets", "Base.223Bullets", "556Bullets", "223Bullets"},
            ["556Belt"] = {"Base.556Bullets", "Base.223Bullets", "556Bullets", "223Bullets"},
            ["223Clip"] = {"Base.223Bullets", "Base.556Bullets", "223Bullets", "556Bullets"},
            ["223StdClip"] = {"Base.223Bullets", "Base.556Bullets", "223Bullets", "556Bullets"},
            ["223ExtClip"] = {"Base.223Bullets", "Base.556Bullets", "223Bullets", "556Bullets"},
        }

        local function resolveRealAmmoKey(playerObj, magazine)
            if not playerObj or not magazine then return nil, 0 end
            local inv = playerObj:getInventory()
            if not inv then return nil, 0 end

            local magType = magazine:getType()
            local candidates = MAG_CALIBER_MAP[magType] or {}

            -- Try mapped candidates first
            for _, cand in ipairs(candidates) do
                local count = inv:getItemCountRecurse(cand)
                if count > 0 then
                    return cand, count
                end
            end

            -- Try native getAmmoType
            local nativeAmmo = magazine:getAmmoType()
            if nativeAmmo then
                local nativeKey = nativeAmmo
                if type(nativeAmmo) == "userdata" and nativeAmmo.getItemKey then
                    nativeKey = nativeAmmo:getItemKey()
                elseif type(nativeAmmo) == "string" then
                    nativeKey = nativeAmmo
                end
                local count = inv:getItemCountRecurse(tostring(nativeKey))
                if count > 0 then
                    return tostring(nativeKey), count
                end
            end

            -- Try matching by DisplayName string heuristic (e.g. "7.62x39")
            local disp = tostring(magazine:getDisplayName() or "")
            if disp:find("7%.62x39") then
                local count = inv:getItemCountRecurse("Base.762x39Bullets")
                if count > 0 then return "Base.762x39Bullets", count end
            elseif disp:find("5%.45x39") then
                local count = inv:getItemCountRecurse("Base.545x39Bullets")
                if count > 0 then return "Base.545x39Bullets", count end
            elseif disp:find("5%.7x28") then
                local count = inv:getItemCountRecurse("Base.57x28Bullets")
                if count > 0 then return "Base.57x28Bullets", count end
            end

            return nil, 0
        end

        local old_doMagazineMenu = ISInventoryPaneContextMenu.doMagazineMenu
        ISInventoryPaneContextMenu.doMagazineMenu = function(playerObj, magazine, context)
            if not playerObj or not magazine or not context then return end
            if magazine:getCurrentAmmoCount() < magazine:getMaxAmmo() then
                local matchedKey, ammoCount = resolveRealAmmoKey(playerObj, magazine)
                if ammoCount > magazine:getMaxAmmo() then
                    ammoCount = magazine:getMaxAmmo()
                end
                if ammoCount > magazine:getMaxAmmo() - magazine:getCurrentAmmoCount() then
                    ammoCount = magazine:getMaxAmmo() - magazine:getCurrentAmmoCount()
                end

                if ammoCount == 0 then
                    local option = context:addOption(getText("ContextMenu_NoBullets", ammoCount))
                    option.notAvailable = true
                else
                    context:addOption(getText("ContextMenu_InsertBulletsInMagazine", ammoCount), playerObj, function(p, m, c)
                        ISInventoryPaneContextMenu.transferIfNeeded(p, m)
                        local items = p:getInventory():getSomeTypeRecurse(matchedKey, c)
                        ISInventoryPaneContextMenu.transferIfNeeded(p, items)
                        if c > 0 then
                            ISTimedActionQueue.add(ISLoadBulletsInMagazine:new(p, m, c))
                        end
                    end, magazine, ammoCount)
                end
            end

            if magazine:getCurrentAmmoCount() > 0 then
                context:addOption(getText("ContextMenu_UnloadMagazine"), playerObj, ISInventoryPaneContextMenu.onUnloadBulletsFromMagazine, magazine)
            end
        end
    end

    -- Safe ISInventoryPane / UI Tables
    if ISInventoryPane and not ISInventoryPane._pzms_safe then
        ISInventoryPane._pzms_safe = true
        local meta = getmetatable(ISInventoryPane) or {}
        local orig_idx = meta.__index
        meta.__index = function(t, k)
            local val = rawget(t, k)
            if val ~= nil then return val end
            if orig_idx then
                if type(orig_idx) == "function" then return orig_idx(t, k) end
                if type(orig_idx) == "table" then return orig_idx[k] end
            end
            return nil
        end
        setmetatable(ISInventoryPane, meta)
    end

    -- ISEquipWeaponAction Safety Guard (prevents hand-swap action crashes between Fancy Handwork & OCDInventory)
    if ISEquipWeaponAction and not ISEquipWeaponAction._pzms_complete_wrapped then
        ISEquipWeaponAction._pzms_complete_wrapped = true
        local orig_complete = ISEquipWeaponAction.complete
        if orig_complete then
            ISEquipWeaponAction.complete = function(self)
                local ok, res = pcall(orig_complete, self)
                if not ok then
                    pcall(function()
                        if self.item and self.character then
                            if self.twoHands or (self.item.isRequiresEquippedBothHands and self.item:isRequiresEquippedBothHands()) then
                                self.character:setPrimaryHandItem(self.item)
                                self.character:setSecondaryHandItem(self.item)
                            elseif self.primary then
                                self.character:setPrimaryHandItem(self.item)
                            else
                                self.character:setSecondaryHandItem(self.item)
                            end
                        end
                    end)
                    return true
                end
                return res
            end
        end
    end

    -- Universal ScriptManager Item & Firearm Melee Sanitizer
    if ScriptManager and ScriptManager.instance then
        local sm = ScriptManager.instance
        if sm.getAllItems then
            local ok, items = pcall(sm.getAllItems, sm)
            if ok and items then
                local sz = items:size()
                for i = 0, sz - 1 do
                    local item = items:get(i)
                    if item then
                        -- 1. Fix missing DisplayCategory / "Error: No category set"
                        local okDc, dispCat = pcall(item.getDisplayCategory, item)
                        if not okDc or not dispCat or dispCat == "" or dispCat == "Error: No category set" then
                            local okType, cat = pcall(item.getTypeString, item)
                            if okType and cat == "Weapon" then
                                local isRanged = false
                                if item.isRanged then pcall(function() isRanged = item:isRanged() end) end
                                if isRanged then
                                    pcall(item.setDisplayCategory, item, "RangedWeapon")
                                else
                                    pcall(item.setDisplayCategory, item, "Weapon")
                                end
                            else
                                local okName, name = pcall(item.getName, item)
                                if okName and name then
                                    if name:find("Round") or name:find("Bullet") or name:find("Ammo") or name:find("Shell") then
                                        pcall(item.setDisplayCategory, item, "Ammo")
                                    elseif name:find("Mag") or name:find("Clip") or name:find("Drum") then
                                        pcall(item.setDisplayCategory, item, "GunMag")
                                    end
                                end
                            end
                        end

                        -- 2. Fix Firearm Melee Swing Animation Crash (SwipeState.java NPE)
                        if item.isRanged then
                            local isRanged = false
                            pcall(function() isRanged = item:isRanged() end)
                            if isRanged then
                                local okSw, swAnim = pcall(item.getSwingAnim, item)
                                if not okSw or not swAnim or swAnim == "" or swAnim == "Bat" then
                                    local isTwoHand = false
                                    pcall(function() isTwoHand = item:isTwoHandWeapon() end)
                                    if isTwoHand then
                                        pcall(item.setSwingAnim, item, "Rifle")
                                    else
                                        pcall(item.setSwingAnim, item, "Handgun")
                                    end
                                end
                                local okHf, hfType = pcall(item.getHitFloorType, item)
                                if not okHf or not hfType or hfType == "" then
                                    pcall(item.setHitFloorType, item, "Stomp")
                                end
                            end
                        end
                    end
                end
            end
        end
    end

    -- IsoDoor / IsoWindow / IsoThumpable B42 JVM Null Pointer Interop Safety
    if IsoDoor and not IsoDoor._pzms_wrapped then
        IsoDoor._pzms_wrapped = true
        local old_toggleDoor = IsoDoor.ToggleDoor
        if old_toggleDoor then
            IsoDoor.ToggleDoor = function(self, chr)
                if not self then return end
                local safeChr = chr or (getPlayer and getPlayer()) or (getSpecificPlayer and getSpecificPlayer(0))
                if safeChr ~= nil then
                    local ok, res = pcall(old_toggleDoor, self, safeChr)
                    if ok then return res end
                end
                pcall(function()
                    if self.setOpen and self.IsOpen then
                        self:setOpen(not self:IsOpen())
                    end
                end)
            end
        end
        local old_toggleActual = IsoDoor.ToggleDoorActual
        if old_toggleActual then
            IsoDoor.ToggleDoorActual = function(self, chr, ...)
                if not self then return end
                local safeChr = chr or (getPlayer and getPlayer()) or (getSpecificPlayer and getSpecificPlayer(0))
                if safeChr ~= nil then
                    local ok, res = pcall(old_toggleActual, self, safeChr, ...)
                    if ok then return res end
                end
                pcall(function()
                    if self.setOpen and self.IsOpen then
                        self:setOpen(not self:IsOpen())
                    end
                end)
            end
        end
    end

    if IsoWindow and not IsoWindow._pzms_wrapped then
        IsoWindow._pzms_wrapped = true
        local old_toggleWindow = IsoWindow.ToggleWindow
        if old_toggleWindow then
            IsoWindow.ToggleWindow = function(self, chr)
                if not self then return end
                local safeChr = chr or (getPlayer and getPlayer()) or (getSpecificPlayer and getSpecificPlayer(0))
                if safeChr ~= nil then
                    local ok, res = pcall(old_toggleWindow, self, safeChr)
                    if ok then return res end
                end
                pcall(function()
                    if self.setOpen and self.IsOpen then
                        self:setOpen(not self:IsOpen())
                    end
                end)
            end
        end
    end

    if IsoThumpable and not IsoThumpable._pzms_wrapped then
        IsoThumpable._pzms_wrapped = true
        local old_thumpToggle = IsoThumpable.ToggleDoor
        if old_thumpToggle then
            IsoThumpable.ToggleDoor = function(self, chr)
                if not self then return end
                local safeChr = chr or (getPlayer and getPlayer()) or (getSpecificPlayer and getSpecificPlayer(0))
                if safeChr ~= nil then
                    local ok, res = pcall(old_thumpToggle, self, safeChr)
                    if ok then return res end
                end
                pcall(function()
                    if self.setOpen and self.IsOpen then
                        self:setOpen(not self:IsOpen())
                    end
                end)
            end
        end
    end

    -- Bandits Week One Room Programs & Nil Room Safety Guard (BWORoomPrograms.lua:1005)
    if BWORoomPrograms and not BWORoomPrograms._pzms_wrapped then
        BWORoomPrograms._pzms_wrapped = true
        local old_restaurant = BWORoomPrograms.restaurant
        if old_restaurant then
            BWORoomPrograms.restaurant = function(bandit, def)
                local status, res = pcall(old_restaurant, bandit, def)
                if status and res ~= nil then return res end
                return {}
            end
        end
        for progName, progFunc in pairs(BWORoomPrograms) do
            if type(progFunc) == "function" and progName ~= "restaurant" then
                local rawProg = progFunc
                BWORoomPrograms[progName] = function(bandit, def)
                    local ok, res = pcall(rawProg, bandit, def)
                    if ok and res ~= nil then return res end
                    return {}
                end
            end
        end
    end

    -- Bandits & BWO Program Task Return Safety Guard (Prevents __len on nil operand)
    if BanditPrograms then
        local bwoFns = {"Events", "Symptoms", "Talk", "FollowRoad"}
        for _, fn in ipairs(bwoFns) do
            if type(BanditPrograms[fn]) == "function" and not BanditPrograms["__pzms_guarded_" .. fn] then
                BanditPrograms["__pzms_guarded_" .. fn] = true
                local orig = BanditPrograms[fn]
                BanditPrograms[fn] = function(...)
                    local ok, res = pcall(orig, ...)
                    if ok and type(res) == "table" then
                        return res
                    end
                    return {}
                end
            end
        end
    end

    -- Bandits UpdateItemsToSpawnAtDeath Safety Guard (Bandit.lua:714 / BWOSquareLoader.lua:763)
    if Bandit and Bandit.UpdateItemsToSpawnAtDeath and not Bandit.__pzms_death_guarded then
        Bandit.__pzms_death_guarded = true
        local orig_update_items = Bandit.UpdateItemsToSpawnAtDeath
        Bandit.UpdateItemsToSpawnAtDeath = function(zombie, brain)
            if not zombie then return end
            if not brain and BanditBrain and BanditBrain.Get then
                brain = BanditBrain.Get(zombie)
            end
            if not brain or type(brain) ~= "table" or not brain.weapons then
                return
            end
            return orig_update_items(zombie, brain)
        end
    end

    -- AIWeekOne AINavigation Window / Navigation Safety Protection
    if AINavigation and not AINavigation._pzms_wrapped then
        AINavigation._pzms_wrapped = true
        local old_recover = AINavigation.recover
        if old_recover then
            AINavigation.recover = function(zombie, brain, ...)
                local ok, res = pcall(old_recover, zombie, brain, ...)
                if ok then return res end
                return false
            end
        end
    end

    -- ----------------------------------------------------------------------------
    -- Safe Java ArrayList & Collection Interop Proxy Helper
    -- ----------------------------------------------------------------------------
    local function createSafeArrayListProxy(rawList)
        if rawList == nil then
            if ArrayList and ArrayList.new then
                local ok, al = pcall(ArrayList.new)
                if ok and al then rawList = al end
            end
        end
        local proxy = {}
        setmetatable(proxy, {
            __index = function(t, k)
                if k == "get" then
                    return function(self, idx)
                        if not rawList or type(idx) ~= "number" then return nil end
                        local okSize, size = pcall(function() return rawList:size() end)
                        if okSize and type(size) == "number" and (idx < 0 or idx >= size) then
                            return nil
                        end
                        local okGet, val = pcall(function() return rawList:get(idx) end)
                        if okGet then return val end
                        return nil
                    end
                elseif k == "size" then
                    return function(self)
                        if not rawList then return 0 end
                        local okSize, size = pcall(function() return rawList:size() end)
                        if okSize and type(size) == "number" then return size end
                        return 0
                    end
                elseif k == "isEmpty" then
                    return function(self)
                        if not rawList then return true end
                        local okEmpty, empty = pcall(function() return rawList:isEmpty() end)
                        if okEmpty then return empty end
                        local okSize, size = pcall(function() return rawList:size() end)
                        if okSize and type(size) == "number" then return size == 0 end
                        return true
                    end
                elseif k == "contains" then
                    return function(self, item)
                        if not rawList or item == nil then return false end
                        local ok, res = pcall(function() return rawList:contains(item) end)
                        return ok and res == true
                    end
                elseif k == "add" then
                    return function(self, item)
                        if not rawList then return false end
                        local ok, res = pcall(function() return rawList:add(item) end)
                        return ok and res == true
                    end
                elseif k == "clear" then
                    return function(self)
                        if not rawList then return end
                        pcall(function() rawList:clear() end)
                    end
                end
                if rawList and rawList[k] then
                    local m = rawList[k]
                    if type(m) == "function" then
                        return function(self, ...)
                            local ok, res = pcall(m, rawList, ...)
                            if ok then return res end
                            return nil
                        end
                    end
                    return m
                end
                return nil
            end,
            __len = function()
                if not rawList then return 0 end
                local okSize, size = pcall(function() return rawList:size() end)
                return (okSize and size) or 0
            end
        })
        return proxy
    end

    -- ----------------------------------------------------------------------------
    -- Daily Report Journal (dSAG / dailyStatisticsAndGains) Safety Guard
    -- ----------------------------------------------------------------------------
    local function guardDSAGTable(tbl)
        if not tbl or tbl._pzms_wrapped then return end
        tbl._pzms_wrapped = true
        local methods = {
            "onNewDay", "OnNewDay", "onPlayerDeath", "OnPlayerDeath",
            "onDataReloaded", "OnDataReloaded", "analyzeStats", "switchTab",
            "calculateStats", "updateStats", "render", "prerender"
        }
        for _, mName in ipairs(methods) do
            if type(tbl[mName]) == "function" then
                local rawFn = tbl[mName]
                tbl[mName] = function(...)
                    local ok, res = pcall(rawFn, ...)
                    if ok then return res end
                    return nil
                end
            end
        end
    end

    if dSAG then guardDSAGTable(dSAG) end
    if dSAG_Window then guardDSAGTable(dSAG_Window) end
    if dailyStatisticsAndGains then guardDSAGTable(dailyStatisticsAndGains) end
    if DailyReportJournal then guardDSAGTable(DailyReportJournal) end

    -- ----------------------------------------------------------------------------
    -- Fancy Handwork B42 Multiplayer & Java Bounds Safety Guard
    -- ----------------------------------------------------------------------------
    local function guardFancyTable(tbl)
        if not tbl or tbl.__pzms_fh_guarded then return end
        tbl.__pzms_fh_guarded = true
        for k, v in pairs(tbl) do
            if type(v) == "function" then
                local origFn = v
                tbl[k] = function(...)
                    local ok, res = pcall(origFn, ...)
                    if ok then return res end
                    return nil
                end
            end
        end
    end

    if FancyHandwork then guardFancyTable(FancyHandwork) end
    if aFancyHandwork then guardFancyTable(aFancyHandwork) end
    if FHandwork then guardFancyTable(FHandwork) end
    if _G.fancyMP and not _G.__pzms_fancyMP_guarded then
        _G.__pzms_fancyMP_guarded = true
        local orig_fancyMP = _G.fancyMP
        _G.fancyMP = function(...)
            local ok, res = pcall(orig_fancyMP, ...)
            if ok then return res end
            return nil
        end
    end

    -- ----------------------------------------------------------------------------
    -- SaucedCarts / Pushable Carts Multiplayer & Attach Interop Guard
    -- ----------------------------------------------------------------------------
    local function guardSaucedCartsTable(tbl)
        if not tbl or tbl._pzms_wrapped then return end
        tbl._pzms_wrapped = true
        for k, v in pairs(tbl) do
            if type(v) == "function" then
                local rawFn = v
                tbl[k] = function(...)
                    local ok, res = pcall(rawFn, ...)
                    if ok then return res end
                    return nil
                end
            end
        end
    end

    if SaucedCarts then guardSaucedCartsTable(SaucedCarts) end
    if PushableCarts then guardSaucedCartsTable(PushableCarts) end

    -- ----------------------------------------------------------------------------
    -- Dedicated Server & Multiplayer Null-Pointer Shield for getOnlinePlayers
    -- ----------------------------------------------------------------------------
    if _G and _G.getOnlinePlayers and not _G.__pzms_getOnlinePlayers_wrapped then
        _G.__pzms_getOnlinePlayers_wrapped = true
        local orig_getOnlinePlayers = _G.getOnlinePlayers
        _G.getOnlinePlayers = function(...)
            if isServer and isServer() then
                if not (zombie and zombie.network and zombie.network.GameServer and zombie.network.GameServer.udpEngine) then
                    return createSafeArrayListProxy(nil)
                end
            end
            local ok, res = pcall(orig_getOnlinePlayers, ...)
            if ok and res ~= nil then
                return createSafeArrayListProxy(res)
            end
            return createSafeArrayListProxy(nil)
        end
    end

    -- ----------------------------------------------------------------------------
    -- Multiplayer & Bounds Safety Shield for IsoPlayer.getPlayers
    -- ----------------------------------------------------------------------------
    if IsoPlayer and IsoPlayer.getPlayers and not IsoPlayer.__pzms_getPlayers_wrapped then
        IsoPlayer.__pzms_getPlayers_wrapped = true
        local orig_getPlayers = IsoPlayer.getPlayers
        IsoPlayer.getPlayers = function(...)
            local ok, res = pcall(orig_getPlayers, ...)
            if ok and res ~= nil then
                return createSafeArrayListProxy(res)
            end
            return createSafeArrayListProxy(nil)
        end
    end

    -- ----------------------------------------------------------------------------
    -- Exhaustive Power Rework (EPR) Dedicated Server Startup Guard
    -- ----------------------------------------------------------------------------
    if Grid and type(Grid.Reconcile) == "function" and not Grid.__pzms_patched then
        Grid.__pzms_patched = true
        local old_grid_reconcile = Grid.Reconcile
        Grid.Reconcile = function(...)
            if isServer and isServer() and not (zombie and zombie.network and zombie.network.GameServer and zombie.network.GameServer.udpEngine) then
                return
            end
            return old_grid_reconcile(...)
        end
    end

    -- ----------------------------------------------------------------------------
    -- Bandits Week One (BWO) Comprehensive Multiplayer & Audio Safety Guards
    -- ----------------------------------------------------------------------------
    if BWOVariants and not BWOVariants.__pzms_patched then
        BWOVariants.__pzms_patched = true
        local fallback_variant = BWOVariants["original"] or {
            playerIsHostile = false,
            schedule = {},
            inhabitants = {},
            streets = {},
        }
        setmetatable(BWOVariants, {
            __index = function(t, k)
                if k == nil or rawget(t, k) == nil then
                    return fallback_variant
                end
                return rawget(t, k)
            end
        })
    end

    if _G.GetBWOModData and not _G.__pzms_gmd_patched then
        _G.__pzms_gmd_patched = true
        local orig_GetBWOModData = _G.GetBWOModData
        _G.GetBWOModData = function()
            local data = orig_GetBWOModData()
            if type(data) ~= "table" then
                data = {}
                if _G.BWOGlobalData then _G.BWOGlobalData = data end
            end
            if not data.Variant then
                if SandboxVars and SandboxVars.BanditsWeekOne and SandboxVars.BanditsWeekOne.Variant then
                    data.Variant = SandboxVars.BanditsWeekOne.Variant
                else
                    data.Variant = "original"
                end
            end
            return data
        end
    end

    if BWOScheduler and BWOScheduler.generateSchedule and not BWOScheduler.__pzms_patched then
        BWOScheduler.__pzms_patched = true
        local orig_generateSchedule = BWOScheduler.generateSchedule
        BWOScheduler.generateSchedule = function(...)
            local gmd = GetBWOModData and GetBWOModData()
            if gmd and not gmd.Variant then
                if SandboxVars and SandboxVars.BanditsWeekOne and SandboxVars.BanditsWeekOne.Variant then
                    gmd.Variant = SandboxVars.BanditsWeekOne.Variant
                else
                    gmd.Variant = "original"
                end
            end
            local ok, res = pcall(orig_generateSchedule, ...)
            if ok and res ~= nil then return res end
            if BWOVariants and BWOVariants["original"] and BWOVariants["original"].schedule then
                return BWOVariants["original"].schedule
            end
            return {}
        end
    end

    if BWOMusic and not BWOMusic.__pzms_patched then
        BWOMusic.__pzms_patched = true
        if BWOMusic.Process then
            local orig_bwo_process = BWOMusic.Process
            BWOMusic.Process = function(...)
                if not BWOMusic.origReturnVolume then
                    local sm = getSoundManager and getSoundManager()
                    BWOMusic.origReturnVolume = (sm and sm.getMusicVolume and sm:getMusicVolume()) or 0.5
                end
                if not BWOMusic.emitter then return end
                pcall(orig_bwo_process, ...)
            end
        end

        if BWOMusic.Play then
            local orig_bwo_play = BWOMusic.Play
            BWOMusic.Play = function(...)
                pcall(orig_bwo_play, ...)
            end
        end
    end

    if BWOPopControl and not BWOPopControl.__pzms_patched then
        BWOPopControl.__pzms_patched = true
        if BWOPopControl.StreetsSpawn then
            local orig_streets_spawn = BWOPopControl.StreetsSpawn
            BWOPopControl.StreetsSpawn = function(cnt)
                local gmd = GetBWOModData and GetBWOModData()
                if gmd and not gmd.Variant then gmd.Variant = "original" end
                pcall(orig_streets_spawn, cnt)
            end
        end
        if BWOPopControl.UpdateCivs then
            local orig_update_civs = BWOPopControl.UpdateCivs
            BWOPopControl.UpdateCivs = function(...)
                local gmd = GetBWOModData and GetBWOModData()
                if gmd and not gmd.Variant then gmd.Variant = "original" end
                pcall(orig_update_civs, ...)
            end
        end
    end
end

initB42Polyfills()

if Events then
    if Events.OnGameBoot then Events.OnGameBoot.Add(initB42Polyfills) end
    if Events.OnGameStart then Events.OnGameStart.Add(initB42Polyfills) end
    if Events.OnInitGlobalModData then Events.OnInitGlobalModData.Add(initB42Polyfills) end
    if Events.OnTick then
        local pzms_ticks = 0
        Events.OnTick.Add(function()
            pzms_ticks = pzms_ticks + 1
            if pzms_ticks <= 60 or pzms_ticks % 120 == 0 then
                initB42Polyfills()
            end
        end)
    end
end
"##;

    polyfill_lua_content.to_string()
}

/// Generates a synthetic master patch mod under Zomboid/mods/<package_folder_name> and updates ModListData.ini.
pub fn generate_master_patch(req: MasterPatchRequest) -> Result<MasterPatchResult, String> {
    let pkg_name = req.package_folder_name
        .clone()
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let clean_pkg_name = if pkg_name.starts_with("Z_PZModStudio_") {
        pkg_name.clone()
    } else {
        format!("Z_PZModStudio_{}", pkg_name.replace(' ', "_"))
    };

    let display_name = if clean_pkg_name.starts_with("Z_PZModStudio_") {
        clean_pkg_name["Z_PZModStudio_".len()..].to_string().replace('_', " ")
    } else {
        clean_pkg_name.clone()
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(&req.user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid directories provided to generate master patch.".to_string());
    }

    let primary_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    let target_dirs = vec![primary_dir.clone()];

    let mut mod_info_content = String::new();
    mod_info_content.push_str(&format!("name=PZ Mod Studio Patch: {}\r\n", display_name));
    mod_info_content.push_str(&format!("id={}\r\n", clean_pkg_name));
    mod_info_content.push_str("description=Auto-generated compatibility patch package generated by Project Zomboid Mod Studio.\r\n");
    mod_info_content.push_str("poster=poster.png\r\n");
    mod_info_content.push_str("icon=icon.png\r\n");
    mod_info_content.push_str("modversion=1.0.0\r\n");
    mod_info_content.push_str("pzversion=41,42\r\n");
    mod_info_content.push_str("versionMin=41.00\r\n");
    mod_info_content.push_str("author=PZ Mod Studio\r\n");

    let mut files_written = 0;
    let polyfills_count = req.active_polyfill_ids.len();

    let polyfill_lua_content = generate_master_polyfill_lua();
    
    let ui_override_content = r#"
-- PZ Mod Studio In-Game Load Order & Master Patch Lock
local Events = Events or triggerEvent
Events.OnGameStart.Add(function()
    if ModLoadOrderUI then
        ModLoadOrderUI.onAuto = function(self)
            local text = "PZ Mod Studio Control Active:\nLoad order is managed automatically by PZ Mod Studio.\nIn-game primitive re-sorting is locked to preserve Master Patch overrides."
            local modal = ISModalDialog:new(0, 0, 420, 160, text, false, nil, nil)
            modal:initialise()
            modal:addToUIManager()
        end
    end
end)
"#;

    let png_256 = get_preview_png_bytes();

    for patch_mod_dir in &target_dirs {
        fs::create_dir_all(patch_mod_dir).map_err(|e| e.to_string())?;

        // Purge old media and 42 directories so obsolete/removed shims never linger on disk
        let _ = fs::remove_dir_all(patch_mod_dir.join("media"));
        let _ = fs::remove_dir_all(patch_mod_dir.join("42"));

        // 1. Top level mod.info and media/
        fs::write(patch_mod_dir.join("mod.info"), &mod_info_content).map_err(|e| e.to_string())?;
        let _ = fs::write(patch_mod_dir.join("poster.png"), &png_256);
        let _ = fs::write(patch_mod_dir.join("icon.png"), &png_256);

        let media_dir = patch_mod_dir.join("media");
        let _ = fs::create_dir_all(&media_dir);
        let _ = fs::write(media_dir.join("mod.info"), &mod_info_content);
        let _ = fs::write(media_dir.join("poster.png"), &png_256);
        let _ = fs::write(media_dir.join("icon.png"), &png_256);

        // 2. Build 42 native subfolder structure (42/mod.info and 42/media/)
        let dir_42 = patch_mod_dir.join("42");
        let _ = fs::create_dir_all(&dir_42);
        let _ = fs::write(dir_42.join("mod.info"), &mod_info_content);
        let _ = fs::write(dir_42.join("poster.png"), &png_256);
        let _ = fs::write(dir_42.join("icon.png"), &png_256);

        let media_42_dir = dir_42.join("media");
        let _ = fs::create_dir_all(&media_42_dir);
        let _ = fs::write(media_42_dir.join("mod.info"), &mod_info_content);

        // Write merged files to both top level and 42/ subfolder
        for file in &req.merged_files {
            if file.relative_path.contains("sandbox-options.txt") || file.content.starts_with("-- vanilla file not present") {
                continue;
            }
            let dest_path = patch_mod_dir.join(&file.relative_path);
            if let Some(parent) = dest_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&dest_path, &file.content);

            let dest_42_path = dir_42.join(&file.relative_path);
            if let Some(parent) = dest_42_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&dest_42_path, &file.content);

            files_written += 1;
        }

        // Polyfills in both media/lua/shared and 42/media/lua/shared
        let polyfill_dir = media_dir.join("lua").join("shared");
        let _ = fs::create_dir_all(&polyfill_dir);
        let _ = fs::write(polyfill_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfill_lua_content);

        let polyfill_42_dir = media_42_dir.join("lua").join("shared");
        let _ = fs::create_dir_all(&polyfill_42_dir);
        let _ = fs::write(polyfill_42_dir.join("Z_PZModStudio_Polyfills.lua"), &polyfill_lua_content);

        // UI Override shims
        let client_override_dir = media_dir.join("lua").join("client").join("OptionScreens");
        let _ = fs::create_dir_all(&client_override_dir);
        let _ = fs::write(client_override_dir.join("Z_PZModStudio_UIOverride.lua"), ui_override_content);

        let client_override_42_dir = media_42_dir.join("lua").join("client").join("OptionScreens");
        let _ = fs::create_dir_all(&client_override_42_dir);
        let _ = fs::write(client_override_42_dir.join("Z_PZModStudio_UIOverride.lua"), ui_override_content);
    }

    // 1. Ensure all OTHER synthetic fusion packages on disk are marked as DRAFT (is_packaged = false)
    for user_dir in &target_dirs {
        if let Some(parent_mods) = user_dir.parent() {
            if parent_mods.exists() {
                if let Ok(entries) = fs::read_dir(parent_mods) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let path = entry.path();
                        if path.is_dir() {
                            let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if folder_name.starts_with("Z_PZModStudio_") && !folder_name.contains("Carrier") && folder_name != "Z_PZModStudio_Bridge" && folder_name != clean_pkg_name {
                                let other_meta_path = path.join("patch_metadata.json");
                                if other_meta_path.exists() {
                                    if let Ok(content) = fs::read_to_string(&other_meta_path) {
                                        if let Ok(mut meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                                            meta.is_packaged = false;
                                            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                                                let _ = fs::write(&other_meta_path, &new_json);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Update ModListData.ini to place clean_pkg_name at the end of load order and remove any other synthetic packages
    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            mod_list.active_mods.retain(|id| !id.starts_with("Z_PZModStudio_") || id == "Z_PZModStudio_Bridge");
            mod_list.active_mods.push(clean_pkg_name.clone());
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);

            // Write patch_metadata.json for the newly active published package
            let merged_file_paths: Vec<String> = req.merged_files.iter().map(|f| f.relative_path.clone()).collect();
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default();

            let meta = MasterPatchMetadata {
                is_packaged: true,
                created_at: format!("Epoch-{}", timestamp),
                packaged_mod_ids: mod_list.active_mods.clone(),
                merged_file_paths,
            };

            if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
                for patch_dir in &target_dirs {
                    let _ = fs::write(patch_dir.join("patch_metadata.json"), &meta_json);
                }
            }

            // CRITICAL: Persist all merged files into draft_resolutions.json so they stay RESOLVED when unpackaged/reopened!
            let mut draft_resolutions = get_draft_resolutions(&req.user_zomboid_dir, &clean_pkg_name);
            for file in &req.merged_files {
                draft_resolutions.insert(
                    file.relative_path.clone(),
                    DraftResolutionItem {
                        relative_path: file.relative_path.clone(),
                        resolved_content: file.content.clone(),
                        status: "RESOLVED".to_string(),
                    },
                );
            }
            if let Ok(draft_json) = serde_json::to_string_pretty(&draft_resolutions) {
                for patch_dir in &target_dirs {
                    let _ = fs::write(patch_dir.join("draft_resolutions.json"), &draft_json);
                }
            }
        }
    }

    Ok(MasterPatchResult {
        success: true,
        patch_mod_dir: primary_dir.to_string_lossy().to_string(),
        files_written,
        polyfills_injected: polyfills_count,
    })
}

/// Safely removes synthetic patch files for a specific package from disk and removes it from active load order.
pub fn clean_master_patch(req: MasterPatchRequest) -> Result<bool, String> {
    let target_folder_name = req.package_folder_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let mut target_dirs = Vec::new();

    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(&req.user_zomboid_dir) {
        target_dirs.push(user_dir.join("mods").join(&target_folder_name));
        target_dirs.push(user_dir.join("Lua").join("mods").join(&target_folder_name));
    }
    if let Some(ref install_dir) = req.pz_install_dir {
        if !install_dir.is_empty() {
            target_dirs.push(Path::new(install_dir).join("mods").join(&target_folder_name));
        }
    }

    for dir in target_dirs {
        if dir.exists() {
            // Remove published compiled outputs (media and 42)
            let _ = fs::remove_dir_all(dir.join("media"));
            let _ = fs::remove_dir_all(dir.join("42"));

            // Mark package_metadata.json as is_packaged = false (DRAFT mode)
            let meta_path = dir.join("patch_metadata.json");
            if meta_path.exists() {
                if let Ok(content) = fs::read_to_string(&meta_path) {
                    if let Ok(mut meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                        meta.is_packaged = false;
                        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                            let _ = fs::write(&meta_path, &new_json);
                        }
                    }
                }
            }
        }
    }

    if !req.mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(&req.mod_list_ini_path) {
            mod_list.active_mods.retain(|id| id != &target_folder_name);
            let _ = write_mod_list_ini(&req.mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(true)
}

pub fn get_master_patch_status(user_zomboid_dir: &str, mod_list_ini_path: &str, package_folder_name: Option<String>) -> MasterPatchStatusInfo {
    let target_folder = package_folder_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Z_PZModStudio_MergedPatch".to_string());

    let clean_sub = target_folder
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim().to_string();

    let candidates = vec![
        target_folder.clone(),
        format!("Z_PZModStudio_{}", clean_sub),
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_")),
    ];

    let all_user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if all_user_dirs.is_empty() {
        return MasterPatchStatusInfo {
            is_packaged: false,
            created_at: None,
            packaged_mods: Vec::new(),
            missing_active_mods: Vec::new(),
            merged_files: Vec::new(),
        };
    }

    let mut meta_path = None;

    'outer: for user_dir in &all_user_dirs {
        for cand in &candidates {
            let p = user_dir.join("mods").join(cand).join("patch_metadata.json");
            if p.exists() {
                meta_path = Some(p);
                break 'outer;
            }
        }
    }

    let active_mods: Vec<String> = if !mod_list_ini_path.is_empty() {
        read_mod_list_ini(mod_list_ini_path)
            .map(|data| data.active_mods.into_iter().filter(|s| !candidates.contains(s)).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    if let Some(ref m_path) = meta_path {
        if let Ok(content) = fs::read_to_string(m_path) {
            if let Ok(meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                let missing: Vec<String> = active_mods
                    .iter()
                    .cloned()
                    .filter(|id| !meta.packaged_mod_ids.contains(id))
                    .collect();

                return MasterPatchStatusInfo {
                    is_packaged: meta.is_packaged,
                    created_at: Some(meta.created_at),
                    packaged_mods: meta.packaged_mod_ids,
                    merged_files: meta.merged_file_paths,
                    missing_active_mods: missing,
                };
            }
        }
    }

    MasterPatchStatusInfo {
        is_packaged: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
        missing_active_mods: active_mods,
    }
}

pub fn get_active_mod_ids_from_disk(user_zomboid_dir: &str, mod_list_ini_path: &str) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();

    // 1. Check PZModStudio_MasterLoadOrder.json in user_dirs
    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for u_dir in &user_dirs {
        let master_json_path = u_dir.join("PZModStudio_MasterLoadOrder.json");
        if master_json_path.exists() {
            if let Ok(content) = fs::read_to_string(&master_json_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(arr) = parsed.get("active_mod_ids").and_then(|v| v.as_array()) {
                        for item in arr {
                            if let Some(s) = item.as_str() {
                                set.insert(s.to_string());
                            }
                        }
                        if !set.is_empty() {
                            return set;
                        }
                    }
                }
            }
        }

        // 2. Check active profile in PZModStudio_Profiles
        let profiles_dir = u_dir.join("PZModStudio_Profiles");
        if profiles_dir.exists() {
            if let Ok(entries) = fs::read_dir(&profiles_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.extension().and_then(|s| s.to_str()) == Some("json") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            if let Ok(inst) = serde_json::from_str::<crate::instance_manager::AppInstance>(&content) {
                                if inst.is_active {
                                    for id in inst.active_mod_ids {
                                        set.insert(id);
                                    }
                                    if !set.is_empty() {
                                        return set;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Check mod_list_ini_path / ModListData.ini
    if !mod_list_ini_path.is_empty() {
        if let Ok(data) = read_mod_list_ini(mod_list_ini_path) {
            for id in data.active_mods {
                set.insert(id);
            }
            if !set.is_empty() {
                return set;
            }
        }
    }

    for u_dir in &user_dirs {
        for candidate_ini in &[u_dir.join("ModListData.ini"), u_dir.join("mods").join("ModListData.ini")] {
            if candidate_ini.exists() {
                if let Ok(data) = read_mod_list_ini(&candidate_ini.to_string_lossy()) {
                    for id in data.active_mods {
                        set.insert(id);
                    }
                    if !set.is_empty() {
                        return set;
                    }
                }
            }
        }

        // 4. Check mods.txt
        let mods_txt = u_dir.join("mods.txt");
        if mods_txt.exists() {
            if let Ok(content) = fs::read_to_string(&mods_txt) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('#') {
                        set.insert(trimmed.to_string());
                    }
                }
                if !set.is_empty() {
                    return set;
                }
            }
        }
    }

    set
}

pub fn list_merged_packages(user_zomboid_dir: &str, _mod_list_ini_path: &str) -> Vec<MergedPackageInfo> {
    let mut packages = Vec::new();
    let mut seen_folders = std::collections::HashSet::new();

    let mut candidate_dirs = Vec::new();
    let clean_user = user_zomboid_dir.trim();
    if !clean_user.is_empty() {
        let p = PathBuf::from(clean_user);
        if p.exists() {
            candidate_dirs.push(p.clone());
            candidate_dirs.push(p.join("mods"));
        }
    }
    for user_dir in crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir) {
        if user_dir.exists() {
            candidate_dirs.push(user_dir.clone());
        }
        let m_dir = user_dir.join("mods");
        if m_dir.exists() {
            candidate_dirs.push(m_dir);
        }
    }

    if let Some(home) = dirs_next::home_dir() {
        let h1 = home.join("Zomboid").join("mods");
        if h1.exists() { candidate_dirs.push(h1); }
        let h2 = home.join("Documents").join("Zomboid").join("mods");
        if h2.exists() { candidate_dirs.push(h2); }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p1 = PathBuf::from(profile).join("Zomboid").join("mods");
        if p1.exists() { candidate_dirs.push(p1); }
    }

    let detected_paths = crate::vfs::auto_detect_paths();
    if !detected_paths.workshop_dir.is_empty() {
        let ws_mods = Path::new(&detected_paths.workshop_dir).join("mods");
        if ws_mods.exists() {
            candidate_dirs.push(ws_mods);
        }
    }

    for mods_dir in &candidate_dirs {
        if let Ok(entries) = fs::read_dir(mods_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if folder_name.starts_with("Z_PZModStudio_") && !folder_name.contains("Carrier") {
                        if !seen_folders.insert(folder_name.clone()) {
                            continue;
                        }

                        let is_companion_bridge = folder_name == "Z_PZModStudio_Bridge";

                        let mut parsed_desc = None;
                        let display_name = if is_companion_bridge {
                            parsed_desc = Some("Official companion mod for live game control, command execution, and AI agent communication.".to_string());
                            "PZ Mod Studio Live Bridge (Companion Mod)".to_string()
                        } else if let Ok(info_str) = fs::read_to_string(path.join("mod.info")) {
                            let mut parsed_name = None;
                            for line in info_str.lines() {
                                let trimmed = line.trim();
                                if trimmed.starts_with("name=") {
                                    let val = trimmed[5..].trim().to_string();
                                    if !val.is_empty() {
                                        let clean = val
                                            .replace("PZ Mod Studio Patch: ", "")
                                            .replace("PZ Mod Studio Patch:", "")
                                            .replace("Z_PZModStudio_", "");
                                        parsed_name = Some(clean.trim().replace('_', " "));
                                    }
                                } else if trimmed.starts_with("description=") {
                                    let val = trimmed[12..].trim().to_string();
                                    if !val.is_empty() {
                                        parsed_desc = Some(val);
                                    }
                                }
                            }
                            parsed_name.unwrap_or_else(|| {
                                let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                                clean
                            })
                        } else {
                            let clean = folder_name["Z_PZModStudio_".len()..].to_string().replace('_', " ");
                            clean
                        };

                        let meta_path = path.join("patch_metadata.json");
                        
                        let (is_packaged, created_at, packaged_mods, merged_files, meta_visible, meta_desc) = if meta_path.exists() {
                            if let Ok(content) = fs::read_to_string(&meta_path) {
                                if let Ok(meta_json) = serde_json::from_str::<serde_json::Value>(&content) {
                                    let is_pkg = meta_json["is_packaged"].as_bool().unwrap_or(false);
                                    let created = meta_json["created_at"].as_str().map(|s| s.to_string());
                                    let mods = meta_json["packaged_mod_ids"]
                                        .as_array()
                                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                        .unwrap_or_default();
                                    let files = meta_json["merged_file_paths"]
                                        .as_array()
                                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                        .unwrap_or_default();
                                    let vis = meta_json.get("is_visible_in_modlist").and_then(|v| v.as_bool());
                                    let desc = meta_json.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
                                    (is_pkg, created, mods, files, vis, desc)
                                } else {
                                    (false, None, Vec::new(), Vec::new(), None, None)
                                }
                            } else {
                                (false, None, Vec::new(), Vec::new(), None, None)
                            }
                        } else {
                            (false, None, Vec::new(), Vec::new(), None, None)
                        };

                        let description = parsed_desc.or(meta_desc);
                        let is_active_in_modlist = meta_visible.unwrap_or(true);

                        packages.push(MergedPackageInfo {
                            folder_name: folder_name.clone(),
                            display_name,
                            mod_id: folder_name,
                            description,
                            is_packaged,
                            is_active_in_modlist,
                            is_companion_bridge,
                            created_at,
                            packaged_mods,
                            merged_files,
                        });
                    }
                }
            }
        }
    }

    packages.sort_by(|a, b| {
        if a.is_companion_bridge != b.is_companion_bridge {
            a.is_companion_bridge.cmp(&b.is_companion_bridge)
        } else {
            a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase())
        }
    });

    packages
}

pub fn create_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, name: &str, description: Option<&str>) -> Result<MergedPackageInfo, String> {
    let clean_sub = name.trim().replace("PZ Mod Studio Patch: ", "").replace(' ', "_");
    if clean_sub.is_empty() {
        return Err("Package name cannot be empty.".to_string());
    }
    let folder_name = format!("Z_PZModStudio_{}", clean_sub);
    let display_name = clean_sub.replace('_', " ");
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);
    let final_desc = description.unwrap_or("Compatibility merge package synthesized by PZ Mod Studio.").trim();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Invalid Zomboid directory.".to_string());
    }
    let pkg_dir = user_dirs[0].join("mods").join(&folder_name);
    fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, folder_name, final_desc
    );
    let _ = fs::write(pkg_dir.join("mod.info"), &mod_info_content);
    let png_256 = get_preview_png_bytes();
    let _ = fs::write(pkg_dir.join("poster.png"), &png_256);
    let _ = fs::write(pkg_dir.join("icon.png"), &png_256);

    let meta = serde_json::json!({
        "is_packaged": false,
        "is_visible_in_modlist": true,
        "description": final_desc,
        "created_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default(),
        "packaged_mod_ids": [],
        "merged_file_paths": []
    });
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(pkg_dir.join("patch_metadata.json"), &meta_json);
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            mod_list.active_mods.retain(|id| id != &folder_name);
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(MergedPackageInfo {
        folder_name: folder_name.clone(),
        display_name,
        mod_id: folder_name,
        description: Some(final_desc.to_string()),
        is_packaged: false,
        is_active_in_modlist: true,
        is_companion_bridge: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

pub fn rename_merged_package(
    user_zomboid_dir: &str,
    mod_list_ini_path: &str,
    old_folder: &str,
    new_name: &str,
    new_description: Option<&str>,
) -> Result<MergedPackageInfo, String> {
    if old_folder == "Z_PZModStudio_Bridge" {
        return Err("The companion mod 'Z_PZModStudio_Bridge' is an internal system component and cannot be renamed.".to_string());
    }

    let clean_old_sub = old_folder
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_old_sub = clean_old_sub.trim();
    let old_candidates = vec![
        old_folder.to_string(),
        format!("Z_PZModStudio_{}", clean_old_sub),
        format!("Z_PZModStudio_{}", clean_old_sub.replace(' ', "_")),
    ];

    let clean_new_sub = new_name
        .replace("PZ Mod Studio Patch: ", "")
        .trim()
        .replace(' ', "_");
    if clean_new_sub.is_empty() {
        return Err("The new name cannot be empty.".to_string());
    }
    let new_folder = format!("Z_PZModStudio_{}", clean_new_sub);
    let display_name = clean_new_sub.replace('_', " ");
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);
    let final_desc = new_description.unwrap_or("Compatibility merge package synthesized by PZ Mod Studio.").trim();

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("Invalid Zomboid directory.".to_string());
    }

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription={}\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, new_folder, final_desc
    );

    for dir in &user_dirs {
        for old_target in &old_candidates {
            let old_p = dir.join("mods").join(old_target);
            let new_p = dir.join("mods").join(&new_folder);
            if old_p.exists() {
                let _ = fs::rename(&old_p, &new_p);
                let _ = fs::write(new_p.join("mod.info"), &mod_info_content);
                let meta_path = new_p.join("patch_metadata.json");
                if meta_path.exists() {
                    if let Ok(meta_str) = fs::read_to_string(&meta_path) {
                        if let Ok(mut meta_json) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                            meta_json["description"] = serde_json::json!(final_desc);
                            let _ = fs::write(&meta_path, serde_json::to_string_pretty(&meta_json).unwrap_or_default());
                        }
                    }
                }
            }
        }
    }

    let mut is_active = false;
    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            for id in &mut mod_list.active_mods {
                if old_candidates.contains(id) {
                    *id = new_folder.clone();
                    is_active = true;
                }
            }
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(MergedPackageInfo {
        folder_name: new_folder.clone(),
        display_name,
        mod_id: new_folder,
        description: Some(final_desc.to_string()),
        is_packaged: false,
        is_active_in_modlist: is_active,
        is_companion_bridge: false,
        created_at: None,
        packaged_mods: Vec::new(),
        merged_files: Vec::new(),
    })
}

pub fn toggle_package_in_modlist(
    user_zomboid_dir: &str,
    mod_list_ini_path: &str,
    folder_name: &str,
    enabled: bool,
) -> Result<bool, String> {
    let clean_sub = folder_name
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim();

    let target_id = if folder_name.starts_with("Z_PZModStudio_") {
        folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);

    // 1. Write is_visible_in_modlist to patch_metadata.json
    for u_dir in &user_dirs {
        for cand in &[target_id.clone(), folder_name.to_string()] {
            let pkg_dir = u_dir.join("mods").join(cand);
            if pkg_dir.exists() {
                let meta_path = pkg_dir.join("patch_metadata.json");
                let mut meta_json = if meta_path.exists() {
                    fs::read_to_string(&meta_path)
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .unwrap_or_else(|| serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };
                meta_json["is_visible_in_modlist"] = serde_json::json!(enabled);
                let _ = fs::write(meta_path, serde_json::to_string_pretty(&meta_json).unwrap_or_default());
            }
        }
    }

    // 2. If disabled (hidden from ModList), remove from active_mods so it's not active while hidden
    if !enabled {
        let active_set = get_active_mod_ids_from_disk(user_zomboid_dir, mod_list_ini_path);
        let mut active_mods: Vec<String> = active_set.into_iter().collect();
        let initial_len = active_mods.len();
        active_mods.retain(|id| id != &target_id && id != folder_name);

        if active_mods.len() != initial_len {
            let mut load_order: Vec<String> = Vec::new();
            for u_dir in &user_dirs {
                let master_json_path = u_dir.join("PZModStudio_MasterLoadOrder.json");
                if master_json_path.exists() {
                    if let Ok(content) = fs::read_to_string(&master_json_path) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(arr) = parsed.get("load_order").and_then(|v| v.as_array()) {
                                for item in arr {
                                    if let Some(s) = item.as_str() {
                                        load_order.push(s.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _ = crate::instance_manager::save_master_load_order(user_zomboid_dir.to_string(), load_order, active_mods);
        }
    }

    Ok(true)
}

fn force_remove_dir_all(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    let _ = force_remove_dir_all(&entry_path);
                } else {
                    if let Ok(metadata) = fs::metadata(&entry_path) {
                        let mut permissions = metadata.permissions();
                        if permissions.readonly() {
                            permissions.set_readonly(false);
                            let _ = fs::set_permissions(&entry_path, permissions);
                        }
                    }
                    let _ = fs::remove_file(&entry_path);
                }
            }
        }
        let _ = fs::remove_dir(path);
    } else {
        if let Ok(metadata) = fs::metadata(path) {
            let mut permissions = metadata.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                let _ = fs::set_permissions(path, permissions);
            }
        }
        let _ = fs::remove_file(path);
    }
    Ok(())
}

pub fn delete_merged_package(user_zomboid_dir: &str, mod_list_ini_path: &str, folder_name: &str) -> Result<bool, String> {
    if folder_name == "Z_PZModStudio_Bridge" {
        return Err("The companion mod 'Z_PZModStudio_Bridge' is an internal system component and cannot be deleted.".to_string());
    }

    let clean_sub = folder_name
        .replace("PZ Mod Studio Patch: ", "")
        .replace("Z_PZModStudio_", "");
    let clean_sub = clean_sub.trim();

    let candidates = vec![
        folder_name.to_string(),
        format!("Z_PZModStudio_{}", clean_sub),
        format!("Z_PZModStudio_{}", clean_sub.replace(' ', "_")),
    ];

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for dir in &user_dirs {
        for target in &candidates {
            let _ = force_remove_dir_all(&dir.join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Lua").join("mods").join(target));
            let _ = force_remove_dir_all(&dir.join("Workshop").join("PZModStudioCarrier").join("Contents").join("mods").join(target));
        }
    }

    // Also remove from dynamically detected installation and workshop folders
    let detected_paths = crate::vfs::auto_detect_paths();
    let mut extra_dirs = Vec::new();
    if !detected_paths.pz_install_dir.is_empty() {
        extra_dirs.push(Path::new(&detected_paths.pz_install_dir).join("mods"));
    }
    if !detected_paths.workshop_dir.is_empty() {
        extra_dirs.push(Path::new(&detected_paths.workshop_dir).join("mods"));
    }
    for extra_dir in extra_dirs {
        for target in &candidates {
            let p = extra_dir.join(target);
            if p.exists() {
                let _ = force_remove_dir_all(&p);
            }
        }
    }

    if !mod_list_ini_path.is_empty() {
        if let Ok(mut mod_list) = read_mod_list_ini(mod_list_ini_path) {
            mod_list.active_mods.retain(|id| !candidates.contains(id));
            let _ = write_mod_list_ini(mod_list_ini_path, &mod_list.active_mods);
        }
    }

    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftResolutionItem {
    pub relative_path: String,
    pub resolved_content: String,
    pub status: String,
}

pub fn save_draft_resolution(
    user_zomboid_dir: &str,
    package_folder_name: &str,
    relative_path: &str,
    resolved_content: &str,
    status: &str,
) -> Result<bool, String> {
    let clean_pkg_name = if package_folder_name.starts_with("Z_PZModStudio_") {
        package_folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", package_folder_name.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    let _ = fs::create_dir_all(&pkg_dir);
    let draft_file = pkg_dir.join("draft_resolutions.json");

    let mut resolutions: std::collections::HashMap<String, DraftResolutionItem> = if draft_file.exists() {
        fs::read_to_string(&draft_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    resolutions.insert(
        relative_path.to_string(),
        DraftResolutionItem {
            relative_path: relative_path.to_string(),
            resolved_content: resolved_content.to_string(),
            status: status.to_string(),
        },
    );

    let json_str = serde_json::to_string_pretty(&resolutions).map_err(|e| e.to_string())?;
    fs::write(draft_file, json_str).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_draft_resolutions(
    user_zomboid_dir: &str,
    package_folder_name: &str,
) -> std::collections::HashMap<String, DraftResolutionItem> {
    let clean_pkg_name = if package_folder_name.starts_with("Z_PZModStudio_") {
        package_folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", package_folder_name.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return std::collections::HashMap::new();
    }

    let draft_file = user_dirs[0].join("mods").join(&clean_pkg_name).join("draft_resolutions.json");
    if draft_file.exists() {
        fs::read_to_string(&draft_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    }
}

pub fn clear_draft_resolutions(
    user_zomboid_dir: &str,
    package_folder_name: &str,
) -> Result<bool, String> {
    let clean_pkg_name = if package_folder_name.starts_with("Z_PZModStudio_") {
        package_folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", package_folder_name.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    for u_dir in user_dirs {
        let draft_file = u_dir.join("mods").join(&clean_pkg_name).join("draft_resolutions.json");
        if draft_file.exists() {
            let _ = fs::remove_file(draft_file);
        }
    }
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedMergedPackage {
    pub format_version: u32,
    pub folder_name: String,
    pub display_name: String,
    pub created_at: String,
    pub is_packaged: bool,
    pub packaged_mod_ids: Vec<String>,
    pub draft_resolutions: std::collections::HashMap<String, DraftResolutionItem>,
    pub merged_files: Vec<MergedFilePayload>,
}

pub fn export_merged_package(
    user_zomboid_dir: &str,
    package_folder_name: &str,
    target_file_path: &str,
) -> Result<bool, String> {
    let clean_pkg_name = if package_folder_name.starts_with("Z_PZModStudio_") {
        package_folder_name.to_string()
    } else {
        format!("Z_PZModStudio_{}", package_folder_name.replace(' ', "_"))
    };

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let pkg_dir = user_dirs[0].join("mods").join(&clean_pkg_name);
    if !pkg_dir.exists() {
        return Err(format!("The package '{}' does not exist on disk.", clean_pkg_name));
    }

    let meta_path = pkg_dir.join("patch_metadata.json");
    let (is_packaged, created_at, packaged_mods) = if meta_path.exists() {
        if let Ok(content) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<MasterPatchMetadata>(&content) {
                (meta.is_packaged, meta.created_at, meta.packaged_mod_ids)
            } else {
                (false, String::new(), Vec::new())
            }
        } else {
            (false, String::new(), Vec::new())
        }
    } else {
        (false, String::new(), Vec::new())
    };

    let draft_resolutions = get_draft_resolutions(user_zomboid_dir, &clean_pkg_name);

    let display_name = clean_pkg_name["Z_PZModStudio_".len()..].replace('_', " ");

    let mut merged_files = Vec::new();
    let media_dir = pkg_dir.join("media");
    if media_dir.exists() {
        for entry in walkdir::WalkDir::new(&media_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(rel) = entry.path().strip_prefix(&pkg_dir) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        merged_files.push(MergedFilePayload {
                            relative_path: rel_str,
                            content,
                        });
                    }
                }
            }
        }
    }

    let export_payload = ExportedMergedPackage {
        format_version: 1,
        folder_name: clean_pkg_name,
        display_name,
        created_at,
        is_packaged,
        packaged_mod_ids: packaged_mods,
        draft_resolutions,
        merged_files,
    };

    let json_str = serde_json::to_string_pretty(&export_payload).map_err(|e| e.to_string())?;
    fs::write(target_file_path, json_str).map_err(|e| e.to_string())?;

    Ok(true)
}

pub fn import_merged_package(
    user_zomboid_dir: &str,
    _mod_list_ini_path: &str,
    source_file_path: &str,
) -> Result<MergedPackageInfo, String> {
    if source_file_path.ends_with(".pzpack") {
        return Err("This file is a Collection Preset (.pzpack), not a Merge Package (.pzmerge). To import mod list presets, go to 'Mod List' > 'Presets' > 'Import .pzpack'.".to_string());
    }

    let content = fs::read_to_string(source_file_path).map_err(|e| format!("Error reading file: {}", e))?;

    if content.contains("\"load_order\"") && !content.contains("\"merged_files\"") {
        return Err("This file corresponds to a Mod List Preset (.pzpack). Please import it from the 'Mod List' tab.".to_string());
    }

    let imported: ExportedMergedPackage = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid .pzmerge package format: {}", e))?;

    let user_dirs = crate::load_order::mod_info::get_all_user_zomboid_dirs(user_zomboid_dir);
    if user_dirs.is_empty() {
        return Err("No valid Zomboid user directories found.".to_string());
    }

    let clean_folder = if imported.folder_name.starts_with("Z_PZModStudio_") {
        imported.folder_name.clone()
    } else {
        format!("Z_PZModStudio_{}", imported.folder_name.replace(' ', "_"))
    };

    let pkg_dir = user_dirs[0].join("mods").join(&clean_folder);
    fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;

    let display_name = imported.display_name.clone();
    let in_game_title = format!("PZ Mod Studio Patch: {}", display_name);

    let mod_info_content = format!(
        "name={}\r\nid={}\r\ndescription=Compatibility merge package synthesized by PZ Mod Studio.\r\nposter=poster.png\r\nicon=icon.png\r\nmodversion=1.0.0\r\npzversion=41,42\r\nversionMin=41.00\r\nauthor=PZ Mod Studio\r\n",
        in_game_title, clean_folder
    );
    let _ = fs::write(pkg_dir.join("mod.info"), &mod_info_content);
    let png_256 = get_preview_png_bytes();
    let _ = fs::write(pkg_dir.join("poster.png"), &png_256);
    let _ = fs::write(pkg_dir.join("icon.png"), &png_256);

    let meta = MasterPatchMetadata {
        is_packaged: imported.is_packaged,
        created_at: if imported.created_at.is_empty() {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_default()
        } else {
            imported.created_at.clone()
        },
        packaged_mod_ids: imported.packaged_mod_ids.clone(),
        merged_file_paths: imported.merged_files.iter().map(|f| f.relative_path.clone()).collect(),
    };
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(pkg_dir.join("patch_metadata.json"), &meta_json);
    }

    if let Ok(draft_json) = serde_json::to_string_pretty(&imported.draft_resolutions) {
        let _ = fs::write(pkg_dir.join("draft_resolutions.json"), &draft_json);
    }

    // Write merged files to disk
    for file in &imported.merged_files {
        let dest = pkg_dir.join(&file.relative_path);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(dest, &file.content);

        // Also duplicate to 42/ subfolder for native B42 compatibility
        let dest_42 = pkg_dir.join("42").join(&file.relative_path);
        if let Some(parent) = dest_42.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(dest_42, &file.content);
    }

    Ok(MergedPackageInfo {
        folder_name: clean_folder.clone(),
        display_name,
        mod_id: clean_folder,
        description: Some("Package imported from .pzmerge file".to_string()),
        is_packaged: imported.is_packaged,
        is_active_in_modlist: false,
        is_companion_bridge: false,
        created_at: Some(meta.created_at),
        packaged_mods: imported.packaged_mod_ids,
        merged_files: imported.merged_files.iter().map(|f| f.relative_path.clone()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn test_validate_polyfill_lua_ast() {
        let poly_content = generate_master_polyfill_lua();
        let parse_result = full_moon::parse(&poly_content);
        assert!(parse_result.is_ok(), "generate_master_polyfill_lua() must be valid Lua syntax: {:?}", parse_result.err());
    }

    #[test]
    fn test_sync_latest_master_polyfills() {
        let poly_content = generate_master_polyfill_lua();
        assert!(poly_content.contains("IGUI_ItemCat_GunMag"));
        assert!(poly_content.contains("sanitizeAllScriptItems") || poly_content.contains("getAllItems"));
        assert!(poly_content.contains("BWORoomPrograms"));
        assert!(poly_content.contains("IsoDoor"));

        let user_mods = Path::new("C:/Users/javie/Zomboid/mods");
        if user_mods.exists() {
            for entry in fs::read_dir(user_mods).unwrap().filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_dir() {
                    let name = p.file_name().unwrap().to_string_lossy();
                    if name.starts_with("Z_PZModStudio_") {
                        let poly1 = p.join("media").join("lua").join("shared").join("Z_PZModStudio_Polyfills.lua");
                        let poly2 = p.join("42").join("media").join("lua").join("shared").join("Z_PZModStudio_Polyfills.lua");
                        if let Some(parent) = poly1.parent() { let _ = fs::create_dir_all(parent); }
                        if let Some(parent) = poly2.parent() { let _ = fs::create_dir_all(parent); }
                        let _ = fs::write(poly1, &poly_content);
                        let _ = fs::write(poly2, &poly_content);
                    }
                }
            }
        }
    }
}

