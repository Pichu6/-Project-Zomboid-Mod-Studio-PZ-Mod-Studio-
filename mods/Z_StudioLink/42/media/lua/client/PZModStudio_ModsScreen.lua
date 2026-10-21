-- PZ Mod Studio Link: its own Mods screen, opened by the main menu's MODS button.
--
-- On its own (no app): every installed mod with search and filters, its details (poster,
-- description, what it requires and what needs it), turning mods on and off with what they
-- require, and Accept / Back like the game's screen. What it changes goes to mods/default.txt
-- exactly as the game's screen writes it.
-- With PZ Mod Studio: the profile's mods first, Mod Health's warnings on each mod, and the mods
-- installed but in no profile, added to it in one click.
-- The game's own screen is one button away ("The game's screen"), and another mod manager that
-- owns the Mods screen (see PZModStudio_Link.lua) keeps it: then this screen never opens.

require "PZModStudio_Link"
require "ISUI/ISPanelJoypad"
require "ISUI/ISButton"
require "ISUI/ISTextEntryBox"
require "ISUI/ISScrollingListBox"
require "ISUI/ISRichTextPanel"
require "OptionScreens/MainScreen"

local Link = PZModStudioLink
local text = Link.text
local plainId = Link.plainId

local FONT_SMALL = UIFont.Small
local FONT_MEDIUM = UIFont.Medium
local function fontH(font) return getTextManager():getFontHeight(font) end
local function measure(font, s) return getTextManager():MeasureStringX(font, s) end
local WORKSHOP_URL = "https://steamcommunity.com/sharedfiles/filedetails/?id="

local Screen = ISPanelJoypad:derive("StudioLinkModsScreen")
Link.ModsScreen = Screen

-- ------------------------------------------------------------------ data

--- Every installed mod the game can see, once each (the first folder of an id wins, as in the
--- game's screen), with what the screen needs of it.
local function readMods()
    local list, byId = {}, {}
    for _, dir in ipairs(getModDirectoryTable()) do
        local info = getModInfo(dir)
        if info and not byId[plainId(info:getId())] then
            local id = plainId(info:getId())
            local requires = {}
            local req = info:getRequire()
            if req then
                for i = 0, req:size() - 1 do table.insert(requires, plainId(req:get(i))) end
            end
            local mod = {
                id = id,
                gameId = info:getId(),
                info = info,
                name = info:getName() or id,
                requires = requires,
                available = info:isAvailable(),
                map = Link.isMapMod(info:getId()),
                workshop = tostring(info:getWorkshopID() or ""),
            }
            byId[id] = mod
            table.insert(list, mod)
        end
    end
    table.sort(list, function(a, b) return string.lower(a.name) < string.lower(b.name) end)
    return list, byId
end

--- The active list as the game has it: ids in load order, as written (B42 ids may start with \).
local function readActive()
    local order = {}
    local mods = ActiveMods.getById("default"):getMods()
    for i = 0, mods:size() - 1 do table.insert(order, mods:get(i)) end
    return order
end

-- ------------------------------------------------------------------ the list

local ModList = ISScrollingListBox:derive("StudioLinkModList")

function ModList:new(x, y, w, h, screen)
    local o = ISScrollingListBox.new(self, x, y, w, h)
    o.screen = screen
    o.font = FONT_SMALL
    o.fontHgt = fontH(FONT_SMALL)
    o.itemheight = math.max(26, o.fontHgt + 10)
    o.drawBorder = true
    o.backgroundColor = { r = 0.04, g = 0.05, b = 0.07, a = 0.9 }
    o.tickTexture = getTexture("media/ui/inventoryPanes/Tickbox_Tick.png")
    return o
end

function ModList:doDrawItem(y, item, alt)
    local h = self.itemheight
    if y + self:getYScroll() + h < 0 or y + self:getYScroll() >= self.height then return y + h end
    local mod = item.item
    local screen = self.screen
    if self.selected == item.index then
        self:drawRect(0, y, self.width, h, 0.35, 0.2, 0.45, 0.7)
    elseif self.mouseoverselected == item.index and self:isMouseOver() then
        self:drawRect(0, y, self.width, h, 0.12, 1, 1, 1)
    end
    local on = screen.on[mod.id]
    -- The tick: on, off, or cannot be on (not for this build).
    local box = 16
    local bx, by = 10, y + (h - box) / 2
    if mod.available then
        self:drawRectBorder(bx, by, box, box, 0.9, 0.7, 0.7, 0.7)
        if on and self.tickTexture then self:drawTextureScaled(self.tickTexture, bx, by, box, box, 1, 1, 1, 1) end
    else
        self:drawRectBorder(bx, by, box, box, 0.5, 0.4, 0.4, 0.4)
    end
    local nameColor = mod.available and (on and { 1, 1, 1 } or { 0.7, 0.7, 0.7 }) or { 0.45, 0.45, 0.45 }
    local ty = y + (h - self.fontHgt) / 2
    self:drawText(mod.name, 36, ty, nameColor[1], nameColor[2], nameColor[3], 1, FONT_SMALL)
    -- On the right: Mod Health's mark, map, the load position.
    local rx = self.width - 14
    local function tag(label, r, g, b)
        local w = measure(FONT_SMALL, label)
        rx = rx - w
        self:drawText(label, rx, ty, r, g, b, 1, FONT_SMALL)
        rx = rx - 10
    end
    if on and screen.position[mod.id] then tag("#" .. tostring(screen.position[mod.id]), 0.5, 0.5, 0.5) end
    if mod.map then tag(text("modsMap"), 0.7, 0.6, 1.0) end
    if not mod.available then tag(text("modsNotForBuild"), 0.6, 0.6, 0.6) end
    local health = screen.health[mod.id]
    if health then
        if health.severity == "error" then tag("!", 1, 0.35, 0.35) else tag("!", 1, 0.8, 0.3) end
    end
    if screen.missingReq[mod.id] then tag(text("modsNeedsMore"), 1, 0.6, 0.3) end
    if screen.changed[mod.id] then tag("*", 0.45, 0.9, 0.55) end
    self:drawRectBorder(0, y, self.width, h, 0.15, 1, 1, 1)
    return y + h
end

function ModList:onMouseDown(x, y)
    if #self.items == 0 then return end
    local row = self:rowAt(x, y)
    if row < 1 or row > #self.items then return end
    self.selected = row
    getSoundManager():playUISound("UISelectListItem")
    -- Shown first (the list keeps the shown mod selected when it is redrawn); the tick column
    -- also turns it on or off.
    self.screen:select(self.items[row].item)
    if x < 34 then
        self.screen:toggle(self.items[row].item)
    end
end

function ModList:onMouseDoubleClick(x, y)
    local row = self:rowAt(x, y)
    if row >= 1 and row <= #self.items then self.screen:toggle(self.items[row].item) end
end

-- ------------------------------------------------------------------ the screen

function Screen:new(x, y, w, h)
    local o = ISPanelJoypad.new(self, x, y, w, h)
    o.backgroundColor = { r = 0.02, g = 0.03, b = 0.05, a = 0.94 }
    o.borderColor = { r = 0.35, g = 0.75, b = 1.0, a = 0.5 }
    o.filter = "all"
    o.search = ""
    o.on = {}
    o.changed = {}
    o.position = {}
    o.missingReq = {}
    o.health = {}
    return o
end

function Screen:readState()
    self.mods, self.byId = readMods()
    self.order = readActive()
    self.on = {}
    for _, id in ipairs(self.order) do self.on[plainId(id)] = true end
    self.startOn = {}
    for id, _ in pairs(self.on) do self.startOn[id] = true end
    -- With the app: its profile and Mod Health's warnings (as it last wrote them).
    self.link = Link.appInstalled() and Link.read() or nil
    self.health = self.link and Link.readHealth() or {}
    self.onlyProfile = self.link ~= nil
    self:recount()
end

--- What follows from the working list: positions, changes, requirements not met.
function Screen:recount()
    self.position, self.changed, self.missingReq = {}, {}, {}
    local n = 0
    for _, id in ipairs(self.order) do
        n = n + 1
        self.position[plainId(id)] = n
    end
    self.changes = 0
    for _, mod in ipairs(self.mods) do
        if (self.on[mod.id] or false) ~= (self.startOn[mod.id] or false) then
            self.changed[mod.id] = true
            self.changes = self.changes + 1
        end
        if self.on[mod.id] then
            for _, req in ipairs(mod.requires) do
                if not self.on[req] then self.missingReq[mod.id] = true end
            end
        end
    end
end

--- The mods the list shows now.
function Screen:visibleMods()
    local out = {}
    -- What was typed, as plain text (a "-" or "(" would mean something to Lua's find).
    local q = string.gsub(string.lower(self.search or ""), "%p", "%%%0")
    for _, mod in ipairs(self.mods) do
        local show = true
        if self.onlyProfile and self.link and not self.link.members[mod.id] and not self.on[mod.id] then show = false end
        if show and self.filter == "on" and not self.on[mod.id] then show = false end
        if show and self.filter == "off" and self.on[mod.id] then show = false end
        if show and self.filter == "maps" and not mod.map then show = false end
        if show and self.filter == "problems" and not (self.health[mod.id] or self.missingReq[mod.id] or (self.on[mod.id] and not mod.available)) then show = false end
        if show and q ~= "" then
            show = string.find(string.lower(mod.name), q) ~= nil or string.find(string.lower(mod.id), q) ~= nil or string.find(mod.workshop, q) ~= nil
        end
        if show then table.insert(out, mod) end
    end
    return out
end

function Screen:refreshList()
    local keep = self.selectedMod
    self.list:clear()
    local pick = 1
    for i, mod in ipairs(self:visibleMods()) do
        self.list:addItem(mod.name, mod)
        if keep and mod.id == keep.id then pick = i end
    end
    self.list.selected = math.min(pick, #self.list.items)
    if #self.list.items > 0 then self:select(self.list.items[self.list.selected].item) else self:select(nil) end
    self:updateButtons()
end

-- ------------------------------------------------------------------ turning mods on and off

--- The mods `mod` needs that are installed and off, all the way down, and those not installed.
function Screen:needed(mod, out, missing, seen)
    seen = seen or {}
    for _, req in ipairs(mod.requires) do
        if not seen[req] then
            seen[req] = true
            local r = self.byId[req]
            if not r then
                table.insert(missing, req)
            else
                self:needed(r, out, missing, seen)
                if not self.on[req] then table.insert(out, r) end
            end
        end
    end
end

--- The mods that are on and need `mod`, all the way up.
function Screen:dependents(mod, out, seen)
    seen = seen or {}
    for _, other in ipairs(self.mods) do
        if self.on[other.id] and not seen[other.id] then
            for _, req in ipairs(other.requires) do
                if req == mod.id then
                    seen[other.id] = true
                    table.insert(out, other)
                    self:dependents(other, out, seen)
                end
            end
        end
    end
end

function Screen:setOn(mod, on)
    if on and not self.on[mod.id] then
        self.on[mod.id] = true
        table.insert(self.order, mod.gameId)
    elseif not on and self.on[mod.id] then
        self.on[mod.id] = nil
        for i = #self.order, 1, -1 do
            if plainId(self.order[i]) == mod.id then table.remove(self.order, i) end
        end
    end
end

local function names(mods)
    local out = {}
    for i, m in ipairs(mods) do
        if i > 12 then
            table.insert(out, text("andMore", #mods - 12))
            break
        end
        table.insert(out, "- " .. (type(m) == "table" and m.name or tostring(m)))
    end
    return table.concat(out, " <LINE> ")
end

--- On: what it requires comes on with it (said first when there is any). Off: what needs it
--- goes off with it, said first.
function Screen:toggle(mod)
    if not mod then return end
    if not self.on[mod.id] then
        if not mod.available then
            Link.WaitPanel.choose(mod.name, text("modsCannotTurnOn"), 150, { { label = text("back") } })
            return
        end
        local extra, missing = {}, {}
        self:needed(mod, extra, missing)
        local function apply()
            for _, r in ipairs(extra) do self:setOn(r, true) end
            -- Requirements first in the load order: each one before the mods that need it.
            self:setOn(mod, true)
            self:recount()
            self:refreshList()
        end
        if #extra == 0 and #missing == 0 then return apply() end
        local body = ""
        if #extra > 0 then body = body .. text("modsAlsoOn", mod.name) .. " <LINE> " .. names(extra) .. " <LINE> <LINE> " end
        if #missing > 0 then body = body .. " <RGB:1,0.6,0.3> " .. text("modsMissingReq", mod.name) .. " <RGB:1,1,1> <LINE> " .. names(missing) .. " <LINE> " end
        local lines = #extra + #missing + 6
        Link.WaitPanel.choose(mod.name, body, 100 + lines * (fontH(FONT_SMALL) + 2), {
            { label = text("back") },
            { label = text("modsTurnOn"), accept = true, onClick = apply },
        })
    else
        local deps = {}
        self:dependents(mod, deps)
        local function apply()
            for _, d in ipairs(deps) do self:setOn(d, false) end
            self:setOn(mod, false)
            self:recount()
            self:refreshList()
        end
        if #deps == 0 then return apply() end
        local body = text("modsAlsoOff", mod.name) .. " <LINE> " .. names(deps)
        Link.WaitPanel.choose(mod.name, body, 100 + (#deps + 4) * (fontH(FONT_SMALL) + 2), {
            { label = text("back") },
            { label = text("modsTurnOff"), accept = true, onClick = apply },
        })
    end
end

-- ------------------------------------------------------------------ details

function Screen:select(mod)
    self.selectedMod = mod
    if not self.desc then return end
    if not mod then
        self.desc:setText("")
        self.desc:paginate()
        self.poster = nil
        return
    end
    local info = mod.info
    local parts = {}
    local function line(s) table.insert(parts, s) end
    line(" <SIZE:medium> " .. mod.name .. " <SIZE:small> <LINE> ")
    local meta = mod.id
    if mod.workshop ~= "" and mod.workshop ~= "0" then meta = meta .. "   Workshop " .. mod.workshop end
    local version = info:getModVersion()
    if version and version ~= "" then meta = meta .. "   v" .. version end
    line(" <RGB:0.6,0.6,0.6> " .. meta .. " <RGB:1,1,1> <LINE> ")
    local author = info:getAuthor()
    if author and author ~= "" then line(" <RGB:0.6,0.6,0.6> " .. text("modsBy", author) .. " <RGB:1,1,1> <LINE> ") end
    if not mod.available then line(" <RGB:1,0.6,0.3> " .. text("modsCannotTurnOn") .. " <RGB:1,1,1> <LINE> ") end
    -- What Mod Health says (with the app).
    local health = self.health[mod.id]
    if health then
        local color = health.severity == "error" and "1,0.45,0.45" or "1,0.8,0.35"
        for _, l in ipairs(health.lines) do line(" <RGB:" .. color .. "> " .. l .. " <RGB:1,1,1> <LINE> ") end
    end
    if #mod.requires > 0 then
        line(" <LINE> " .. text("modsRequires") .. " <LINE> ")
        for _, req in ipairs(mod.requires) do
            local r = self.byId[req]
            if not r then
                line(" <RGB:1,0.5,0.4> - " .. req .. " (" .. text("modsNotInstalled") .. ") <RGB:1,1,1> <LINE> ")
            elseif self.on[req] then
                line(" <RGB:0.55,0.9,0.6> - " .. r.name .. " <RGB:1,1,1> <LINE> ")
            else
                line(" <RGB:1,0.75,0.4> - " .. r.name .. " (" .. text("modsOff") .. ") <RGB:1,1,1> <LINE> ")
            end
        end
    end
    local needs = {}
    for _, other in ipairs(self.mods) do
        for _, req in ipairs(other.requires) do
            if req == mod.id then table.insert(needs, other) end
        end
    end
    if #needs > 0 then
        line(" <LINE> " .. text("modsNeededBy") .. " <LINE> ")
        for i, other in ipairs(needs) do
            if i > 10 then
                line(" " .. text("andMore", #needs - 10) .. " <LINE> ")
                break
            end
            line(" <RGB:0.8,0.8,0.8> - " .. other.name .. " <RGB:1,1,1> <LINE> ")
        end
    end
    local description = info:getDescription() or ""
    if description ~= "" then line(" <LINE> " .. description) end
    self.desc:setText(table.concat(parts, ""))
    self.desc:paginate()
    self.desc:setYScroll(0)
    self.poster = nil
    pcall(function()
        if info:getPosterCount() > 0 then self.poster = getTexture(info:getPoster(0)) end
    end)
    self:updateButtons()
end

function Screen:updateButtons()
    if not self.toggleButton then return end
    local mod = self.selectedMod
    if mod then
        self.toggleButton:setTitle(self.on[mod.id] and text("modsTurnOff") or text("modsTurnOn"))
        self.toggleButton:setEnable(mod.available or self.on[mod.id] == true)
        self.workshopButton:setEnable(mod.workshop ~= "" and mod.workshop ~= "0")
    else
        self.toggleButton:setEnable(false)
        self.workshopButton:setEnable(false)
    end
    self.acceptButton:setTitle(self.changes > 0 and text("modsAcceptN", self.changes) or text("modsAccept"))
    for key, button in pairs(self.filterButtons) do
        if key == self.filter then
            button.backgroundColor = { r = 0.2, g = 0.45, b = 0.7, a = 0.9 }
        else
            button.backgroundColor = { r = 0, g = 0, b = 0, a = 1 }
        end
    end
    if self.profileTick then
        self.profileTick:setTitle(self.onlyProfile and text("modsOnlyProfileOn") or text("modsOnlyProfileOff"))
    end
end

-- ------------------------------------------------------------------ layout

function Screen:createChildren()
    local pad = 20
    local bh = math.max(24, fontH(FONT_SMALL) + 8)
    local top = pad + fontH(UIFont.Large) + fontH(FONT_SMALL) + 18

    self.searchBox = ISTextEntryBox:new("", pad, top, 240, bh)
    self.searchBox.font = FONT_SMALL
    self.searchBox:initialise()
    self.searchBox:instantiate()
    self.searchBox:setClearButton(true)
    self.searchBox.onTextChange = function()
        self.search = self.searchBox:getText() or ""
        self:refreshList()
    end
    self:addChild(self.searchBox)

    self.filterButtons = {}
    local fx = self.searchBox:getRight() + 12
    for _, key in ipairs({ "all", "on", "off", "problems", "maps" }) do
        local label = text("modsFilter_" .. key)
        local w = measure(FONT_SMALL, label) + 20
        local b = ISButton:new(fx, top, w, bh, label, self, function(screen)
            screen.filter = key
            screen:refreshList()
        end)
        b:initialise()
        b:instantiate()
        self:addChild(b)
        self.filterButtons[key] = b
        fx = fx + w + 6
    end

    if self.link then
        local label = text("modsOnlyProfileOn")
        local w = math.max(measure(FONT_SMALL, label), measure(FONT_SMALL, text("modsOnlyProfileOff"))) + 20
        self.profileTick = ISButton:new(fx + 10, top, w, bh, label, self, function(screen)
            screen.onlyProfile = not screen.onlyProfile
            screen:refreshList()
        end)
        self.profileTick:initialise()
        self.profileTick:instantiate()
        self:addChild(self.profileTick)
        fx = self.profileTick:getRight() + 6
        -- Installed mods in no profile at all: added to this one, off, by the app.
        local fresh = {}
        for _, mod in ipairs(self.mods) do
            if mod.id ~= Link.SELF_ID and not string.find(mod.id, Link.STUDIO_PACKAGE) and not self.link.members[mod.id] and not self.link.others[mod.id] and not self.on[mod.id] then
                table.insert(fresh, mod.id)
            end
        end
        if #fresh > 0 then
            local nl = text("newMods", #fresh)
            self.newButton = ISButton:new(fx + 6, top, measure(FONT_SMALL, nl) + 20, bh, nl, self, function(screen, button)
                Link.requestAdd(fresh)
                button:setTitle(text("adding"))
                button:setEnable(false)
            end)
            self.newButton:initialise()
            self.newButton:instantiate()
            self:addChild(self.newButton)
        end
    end

    local listTop = top + bh + 10
    local bottom = self.height - pad - bh - 12
    local listW = math.floor((self.width - pad * 3) * 0.55)
    self.list = ModList:new(pad, listTop, listW, bottom - listTop, self)
    self.list:initialise()
    self.list:instantiate()
    self:addChild(self.list)

    local dx = pad * 2 + listW
    local dw = self.width - dx - pad
    self.detailX, self.detailY, self.detailW = dx, listTop, dw
    self.posterSize = math.min(160, math.floor(dw * 0.35))
    local descTop = listTop + self.posterSize + 10
    self.desc = ISRichTextPanel:new(dx, descTop, dw, bottom - descTop - bh - 10)
    self.desc.background = false
    self.desc.autosetheight = false
    self.desc.clip = true
    self.desc.marginLeft = 8
    self.desc.marginRight = 8
    self.desc:initialise()
    self.desc:instantiate()
    self.desc:addScrollBars(true)
    self:addChild(self.desc)

    local by = bottom - bh
    self.toggleButton = ISButton:new(dx, by, 150, bh, text("modsTurnOn"), self, function(screen) screen:toggle(screen.selectedMod) end)
    self.toggleButton:initialise()
    self.toggleButton:instantiate()
    self:addChild(self.toggleButton)
    self.workshopButton = ISButton:new(dx + 160, by, 170, bh, text("modsWorkshopPage"), self, function(screen)
        local mod = screen.selectedMod
        if mod then pcall(function() openUrl(WORKSHOP_URL .. mod.workshop) end) end
    end)
    self.workshopButton:initialise()
    self.workshopButton:instantiate()
    self:addChild(self.workshopButton)

    -- The bottom bar: the game's own screen on the left, Back and Accept on the right.
    local fy = self.height - pad - bh
    local original = ISButton:new(pad, fy, measure(FONT_SMALL, text("modsGameScreen")) + 24, bh, text("modsGameScreen"), self, function(screen) screen:openGameScreen() end)
    original:initialise()
    original:instantiate()
    self:addChild(original)
    self.acceptButton = ISButton:new(self.width - pad - 190, fy, 190, bh, text("modsAccept"), self, function(screen) screen:accept() end)
    self.acceptButton:initialise()
    self.acceptButton:instantiate()
    self.acceptButton:enableAcceptColor()
    self:addChild(self.acceptButton)
    local back = ISButton:new(self.acceptButton.x - 130, fy, 120, bh, text("back"), self, function(screen) screen:back() end)
    back:initialise()
    back:instantiate()
    back:enableCancelColor()
    self:addChild(back)
    self.backButton = back

    self:refreshList()
end

function Screen:prerender()
    ISPanelJoypad.prerender(self)
    local pad = 20
    self:drawText(text("modsTitle"), pad, pad - 4, 1, 1, 1, 1, UIFont.Large)
    -- Under the title: the profile (with the app) or what is installed (without it).
    local onCount = 0
    for _, _ in pairs(self.on) do onCount = onCount + 1 end
    local sub
    if self.link then
        local alive = Link.appAlive()
        sub = text("modsSubProfile", self.link.name, onCount, #self.mods) .. "   " .. (alive and text("cardOpen") or text("cardClosed"))
    else
        sub = text("modsSub", #self.mods, onCount)
    end
    self:drawText(sub, pad, pad + fontH(UIFont.Large), 0.65, 0.75, 0.85, 1, FONT_SMALL)
    -- The poster of the selected mod, above its details.
    if self.poster and self.detailX then
        self:drawTextureScaledAspect(self.poster, self.detailX, self.detailY, self.posterSize, self.posterSize, 1, 1, 1, 1)
    elseif self.detailX then
        self:drawRectBorder(self.detailX, self.detailY, self.posterSize, self.posterSize, 0.3, 0.6, 0.6, 0.6)
    end
end

-- ------------------------------------------------------------------ leaving

function Screen:close()
    self:setVisible(false)
    if self.parent then self.parent:removeChild(self) end
    Screen.instance = nil
    if MainScreen.instance then
        MainScreen.instance.bottomPanel:setVisible(true)
        local joypad = JoypadState.getMainMenuJoypad()
        if joypad then
            joypad.focus = MainScreen.instance
            updateJoypadFocus(joypad)
        end
    end
end

--- Writes the working list to the game's active mods, saved and loaded as the game's screen does.
function Screen:accept()
    if self.changes == 0 then return self:close() end
    local ok, err = pcall(function()
        local active = ActiveMods.getById("default")
        local mods = active:getMods()
        mods:clear()
        -- Each mod after what it requires (the game's own rule when it saves an order).
        local placed = {}
        local function place(id)
            local plain = plainId(id)
            if placed[plain] or not self.on[plain] then return end
            placed[plain] = true
            local mod = self.byId[plain]
            if mod then
                for _, req in ipairs(mod.requires) do
                    if self.byId[req] then place(self.byId[req].gameId) end
                end
            end
            mods:add(id)
        end
        for _, id in ipairs(self.order) do place(id) end
        active:checkMissingMods()
        active:checkMissingMaps()
        saveModsFile()
        ActiveMods.getById("currentGame"):copyFrom(active)
        local reset = ActiveMods.requiresResetLua(active)
        self:close()
        if reset then
            MainScreen.instance.bottomPanel:setVisible(false)
            getCore():ResetLua("default", "modsChanged")
        end
    end)
    if not ok then
        print("[StudioLink] the Mods screen could not save: " .. tostring(err))
        self:close()
    end
end

function Screen:back()
    if self.changes == 0 then return self:close() end
    Link.WaitPanel.choose(text("modsTitle"), text("modsDiscard", self.changes), 150, {
        { label = text("back") },
        { label = text("modsDiscardYes"), onClick = function() self:close() end },
        { label = text("modsAccept"), accept = true, onClick = function() self:accept() end },
    })
end

--- The game's own Mods screen, as its MODS button opens it (changes here are dropped first).
function Screen:openGameScreen()
    self:close()
    local ms = MainScreen.instance
    if not ms or not ms.modSelect then return end
    ms.bottomPanel:setVisible(false)
    ms.modSelect.model.isNewGame = false
    ms.modSelect:setVisible(true, JoypadState.getMainMenuJoypad())
    ms.modSelect.model:reloadMods()
    pcall(ModSelector.showNagPanel)
    ModSelector.instance.returnToUI = ms
end

-- ------------------------------------------------------------------ controller

function Screen:onJoypadDown(button)
    if button == Joypad.AButton then
        self:toggle(self.selectedMod)
    elseif button == Joypad.BButton then
        self:back()
    elseif button == Joypad.YButton then
        self:accept()
    elseif button == Joypad.XButton then
        local order = { "all", "on", "off", "problems", "maps" }
        for i, key in ipairs(order) do
            if key == self.filter then
                self.filter = order[(i % #order) + 1]
                break
            end
        end
        self:refreshList()
    end
end

function Screen:onJoypadDirUp() self.list:onJoypadDirUp(); self:select(self.list.items[self.list.selected] and self.list.items[self.list.selected].item) end
function Screen:onJoypadDirDown() self.list:onJoypadDirDown(); self:select(self.list.items[self.list.selected] and self.list.items[self.list.selected].item) end

function Screen:onKeyRelease(key)
    if key == Keyboard.KEY_ESCAPE then self:back() end
end

-- ------------------------------------------------------------------ opening it

--- This screen opens from MODS unless another mod manager owns the Mods screen.
function Screen.owns()
    return not Link.otherManager()
end

function Screen.open()
    local ms = MainScreen.instance
    if not ms then return end
    if Screen.instance then Screen.instance:close() end
    local screen = Screen:new(0, 0, ms.width, ms.height)
    screen:readState()
    screen:initialise()
    screen:instantiate()
    ms:addChild(screen)
    screen:bringToTop()
    Screen.instance = screen
    ms.bottomPanel:setVisible(false)
    local joypad = JoypadState.getMainMenuJoypad()
    if joypad then
        joypad.focus = screen
        updateJoypadFocus(joypad)
    end
end

-- The MODS item calls MainScreen.onMenuItemMouseDownMainMenu, kept on the item when the menu
-- was made: the item is pointed at this one each time the menu shows.
local gameClick = MainScreen.onMenuItemMouseDownMainMenu
local function click(item, x, y)
    if item and item.internal == "MODS" and MainScreen.instance and (MainScreen.instance.delay or 0) <= 0 then
        local ok, owns = pcall(Screen.owns)
        if ok and owns then
            getSoundManager():playUISound("UIActivateMainMenuItem")
            local opened, err = pcall(Screen.open)
            if opened then return end
            print("[StudioLink] the Mods screen could not open, the game's opens instead: " .. tostring(err))
        end
    end
    return gameClick(item, x, y)
end
MainScreen.onMenuItemMouseDownMainMenu = click

local menuPrerender = MainScreen.prerender
function MainScreen:prerender(...)
    menuPrerender(self, ...)
    if self.modsOption and self.modsOption.onMouseDown ~= click then self.modsOption.onMouseDown = click end
end
