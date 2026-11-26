$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $rootDir
$nodeVersion = '24.19.0'
$archiveName = "node-v$nodeVersion-win-x64"
$digest = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'
$cache = Join-Path $rootDir '.local'
$engine = Join-Path $rootDir 'src-tauri/engine'
New-Item -ItemType Directory -Force $cache, $engine | Out-Null
$archive = Join-Path $cache "$archiveName.zip"
if (-not (Test-Path -LiteralPath $archive)) {
  curl.exe -fSL --retry 2 "https://nodejs.org/dist/v$nodeVersion/$archiveName.zip" -o $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $digest) {
  throw "Node.js archive SHA-256 mismatch: $archive"
}
tar.exe -xf $archive -C $cache "$archiveName/node.exe" "$archiveName/LICENSE"
Copy-Item -LiteralPath (Join-Path $cache "$archiveName/node.exe") -Destination $engine
Copy-Item -LiteralPath (Join-Path $cache "$archiveName/LICENSE") -Destination (Join-Path $engine 'Node-LICENSE.txt')
Copy-Item -Path desktop, src -Destination $engine -Recurse -Force
$manifest = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json -AsHashtable
$keep = @('@whiskeysockets/baileys', 'pino', 'qrcode', 'qrcode-terminal')
foreach ($name in @($manifest.dependencies.Keys)) {
  if ($name -notin $keep) { $manifest.dependencies.Remove($name) }
}
$manifest.Remove('devDependencies')
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $engine 'package.json') -Encoding utf8NoBOM
Copy-Item -LiteralPath package-lock.json -Destination $engine
npm.cmd ci --prefix $engine --omit=dev --ignore-scripts --no-fund
Copy-Item -LiteralPath LICENSE, NOTICE.md, THIRD-PARTY-LICENSES -Destination $engine -Force
$notices = Join-Path $engine 'notices'
New-Item -ItemType Directory -Force $notices | Out-Null
foreach ($package in @('react', 'react-dom', 'lucide-react', '@tauri-apps/api', '@tauri-apps/plugin-dialog')) {
  $packageDir = Join-Path $rootDir "node_modules/$package"
  $target = Join-Path $notices ($package -replace '[/@]', '-')
  New-Item -ItemType Directory -Force $target | Out-Null
  Get-ChildItem -LiteralPath $packageDir -File | Where-Object Name -Match '^(LICENSE|COPYING|NOTICE)' | Copy-Item -Destination $target
}
$metadata = cargo metadata --manifest-path src-tauri/Cargo.toml --locked --filter-platform x86_64-pc-windows-msvc --format-version 1 | ConvertFrom-Json
foreach ($package in $metadata.packages | Where-Object source) {
  $target = Join-Path $notices "$($package.name)-$($package.version)"
  New-Item -ItemType Directory -Force $target | Out-Null
  Get-ChildItem -LiteralPath (Split-Path -Parent $package.manifest_path) -File | Where-Object Name -Match '^(LICENSE|COPYING|NOTICE|COPYRIGHT)' | Copy-Item -Destination $target
}
