#!/usr/bin/env pwsh

# Script to start all project dependencies (Artifact Registry and local emulators).
$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Project Dependencies Manager" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# --- 1. Health Checks & Auto-Start ---
Write-Host "Verifying Docker status..." -ForegroundColor Gray
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'docker' command not found. Please ensure Docker is installed." -ForegroundColor Red
    exit 1
}

$dockerRunning = $false
& docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker engine is not running. Attempting to start Docker Desktop..." -ForegroundColor Yellow
    
    $dockerPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerPath) {
        Start-Process $dockerPath
        Write-Host "Waiting for Docker engine to initialize (this may take up to a minute)..." -ForegroundColor Gray
        
        $maxRetries = 30
        $retryCount = 0
        while ($retryCount -lt $maxRetries) {
            Start-Sleep -Seconds 2
            & docker info > $null 2>&1
            if ($LASTEXITCODE -eq 0) {
                $dockerRunning = $true
                break
            }
            $retryCount++
            Write-Host "." -NoNewline -ForegroundColor Gray
        }
        Write-Host ""
    }
}
else {
    $dockerRunning = $true
}

if (-not $dockerRunning) {
    Write-Host "Error: Docker engine is not running or failed to start. Please start Docker Desktop manually." -ForegroundColor Red
    exit 1
}
Write-Host "Docker is ready." -ForegroundColor Green

# --- 2. Find Artifact Registry ---
$PossiblePaths = @(
    (Join-Path $PSScriptRoot "..\artifact-registry"),
    (Join-Path $PSScriptRoot "..\..\tools\artifact-registry")
)

$RegistryDir = $null
foreach ($Path in $PossiblePaths) {
    if (Test-Path (Join-Path $Path "docker-compose.yml")) {
        $RegistryDir = (Resolve-Path $Path).Path
        break
    }
}

# --- 3. Manage Artifact Registry ---
Write-Host "[1/2] Artifact Registry" -ForegroundColor Cyan
if ($RegistryDir) {
    $RegistryCompose = Join-Path $RegistryDir "docker-compose.yml"
    $running = docker compose -f $RegistryCompose ps --services --filter "status=running"
    if ($running) {
        Write-Host "      Status: Running" -ForegroundColor Green
    }
    else {
        Write-Host "      Status: Stopped. Starting..." -ForegroundColor Yellow
        docker compose -f $RegistryCompose up -d
        if ($LASTEXITCODE -eq 0) {
            Write-Host "      Started successfully." -ForegroundColor Green
        }
        else {
            Write-Host "      Failed to start." -ForegroundColor Red
        }
    }
}
else {
    Write-Host "      Error: Artifact registry not found in expected locations." -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Dependencies are ready!" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
