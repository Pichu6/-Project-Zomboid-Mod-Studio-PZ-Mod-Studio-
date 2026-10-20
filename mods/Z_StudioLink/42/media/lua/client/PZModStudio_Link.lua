-- PZ Mod Studio Link: the game's Mods screen shows the profile that is active in PZ Mod Studio.
--
-- Files in Zomboid/Lua (the only folder the game's Lua can use), protocol 2:
--   PZModStudio_Link.txt          app:  profile=<name>, member=<mod id> per mod of the profile
--                                       (on or off, in load order), other=<mod id> per mod
--                                       another profile holds
--   PZModStudio_LinkHealth.txt    app:  <severity>\t<mod id>\t<text> per Mod Health warning, in
--                                       the player's language
--   PZModStudio_LinkApp.txt       app:  protocol, version, alive=<unix seconds>, every few
--                                       seconds while it runs
--   PZModStudio_LinkRequests.txt  this: <id>\t<verb>\t<argument> per request (add <mod id>)
--   PZModStudio_LinkAcks.txt      app:  <id>\tok|error\t<text> per request it handled
--   PZModStudio_LinkGame.txt      this: state=menu|ingame, save, mods, on entering either
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

local APP_FILE = "PZModStudio_LinkApp.txt"
local ACKS_FILE = "PZModStudio_LinkAcks.txt"
local GAME_FILE = "PZModStudio_LinkGame.txt"
local PROTOCOL = 2
-- The app writes its file every few seconds; older than this, it is closed.
local APP_ALIVE_SECONDS = 15
-- A request the app has not answered in this long is shown as not done.
local REQUEST_TIMEOUT_SECONDS = 30
-- Mod managers that own the Mods screen themselves. With one of them on, this mod leaves that
-- screen alone (two mods reshaping one list fight) and keeps only the save checks.
-- (mod.info ids: Definitive Mod Manager, PZMM's client, Mod Manager, Mod Load Order Sorter)
local OTHER_MANAGERS = { "DefinitiveModManager", "PZMMClient", "ModManager", "ModLoadOrderSorter_b42" }

-- The texts, in English. The game's translations (media/lua/shared/Translate/<LANG>/UI.json,
-- keys UI_StudioLink_<name>) win when they have the key. {1}, {2}... are filled in here: a "%"
-- in a translation would be read by the game as a format of its own.
local TEXT = {
    profile = "Profile: {1}",
    profileTip = "The profile active in PZ Mod Studio. Only its mods are listed.",
    appClosed = "(PZ Mod Studio closed)",
    appClosedTip = "PZ Mod Studio is not running. The list is the profile as it was when the app last wrote it; what you ask for here is done when the app opens.",
    showAll = "Show all subscribed mods",
    newMods = "+{1} new -> profile",
    newModsTip = "{1} installed mod(s) are in no profile (subscribed outside PZ Mod Studio, for example). Click to add them to \"{2}\", switched off:\n{3}",
    adding = "Adding...",
    addFailed = "Not added",
    addFailedTip = "PZ Mod Studio could not add the mods: {1}",
    noAnswer = "PZ Mod Studio did not answer. Open it and the mods are added then.",
    blocked = "This save uses mods that are not in the profile \"{1}\":",
    howTo = "Switch to the profile you played it with in PZ Mod Studio, or add these mods to this profile.",
    empty = "This save's mod list is empty, while the profile \"{1}\" has {2} mods.",
    emptyWhy = "Loaded like this, the game would run it with no mods and drop every item that came from a mod. Yes gives it the profile's mods and loads it; No goes back.",
    badgeEmpty = "no mods",
    badgeOutside = "{1} outside the profile",
    badgeOk = "profile mods",
}

local translated = {}

--- A text in the player's language, with {1}, {2}... filled in.
local function text(key, ...)
    local value = translated[key]
    if value == nil then
        local full = "UI_StudioLink_" .. key
        local ok, result = pcall(getText, full)
        value = (ok and type(result) == "string" and result ~= "" and result ~= full) and result or TEXT[key] or key
        translated[key] = value
    end
    local args = { ... }
    if #args == 0 then return value end
    return (string.gsub(value, "{(%d)}", function(n)
        local arg = args[tonumber(n)]
        return arg ~= nil and tostring(arg) or ""
    end))
end

--- Seconds since 1970 by the game's clock (the app writes the same clock in its file).
local function now()
    local ok, ms = pcall(getTimestampMs)
    if ok and ms then return math.floor(ms / 1000) end
    return math.floor(os.time())
end

local Link = { showAll = false, pending = {}, waiting = {}, health = {} }
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

--- Asks the Studio to add these mods to the active profile (switched off). Each request gets an
--- id the app answers to; until then the mods count as in the profile.
function Link.requestAdd(ids)
    if #ids == 0 then return end
    local writer = getFileWriter(REQUESTS_FILE, true, true)
    if not writer then return end
    Link.seq = (Link.seq or 0) + 1
    local id = tostring(now()) .. "-" .. tostring(Link.seq)
    for _, modId in ipairs(ids) do
        writer:write(id .. "\tadd\t" .. modId .. "\n")
        Link.pending[modId] = true
    end
    writer:close()
    Link.waiting[id] = { ids = ids, at = now() }
    Link.addError = nil
end

--- Whether a request is still waiting for the app's answer. (The game's Lua has no `next`.)
function Link.isWaiting()
    for _ in pairs(Link.waiting) do return true end
    return false
end

--- Whether PZ Mod Studio is running: its file says so, and says it lately.
function Link.appAlive()
    local t = now()
    if Link.appCheckedAt and t - Link.appCheckedAt < 2 then return Link.appIsAlive end
    Link.appCheckedAt = t
    local alive = false
    local file = getFileReader(APP_FILE, false)
    if file then
        local line = file:readLine()
        while line ~= nil do
            local stamp = string.match(line, "^alive=(%d+)")
            if stamp then alive = math.abs(t - tonumber(stamp)) <= APP_ALIVE_SECONDS end
            line = file:readLine()
        end
        file:close()
    end
    Link.appIsAlive = alive
    return alive
end

--- Reads the app's answers to what is still waiting. Returns true when something was settled.
function Link.readAcks()
    if not Link.isWaiting() then return false end
    local settled = false
    local file = getFileReader(ACKS_FILE, false)
    if file then
        local line = file:readLine()
        while line ~= nil do
            local id, status, msg = string.match(line, "^([^\t]+)\t([^\t]+)\t?(.*)$")
            local request = id and Link.waiting[id]
            if request then
                Link.waiting[id] = nil
                settled = true
                if status ~= "ok" then
                    for _, modId in ipairs(request.ids) do Link.pending[modId] = nil end
                    Link.addError = msg ~= "" and msg or status
                end
            end
            line = file:readLine()
        end
        file:close()
    end
    -- Not answered in time: shown as not done. The request stays in the file, so the app still
    -- does it when it opens.
    local t = now()
    for id, request in pairs(Link.waiting) do
        if t - request.at > REQUEST_TIMEOUT_SECONDS then
            Link.waiting[id] = nil
            for _, modId in ipairs(request.ids) do Link.pending[modId] = nil end
            Link.addError = text("noAnswer")
            settled = true
        end
    end
    return settled
end

--- The mod managers on in this game that own the Mods screen, by id.
function Link.otherManager()
    if Link.otherManagerId ~= nil then return Link.otherManagerId or nil end
    Link.otherManagerId = false
    pcall(function()
        local active = ActiveMods.getById("default")
        for _, id in ipairs(OTHER_MANAGERS) do
            if active:isModActive(id) then
                Link.otherManagerId = id
                print("[StudioLink] " .. id .. " is on: it owns the Mods screen; only the save checks stay")
                return
            end
        end
    end)
    return Link.otherManagerId or nil
end

--- Tells the app where the player is. state = "menu" or "ingame".
function Link.writeGameState(state)
    local ok, err = pcall(function()
        local writer = getFileWriter(GAME_FILE, true, false)
        if not writer then return end
        local version = ""
        pcall(function() version = getModInfoByID(SELF_ID):getModVersion() or "" end)
        writer:write("protocol=" .. PROTOCOL .. "\n")
        writer:write("link=" .. tostring(version) .. "\n")
        writer:write("state=" .. state .. "\n")
        if state == "ingame" then
            local world = getWorld()
            local name = tostring(world:getWorld() or "")
            if name ~= "" then
                writer:write("save=" .. tostring(world:getGameMode()) .. "/" .. name .. "\n")
            end
            local mods = getActivatedMods()
            for i = 0, mods:size() - 1 do
                writer:write("mod=" .. tostring(mods:get(i)) .. "\n")
            end
        end
        writer:write("at=" .. now() .. "\n")
        writer:close()
    end)
    if not ok then print("[StudioLink] could not write the game state: " .. tostring(err)) end
end

Events.OnMainMenuEnter.Add(function() Link.writeGameState("menu") end)
Events.OnGameStart.Add(function() Link.writeGameState("ingame") end)

-- While a request waits, the app's answer is looked for about once a second.
local lastAckCheck = 0
local function checkAcks()
    if not Link.isWaiting() then return end
    local t = now()
    if t == lastAckCheck then return end
    lastAckCheck = t
    if Link.readAcks() and Link.panel then
        pcall(function() Link.panel:updateView() end)
    end
end
-- Looked for while the Mods screen is drawn, which is where the answer is shown.
local listPrerender = ModSelector.ModListPanel.prerender
function ModSelector.ModListPanel:prerender(...)
    local result = listPrerender(self, ...)
    pcall(checkAcks)
    return result
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
    if self.isServerSettingsMods or Link.otherManager() then return end
    -- Anything going wrong here leaves the game's own list as it is.
    local ok, err = pcall(function()
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
    end)
    if not ok then print("[StudioLink] could not filter the list: " .. tostring(err)) end
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
    if Link.otherManager() then return end
    local link = Link.read()
    if not link then return end
    Link.panel = self
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
            if Link.isWaiting() then return end
            local current = Link.read()
            if not current then return end
            local ids = {}
            for _, modData in ipairs(Link.orphans(panel.model, current)) do table.insert(ids, modData.modId) end
            Link.requestAdd(ids)
            panel:updateView()
        end)
        button:initialise()
        button:instantiate()
        button.borderColor = { r = 0.3, g = 0.75, b = 1.0, a = 0.8 }
        button:setVisible(false)
        self.filterPanel:addChild(button)
        self.studioNewButton = button

        local name = ISLabel:new(button:getRight() + 12, row.y, h, text("profile", link.name),
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
            local label = self.studioProfileLabel
            if Link.appAlive() then
                label:setName(text("profile", link.name))
                label:setColor(0.55, 0.85, 1.0)
                label.tooltip = text("profileTip")
            else
                label:setName(text("profile", link.name) .. " " .. text("appClosed"))
                label:setColor(0.6, 0.6, 0.6)
                label.tooltip = text("appClosedTip")
            end
            local orphans = Link.orphans(self.model, link)
            local button = self.studioNewButton
            local function show(title, tooltip, r, g, b)
                button:setTitle(title)
                button:setWidth(getTextManager():MeasureStringX(UIFont.Small, title) + 16)
                button.tooltip = tooltip
                button.borderColor = { r = r, g = g, b = b, a = 0.8 }
                button:setVisible(true)
            end
            if Link.isWaiting() then
                show(text("adding"), nil, 0.6, 0.6, 0.6)
            elseif Link.addError and #orphans > 0 then
                show(text("addFailed"), text("addFailedTip", Link.addError), 0.95, 0.35, 0.35)
            elseif #orphans > 0 then
                local names = {}
                for i, modData in ipairs(orphans) do
                    if i > 12 then table.insert(names, "..."); break end
                    table.insert(names, "- " .. modData.name)
                end
                show(text("newMods", #orphans), text("newModsTip", #orphans, link.name, table.concat(names, "\n")), 0.3, 0.75, 1.0)
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
        label, r, g, b = text("badgeOutside", count), 1.0, 0.7, 0.2
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
        body = body .. " <TEXT> <RED> " .. text("empty", link.name, profileSize(link)) .. " <RGB:1,1,1> <LINE> <LINE> "
        body = body .. text("emptyWhy") .. " <LINE> "
        MainScreen.displayCheckSavefileModal(body, false)
        return false
    end

    if status ~= "outside" then return true end
    local outside = Link.outsideProfile(saveInfo.activeMods, link)
    local body = " <H1> " .. getText("UI_mainscreen_ErrorLoadingSavefile") .. " <H2> <LINE> <LINE> "
    body = body .. getText("UI_mainscreen_SavefileName", world) .. " <LINE> <LINE> "
    body = body .. " <TEXT> " .. text("blocked", link.name) .. " <LINE> <INDENT:20> <RED> "
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
