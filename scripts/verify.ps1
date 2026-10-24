param([switch]$ReviewedProjectPolicy)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    foreach ($task in @('typecheck', 'lint', 'test', 'build')) {
        Write-Host "Verifying: npm run $task"
        & npm.cmd run $task
        if ($LASTEXITCODE -ne 0) { throw "npm run $task failed: $LASTEXITCODE" }
    }
    $protected = @('public/data/', 'legacy/', 'archive/', '.coding-partner/')
    $changed = @(& git -c core.quotepath=false diff HEAD --name-only)
    if ($LASTEXITCODE -ne 0) { throw 'git diff failed' }
    $changed += @(& git -c core.quotepath=false ls-files --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
    foreach ($path in $changed) {
        foreach ($prefix in $protected) {
            if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                if ($ReviewedProjectPolicy -and $path -eq '.coding-partner/project/COMMON.md') { continue }
                throw "Protected path changed; explicit scope review required: $path"
            }
        }
        if ($path -match '(?i)\.(pdf|png|jpe?g|webp)$') {
            throw "Image/PDF change requires explicit scope review: $path"
        }
    }
    & git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed' }
    Write-Host 'PASS: typecheck, lint (TypeScript), tests, build, protected paths, diff whitespace.'
    Write-Host 'Format checker: not configured. Browser/manual verification: not included.'
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    Pop-Location
}
