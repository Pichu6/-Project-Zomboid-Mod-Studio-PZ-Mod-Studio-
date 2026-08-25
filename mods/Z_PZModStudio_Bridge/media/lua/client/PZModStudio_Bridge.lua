-- =============================================================================
-- PZ Mod Studio — Live Companion Bridge Mod
-- Allows AI Agents & Developer Tools to execute in-game commands, spawn/equip items,
-- evaluate dynamic Lua, broadcast server alerts, and stream player telemetry.
-- =============================================================================

local Bridge = {}
Bridge.tickCount = 0
Bridge.RESP_FILE = "pz_ipc_resp.json"
Bridge.PLAYERS_FILE = "pz_server_players.json"
Bridge.QUEUE_FILES = { "pz_ipc_queue.json", "pz_server_commands.json" }

local function safeHaloText(player, text, r, g, b)
    if not player or not text then return end
    pcall(function()
        if player.setHaloNote then
            player:setHaloNote(tostring(text), r or 255, g or 215, b or 0, 350)
        elseif HaloTextHelper and HaloTextHelper.addText then
            HaloTextHelper.addText(player, tostring(text))
        end
    end)
end

function Bridge.UpdatePlayersState(player)
    if not player then return end
    local username = player:getUsername() or "Player"
    local x = math.floor(player:getX() or 0)
    local y = math.floor(player:getY() or 0)
    local z = math.floor(player:getZ() or 0)
    local health = 1.0
    if player.getBodyDamage and player:getBodyDamage() then
        health = (player:getBodyDamage():getOverallBodyHealth() or 100) / 100
    end
    local isGod = false
    if player.isGodMod then
        isGod = player:isGodMod() == true
    end
    local role = "User"
    if player.getAccessLevel then
        local acc = player:getAccessLevel()
        if acc and acc ~= "" and acc ~= "none" then
            role = acc
        end
    end
    local steamId = ""
    if player.getSteamID then
        local s = player:getSteamID()
        if s then steamId = tostring(s) end
    end
    local ping = 35
    if player.getPing then
        ping = player:getPing() or 35
    end

    local jsonStr = string.format(
        '[{"username":"%s","role":"%s","ping":%d,"health":%.2f,"is_godmode":%s,"x":%d,"y":%d,"z":%d,"steam_id":"%s"}]',
        username:gsub('"', '\\"'),
        role:gsub('"', '\\"'),
        ping,
        health,
        tostring(isGod),
        x,
        y,
        z,
        steamId:gsub('"', '\\"')
    )

    local writer = getFileWriter(Bridge.PLAYERS_FILE, true, false)
    if writer then
        writer:write(jsonStr)
        writer:close()
    end
end

function Bridge.ProcessQueueFile(queueFile, player)
    local reader = getFileReader(queueFile, false)
    if not reader then return end

    local raw = ""
    local line = reader:readLine()
    while line do
        raw = raw .. line
        line = reader:readLine()
    end
    reader:close()

    if raw ~= "" and raw ~= "{}" and not raw:match("^%s*$") then
        -- Immediately clear queue file to prevent repeated execution on error
        local writer = getFileWriter(queueFile, true, false)
        if writer then
            writer:write("{}")
            writer:close()
        end

        local success, err = pcall(function()
            Bridge.ExecuteCommand(raw, player)
        end)

        -- Write response
        local respWriter = getFileWriter(Bridge.RESP_FILE, true, false)
        if respWriter then
            if success then
                respWriter:write('{"status": "ok", "timestamp": "' .. tostring(getTimeInMillis()) .. '"}')
            else
                respWriter:write('{"status": "error", "message": "' .. tostring(err):gsub('"', '\\"') .. '"}')
            end
            respWriter:close()
        end
    end
end

function Bridge.OnTick()
    Bridge.tickCount = Bridge.tickCount + 1

    local player = getPlayer()
    if not player then return end

    -- Update live players JSON every 30 frames (~0.5 sec)
    if Bridge.tickCount % 30 == 0 then
        pcall(function() Bridge.UpdatePlayersState(player) end)
    end

    -- Check for commands every 10 frames (~0.15s)
    if Bridge.tickCount % 10 ~= 0 then return end

    for _, qFile in ipairs(Bridge.QUEUE_FILES) do
        Bridge.ProcessQueueFile(qFile, player)
    end
end

function Bridge.ExecuteCommand(jsonStr, player)
    local actionMatch = jsonStr:match('"action"%s*:%s*"([^"]+)"')
    if not actionMatch then return end

    if actionMatch == "broadcast" then
        local msgMatch = jsonStr:match('"message"%s*:%s*"([^"]+)"')
        if msgMatch then
            local unescaped = msgMatch:gsub('\\n', ' '):gsub('\\"', '"')
            safeHaloText(player, "[SERVER]: " .. unescaped, 255, 69, 0)
            pcall(function()
                if processSayMessage then
                    processSayMessage("[ANNOUNCEMENT]: " .. unescaped)
                elseif ISChat and ISChat.addLineToChat then
                    ISChat.addLineToChat("[ANNOUNCEMENT]: " .. unescaped, 0)
                end
            end)
            print("[PZModStudio_Bridge] Broadcast received: " .. unescaped)
        end
    elseif actionMatch == "kick" then
        local targetMatch = jsonStr:match('"target"%s*:%s*"([^"]+)"')
        local reasonMatch = jsonStr:match('"reason"%s*:%s*"([^"]+)"') or "Kicked by admin"
        if not targetMatch or targetMatch == player:getUsername() then
            safeHaloText(player, "YOU HAVE BEEN KICKED: " .. reasonMatch, 255, 0, 0)
            pcall(function()
                if isClient() and getCore() then
                    getCore():quit()
                end
            end)
        end
    elseif actionMatch == "ban" then
        local targetMatch = jsonStr:match('"target"%s*:%s*"([^"]+)"')
        local reasonMatch = jsonStr:match('"reason"%s*:%s*"([^"]+)"') or "Banned by admin"
        if not targetMatch or targetMatch == player:getUsername() then
            safeHaloText(player, "YOU HAVE BEEN BANNED: " .. reasonMatch, 255, 0, 0)
            pcall(function()
                if isClient() and getCore() then
                    getCore():quit()
                end
            end)
        end
    elseif actionMatch == "give_item" then
        local itemMatch = jsonStr:match('"item"%s*:%s*"([^"]+)"')
        local countMatch = tonumber(jsonStr:match('"count"%s*:%s*(%d+)')) or 1
        local equipMatch = jsonStr:match('"equip"%s*:%s*true') or jsonStr:match('"equip"%s*:%s*"primary"')
        if itemMatch then
            local lastItem = nil
            for i = 1, countMatch do
                lastItem = player:getInventory():AddItem(itemMatch)
            end
            if lastItem and equipMatch then
                player:setPrimaryHandItem(lastItem)
                player:setSecondaryHandItem(lastItem)
            end
            safeHaloText(player, "Added: " .. itemMatch .. (countMatch > 1 and (" x" .. tostring(countMatch)) or ""), 0, 255, 0)
            print("[PZModStudio_Bridge] Successfully added item: " .. itemMatch)
        end
    elseif actionMatch == "eval_lua" then
        local codeMatch = jsonStr:match('"code"%s*:%s*"(.-)"%s*[,}]')
        if not codeMatch then
            codeMatch = jsonStr:match('"code"%s*:%s*"([^"]+)"')
        end
        if codeMatch then
            local unescaped = codeMatch:gsub('\\n', '\n'):gsub('\\r', ''):gsub('\\t', '\t'):gsub('\\"', '"'):gsub('\\\\', '\\')
            local func, loadErr = loadstring(unescaped)
            if func then
                local execOk, execErr = pcall(func)
                if not execOk then
                    print("[PZModStudio_Bridge] Lua runtime error in eval: " .. tostring(execErr))
                    safeHaloText(player, "Lua Error: " .. tostring(execErr), 255, 0, 0)
                else
                    safeHaloText(player, "Lua Executed", 100, 200, 255)
                end
            else
                print("[PZModStudio_Bridge] Lua syntax error in eval: " .. tostring(loadErr))
            end
        end
    elseif actionMatch == "set_godmode" or actionMatch == "godmode" then
        local current = false
        if player.isGodMod then current = player:isGodMod() == true end
        player:setGodMod(not current)
        if not current then
            safeHaloText(player, "Godmode ENABLED", 255, 215, 0)
        else
            safeHaloText(player, "Godmode DISABLED", 200, 200, 200)
        end
    elseif actionMatch == "teleport" then
        local xMatch = tonumber(jsonStr:match('"x"%s*:%s*([%d%.]+)'))
        local yMatch = tonumber(jsonStr:match('"y"%s*:%s*([%d%.]+)'))
        local zMatch = tonumber(jsonStr:match('"z"%s*:%s*([%d%.]+)')) or 0
        if xMatch and yMatch then
            player:setX(xMatch)
            player:setY(yMatch)
            player:setZ(zMatch)
            player:setLx(xMatch)
            player:setLy(yMatch)
            player:setLz(zMatch)
            safeHaloText(player, string.format("Teleported to %d, %d, %d", xMatch, yMatch, zMatch), 200, 100, 255)
        end
    end
end

Events.OnTick.Add(Bridge.OnTick)
print("[PZModStudio_Bridge] Live Companion Mod Initialized successfully!")
