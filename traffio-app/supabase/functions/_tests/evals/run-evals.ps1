# Roda os evals de modelo real usando a MESMA chave da produção: a que o
# painel Master grava em master_config (ANTHROPIC_API_KEY). A chave nunca é
# impressa nem gravada em disco — vive só no ambiente deste processo.
#
# Uso (de qualquer diretório):
#   .\run-evals.ps1              # run.ts + conversation.ts
#   .\run-evals.ps1 run          # só cenários de turno único
#   .\run-evals.ps1 conversation # só conversas multi-turno
param([ValidateSet("all", "run", "conversation")][string]$Suite = "all")

$functionsDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$appDir = Resolve-Path (Join-Path $functionsDir "..\..")

$loadedHere = $false
if (-not $env:ANTHROPIC_API_KEY) {
    $loadedHere = $true
    Push-Location $appDir
    try {
        $raw = (npx supabase db query --linked "select value from master_config where key = 'ANTHROPIC_API_KEY'" 2>$null) -join "`n"
    } finally {
        Pop-Location
    }
    if ($raw -match '"value"\s*:\s*"([^"]+)"') {
        $env:ANTHROPIC_API_KEY = $Matches[1].Trim()
    }
    $raw = $null
    if (-not $env:ANTHROPIC_API_KEY) {
        Write-Error "ANTHROPIC_API_KEY nao encontrada em master_config (painel Master -> Intelligence) e nao definida no ambiente."
        exit 1
    }
    Write-Host "Chave carregada do painel Master (master_config)."
}

$suites = if ($Suite -eq "all") { @("run", "conversation") } else { @($Suite) }
$failed = 0
Push-Location $functionsDir
try {
    foreach ($s in $suites) {
        Write-Host "`n=== evals/$s.ts ===" -ForegroundColor Cyan
        npx deno run -A "_tests/evals/$s.ts"
        if ($LASTEXITCODE -ne 0) { $failed++ }
    }
} finally {
    Pop-Location
    if ($loadedHere) { Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue }
}
exit $failed
