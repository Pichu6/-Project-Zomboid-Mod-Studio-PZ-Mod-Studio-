# 06 — Persistencia ModData, Red y Anti-Cheat

Project Zomboid implementa un modelo de red cliente-servidor semi-autoritativo. Para mantener un rendimiento fluido con miles de zombis en pantalla, una parte considerable de la simulación física se delega al cliente local. Esto exige un manejo riguroso de la persistencia de datos (`ModData`) y protocolos de sincronización de red.

---

## 1. Niveles de Persistencia con `ModData`

`ModData` es el mecanismo nativo para almacenar tablas de datos arbitrarias que se serializan y guardan en el archivo de guardado (`savegame`):

```
┌─────────────────────────────────────────────────────────────┐
│                       NIVELES DE MODDATA                    │
├───────────────────┬───────────────────┬─────────────────────┤
│   Objeto / Item   │      Jugador      │   Mundo / Global    │
│ item:getModData() │player:getModData()│ModData.getOrCreate()│
│ Guarda datos en   │ Guarda datos en   │ Guarda datos en     │
│ el ítem serializ. │ el perfil jugador │ map_meta.bin        │
└───────────────────┴───────────────────┴─────────────────────┘
```

### Ejemplo de Uso:
```lua
-- Asignar metadatos a un objeto
local modData = item:getModData()
modData.CustomDurability = 150
modData.OwnerUUID = player:getUsername()
```

---

## 2. El Gran Desafío Multijugador: `ModData` NO se Replica Automáticamente

⚠️ **Error Común:** Modificar `item:getModData()` o `player:getModData()` en un script de cliente (`media/lua/client/`) solo alterará la memoria local de ese jugador. El servidor y los demás jugadores **no verán el cambio**, provocando desincronizaciones silenciosas y sobreescrituras al recargar la partida.

### El Patrón Autoritativo de Comunicación por Red:

```
┌──────────────────┐                               ┌──────────────────┐
│     CLIENTE      │                               │     SERVIDOR     │
└────────┬─────────┘                               └────────┬─────────┘
         │                                                  │
         │  1. sendClientCommand("MyMod", "DoAction", args) │
         ├─────────────────────────────────────────────────►│
         │                                                  │
         │                                                  │ 2. Events.OnClientCommand
         │                                                  │    - Valida permisos/distancia
         │                                                  │    - Modifica ModData real
         │                                                  │    - Guarda estado
         │                                                  │
         │  3. sendServerCommand("MyMod", "SyncState", data)│
         │◄─────────────────────────────────────────────────┤
         │                                                  │
         │ 4. Events.OnServerCommand                        │
         │    - Actualiza UI y variables locales            │
         ▼                                                  ▼
```

### Código de Implementación:

#### En el Cliente (`media/lua/client/MyMod_Client.lua`):
```lua
-- Enviar solicitud al servidor (solo datos primitivos: IDs, números, texto)
local args = { targetSquareX = 10520, targetSquareY = 9412, targetZ = 0 }
sendClientCommand(player, "MyModModule", "RequestRepair", args)

-- Recibir respuesta del servidor
local function OnServerCommand(module, command, args)
    if module == "MyModModule" and command == "SyncRepairSuccess" then
        -- Actualizar interfaz local
        HaloTextHelper.addText(getPlayer(), "¡Reparación completada!", 0, 255, 0)
    end
end
Events.OnServerCommand.Add(OnServerCommand)
```

#### En el Servidor (`media/lua/server/MyMod_Server.lua`):
```lua
local function OnClientCommand(module, command, player, args)
    if module == "MyModModule" and command == "RequestRepair" then
        -- 1. Validar distancia y recursos en el servidor
        local square = getCell():getGridSquare(args.targetSquareX, args.targetSquareY, args.targetZ)
        if square and player:DistTo(square:getX(), square:getY()) < 4 then
            -- 2. Modificar ModData con autoridad
            local modData = square:getModData()
            modData.isRepaired = true
            
            -- 3. Notificar a todos los clientes cercanos
            sendServerCommand("MyModModule", "SyncRepairSuccess", { success = true })
        end
    end
end
Events.OnClientCommand.Add(OnClientCommand)
```

### 🚫 Prohibición de Serialización de Objetos Java:
Nunca pase instancias directas de `InventoryItem`, `IsoPlayer` o `IsoGridSquare` en la tabla `args` de `sendClientCommand`. Java no puede serializarlos a través del canal de red. Pase siempre coordenadas numéricas (`x, y, z`), el ID del ítem (`item:getID()`) o el índice del jugador.

---

## 3. Seguridad, Anti-Cheat y Atestación Criptográfica (CHAP)

Project Zomboid implementa mecanismos defensivos basados en el protocolo **CHAP (Challenge-Handshake Authentication Protocol)** para prevenir inyecciones de código:

1. **Emisión de Reto (`Server Challenge`):** El servidor envía cíclicamente sondas con un número único de alta entropía (`nonce`) y una firma encriptada.
2. **Canarios de Integridad en Memoria:** El cliente escanea las tablas Kahlua en memoria para verificar que las funciones de combate, salud y movimiento no hayan sido reemplazadas por wrappers de trampas o anuladas.
3. **Paquete de Atestación Hexadecimal:** El cliente responde con un payload comprimido (`version + requestId + nonce + protectedFlags + luaSurfaceMask + signature`). Si el hash o la máscara superficial no coinciden, el servidor desconecta al cliente inmediatamente por infracción de integridad.
