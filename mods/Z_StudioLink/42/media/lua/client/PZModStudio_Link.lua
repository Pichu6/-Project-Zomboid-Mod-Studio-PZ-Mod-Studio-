-- PZ Mod Studio Link: the game's Mods screen shows the profile that is active in PZ Mod Studio.
--
-- The Studio writes Zomboid/Lua/PZModStudio_Link.txt when a profile is activated or changed:
--   profile=<name>
--   member=<mod id>      one line per mod of the profile, on or off, in load order
-- Mods outside the profile are left out of the list ("Show all subscribed mods" brings them
-- back), and a save that uses a mod outside the profile does not load. Turning mods on or off
-- here needs nothing from this mod: the game writes mods/default.txt and the Studio reads it.
-- Without the file (no profile active in the Studio) the game's screens are left as they are.

require "OptionScreens/ModSelector/ModSelector"
require "OptionScreens/ModSelector/ModSelectorModel"
require "OptionScreens/ModSelector/ModListPanel"
require "OptionScreens/MainScreen"

local SELF_ID = "Z_StudioLink"
local FILE = "PZModStudio_Link.txt"

local TEXT = {
    EN = {
        profile = "Profile: %s  (PZ Mod Studio)",
        showAll = "Show all subscribed mods",
        blocked = "This save uses mods that are not in the profile \"%s\":",
        howTo = "Switch to the profile you played it with in PZ Mod Studio, or add these mods to this profile.",
    },
    ES = {
        profile = "Perfil: %s  (PZ Mod Studio)",
        showAll = "Mostrar todos los mods suscriptos",
        blocked = "Esta partida usa mods que no están en el perfil \"%s\":",
        howTo = "Cambiá en PZ Mod Studio al perfil con el que la jugaste, o agregá estos mods a este perfil.",
    },
}

local function text(key)
    local lang = "EN"
    pcall(function() lang = tostring(Translator.getLanguage():name()) end)
    local t = TEXT[lang] or TEXT.EN
    return t[key] or TEXT.EN[key]
end

local Link = { showAll = false }
PZModStudioLink = Link

--- The active profile as the Studio last wrote it, or nil when there is none.
function Link.read()
    local file = getFileReader(FILE, false)
    if not file then return nil end
    local data = { name = "", members = {}, order = {} }
    local line = file:readLine()
    while line ~= nil do
        local key, value = string.match(line, "^%s*([%w_]+)%s*=%s*(.-)%s*$")
        if key == "profile" then
            data.name = value
        elseif key == "member" and value ~= "" then
            if not data.members[value] then table.insert(data.order, value) end
            data.members[value] = true
        end
        line = file:readLine()
    end
    file:close()
    if data.name == "" and #data.order == 0 then return nil end
    data.members[SELF_ID] = true
    return data
end

-- The list: only the profile's mods. Mods switched on are always shown, so nothing active is
-- ever out of sight; this mod itself is never shown, so it cannot be switched off by accident.
local filterMods = ModSelector.Model.filterMods
function ModSelector.Model:filterMods(...)
    filterMods(self, ...)
    if self.isServerSettingsMods then return end
    local link = Link.read()
    if not link then return end
    local kept = {}
    for _, modData in ipairs(self.currentMods) do
        local id = modData.modId
        if id ~= SELF_ID and (Link.showAll or link.members[id] or modData.isActive) then
            table.insert(kept, modData)
        end
    end
    table.wipe(self.currentMods)
    for _, modData in ipairs(kept) do table.insert(self.currentMods, modData) end
end

-- The profile's name and the "show all" tick, on the row of the game's own "enabled only" tick.
local createChildren = ModSelector.ModListPanel.createChildren
function ModSelector.ModListPanel:createChildren()
    createChildren(self)
    local link = Link.read()
    if not link then return end
    local ok, err = pcall(function()
        local row = self.enabledModsTickbox
        local h = row:getHeight()
        local label = text("showAll")
        local width = h + 10 + getTextManager():MeasureStringX(UIFont.Small, label)
        local tick = ISTickBox:new(row:getRight() + 20, row.y, width, h, "", self, function(panel, _, selected)
            Link.showAll = selected and true or false
            panel:updateView()
        end)
        tick:initialise()
        tick:instantiate()
        tick:addOption(label)
        tick.selected[1] = Link.showAll
        self.filterPanel:addChild(tick)
        self.studioShowAll = tick

        local name = ISLabel:new(tick:getRight() + 20, row.y, h, string.format(text("profile"), link.name),
            0.55, 0.85, 1.0, 1.0, UIFont.Small, true)
        name:initialise()
        self.filterPanel:addChild(name)
        self.studioProfileLabel = name
    end)
    if not ok then print("[StudioLink] could not add the profile row: " .. tostring(err)) end
end

-- The profile can change while the game sits on the main menu: read it again each time.
local updateView = ModSelector.ModListPanel.updateView
function ModSelector.ModListPanel:updateView(...)
    if self.studioProfileLabel then
        local link = Link.read()
        if link then self.studioProfileLabel:setName(string.format(text("profile"), link.name)) end
    end
    return updateView(self, ...)
end

--- Mods the save uses that are not in the profile.
function Link.outsideProfile(activeMods, link)
    local result = {}
    if not activeMods then return result end
    local mods = activeMods:getMods()
    for i = 0, mods:size() - 1 do
        local id = mods:get(i)
        if not link.members[id] then
            local info = getModInfoByID(id)
            table.insert(result, info and info:getName() or id)
        end
    end
    return result
end

-- The save check: the game's own one first, then the profile, with the game's own dialog.
local checkSaveFile = MainScreen.checkSaveFile
function MainScreen.checkSaveFile(...)
    if not checkSaveFile(...) then return false end
    local link = Link.read()
    if not link then return true end
    local saveInfo = getSaveInfo(getWorld():getWorld())
    local outside = Link.outsideProfile(saveInfo and saveInfo.activeMods, link)
    if #outside == 0 then return true end

    local body = " <H1> " .. getText("UI_mainscreen_ErrorLoadingSavefile") .. " <H2> <LINE> <LINE> "
    body = body .. getText("UI_mainscreen_SavefileName", getWorld():getWorld()) .. " <LINE> <LINE> "
    body = body .. " <TEXT> " .. string.format(text("blocked"), link.name) .. " <LINE> <INDENT:20> <RED> "
    for _, name in ipairs(outside) do body = body .. name .. " <LINE> " end
    body = body .. " <INDENT:0> <RGB:1,1,1> <LINE> " .. text("howTo") .. " <LINE> "
    MainScreen.displayCheckSavefileModal(body, true)
    return false
end
