# Script para iniciar o MAXpoker e o Cloudflare Tunnel
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "♠ Iniciando MAXpoker Server..." -ForegroundColor Green
$serverJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    node server.js
}

Start-Sleep -Seconds 2

Write-Host "☁ Conectando ao Cloudflare Tunnel..." -ForegroundColor Cyan
& .\cloudflared.exe tunnel --url http://localhost:3000
