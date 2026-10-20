-- PZ Mod Studio Link: the game's Mods screen shows the profile that is active in PZ Mod Studio.
--
-- The Studio writes, in Zomboid/Lua:
--   PZModStudio_Link.txt        profile=<name>, member=<mod id> per mod of the profile (on or
--                               off, in load order), other=<mod id> per mod another profile holds
--   PZModStudio_LinkHealth.txt  <severity>\t<mod id>\t<text> per Mod Health warning, in the
--                               player's language
-- and this mod writes PZModStudio_LinkRequests.txt (add=<mod id> per line) when the player asks
-- to add mods to the profile; the Studio picks it up within a couple of seconds.
--
-- What it does with them:
-- - Mods screen: only the profile's mods ("Show all subscribed mods" brings the rest back); a
--   button for mods installed but in no profile at all (new subscriptions), which adds them to
--   the profile; a mark on each mod Mod Health has something to say about, with the text on hover.
-- - Load screen: on each save, whether its mods match the profile.
-- - Loading a save: one that uses mods outside the profile does not load; one whose mod list is
--   empty asks first, and can be given the profile's mods.
-- Turning mods on or off here needs nothing from this mod: the game writes mods/default.txt and
-- the Studio reads it. Without the Link file (no profile active in the Studio) the game's screens
-- are left as they are.

require "OptionScreens/ModSelector/ModSelector"
require "OptionScreens/ModSelector/ModSelectorModel"
require "OptionScreens/ModSelector/ModListPanel"
require "OptionScreens/ModSelector/ModListBox"
require "OptionScreens/MainScreen"
require "OptionScreens/LoadGameScreen"

local SELF_ID = "Z_StudioLink"
local FILE = "PZModStudio_Link.txt"
local HEALTH_FILE = "PZModStudio_LinkHealth.txt"
local REQUESTS_FILE = "PZModStudio_LinkRequests.txt"
local STUDIO_PACKAGE = "^Z_PZModStudio_"

local TEXT = {
    EN = {
        profile = "Profile: %s",
        profileTip = "The profile active in PZ Mod Studio. Only its mods are listed.",
        showAll = "Show all subscribed mods",
        newMods = "+%d new -> profile",
        newModsTip = "%d installed mod(s) are in no profile (subscribed outside PZ Mod Studio, for example). Click to add them to \"%s\", switched off:\n%s",
        added = "Added to the profile",
        blocked = "This save uses mods that are not in the profile \"%s\":",
        howTo = "Switch to the profile you played it with in PZ Mod Studio, or add these mods to this profile.",
        empty = "This save's mod list is empty, while the profile \"%s\" has %d mods.",
        emptyWhy = "Loaded like this, the game would run it with no mods and drop every item that came from a mod. Yes gives it the profile's mods and loads it; No goes back.",
        badgeEmpty = "no mods",
        badgeOutside = "%d outside the profile",
        badgeOk = "profile mods",
    },
    ES = {
        profile = "Perfil: %s",
        profileTip = "El perfil activo en PZ Mod Studio. Solo se listan sus mods.",
        showAll = "Mostrar todos los mods suscriptos",
        newMods = "+%d nuevos -> perfil",
        newModsTip = "%d mod(s) instalados no están en ningún perfil (suscriptos fuera de PZ Mod Studio, por ejemplo). Clic para agregarlos a \"%s\", apagados:\n%s",
        added = "Agregado al perfil",
        blocked = "Esta partida usa mods que no están en el perfil \"%s\":",
        howTo = "Cambiá en PZ Mod Studio al perfil con el que la jugaste, o agregá estos mods a este perfil.",
        empty = "La lista de mods de esta partida está vacía, y el perfil \"%s\" tiene %d mods.",
        emptyWhy = "Si la cargás así, el juego la correría sin mods y borraría todos los objetos que venían de un mod. Sí le da los mods del perfil y la carga; No vuelve.",
        badgeEmpty = "sin mods",
        badgeOutside = "%d fuera del perfil",
        badgeOk = "mods del perfil",
    },
}

local function language()
    local lang = "EN"
    pcall(function()
        local l = Translator.getLanguage()
        lang = tostring(l and (l.name and l:name() or l) or "EN")
    end)
    return string.upper(lang)
end

local function text(key)
    local t = TEXT[language()] or TEXT.EN
    return t[key] or TEXT.EN[key]
end

local Link = { showAll = false, pending = {}, health = {} }
PZModStudioLink = Link

-- ------------------------------------------------------------------ the Studio's files

--- The active profile as the Studio last wrote it, or nil when there is none.
function Link.read()
    local file = getFileReader(FILE, false)
    if not file then return nil end
    local data = { name = "", members = {}, order = {}, others = {} }
    local line = file:readLine()
    while line ~= nil do
        local key, value = string.match(line, "^%s*([%w_]+)%s*=%s*(.-)%s*$")
        if key == "profile" then
            data.name = value
        elseif key == "member" and value ~= "" then
            if not data.members[value] then table.insert(data.order, value) end
            data.members[value] = true
        elseif key == "other" and value ~= "" then
            data.others[value] = true
        end
        line = file:readLine()
    end
    file:close()
    if data.name == "" and #data.order == 0 then return nil end
    data.members[SELF_ID] = true
    -- Asked for in this session, before the Studio has written them back.
    for id, _ in pairs(Link.pending) do
        if data.members[id] then Link.pending[id] = nil else data.members[id] = true end
    end
    return data
end

--- Mod Health's warnings, per mod id: { severity = "error"|"warning"|..., lines = {...} }.
function Link.readHealth()
    local result = {}
    local file = getFileReader(HEALTH_FILE, false)
    if not file then return result end
    local line = file:readLine()
    while line ~= nil do
        local severity, id, msg = string.match(line, "^([^\t]*)\t([^\t]+)\t(.*)$")
        if id then
            local entry = result[id] or { severity = severity, lines = {} }
            if severity == "error" then entry.severity = "error" end
            table.insert(entry.lines, msg)
            result[id] = entry
        end
        line = file:readLine()
    end
    file:close()
    return result
end

--- Asks the Studio to add these mods to the active profile (switched off).
function Link.requestAdd(ids)
    if #ids == 0 then return end
    local writer = getFileWriter(REQUESTS_FILE, true, true)
    if not writer then return end
    for _, id in ipairs(ids) do
        writer:write("add=" .. id .. "\n")
        Link.pending[id] = true
    end
    writer:close()
end

--- Installed mods that are in no profile: not this one's, not another's, not the Studio's own.
function Link.orphans(model, link)
    local result = {}
    if not model or not model.sortedMods then return result end
    for _, modData in ipairs(model.sortedMods) do
        local id = modData.modId
        if id ~= SELF_ID and not string.find(id, STUDIO_PACKAGE) and not link.members[id] and not link.others[id] and not modData.isActive then
            table.insert(result, modData)
        end
    end
    return result
end

-- ------------------------------------------------------------------ the Mods screen

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

-- Mod Health's warnings are read when the list is read, not on every frame.
local reloadMods = ModSelector.Model.reloadMods
function ModSelector.Model:reloadMods(...)
    Link.health = Link.readHealth()
    return reloadMods(self, ...)
end

--- Lays out the Studio's controls on the row of the game's own "enabled only" tick, leaving the
--- game's Favorites button its room: the new-mods button first, the profile name only if it fits.
local function layoutRow(panel)
    local row = panel.enabledModsTickbox
    local limit = (panel.favoriteButton and panel.favoriteButton.x or panel.width) - 10
    local x = row:getRight() + 16
    if panel.studioShowAll then
        panel.studioShowAll:setX(x)
        x = panel.studioShowAll:getRight() + 12
    end
    if panel.studioNewButton and panel.studioNewButton:isVisible() then
        panel.studioNewButton:setX(x)
        x = panel.studioNewButton:getRight() + 12
    end
    if panel.studioProfileLabel then
        panel.studioProfileLabel:setX(x)
        panel.studioProfileLabel:setVisible(panel.studioProfileLabel:getRight() <= limit)
    end
end

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
        local tick = ISTickBox:new(row:getRight() + 16, row.y, width, h, "", self, function(panel, _, selected)
            Link.showAll = selected and true or false
            panel:updateView()
        end)
        tick:initialise()
        tick:instantiate()
        tick:addOption(label)
        tick.selected[1] = Link.showAll
        self.filterPanel:addChild(tick)
        self.studioShowAll = tick

        local button = ISButton:new(tick:getRight() + 12, row.y, 120, h, "", self, function(panel)
            local now = Link.read()
            if not now then return end
            local ids = {}
            for _, modData in ipairs(Link.orphans(panel.model, now)) do table.insert(ids, modData.modId) end
            Link.requestAdd(ids)
            panel:updateView()
        end)
        button:initialise()
        button:instantiate()
        button.borderColor = { r = 0.3, g = 0.75, b = 1.0, a = 0.8 }
        button:setVisible(false)
        self.filterPanel:addChild(button)
        self.studioNewButton = button

        local name = ISLabel:new(button:getRight() + 12, row.y, h, string.format(text("profile"), link.name),
            0.55, 0.85, 1.0, 1.0, UIFont.Small, true)
        name:initialise()
        name.tooltip = text("profileTip")
        self.filterPanel:addChild(name)
        self.studioProfileLabel = name
        layoutRow(self)
    end)
    if not ok then print("[StudioLink] could not add the profile row: " .. tostring(err)) end
end

-- The profile can change while the game sits on the main menu: read it again each time.
local updateView = ModSelector.ModListPanel.updateView
function ModSelector.ModListPanel:updateView(...)
    local result = updateView(self, ...)
    if self.studioProfileLabel then
        local ok, err = pcall(function()
            local link = Link.read()
            if not link then return end
            self.studioProfileLabel:setName(string.format(text("profile"), link.name))
            local orphans = Link.orphans(self.model, link)
            local button = self.studioNewButton
            if #orphans > 0 then
                local names = {}
                for i, modData in ipairs(orphans) do
                    if i > 12 then table.insert(names, "..."); break end
                    table.insert(names, "- " .. modData.name)
                end
                button:setTitle(string.format(text("newMods"), #orphans))
                button:setWidth(getTextManager():MeasureStringX(UIFont.Small, button:getTitle()) + 16)
                button.tooltip = string.format(text("newModsTip"), #orphans, link.name, table.concat(names, "\n"))
                button:setVisible(true)
            else
                button:setVisible(false)
            end
            layoutRow(self)
        end)
        if not ok then print("[StudioLink] could not update the profile row: " .. tostring(err)) end
    end
    return result
end

local recalcSize = ModSelector.ModListPanel.recalcSize
function ModSelector.ModListPanel:recalcSize(...)
    local result = recalcSize(self, ...)
    if self.studioProfileLabel then pcall(layoutRow, self) end
    return result
end

-- A mark on each mod Mod Health has something to say about, left of the favourite star, with
-- what it says on hover (unless the game is already saying something there).
local SEVERITY_COLOR = {
    error = { r = 0.95, g = 0.3, b = 0.3 },
    warning = { r = 1.0, g = 0.7, b = 0.2 },
}
-- The game's own sizes for a row (locals of ModListBox.lua).
local BUTTON_HGT = getTextManager():getFontHeight(UIFont.Small) + 6
local UI_BORDER_SPACING = 10
local function drawHealthMark(list, y, nextY, item)
    local entry = item.item and Link.health[item.item.modId]
    if entry then
        local color = SEVERITY_COLOR[entry.severity] or SEVERITY_COLOR.warning
        local height = nextY - y
        local size = math.max(8, math.floor(height / 3))
        local x = list:getWidth() - UI_BORDER_SPACING - BUTTON_HGT - 1 - UI_BORDER_SPACING - size
        list:drawRect(x, y + (height - size) / 2, size, size, 0.9, color.r, color.g, color.b)
        if not item.item.isIncompatible then
            item.tooltip = table.concat(entry.lines, "\n")
            item.studioTip = true
        end
    elseif item.studioTip then
        -- The warning is gone since the list was last read.
        item.studioTip = nil
        if not (item.item and item.item.isIncompatible) then item.tooltip = nil end
    end
end
local doDrawItem = ModSelector.ModListBox.doDrawItem
function ModSelector.ModListBox:doDrawItem(y, item, alt)
    local nextY = doDrawItem(self, y, item, alt)
    pcall(drawHealthMark, self, y, nextY, item)
    return nextY
end

-- ------------------------------------------------------------------ saves

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

--- How many mods the profile has besides this one.
local function profileSize(link)
    local n = 0
    for _, id in ipairs(link.order) do
        if id ~= SELF_ID then n = n + 1 end
    end
    return n
end

--- A save against the profile: "empty", "outside" (with how many), "ok", or nil when there is
--- nothing to say (no profile, or an old save without a mod list, which uses the default one).
function Link.saveStatus(activeMods, link)
    if not link or not activeMods then return nil end
    if activeMods:getMods():isEmpty() then
        return profileSize(link) > 0 and "empty" or nil
    end
    local outside = Link.outsideProfile(activeMods, link)
    if #outside > 0 then return "outside", #outside end
    return "ok"
end

-- The badge on each save of the Load screen, at the right of the row.
local function drawSaveBadge(list, y, item)
    local link = Link.listLink
    if not link then return end
    local status, count = Link.saveStatus(item.item.activeMods, link)
    if not status then return end
    local label, r, g, b
    if status == "empty" then
        label, r, g, b = text("badgeEmpty"), 0.95, 0.35, 0.35
    elseif status == "outside" then
        label, r, g, b = string.format(text("badgeOutside"), count), 1.0, 0.7, 0.2
    else
        label, r, g, b = text("badgeOk"), 0.45, 0.85, 0.5
    end
    local right = list:getWidth() - 12
    if not item.item.playerAlive and list.parent and list.parent.deadTexture then
        right = list:getWidth() - 24 - list.parent.deadTexture:getWidthOrig() - 8
    end
    list:drawTextRight(label, right, y + 6, r, g, b, 0.95, UIFont.Small)
end

local createLoadScreen = LoadGameScreen.create
function LoadGameScreen:create(...)
    local result = createLoadScreen(self, ...)
    local draw = self.listbox.doDrawItem
    self.listbox.doDrawItem = function(list, y, item, alt)
        local nextY = draw(list, y, item, alt)
        pcall(drawSaveBadge, list, y, item)
        return nextY
    end
    return result
end

-- The profile is read once when the list of saves is filled, not on every frame.
local setSaveGamesList = LoadGameScreen.setSaveGamesList
function LoadGameScreen:setSaveGamesList(...)
    Link.listLink = Link.read()
    return setSaveGamesList(self, ...)
end

-- The save check: the game's own one first, then the profile, with the game's own dialog.
local checkSaveFile = MainScreen.checkSaveFile
function MainScreen.checkSaveFile(...)
    if not checkSaveFile(...) then return false end
    local link = Link.read()
    if not link then return true end
    local world = getWorld():getWorld()
    local saveInfo = getSaveInfo(world)
    local status = Link.saveStatus(saveInfo and saveInfo.activeMods, link)

    -- A save whose own mod list is empty loads with no mods, and the game then drops every item
    -- a mod made. Asked first, the game's own way: Yes gives it the profile's mods and loads it,
    -- No goes back.
    if status == "empty" and Link.fillEmpty == world then
        -- Yes was answered: the game's own Yes comes back through here after copying the save's
        -- (empty) list again, so the profile's mods are put back before it loads.
        Link.fillEmpty = nil
        ActiveMods.getById("currentGame"):copyFrom(ActiveMods.getById("default"))
        return true
    end
    Link.fillEmpty = nil
    if status == "empty" then
        Link.askedEmpty = world
        local body = " <H1> " .. getText("UI_mainscreen_ErrorLoadingSavefile") .. " <H2> <LINE> <LINE> "
        body = body .. getText("UI_mainscreen_SavefileName", world) .. " <LINE> <LINE> "
        body = body .. " <TEXT> <RED> " .. string.format(text("empty"), link.name, profileSize(link)) .. " <RGB:1,1,1> <LINE> <LINE> "
        body = body .. text("emptyWhy") .. " <LINE> "
        MainScreen.displayCheckSavefileModal(body, false)
        return false
    end

    if status ~= "outside" then return true end
    local outside = Link.outsideProfile(saveInfo.activeMods, link)
    local body = " <H1> " .. getText("UI_mainscreen_ErrorLoadingSavefile") .. " <H2> <LINE> <LINE> "
    body = body .. getText("UI_mainscreen_SavefileName", world) .. " <LINE> <LINE> "
    body = body .. " <TEXT> " .. string.format(text("blocked"), link.name) .. " <LINE> <INDENT:20> <RED> "
    for _, name in ipairs(outside) do body = body .. name .. " <LINE> " end
    body = body .. " <INDENT:0> <RGB:1,1,1> <LINE> " .. text("howTo") .. " <LINE> "
    MainScreen.displayCheckSavefileModal(body, true)
    return false
end

-- Yes on the empty-list question: the save gets the profile's mods (the list the game started
-- with), then the game's own Yes writes them into the save and loads it.
local onCheckSavefileModalClick = MainScreen.onCheckSavefileModalClick
function MainScreen.onCheckSavefileModalClick(model, button, ...)
    local world = getWorld():getWorld()
    if Link.askedEmpty == world then
        Link.askedEmpty = nil
        if button and button.internal == "YES" then
            ActiveMods.getById("currentGame"):copyFrom(ActiveMods.getById("default"))
            Link.fillEmpty = world
        end
    end
    return onCheckSavefileModalClick(model, button, ...)
end
