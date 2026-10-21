# Servers

The Servers screen has two sides: **Join a server**, to find a multiplayer server and play on it, and **Host a server**, to run your own dedicated server from this PC. Switch between them with the two buttons at the top.

## Join a server: finding one

Under **Public servers**, press **Find servers**. The Studio asks Steam for every Project Zomboid server, the way the game's own browser does, through the Steam client running on this PC (no key needed; Steam shows you as in Project Zomboid while it asks). Servers appear as they answer; all of them take about a minute and a half. **Stop** ends the search, **Search again** starts over.

Narrow the list with the box (**Name or map**) and the filters: **Only my build**, **With players**, **Not full**, **No password**, **Modded and vanilla** / **Modded** / **Vanilla**, and sort by **Most players**, **Lowest ping** or **Name**. Right-click a server for a menu: **See what it says**, **Join**, **Star it**, **Copy the address** and making a profile with its mods.

**My servers** holds the servers you star (**Starred**) and the ones you joined from here (**Joined from here**). To add a private or a friend's server, type its address under **Add a server by its address** (`ip:port`; port 16261 if left out), an optional name and the password, and press **Add**. The password is kept in Windows' credential store, never in a file.

## Join a server: joining

1. Click a server. The panel on the right shows its build, whether it is open or whitelist only, its last wipe and its mods. Each mod is coloured: **Installed and on**, **Installed**, or **The game downloads it**.
2. If the server runs another build than yours, a warning says so: the game will not let you in until both match (Steam beta branch).
3. Type the server password if it has one, and tick **Remember the password** to keep it.
4. Close the game if it is open, and press **Join**.

The game starts on this server's connect screen with the server password filled in. There you type your account user name and password for that server (a new name makes a new account). The game downloads the server's mods and uses them only there: your own mod list and profiles stay as they are.

## Making a profile for a server

A server only announces its first few mods (Steam cuts the list). After you join it once from here, the Studio knows the full list, and the button becomes **Make a profile with these N mods**. Before that, **Make a profile with the N mods it announces** uses the partial list. The profile is named "Server: (name)" and keeps the server's order. Mods not installed now are pointed out before the profile is made.

## Host a server: the server list

On the left, **Server Configs (.ini)** lists the server configurations in `Zomboid/Server`, with their mod and Workshop counts and **Running** for the one that is up. Type a name and press **Create** to make a new one, or **⚡ Create default configuration (servertest.ini)** when there is none. The bin deletes a configuration from disk (you are asked first). Pick one to see its tabs. The top banner shows **ONLINE** or **OFFLINE**, **Share Invite** (copies an invite text with the name, port, max players, password and mod count; you fill in your public IP and forward the port) and a button to reload the server files.

## Host & Launcher

- **Memory (-Xmx)**: 4, 8, 12 or 16 GB for the server.
- **Admin Password**: sets the password of the `admin` account when the server starts.
- **Auth & Network**: **Steam Enabled** or **NoSteam (LAN)**.
- **Launch Dedicated Server (name)** starts it in its own console window. While it runs, **Stop Dedicated Server** stops the server the Studio started (never other Java programs), and **Restart** stops and starts it again.

## Mods & Sync

This compares your active mods with what the server's `.ini` has. A server does not read your mod list: it needs three lines in its `.ini`, `Mods=`, `WorkshopItems=` and `Map=`, and all three must agree or the server quietly plays without the mods. The Studio checks them and lists what is wrong (a mod never downloaded, an item never loaded, a map ignored).

**Write my list into this server (Mods, WorkshopItems and Map)** writes all three lines from your active mods, in load order, and keeps every other setting as it was. The previous file is saved in `Zomboid/PZModStudio_Backups`.

A PZ Mod Studio package (`Z_PZModStudio_*`) that is on goes into `Mods=` too, but it is a local mod, not a Workshop item: the server on this PC has it, players do not get it by downloading, and the game does not let them join without it. Share the package with them, or switch it off before you write the list.

**Multiplayer check of the active mods** (**Check**) lists calls that a mod's client code makes directly where the game routes them through the server; in multiplayer they change only that player's world, or are refused.

## Players

**Connected Players** lists who is online, read from the server's own log, with role, ping, health and position. Kicking, banning and messaging need the server console; the Studio does not do them.

## Quick .ini

Edit the main settings and press **Save Settings to .ini**: **Public Server Name**, **Server Password (Join)** (blank for an open server), **Admin Password (-adminpassword)**, **Max Players**, **Default Port**, **Public Description**, **PVP Combat** and **Pause When Empty**.

## Discord

A Discord webhook lets the server post to one channel: when it is up, stopped, crashed or back after a restart, who joins and leaves, and when its Workshop mods were updated and it needs a restart. No one is pinged.

1. In Discord, open the channel's settings, Integrations, Webhooks, New Webhook, and copy its URL.
2. Paste it under **Webhook address** and press **Save**. It is kept in Windows Credential Manager and never shown again.
3. Press **Send a test** and look at the channel.
4. Tick **Post this server's news to the channel** and choose the events: **Up, stopped and crashed**, **Players joining and leaving**, **Restarts**, **Workshop mods waiting for a restart**.

**Forget it** removes the address from this PC. Each server has its own webhook.

## Good to know

- Posting to Discord only happens while PZ Mod Studio is open and hosting the server.
- Launching a server needs the game folder set in **App Settings**.
- Joining starts the game: close it first.
