$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $rootDir
$out = Join-Path $rootDir 'dist/windows'
$target = Join-Path $rootDir 'src-tauri/target/release'
$name = 'StickerForge-Desktop-0.4.0-x64'
$portable = Join-Path $out 'portable'
New-Item -ItemType Directory -Force $out, $portable | Out-Null
Copy-Item -LiteralPath (Join-Path $target 'bundle/nsis/StickerForge Desktop_0.4.0_x64-setup.exe') -Destination (Join-Path $out "$name-setup.exe") -Force
Copy-Item -LiteralPath (Join-Path $target 'bundle/msi/StickerForge Desktop_0.4.0_x64_en-US.msi') -Destination (Join-Path $out "$name.msi") -Force
Copy-Item -LiteralPath (Join-Path $target 'stickerforge.exe') -Destination $portable -Force
Copy-Item -LiteralPath (Join-Path $rootDir 'src-tauri/engine') -Destination $portable -Recurse -Force
$zip = Join-Path $out "$name-portable.zip"
tar.exe -a -cf $zip -C $portable stickerforge.exe engine
$files = @("$name-setup.exe", "$name.msi", "$name-portable.zip")
$files | ForEach-Object {
  $hash = Get-FileHash -LiteralPath (Join-Path $out $_) -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $_"
} | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
