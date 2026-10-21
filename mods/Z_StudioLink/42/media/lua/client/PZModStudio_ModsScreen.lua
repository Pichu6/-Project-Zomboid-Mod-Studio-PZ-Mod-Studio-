-- PZ Mod Studio Link: its own Mods screen, opened by the main menu's MODS button.
--
-- On its own (no app): every installed mod with search (name, id, Workshop id, author) and
-- filters, favourites (the same ones the game's screen keeps), its details (poster, description,
-- what it requires and what needs it), turning mods on and off with what they require, the load
-- order (sorted by it, moved up and down or dragged), several mods at once (Ctrl / Shift),
-- grouping by author or category, each mod's options page (Mod Options), a summary on top that
-- filters, and Accept / Back like the game's screen. What it
-- changes goes to mods/default.txt exactly as the game's screen writes it.
-- With PZ Mod Studio: the profile's mods first, Mod Health's warnings on each mod, the mods
-- updated since the last session, and the mods installed but in no profile, added in one click.
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

local function fontH(font) return getTextManager():getFontHeight(font) end
local function measure(font, s) return getTextManager():MeasureStringX(font, s) end
local WORKSHOP_URL = "https://steamcommunity.com/sharedfiles/filedetails/?id="
local FAVOURITES_FILE = "pz_modlist_settings.cfg"
local UPDATED_FILE = "PZModStudio_LinkUpdated.txt"
local FILTERS = { "all", "on", "off", "favourites", "updated", "problems", "maps" }

-- The app's colours (Tailwind slate and emerald), as 0..1.
local C = {
    bg = { 0.008, 0.024, 0.09 },
    panel = { 0.059, 0.09, 0.165 },
    border = { 0.2, 0.255, 0.333 },
    accent = { 0.063, 0.725, 0.506 },
    accentDark = { 0.016, 0.47, 0.34 },
    text = { 0.945, 0.96, 0.976 },
    muted = { 0.58, 0.64, 0.72 },
    warn = { 0.98, 0.75, 0.14 },
    error = { 0.97, 0.44, 0.44 },
    map = { 0.65, 0.55, 0.98 },
    info = { 0.35, 0.65, 0.98 },
}

local function styleButton(b, primary)
    b.backgroundColor = primary and { r = C.accentDark[1], g = C.accentDark[2], b = C.accentDark[3], a = 1 } or { r = C.panel[1], g = C.panel[2], b = C.panel[3], a = 1 }
    b.backgroundColorMouseOver = primary and { r = C.accent[1], g = C.accent[2], b = C.accent[3], a = 0.8 } or { r = 0.12, g = 0.16, b = 0.23, a = 1 }
    b.borderColor = { r = C.border[1], g = C.border[2], b = C.border[3], a = 1 }
end

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
                author = info:getAuthor() or "",
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

--- The game's favourites (its own Mods screen keeps them in pz_modlist_settings.cfg, first line
--- "!fav!:id;id;"), and the rest of that file, kept as it is when they are written back.
local function readFavourites()
    local favs, others = {}, {}
    local file = getFileReader(FAVOURITES_FILE, true)
    if not file then return favs, others end
    local line = file:readLine()
    local first = true
    while line ~= nil do
        if first and string.sub(line, 1, 6) == "!fav!:" then
            for id in string.gmatch(string.sub(line, 7), "[^;]+") do favs[plainId(id)] = true end
        elseif line ~= "" then
            table.insert(others, line)
        end
        first = false
        line = file:readLine()
    end
    file:close()
    return favs, others
end

local function writeFavourites(favs)
    local _, others = readFavourites()
    local ids = {}
    for id, on in pairs(favs) do
        if on then table.insert(ids, id .. ";") end
    end
    local file = getFileWriter(FAVOURITES_FILE, true, false)
    if not file then return end
    file:write("!fav!:" .. table.concat(ids) .. "\n")
    for _, l in ipairs(others) do file:write(l .. "\n") end
    file:close()
end

--- What the app says was updated since the last session (and what Steam has waiting).
local function readUpdated()
    local updated = {}
    local file = getFileReader(UPDATED_FILE, false)
    if not file then return updated end
    local line = file:readLine()
    while line ~= nil do
        local key, id = string.match(line, "^(%a+)=(.+)$")
        if key == "updated" or key == "waiting" then updated[plainId(id)] = key end
        line = file:readLine()
    end
    file:close()
    return updated
end

-- ------------------------------------------------------------------ the list

local ModList = ISScrollingListBox:derive("StudioLinkModList")

function ModList:new(x, y, w, h, screen)
    local o = ISScrollingListBox.new(self, x, y, w, h)
    o.screen = screen
    o.font = screen.listFont
    o.fontHgt = fontH(o.font)
    o.itemheight = o.fontHgt + (screen.big and 14 or 10)
    o.drawBorder = true
    o.borderColor = { r = C.border[1], g = C.border[2], b = C.border[3], a = 1 }
    o.backgroundColor = { r = C.panel[1], g = C.panel[2], b = C.panel[3], a = 0.95 }
    o.tickTexture = getTexture("media/ui/inventoryPanes/Tickbox_Tick.png")
    o.starOn = getTexture("media/ui/inventoryPanes/FavouriteYes.png")
    o.starOff = getTexture("media/ui/inventoryPanes/FavouriteNo.png")
    return o
end

-- The columns a click lands in: the star, the tick, the rest (shows the mod).
local STAR_RIGHT, TICK_RIGHT, NAME_X = 26, 52, 60

function ModList:doDrawItem(y, item, alt)
    local h = self.itemheight
    if y + self:getYScroll() + h < 0 or y + self:getYScroll() >= self.height then return y + h end
    local mod = item.item
    local screen = self.screen
    -- A group's heading (grouped by author or category).
    if mod.header then
        self:drawRect(0, y, self.width, h, 0.9, C.bg[1], C.bg[2], C.bg[3])
        local ty = y + (h - fontH(UIFont.Small)) / 2
        self:drawText(mod.header .. "  (" .. tostring(mod.count) .. ")", 12, ty, C.accent[1], C.accent[2], C.accent[3], 1, UIFont.Small)
        self:drawRect(0, y + h - 1, self.width, 1, 0.8, C.border[1], C.border[2], C.border[3])
        return y + h
    end
    -- Where a dragged mod would land.
    if self.dragging and self.dropRow == item.index then
        self:drawRect(0, y, self.width, 3, 1, C.accent[1], C.accent[2], C.accent[3])
    end
    if screen.multi[mod.id] then
        self:drawRect(0, y, self.width, h, 0.35, C.accentDark[1], C.accentDark[2], C.accentDark[3])
    end
    if self.selected == item.index then
        self:drawRect(0, y, self.width, h, 0.55, C.accentDark[1], C.accentDark[2], C.accentDark[3])
    elseif self.mouseoverselected == item.index and self:isMouseOver() then
        self:drawRect(0, y, self.width, h, 0.07, 1, 1, 1)
    end
    local on = screen.on[mod.id]
    local box = math.min(18, h - 8)
    local by = y + (h - box) / 2
    -- Favourite star.
    local star = screen.favs[mod.id] and self.starOn or self.starOff
    if star then self:drawTextureScaled(star, 6, by, box, box, screen.favs[mod.id] and 1 or 0.35, 1, 1, 1) end
    -- The tick: on, off, or cannot be on (not for this build).
    local bx = 30
    if mod.available then
        if on then self:drawRect(bx, by, box, box, 0.9, C.accentDark[1], C.accentDark[2], C.accentDark[3]) end
        self:drawRectBorder(bx, by, box, box, 1, on and C.accent[1] or C.muted[1], on and C.accent[2] or C.muted[2], on and C.accent[3] or C.muted[3])
        if on and self.tickTexture then self:drawTextureScaled(self.tickTexture, bx, by, box, box, 1, 1, 1, 1) end
    else
        self:drawRectBorder(bx, by, box, box, 0.4, C.muted[1], C.muted[2], C.muted[3])
    end
    local col = mod.available and (on and C.text or C.muted) or { 0.4, 0.42, 0.46 }
    local ty = y + (h - self.fontHgt) / 2
    self:drawText(mod.name, NAME_X, ty, col[1], col[2], col[3], 1, self.font)
    -- On the right: marks, then the load position.
    local rx = self.width - 16
    local small = UIFont.Small
    local sty = y + (h - fontH(small)) / 2
    local function tag(label, c)
        local w = measure(small, label)
        rx = rx - w
        self:drawText(label, rx, sty, c[1], c[2], c[3], 1, small)
        rx = rx - 12
    end
    if on and screen.position[mod.id] then tag("#" .. tostring(screen.position[mod.id]), C.muted) end
    if screen.changed[mod.id] then tag("*", C.accent) end
    if mod.map then tag(text("modsMap"), C.map) end
    if screen.updated[mod.id] == "updated" then tag(text("modsUpdated"), C.info) end
    if screen.updated[mod.id] == "waiting" then tag(text("modsWaiting"), C.warn) end
    if not mod.available then tag(text("modsNotForBuild"), C.muted) end
    if screen.missingReq[mod.id] then tag(text("modsNeedsMore"), C.warn) end
    local health = screen.health[mod.id]
    if health then tag("!", health.severity == "error" and C.error or C.warn) end
    self:drawRect(0, y + h - 1, self.width, 1, 0.6, C.border[1], C.border[2], C.border[3])
    return y + h
end

function ModList:onMouseDown(x, y)
    if #self.items == 0 then return end
    local row = self:rowAt(x, y)
    if row < 1 or row > #self.items then return end
    local mod = self.items[row].item
    if mod.header then return end
    getSoundManager():playUISound("UISelectListItem")
    local screen = self.screen
    -- Ctrl adds or takes one mod, Shift takes the rows from the last one clicked: several mods.
    if isCtrlKeyDown() or isShiftKeyDown() then
        if isShiftKeyDown() and self.anchor then
            screen.multi = {}
            local a, b = math.min(self.anchor, row), math.max(self.anchor, row)
            for i = a, b do
                local m = self.items[i] and self.items[i].item
                if m and not m.header then screen.multi[m.id] = true end
            end
        else
            if screen.selectedMod and not screen.selectedMod.header then screen.multi[screen.selectedMod.id] = true end
            screen.multi[mod.id] = not screen.multi[mod.id] or nil
            self.anchor = row
        end
        self.selected = row
        screen:select(mod)
        return
    end
    screen.multi = {}
    self.anchor = row
    self.selected = row
    -- Shown first (the list keeps the shown mod selected when it is redrawn).
    screen:select(mod)
    if x < STAR_RIGHT then
        screen:toggleFavourite(mod)
    elseif x < TICK_RIGHT then
        screen:toggle(mod)
    else
        -- Held and moved, it is dragged to another place of the load order.
        self.dragFrom = row
        self.dragStartY = y
        self.dragging = false
    end
end

function ModList:onMouseMove(dx, dy)
    ISScrollingListBox.onMouseMove(self, dx, dy)
    if self.dragFrom then
        local my = self:getMouseY()
        if not self.dragging and math.abs(my - self.dragStartY) > 6 then self.dragging = true end
        if self.dragging then self.dropRow = self:rowAt(self:getMouseX(), my) end
    end
end

function ModList:onMouseUp(x, y)
    ISScrollingListBox.onMouseUp(self, x, y)
    if self.dragging and self.dropRow and self.items[self.dragFrom] and self.items[self.dropRow] then
        self.screen:dropAt(self.items[self.dragFrom].item, self.items[self.dropRow].item)
    end
    self.dragFrom, self.dragging, self.dropRow = nil, false, nil
end

function ModList:onMouseUpOutside(x, y)
    ISScrollingListBox.onMouseUpOutside(self, x, y)
    self.dragFrom, self.dragging, self.dropRow = nil, false, nil
end

function ModList:onMouseDoubleClick(x, y)
    local row = self:rowAt(x, y)
    if row >= 1 and row <= #self.items and x >= TICK_RIGHT and not self.items[row].item.header then self.screen:toggle(self.items[row].item) end
end

-- ------------------------------------------------------------------ the screen

function Screen:new(x, y, w, h)
    local o = ISPanelJoypad.new(self, x, y, w, h)
    o.backgroundColor = { r = C.bg[1], g = C.bg[2], b = C.bg[3], a = 0.97 }
    o.borderColor = { r = C.border[1], g = C.border[2], b = C.border[3], a = 1 }
    o.filter = "all"
    o.sort = "name"
    o.group = "none"
    o.multi = {}
    o.search = ""
    o.on, o.changed, o.position, o.missingReq, o.health, o.updated, o.favs = {}, {}, {}, {}, {}, {}, {}
    -- Big screens get bigger rows and text.
    o.big = h >= 900
    o.listFont = o.big and UIFont.Medium or UIFont.Small
    -- Below what other mods draw in the top-left corner (ZombieBuddy lists its Java mods there).
    o.top = 48
    return o
end

function Screen:readState()
    self.mods, self.byId = readMods()
    self.order = readActive()
    self.startOrder = {}
    for i, id in ipairs(self.order) do self.startOrder[i] = plainId(id) end
    self.on = {}
    for _, id in ipairs(self.order) do self.on[plainId(id)] = true end
    self.startOn = {}
    for id, _ in pairs(self.on) do self.startOn[id] = true end
    self.favs = readFavourites()
    -- With the app: its profile, Mod Health's warnings and what was updated (as it last wrote them).
    self.link = Link.appInstalled() and Link.read() or nil
    self.health = self.link and Link.readHealth() or {}
    self.updated = Link.appInstalled() and readUpdated() or {}
    self.onlyProfile = self.link ~= nil
    self:recount()
end

--- What follows from the working list: positions, changes, requirements not met.
function Screen:recount()
    self.position, self.changed, self.missingReq = {}, {}, {}
    for i, id in ipairs(self.order) do self.position[plainId(id)] = i end
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
    -- A new load order counts as one change.
    self.orderChanged = false
    local kept = {}
    for _, id in ipairs(self.startOrder) do
        if self.on[id] then table.insert(kept, id) end
    end
    local now = {}
    for _, id in ipairs(self.order) do
        if self.startOn[plainId(id)] then table.insert(now, plainId(id)) end
    end
    for i = 1, #kept do
        if kept[i] ~= now[i] then self.orderChanged = true end
    end
    if self.orderChanged then self.changes = self.changes + 1 end
    -- The summary on top.
    self.counts = { problems = 0, updated = 0, favourites = 0 }
    for _, mod in ipairs(self.mods) do
        if self.health[mod.id] or self.missingReq[mod.id] or (self.on[mod.id] and not mod.available) then self.counts.problems = self.counts.problems + 1 end
        if self.updated[mod.id] then self.counts.updated = self.counts.updated + 1 end
        if self.favs[mod.id] then self.counts.favourites = self.counts.favourites + 1 end
    end
end

--- The mods the list shows now, in the order chosen.
function Screen:visibleMods()
    local out = {}
    -- What was typed, as plain text (a "-" or "(" would mean something to Lua's find).
    local q = string.gsub(string.lower(self.search or ""), "%p", "%%%0")
    for _, mod in ipairs(self.mods) do
        local show = true
        if self.onlyProfile and self.link and not self.link.members[mod.id] and not self.on[mod.id] then show = false end
        local f = self.filter
        if show and f == "on" and not self.on[mod.id] then show = false end
        if show and f == "off" and self.on[mod.id] then show = false end
        if show and f == "favourites" and not self.favs[mod.id] then show = false end
        if show and f == "updated" and not self.updated[mod.id] then show = false end
        if show and f == "maps" and not mod.map then show = false end
        if show and f == "problems" and not (self.health[mod.id] or self.missingReq[mod.id] or (self.on[mod.id] and not mod.available)) then show = false end
        if show and q ~= "" then
            show = string.find(string.lower(mod.name), q) ~= nil or string.find(string.lower(mod.id), q) ~= nil
                or string.find(mod.workshop, q) ~= nil or string.find(string.lower(mod.author), q) ~= nil
        end
        if show then table.insert(out, mod) end
    end
    if self.sort == "order" then
        -- Mods that are on in their load order, then the rest by name.
        table.sort(out, function(a, b)
            local pa, pb = self.position[a.id], self.position[b.id]
            if pa and pb then return pa < pb end
            if pa or pb then return pa ~= nil end
            return string.lower(a.name) < string.lower(b.name)
        end)
    end
    return out
end

--- A mod's group: its author(s), or its category (a map mod with none set is a map).
function Screen:groupOf(mod)
    if self.group == "author" then
        return mod.author ~= "" and mod.author or text("modsNoAuthor")
    end
    local category = mod.info:getCategory() or ""
    if category == "" and mod.map then category = "map" end
    if category == "" then return text("modsNoCategory") end
    local label = text("modsCategory_" .. category)
    return label ~= "modsCategory_" .. category and label or category
end

function Screen:refreshList()
    local keep = self.selectedMod
    self.list:clear()
    local mods = self:visibleMods()
    local rows = {}
    if self.group == "none" then
        rows = mods
    else
        -- Groups by name, the mods of each in the order chosen, a heading above each.
        local groups, keys = {}, {}
        for _, mod in ipairs(mods) do
            local g = self:groupOf(mod)
            if not groups[g] then
                groups[g] = {}
                table.insert(keys, g)
            end
            table.insert(groups[g], mod)
        end
        table.sort(keys, function(a, b) return string.lower(a) < string.lower(b) end)
        for _, g in ipairs(keys) do
            table.insert(rows, { header = g, count = #groups[g], id = "\0" .. g })
            for _, mod in ipairs(groups[g]) do table.insert(rows, mod) end
        end
    end
    local pick
    for i, mod in ipairs(rows) do
        self.list:addItem(mod.name or mod.header, mod)
        if keep and mod.id == keep.id then pick = i end
        if not pick and not mod.header and not keep then pick = i end
    end
    if not pick then
        for i, row in ipairs(rows) do
            if not row.header then
                pick = i
                break
            end
        end
    end
    self.list.selected = pick or 1
    if pick then
        self:select(self.list.items[pick].item)
        self.list:ensureVisible(pick)
    else
        self:select(nil)
    end
    self:updateButtons()
end

function Screen:say(message)
    self.note = message
    self.noteAt = Link.now()
end

-- ------------------------------------------------------------------ favourites

function Screen:toggleFavourite(mod)
    if not mod then return end
    self.favs[mod.id] = not self.favs[mod.id] or nil
    pcall(writeFavourites, self.favs)
    if self.filter == "favourites" then self:refreshList() else self:updateButtons() end
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
            self:setOn(mod, true)
            self:recount()
            self:refreshList()
        end
        if #extra == 0 and #missing == 0 then return apply() end
        local body = ""
        if #extra > 0 then body = body .. text("modsAlsoOn", mod.name) .. " <LINE> " .. names(extra) .. " <LINE> <LINE> " end
        if #missing > 0 then body = body .. " <RGB:1,0.6,0.3> " .. text("modsMissingReq", mod.name) .. " <RGB:1,1,1> <LINE> " .. names(missing) .. " <LINE> " end
        local lines = #extra + #missing + 6
        Link.WaitPanel.choose(mod.name, body, 100 + lines * (fontH(UIFont.Small) + 2), {
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
        Link.WaitPanel.choose(mod.name, body, 100 + (#deps + 4) * (fontH(UIFont.Small) + 2), {
            { label = text("back") },
            { label = text("modsTurnOff"), accept = true, onClick = apply },
        })
    end
end

-- ------------------------------------------------------------------ several mods at once

function Screen:multiMods()
    local out = {}
    for _, mod in ipairs(self.mods) do
        if self.multi[mod.id] then table.insert(out, mod) end
    end
    return out
end

--- Turns on (when any of them is off) or off all the mods selected, with what they require or
--- what needs them, said first.
function Screen:toggleMany(mods)
    local anyOff = false
    for _, mod in ipairs(mods) do
        if not self.on[mod.id] and mod.available then anyOff = true end
    end
    local inSet = {}
    for _, mod in ipairs(mods) do inSet[mod.id] = true end
    if anyOff then
        local extra, missing, seen = {}, {}, {}
        for _, mod in ipairs(mods) do
            if not self.on[mod.id] and mod.available then
                local e, m = {}, {}
                self:needed(mod, e, m)
                for _, r in ipairs(e) do
                    if not inSet[r.id] and not seen[r.id] then
                        seen[r.id] = true
                        table.insert(extra, r)
                    end
                end
                for _, id in ipairs(m) do
                    if not seen[id] then
                        seen[id] = true
                        table.insert(missing, id)
                    end
                end
            end
        end
        local function apply()
            for _, r in ipairs(extra) do self:setOn(r, true) end
            for _, mod in ipairs(mods) do
                if mod.available then self:setOn(mod, true) end
            end
            self:recount()
            self:refreshList()
        end
        if #extra == 0 and #missing == 0 then return apply() end
        local body = ""
        if #extra > 0 then body = body .. text("modsAlsoOnMany") .. " <LINE> " .. names(extra) .. " <LINE> <LINE> " end
        if #missing > 0 then body = body .. " <RGB:1,0.6,0.3> " .. text("modsMissingReqMany") .. " <RGB:1,1,1> <LINE> " .. names(missing) .. " <LINE> " end
        Link.WaitPanel.choose(text("modsSelected", #mods), body, 100 + (#extra + #missing + 6) * (fontH(UIFont.Small) + 2), {
            { label = text("back") },
            { label = text("modsTurnOnAll"), accept = true, onClick = apply },
        })
    else
        local deps, seen = {}, {}
        for _, mod in ipairs(mods) do
            local d = {}
            self:dependents(mod, d)
            for _, x in ipairs(d) do
                if not inSet[x.id] and not seen[x.id] then
                    seen[x.id] = true
                    table.insert(deps, x)
                end
            end
        end
        local function apply()
            for _, d in ipairs(deps) do self:setOn(d, false) end
            for _, mod in ipairs(mods) do self:setOn(mod, false) end
            self:recount()
            self:refreshList()
        end
        if #deps == 0 then return apply() end
        Link.WaitPanel.choose(text("modsSelected", #mods), text("modsAlsoOffMany") .. " <LINE> " .. names(deps), 100 + (#deps + 4) * (fontH(UIFont.Small) + 2), {
            { label = text("back") },
            { label = text("modsTurnOffAll"), accept = true, onClick = apply },
        })
    end
end

function Screen:favouriteMany(mods)
    local all = true
    for _, mod in ipairs(mods) do
        if not self.favs[mod.id] then all = false end
    end
    for _, mod in ipairs(mods) do self.favs[mod.id] = (not all) or nil end
    pcall(writeFavourites, self.favs)
    self:recount()
    if self.filter == "favourites" then self:refreshList() else self:updateButtons() end
end

-- ------------------------------------------------------------------ Mod Options

--- The game's options page of a mod (B42 Mod Options), when it registered one: only mods that
--- are on run their code, so only those can have it.
function Screen:hasOptions(mod)
    if not mod or not self.startOn[mod.id] then return false end
    local found = false
    pcall(function()
        local api = PZAPI and PZAPI.ModOptions
        if not api then return end
        if api.Dict and api.Dict[mod.id] then found = true return end
        for _, o in ipairs(api.Data or {}) do
            if o.modOptionsID == mod.id or o.modOptionsID == mod.gameId or getText(o.name or "") == mod.name then found = true end
        end
    end)
    return found
end

--- Opens the game's Options on its Mods page (the options of every mod that has some).
function Screen:openOptions()
    if self.changes > 0 then return self:say(text("modsOptionsAcceptFirst")) end
    self:close()
    local ms = MainScreen.instance
    if not ms or not ms.mainOptions then return end
    ms.bottomPanel:setVisible(false)
    ms.mainOptions:toUI()
    ms.mainOptions:setVisible(true, JoypadState.getMainMenuJoypad())
    pcall(function() ms.mainOptions.tabs:activateView(getText("UI_mainscreen_mods")) end)
end

-- ------------------------------------------------------------------ load order

--- Moves a mod that is on one place up or down the load order. A mod never goes above what it
--- requires, nor below a mod that requires it: the game would load them the wrong way round.
function Screen:move(mod, step)
    if not mod or not self.on[mod.id] then return end
    local at
    for i, id in ipairs(self.order) do
        if plainId(id) == mod.id then at = i end
    end
    local to = at and at + step
    if not to or to < 1 or to > #self.order then return end
    local other = self.byId[plainId(self.order[to])]
    if other then
        if step < 0 then
            for _, req in ipairs(mod.requires) do
                if req == other.id then return self:say(text("modsCantUp", mod.name, other.name)) end
            end
        else
            for _, req in ipairs(other.requires) do
                if req == mod.id then return self:say(text("modsCantDown", mod.name, other.name)) end
            end
        end
    end
    self.order[at], self.order[to] = self.order[to], self.order[at]
    self.note = nil
    self:recount()
    if self.sort ~= "order" then
        self.sort = "order"
        self:say(text("modsSortedByOrder"))
    end
    self:refreshList()
end

--- A mod dropped on another row of the load order: it goes there, but never above what it
--- requires nor below a mod that requires it (it stops at the nearest place it can go).
function Screen:dropAt(mod, target)
    if not mod or not target or target.header or mod.id == target.id then return end
    if self.sort ~= "order" or self.group ~= "none" then return self:say(text("modsDragNeedsOrder")) end
    if not self.on[mod.id] or not self.on[target.id] then return self:say(text("modsDragOnlyOn")) end
    local from
    for i, id in ipairs(self.order) do
        if plainId(id) == mod.id then from = i end
    end
    local entry = table.remove(self.order, from)
    local to
    for i, id in ipairs(self.order) do
        if plainId(id) == target.id then to = i end
    end
    -- Dropped below a row it was above: after that row.
    if to >= from then to = to + 1 end
    local lo, hi = 1, #self.order + 1
    for i, id in ipairs(self.order) do
        local other = self.byId[plainId(id)]
        for _, req in ipairs(mod.requires) do
            if req == plainId(id) and i + 1 > lo then lo = i + 1 end
        end
        if other then
            for _, req in ipairs(other.requires) do
                if req == mod.id and i < hi then hi = i end
            end
        end
    end
    local wanted = to
    if to < lo then to = lo end
    if to > hi then to = hi end
    table.insert(self.order, to, entry)
    if to ~= wanted then self:say(text("modsDragLimited", mod.name)) else self.note = nil end
    self:recount()
    self:refreshList()
end

-- ------------------------------------------------------------------ details

function Screen:select(mod)
    if mod and mod.header then mod = nil end
    self.selectedMod = mod
    if not self.desc then return end
    local many = self:multiMods()
    if #many > 1 then
        local list = {}
        for i, m in ipairs(many) do
            if i > 30 then
                table.insert(list, text("andMore", #many - 30))
                break
            end
            -- "Name, on": the rich text drops a space that stands alone before a colour.
            local state = self.on[m.id] and " <RGB:0.45,0.9,0.65> " .. text("modsOnShort") or " <RGB:0.58,0.64,0.72> " .. text("modsOff")
            table.insert(list, " <RGB:1,1,1> - " .. m.name .. "," .. state .. " <RGB:1,1,1> ")
        end
        self.desc:setText(" <RGB:0.58,0.64,0.72> " .. text("modsManyHelp") .. " <RGB:1,1,1> <LINE> <LINE> " .. table.concat(list, " <LINE> "))
        self.desc:paginate()
        self.desc:setYScroll(0)
        self.poster = nil
        self.posterPath = nil
        self:updateButtons()
        return
    end
    if not mod then
        self.desc:setText("")
        self.desc:paginate()
        self.poster = nil
        self:updateButtons()
        return
    end
    local info = mod.info
    local parts = {}
    local function line(s) table.insert(parts, s) end
    -- What Mod Health says (with the app).
    local health = self.health[mod.id]
    if health then
        local color = health.severity == "error" and "1,0.45,0.45" or "1,0.8,0.35"
        for _, l in ipairs(health.lines) do line(" <RGB:" .. color .. "> " .. l .. " <RGB:1,1,1> <LINE> ") end
        line(" <LINE> ")
    end
    if not mod.available then line(" <RGB:1,0.6,0.3> " .. text("modsCannotTurnOn") .. " <RGB:1,1,1> <LINE> <LINE> ") end
    if self.updated[mod.id] == "updated" then line(" <RGB:0.35,0.65,0.98> " .. text("modsUpdatedLong") .. " <RGB:1,1,1> <LINE> <LINE> ") end
    if self.updated[mod.id] == "waiting" then line(" <RGB:0.98,0.75,0.14> " .. text("modsWaitingLong") .. " <RGB:1,1,1> <LINE> <LINE> ") end
    if #mod.requires > 0 then
        line(" <RGB:0.58,0.64,0.72> " .. text("modsRequires") .. " <RGB:1,1,1> <LINE> ")
        for _, req in ipairs(mod.requires) do
            local r = self.byId[req]
            if not r then
                line(" <RGB:1,0.5,0.4> - " .. req .. " (" .. text("modsNotInstalled") .. ") <RGB:1,1,1> <LINE> ")
            elseif self.on[req] then
                line(" <RGB:0.45,0.9,0.65> - " .. r.name .. " <RGB:1,1,1> <LINE> ")
            else
                line(" <RGB:1,0.75,0.4> - " .. r.name .. " (" .. text("modsOff") .. ") <RGB:1,1,1> <LINE> ")
            end
        end
        line(" <LINE> ")
    end
    local needs = {}
    for _, other in ipairs(self.mods) do
        for _, req in ipairs(other.requires) do
            if req == mod.id then table.insert(needs, other) end
        end
    end
    if #needs > 0 then
        line(" <RGB:0.58,0.64,0.72> " .. text("modsNeededBy") .. " <RGB:1,1,1> <LINE> ")
        for i, other in ipairs(needs) do
            if i > 10 then
                line(" " .. text("andMore", #needs - 10) .. " <LINE> ")
                break
            end
            line(" <RGB:0.85,0.87,0.9> - " .. other.name .. " <RGB:1,1,1> <LINE> ")
        end
        line(" <LINE> ")
    end
    local description = info:getDescription() or ""
    if description ~= "" then line(description) end
    self.desc:setText(table.concat(parts, ""))
    self.desc:paginate()
    self.desc:setYScroll(0)
    self.poster = nil
    self.posterPath = nil
    pcall(function()
        if info:getPosterCount() > 0 then
            self.posterPath = info:getPoster(0)
            self.poster = getTexture(self.posterPath)
        end
    end)
    self:updateButtons()
end

function Screen:updateButtons()
    if not self.toggleButton then return end
    local mod = self.selectedMod
    local many = self:multiMods()
    self.groupButton:setTitle(text("modsGroup_" .. self.group))
    self.summary.problems:setTitle(text("modsSumProblems", self.counts.problems))
    self.summary.favourites:setTitle(text("modsSumFavourites", self.counts.favourites))
    if self.summary.updated then self.summary.updated:setTitle(text("modsSumUpdated", self.counts.updated)) end
    if #many > 1 then
        local anyOff = false
        for _, m in ipairs(many) do
            if not self.on[m.id] and m.available then anyOff = true end
        end
        self.toggleButton:setVisible(true)
        self.toggleButton:setEnable(true)
        self.toggleButton:setTitle(anyOff and text("modsTurnOnAll") or text("modsTurnOffAll"))
        styleButton(self.toggleButton, anyOff)
        self.favButton:setVisible(true)
        self.favButton:setTitle(text("modsFavouriteAll"))
        self.upButton:setVisible(false)
        self.downButton:setVisible(false)
        self.workshopButton:setVisible(false)
        self.optionsButton:setVisible(false)
        self.acceptButton:setTitle(self.changes > 0 and text("modsAcceptN", self.changes) or text("modsAccept"))
        for key, button in pairs(self.filterButtons) do styleButton(button, key == self.filter) end
        self.sortButton:setTitle(self.sort == "order" and text("modsSortOrder") or text("modsSortName"))
        return
    end
    self.optionsButton:setVisible(self:hasOptions(mod))
    local has = mod ~= nil
    self.toggleButton:setVisible(has)
    self.workshopButton:setVisible(has)
    self.favButton:setVisible(has)
    self.upButton:setVisible(has and self.on[mod.id] == true)
    self.downButton:setVisible(has and self.on[mod.id] == true)
    if has then
        self.toggleButton:setTitle(self.on[mod.id] and text("modsTurnOff") or text("modsTurnOn"))
        self.toggleButton:setEnable(mod.available or self.on[mod.id] == true)
        styleButton(self.toggleButton, not self.on[mod.id])
        self.workshopButton:setEnable(mod.workshop ~= "" and mod.workshop ~= "0")
        self.favButton:setTitle(self.favs[mod.id] and text("modsUnfavourite") or text("modsFavourite"))
    end
    self.acceptButton:setTitle(self.changes > 0 and text("modsAcceptN", self.changes) or text("modsAccept"))
    for key, button in pairs(self.filterButtons) do
        styleButton(button, key == self.filter)
    end
    self.sortButton:setTitle(self.sort == "order" and text("modsSortOrder") or text("modsSortName"))
    if self.profileTick then
        self.profileTick:setTitle(self.onlyProfile and text("modsOnlyProfileOn") or text("modsOnlyProfileOff"))
    end
end

-- ------------------------------------------------------------------ layout

local function button(parent, x, y, w, h, label, onClick, primary)
    local b = ISButton:new(x, y, w, h, label, parent, onClick)
    b:initialise()
    b:instantiate()
    b:setFont(UIFont.Small)
    styleButton(b, primary)
    parent:addChild(b)
    return b
end

function Screen:createChildren()
    local pad = 20
    local bh = math.max(26, fontH(UIFont.Small) + 10)
    local top = self.top + fontH(UIFont.Large) + fontH(UIFont.Small) + 16
    self.controlsY = top

    self.searchBox = ISTextEntryBox:new("", pad, top, 260, bh)
    self.searchBox.font = UIFont.Small
    self.searchBox:initialise()
    self.searchBox:instantiate()
    self.searchBox:setClearButton(true)
    self.searchBox.tooltip = text("modsSearchTip")
    self.searchBox.onTextChange = function()
        self.search = self.searchBox:getText() or ""
        self:refreshList()
    end
    self:addChild(self.searchBox)

    self.filterButtons = {}
    local fx = self.searchBox:getRight() + 12
    for _, key in ipairs(FILTERS) do
        -- "Updated" only with the app (it is what tells).
        if key ~= "updated" or Link.appInstalled() then
            local label = text("modsFilter_" .. key)
            local b = button(self, fx, top, measure(UIFont.Small, label) + 22, bh, label, function(screen)
                screen.filter = key
                screen:refreshList()
            end)
            self.filterButtons[key] = b
            fx = b:getRight() + 6
        end
    end
    local sw = math.max(measure(UIFont.Small, text("modsSortName")), measure(UIFont.Small, text("modsSortOrder"))) + 22
    self.sortButton = button(self, fx + 12, top, sw, bh, text("modsSortName"), function(screen)
        screen.sort = screen.sort == "order" and "name" or "order"
        screen:refreshList()
    end)
    fx = self.sortButton:getRight() + 6
    local gw = 0
    for _, g in ipairs({ "none", "author", "category" }) do gw = math.max(gw, measure(UIFont.Small, text("modsGroup_" .. g))) end
    self.groupButton = button(self, fx, top, gw + 22, bh, text("modsGroup_none"), function(screen)
        screen.group = (screen.group == "none" and "author") or (screen.group == "author" and "category") or "none"
        screen:refreshList()
    end)
    fx = self.groupButton:getRight() + 6

    -- The summary, right of the title: each one shows its mods.
    self.summary = {}
    local sx = self.width - pad
    local sy = self.top
    local function summaryButton(key, label)
        local w = measure(UIFont.Small, label) + 40
        sx = sx - w
        local b = button(self, sx, sy, w, bh, label, function(screen)
            screen.filter = key
            screen:refreshList()
        end)
        sx = sx - 6
        self.summary[key] = b
    end
    summaryButton("favourites", text("modsSumFavourites", 999))
    if Link.appInstalled() then summaryButton("updated", text("modsSumUpdated", 999)) end
    summaryButton("problems", text("modsSumProblems", 999))

    if self.link then
        local w = math.max(measure(UIFont.Small, text("modsOnlyProfileOn")), measure(UIFont.Small, text("modsOnlyProfileOff"))) + 22
        self.profileTick = button(self, fx + 12, top, w, bh, text("modsOnlyProfileOn"), function(screen)
            screen.onlyProfile = not screen.onlyProfile
            screen:refreshList()
        end)
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
            self.newButton = button(self, fx + 6, top, measure(UIFont.Small, nl) + 22, bh, nl, function(screen, b)
                Link.requestAdd(fresh)
                b:setTitle(text("adding"))
                b:setEnable(false)
            end, true)
        end
    end

    local listTop = top + bh + 12
    local bottom = self.height - pad - bh - 14
    local listW = math.floor((self.width - pad * 3) * 0.52)
    self.list = ModList:new(pad, listTop, listW, bottom - listTop, self)
    self.list:initialise()
    self.list:instantiate()
    self:addChild(self.list)

    -- Details: the poster on the left, the name and its buttons beside it, the text below.
    local dx = pad * 2 + listW
    local dw = self.width - dx - pad
    self.detailX, self.detailY, self.detailW = dx, listTop, dw
    self.posterSize = math.min(self.big and 256 or 190, math.floor(dw * 0.42))
    local bx = dx + self.posterSize + 16
    local bw = math.min(200, dw - self.posterSize - 16)
    local nameH = fontH(UIFont.Medium) * 2 + fontH(UIFont.Small) * 2 + 18
    local by = listTop + nameH
    self.toggleButton = button(self, bx, by, bw, bh, text("modsTurnOn"), function(screen)
        local many = screen:multiMods()
        if #many > 1 then screen:toggleMany(many) else screen:toggle(screen.selectedMod) end
    end, true)
    self.favButton = button(self, bx, by + bh + 6, bw, bh, text("modsFavourite"), function(screen)
        local many = screen:multiMods()
        if #many > 1 then screen:favouriteMany(many) else screen:toggleFavourite(screen.selectedMod) end
    end)
    local half = math.floor((bw - 6) / 2)
    self.upButton = button(self, bx, by + (bh + 6) * 2, half, bh, text("modsUp"), function(screen) screen:move(screen.selectedMod, -1) end)
    self.downButton = button(self, bx + half + 6, by + (bh + 6) * 2, bw - half - 6, bh, text("modsDown"), function(screen) screen:move(screen.selectedMod, 1) end)
    self.workshopButton = button(self, bx, by + (bh + 6) * 3, bw, bh, text("modsWorkshopPage"), function(screen)
        local mod = screen.selectedMod
        if mod then pcall(function() openUrl(WORKSHOP_URL .. mod.workshop) end) end
    end)
    self.optionsButton = button(self, bx, by + (bh + 6) * 4, bw, bh, text("modsOptions"), function(screen) screen:openOptions() end)
    local descTop = math.max(listTop + self.posterSize, self.optionsButton:getBottom()) + 14
    self.desc = ISRichTextPanel:new(dx, descTop, dw, bottom - descTop - 24)
    self.desc.background = false
    self.desc.autosetheight = false
    self.desc.clip = true
    self.desc.marginLeft = 2
    self.desc.marginRight = 10
    self.desc:initialise()
    self.desc:instantiate()
    self.desc:addScrollBars(true)
    self:addChild(self.desc)
    self.noteY = bottom - 18

    -- The bottom bar: the game's own screen on the left, Back and Accept on the right.
    local fy = self.height - pad - bh
    button(self, pad, fy, measure(UIFont.Small, text("modsGameScreen")) + 26, bh, text("modsGameScreen"), function(screen) screen:openGameScreen() end)
    self.acceptButton = button(self, self.width - pad - 200, fy, 200, bh, text("modsAccept"), function(screen) screen:accept() end, true)
    self.backButton = button(self, self.acceptButton.x - 140, fy, 130, bh, text("back"), function(screen) screen:back() end)

    self:refreshList()
end

function Screen:prerender()
    ISPanelJoypad.prerender(self)
    local pad = 20
    self:drawText(text("modsTitle"), pad, self.top, C.text[1], C.text[2], C.text[3], 1, UIFont.Large)
    -- Under the title: the profile (with the app) or what is installed (without it).
    local onCount = 0
    for _, _ in pairs(self.on) do onCount = onCount + 1 end
    local subY = self.top + fontH(UIFont.Large) + 2
    if self.link then
        local alive = Link.appAlive()
        local sub = text("modsSubProfile", self.link.name, onCount, #self.mods)
        self:drawText(sub, pad, subY, C.muted[1], C.muted[2], C.muted[3], 1, UIFont.Small)
        local status = "   " .. (alive and text("cardOpen") or text("cardClosed"))
        local c = alive and C.accent or C.muted
        self:drawText(status, pad + measure(UIFont.Small, sub), subY, c[1], c[2], c[3], 1, UIFont.Small)
    else
        self:drawText(text("modsSub", #self.mods, onCount), pad, subY, C.muted[1], C.muted[2], C.muted[3], 1, UIFont.Small)
    end
    if not self.detailX then return end
    -- The details panel behind the poster and the text.
    self:drawRect(self.detailX - 10, self.detailY - 6, self.detailW + 20, self.noteY + 22 - self.detailY, 0.95, C.panel[1], C.panel[2], C.panel[3])
    self:drawRectBorder(self.detailX - 10, self.detailY - 6, self.detailW + 20, self.noteY + 22 - self.detailY, 1, C.border[1], C.border[2], C.border[3])
    -- A poster the game had not loaded yet on the first try is asked for again while drawing.
    if not self.poster and self.posterPath then
        local ok, tex = pcall(getTexture, self.posterPath)
        if ok then self.poster = tex end
    end
    if self.poster then
        self:drawTextureScaledAspect(self.poster, self.detailX, self.detailY, self.posterSize, self.posterSize, 1, 1, 1, 1)
    else
        self:drawRectBorder(self.detailX, self.detailY, self.posterSize, self.posterSize, 0.6, C.border[1], C.border[2], C.border[3])
    end
    local mod = self.selectedMod
    local many = #self:multiMods()
    if many > 1 then
        self:drawText(text("modsSelected", many), self.detailX + self.posterSize + 16, self.detailY, C.text[1], C.text[2], C.text[3], 1, UIFont.Medium)
    elseif mod then
        -- Beside the poster: the name (up to two lines), then id, Workshop, version, author.
        local nx = self.detailX + self.posterSize + 16
        local nw = self.detailW - self.posterSize - 16
        local ny = self.detailY
        local name = mod.name
        if measure(UIFont.Medium, name) > nw then
            local cut = string.len(name)
            while cut > 1 and measure(UIFont.Medium, string.sub(name, 1, cut)) > nw do cut = cut - 1 end
            self:drawText(string.sub(name, 1, cut), nx, ny, C.text[1], C.text[2], C.text[3], 1, UIFont.Medium)
            ny = ny + fontH(UIFont.Medium)
            name = string.sub(name, cut + 1)
        end
        self:drawText(name, nx, ny, C.text[1], C.text[2], C.text[3], 1, UIFont.Medium)
        ny = ny + fontH(UIFont.Medium) + 4
        local meta = mod.id
        if mod.workshop ~= "" and mod.workshop ~= "0" then meta = meta .. "   Workshop " .. mod.workshop end
        local version = mod.info:getModVersion()
        if version and version ~= "" then meta = meta .. "   v" .. version end
        self:drawText(meta, nx, ny, C.muted[1], C.muted[2], C.muted[3], 1, UIFont.Small)
        ny = ny + fontH(UIFont.Small) + 2
        if mod.author ~= "" then self:drawText(text("modsBy", mod.author), nx, ny, C.muted[1], C.muted[2], C.muted[3], 1, UIFont.Small) end
    end
    -- A short note (why a move was refused...), for a few seconds.
    if self.note and self.noteAt and Link.now() - self.noteAt < 6 then
        self:drawText(self.note, self.detailX, self.noteY, C.warn[1], C.warn[2], C.warn[3], 1, UIFont.Small)
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
        -- The chosen order, with each mod after what it requires (the game's own rule).
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

-- ------------------------------------------------------------------ controller and keys

function Screen:onJoypadDown(button)
    if button == Joypad.AButton then
        self:toggle(self.selectedMod)
    elseif button == Joypad.BButton then
        self:back()
    elseif button == Joypad.YButton then
        self:accept()
    elseif button == Joypad.XButton then
        for i, key in ipairs(FILTERS) do
            if key == self.filter then
                self.filter = FILTERS[(i % #FILTERS) + 1]
                break
            end
        end
        self:refreshList()
    elseif button == Joypad.LBumper then
        self:move(self.selectedMod, -1)
    elseif button == Joypad.RBumper then
        self:move(self.selectedMod, 1)
    end
end

function Screen:selectRow()
    local row = self.list.items[self.list.selected]
    self:select(row and row.item)
end
function Screen:onJoypadDirUp()
    self.list:onJoypadDirUp()
    local row = self.list.items[self.list.selected]
    if row and row.item.header then self.list:onJoypadDirUp() end
    self:selectRow()
end
function Screen:onJoypadDirDown()
    self.list:onJoypadDirDown()
    local row = self.list.items[self.list.selected]
    if row and row.item.header then self.list:onJoypadDirDown() end
    self:selectRow()
end

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
