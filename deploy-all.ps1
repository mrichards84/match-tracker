#!/usr/bin/env pwsh
# Deploy Match Tracker App as a Multi-Container Cloud Run Service

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Deploying Match Tracker    Application" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$PROJECT_ID = "balmy-visitor-230809"
$REGION = "us-east1"
$REPO_NAME = "match-tracker-repo"
$REGISTRY_URL = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME"
$TAG = "latest"
$TIMESTAMP = $(Get-Date -Format "yyyyMMdd-HHmmss")
Write-Host "Starting Deployment with Tag: $TAG (Timestamp: $TIMESTAMP)" -ForegroundColor Green

# 1. Build & Push Frontend
Write-Host "Building Frontend..."
docker build `
    --add-host=artifact-registry.local:host-gateway `
    -t "$REGISTRY_URL/web:$TAG" `
    -f ./frontend/Dockerfile `
    ./frontend
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Pushing Frontend..."
docker push "$REGISTRY_URL/web:$TAG"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build/push failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 2. Deploy Infrastructure
Write-Host "Deploying Infrastructure..."
Set-Location infrastructure
$env:TF_CLI_CONFIG_FILE = "$PWD\terraform.rc"
terraform init
terraform apply -var="image_tag=$TAG" -var="deployment_timestamp=$TIMESTAMP" -auto-approve
Set-Location ..

Write-Host "Deployment Complete! Tag: $TAG" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All services deployed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
