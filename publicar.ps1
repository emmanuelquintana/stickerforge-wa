$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Check { if ($LASTEXITCODE -ne 0) { throw "Fallo el comando anterior: $LASTEXITCODE" } }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Instala GitHub CLI: winget install GitHub.cli' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Instala Git: winget install Git.Git' }
gh auth status; Check
$owner = gh api user --jq .login; Check
$repo = "$owner/stickerforge-wa"
Write-Host "Se publicara el codigo fuente en https://github.com/$repo (PUBLICO). No incluye credenciales ni sesiones."
if ((Read-Host 'Escribe PUBLICAR para continuar') -cne 'PUBLICAR') { return }
if (Test-Path .git) { throw 'Esta carpeta ya contiene un repositorio Git; usa una extraccion limpia para evitar tocar otro proyecto.' }
git init -b main; Check
git add -- .gitignore .env.example .github LICENSE NOTICE.md README.md package.json src test launcher scripts iniciar.cmd publicar.ps1; Check
git commit -m 'Initial public release: StickerForge WA 0.3.0'; Check
gh repo create $repo --public --source . --remote origin --push; Check
git tag v0.3.0; Check
git push origin v0.3.0; Check
Write-Host "Repositorio: https://github.com/$repo"
Write-Host "Compilacion y release: https://github.com/$repo/actions"
