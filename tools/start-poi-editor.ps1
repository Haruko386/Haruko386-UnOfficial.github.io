$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 "$PSScriptRoot\poi_editor.py"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    python "$PSScriptRoot\poi_editor.py"
} else {
    Write-Error "please install Python 3 and add it to your PATH"
}
