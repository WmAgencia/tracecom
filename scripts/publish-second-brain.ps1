# Publica o conhecimento do vault Obsidian (TraceCom/) para producao:
#  1) push vault -> relay/knowledge/TraceCom (somente notas de conhecimento; nunca journal/memoria)
#  2) commit + push no GitHub quando houver mudanca
#  3) deploy do relay na Railway
#
# Uso:
#   powershell -File scripts/publish-second-brain.ps1            # publica se houver mudanca
#   powershell -File scripts/publish-second-brain.ps1 -Force     # deploy mesmo sem mudanca
#   powershell -File scripts/publish-second-brain.ps1 -NoDeploy  # so push local (sem deploy)
param(
  [switch]$Force,
  [switch]$NoDeploy
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = (Get-Command node -ErrorAction SilentlyContinue) | Select-Object -First 1
$nodePath = if ($node) { $node.Source } else { "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $nodePath)) { throw "node nao encontrado" }

Write-Output "[1/3] Push do vault para relay/knowledge/TraceCom..."
$output = & $nodePath "scripts\second-brain-sync.mjs" --push 2>&1 | Out-String
Write-Output $output
if ($LASTEXITCODE -ne 0) { throw "second-brain-sync falhou" }
$pushed = 0
$match = [regex]::Match($output, '"pushed":\s*(\d+)')
if ($match.Success) { $pushed = [int]$match.Groups[1].Value }
Write-Output "Notas publicadas do vault: $pushed"

if ($pushed -eq 0 -and -not $Force) {
  Write-Output "Nada novo no vault; deploy nao necessario (use -Force para forcar)."
  exit 0
}

Write-Output "[2/3] Commit/push do conhecimento no GitHub (quando houver git)..."
$git = (Get-Command git -ErrorAction SilentlyContinue) | Select-Object -First 1
if ($git) {
  & $git.Source add relay/knowledge
  $staged = & $git.Source diff --cached --name-only
  if ($staged) {
    & $git.Source -c user.name=WmAgencia -c user.email=wmagencia@users.noreply.github.com commit -m "knowledge(vault): publica notas do Segundo Cerebro para producao (RAG)" | Out-Null
    & $git.Source push origin main
    Write-Output "Commit enviado: $($staged.Count) arquivo(s)."
  } else {
    Write-Output "Sem alteracoes para commitar."
  }
} else {
  Write-Warning "git nao encontrado no PATH; deploy seguira com as alteracoes locais (sem commit)."
}

if ($NoDeploy) { Write-Output "NoDeploy: deploy do relay nao executado."; exit 0 }

Write-Output "[3/3] Deploy do relay (Railway)..."
Push-Location (Join-Path $root "relay")
try {
  npx --yes @railway/cli@latest up --service tracecom-live-relay --environment production --detach
} finally { Pop-Location }
Write-Output "Publicado. O relay reindexara a biblioteca ao reiniciar."
