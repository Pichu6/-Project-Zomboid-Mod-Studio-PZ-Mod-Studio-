# Builds Zomboid/Workshop/Z_StudioLink, the folder the game's Workshop uploader reads.
param([string]$Zomboid = (Join-Path $env:USERPROFILE "Zomboid"))
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here "..\..")
$target = Join-Path $Zomboid "Workshop\Z_StudioLink"
$mod = Join-Path $target "Contents\mods\Z_StudioLink"
New-Item -ItemType Directory -Force $target | Out-Null
# workshop.txt is kept if it is there: after the first upload it holds the item's id.
if (-not (Test-Path (Join-Path $target "workshop.txt"))) { Copy-Item (Join-Path $here "workshop.txt") $target }
Copy-Item (Join-Path $here "preview.png") $target -Force
if (Test-Path $mod) { Remove-Item -Recurse -Force $mod }
New-Item -ItemType Directory -Force (Split-Path $mod) | Out-Null
Copy-Item -Recurse (Join-Path $repo "mods\Z_StudioLink") $mod
Write-Host "Ready: $target"
