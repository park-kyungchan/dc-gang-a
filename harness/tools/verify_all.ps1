# Whole-Lens Monorepo All-in-One Portable Verifier
# Usage: powershell -ExecutionPolicy Bypass -File harness/tools/verify_all.ps1

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Refresh PATH from registry so newly installed Git/Node/Python are always found
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";$env:Path"

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $repoRoot

$pythonExe = if (Test-Path "$repoRoot\.venv\Scripts\python.exe") { "$repoRoot\.venv\Scripts\python.exe" } else { "python" }

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "🚀 Whole-Lens Monorepo Portable Verification Suite" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot" -ForegroundColor DarkGray
Write-Host "Python:     $pythonExe" -ForegroundColor DarkGray
Write-Host "====================================================" -ForegroundColor Cyan

$allPassed = $true

function Run-Step($name, $command) {
    Write-Host "`n[RUN] $name..." -ForegroundColor Yellow
    try {
        & $command
        if ($LASTEXITCODE -eq 0 -or $? -eq $true) {
            Write-Host "  -> PASS: $name" -ForegroundColor Green
        } else {
            Write-Host "  -> FAIL: $name (ExitCode: $LASTEXITCODE)" -ForegroundColor Red
            $script:allPassed = $false
        }
    } catch {
        Write-Host "  -> ERROR: $name - $_" -ForegroundColor Red
        $script:allPassed = $false
    }
}

Run-Step "1. Workbench v2 Unit Tests (17 tests)" { & $pythonExe -B -m unittest discover -s workbench_v2/tests -v }
Run-Step "2. Backend Map Validation (52 operations)" { & $pythonExe -B research/validate_backend_map.py }
Run-Step "3. Source Imports Provenance Hash Check" { & $pythonExe -B harness/tools/verify_source_imports.py }
Run-Step "4. Pre-Push Security & Boundary Audit" { & $pythonExe -B harness/tools/prepush_audit.py }
Run-Step "5. 14:00 Whole-Class UI 12-Student Check" { node review/whole_lens_1400.test.js }

Write-Host "`n====================================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "🎉 ALL PORTABLE GATES PASSED! (Ready for next task)" -ForegroundColor Green
} else {
    Write-Host "⚠️ SOME CHECKS FAILED. Please review above output." -ForegroundColor Red
    exit 1
}
Write-Host "====================================================" -ForegroundColor Cyan
