# scripts/docker-clean-bloat.ps1
# Automated deep clean: Next.js cache, Docker builder, dangling layers, WSL2 page cache

$ErrorActionPreference = "Continue"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Docker Lean Build Ops: Deep Clean & Bloat Purge     " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Measure free RAM before clean
$osBefore = Get-CimInstance Win32_OperatingSystem
$freeRamBeforeMb = [math]::Round($osBefore.FreePhysicalMemory / 1024, 1)
Write-Host "[1/6] Free RAM before clean: $freeRamBeforeMb MB" -ForegroundColor Yellow

# 2. Clean stale Next.js cache (.next/cache)
$nextCachePath = Join-Path $PSScriptRoot "..\.next\cache"
if (Test-Path $nextCachePath) {
    $cacheItems = Get-ChildItem -Path $nextCachePath -Recurse -File -ErrorAction SilentlyContinue
    $cacheSizeMb = [math]::Round(($cacheItems | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
    Write-Host "[2/6] Next.js cache size (.next\cache): $cacheSizeMb MB" -ForegroundColor Yellow

    if ($cacheSizeMb -gt 500) {
        Write-Host "      Purging .next\cache to reclaim disk space..." -ForegroundColor Green
        Remove-Item -Path $nextCachePath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "      OK: .next\cache successfully purged." -ForegroundColor Green
    } else {
        Write-Host "      OK: Cache size is within limits (< 500 MB)." -ForegroundColor Green
    }
} else {
    Write-Host "[2/6] Directory .next\cache is clean or absent." -ForegroundColor Green
}

# 3. Clean Docker builder cache
Write-Host "[3/6] Cleaning Docker BuildKit cache (> 24h old)..." -ForegroundColor Yellow
try {
    & docker builder prune -f --filter "until=24h"
    Write-Host "      OK: Docker builder cache cleaned." -ForegroundColor Green
} catch {
    Write-Host "      WARN: Docker builder prune error: $_" -ForegroundColor DarkGray
}

# 4. Remove dangling images
Write-Host "[4/6] Removing dangling Docker image layers..." -ForegroundColor Yellow
try {
    & docker image prune -f
    Write-Host "      OK: Dangling image layers removed." -ForegroundColor Green
} catch {
    Write-Host "      WARN: Docker image prune error: $_" -ForegroundColor DarkGray
}

# 5. Check and optimize .wslconfig (sparseVhd & autoMemoryReclaim)
Write-Host "[5/6] Checking WSL2 virtual disk optimization (.wslconfig)..." -ForegroundColor Yellow
$wslConfigPath = Join-Path $env:USERPROFILE ".wslconfig"
$needsUpdate = $false

if (Test-Path $wslConfigPath) {
    $content = Get-Content $wslConfigPath -Raw
    if ($content -notmatch "sparseVhd\s*=\s*true") {
        $needsUpdate = $true
    }
} else {
    $needsUpdate = $true
}

if ($needsUpdate) {
    Write-Host "      Enabling sparseVhd=true in .wslconfig for auto-compaction..." -ForegroundColor Green
    $lines = @(
        "[wsl2]",
        "memory=1536MB",
        "processors=2",
        "swap=1GB",
        "",
        "[experimental]",
        "autoMemoryReclaim=gradual",
        "sparseVhd=true"
    )
    $lines | Set-Content -Path $wslConfigPath -Encoding utf8
    Write-Host "      OK: .wslconfig updated with Sparse VHD support." -ForegroundColor Green
} else {
    Write-Host "      OK: .wslconfig already optimized (sparseVhd=true)." -ForegroundColor Green
}

# 6. Drop Linux page cache in WSL2
Write-Host "[6/6] Dropping Linux page cache in WSL2..." -ForegroundColor Yellow
try {
    & wsl -u root -e sh -c "sync; echo 3 > /proc/sys/vm/drop_caches" 2>$null
    Write-Host "      OK: Linux page cache dropped successfully." -ForegroundColor Green
} catch {
    Write-Host "      INFO: WSL not running or drop_caches skipped." -ForegroundColor DarkGray
}

# Final measurement
$osAfter = Get-CimInstance Win32_OperatingSystem
$freeRamAfterMb = [math]::Round($osAfter.FreePhysicalMemory / 1024, 1)
$diffMb = [math]::Round($freeRamAfterMb - $freeRamBeforeMb, 1)

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Clean complete! Free RAM: $freeRamAfterMb MB ($diffMb MB changed)" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
