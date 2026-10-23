-- PZ Mod Studio Profiler: how much of the game's time each mod's event handlers take.
--
-- The Studio puts this mod first in the load order while the player measures. The game runs
-- every mod's shared Lua before any mod's client Lua, and the mods in their load order, so from
-- here on every Events.X.Add of every other mod goes through the Add below: the handler is
-- wrapped in one that clocks it, keyed by the file and first line of the function.
--
-- The game gives Lua one clock, in milliseconds (getTimestampMs). Most handlers take far less;
-- a call that straddles a millisecond tick counts 1 and one that does not counts 0, so over
-- thousands of calls the sum is the real time spent (the chance of straddling a tick is the
-- fraction of a millisecond the call takes).
--
-- Every few seconds the totals go to Zomboid/Lua/pz_profile.json, which the Studio reads.

if PZStudioProfiler then return end

local now = getTimestampMs
local fileOf = getFilenameOfClosure
local lineOf = getFirstLineOfClosure

PZStudioProfiler = {
    version = 1,
    since = now(),
    handlers = {},   -- key -> { file, line, event, ms, calls, worst }
    order = {},      -- keys in the order first seen, to write a stable file
    ticks = 0,
    wrapped = 0,
}
local P = PZStudioProfiler

-- Where a function was written, or nil for one the game made (a Java function, say).
local function whereOf(fn)
    local ok, file = pcall(fileOf, fn)
    if not ok or not file then return nil end
    local okLine, line = pcall(lineOf, fn)
    return file, (okLine and line) or 0
end

local function statFor(event, file, line)
    local key = event .. "|" .. file .. "|" .. tostring(line)
    local s = P.handlers[key]
    if not s then
        s = { file = file, line = line, event = event, ms = 0, calls = 0, worst = 0 }
        P.handlers[key] = s
        table.insert(P.order, key)
    end
    return s
end

-- A mod that wraps other mods' handlers before adding them (the Studio's own Polyfills does,
-- in a pcall) registers wrapper -> inner function here, so the time goes to the inner one's mod.
PZStudioInnerOf = PZStudioInnerOf or {}

local function wrap(event, fn)
    local file, line = whereOf(PZStudioInnerOf[fn] or fn)
    if not file then return nil end
    local s = statFor(event, file, line)
    P.wrapped = P.wrapped + 1
    return function(...)
        local t = now()
        fn(...)
        local d = now() - t
        s.ms = s.ms + d
        s.calls = s.calls + 1
        if d > s.worst then s.worst = d end
    end
end

-- Each event's Add and Remove, rerouted through a wrapper per function. Remove finds the wrapper
-- of the function it is given, so a mod that takes its handler out still does.
local function hook(event, ev)
    local add, remove = ev.Add, ev.Remove
    if type(add) ~= "function" or type(remove) ~= "function" then return end
    local wrappers = {}
    ev.Add = function(fn)
        if type(fn) ~= "function" then return add(fn) end
        local w = wrappers[fn]
        if not w then
            w = wrap(event, fn)
            if not w then return add(fn) end
            wrappers[fn] = w
        end
        return add(w)
    end
    ev.Remove = function(fn)
        return remove(wrappers[fn] or fn)
    end
    -- The original, for this file's own handlers, which are not measured.
    ev.PZStudioRawAdd = add
end

for name, ev in pairs(Events) do
    if type(ev) == "table" then hook(name, ev) end
end

-- ---------------------------------------------------------------- the file the Studio reads

local function quote(s)
    s = tostring(s):gsub("\\", "\\\\"):gsub("\"", "\\\"")
    return "\"" .. s .. "\""
end

function P.write()
    local w = getFileWriter("pz_profile.json", true, false)
    if not w then return end
    local t = now()
    w:write("{\"version\":" .. P.version
        .. ",\"since\":" .. string.format("%d", P.since)
        .. ",\"now\":" .. string.format("%d", t)
        .. ",\"in_game\":" .. tostring(P.inGame == true)
        .. ",\"ticks\":" .. P.ticks
        .. ",\"handlers\":[")
    local first = true
    for _, key in ipairs(P.order) do
        local s = P.handlers[key]
        if s.calls > 0 then
            w:write((first and "" or ",")
                .. "{\"file\":" .. quote(s.file)
                .. ",\"line\":" .. s.line
                .. ",\"event\":" .. quote(s.event)
                .. ",\"ms\":" .. string.format("%d", s.ms)
                .. ",\"calls\":" .. s.calls
                .. ",\"worst\":" .. string.format("%d", s.worst) .. "}")
            first = false
        end
    end
    w:write("]}")
    w:close()
end

-- Starts the count again: what the main menu cost is not what playing costs.
function P.reset(inGame)
    for _, s in pairs(P.handlers) do
        s.ms, s.calls, s.worst = 0, 0, 0
    end
    P.since = now()
    P.ticks = 0
    P.inGame = inGame
end

local lastWrite = now()
local function everyFrame()
    if P.inGame then P.ticks = P.ticks + 1 end
    local t = now()
    if t - lastWrite >= 5000 then
        lastWrite = t
        P.write()
    end
end

-- Registered with the game's own Add, so the profiler does not measure itself.
Events.OnFETick.PZStudioRawAdd(everyFrame)
Events.OnTickEvenPaused.PZStudioRawAdd(everyFrame)
Events.OnGameStart.PZStudioRawAdd(function() P.reset(true); P.write() end)
