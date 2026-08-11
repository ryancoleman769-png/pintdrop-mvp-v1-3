param(
  [string]$ProjectRef = "ggvofckolukahshocxvd"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "Supabase access token not found."
  Write-Host "Run: npx supabase login"
  Write-Host "Or set SUPABASE_ACCESS_TOKEN for this session."
  exit 1
}

npx supabase functions deploy send-voucher-whatsapp --project-ref $ProjectRef --use-api
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Edge Function send-voucher-whatsapp deployed to project $ProjectRef"
