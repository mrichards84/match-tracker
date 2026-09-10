#!/usr/bin/env pwsh
# Apply Terraform infrastructure changes

$ErrorActionPreference = "Stop"

Write-Host "Initializing Terraform..." -ForegroundColor Cyan
$env:TF_CLI_CONFIG_FILE = "$PWD\terraform.rc"
terraform init

if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform init failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Planning Terraform changes..." -ForegroundColor Cyan
terraform plan -out=tfplan

if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform plan failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Review the plan above. Press Enter to apply, or Ctrl+C to cancel..." -ForegroundColor Yellow
Read-Host

Write-Host "Applying Terraform changes..." -ForegroundColor Cyan
terraform apply tfplan

if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform apply failed!" -ForegroundColor Red
    exit 1
}

# Clean up plan file
Remove-Item tfplan -ErrorAction SilentlyContinue

Write-Host "Infrastructure updated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Outputs:" -ForegroundColor Cyan
terraform output
