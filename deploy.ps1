# PintDrop — deploy to GitHub + Vercel
# Run from the project folder after GitHub CLI is authenticated (gh auth login)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

$git = "C:\Program Files\Git\bin\git.exe"
$gh = "$env:TEMP\gh-portable\bin\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }

& $gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub CLI not signed in. Run: gh auth login --web --git-protocol https"
  exit 1
}

$repoName = "pintdrop-mvp-v1.3"
$user = & $gh api user --jq .login
$remote = "https://github.com/$user/$repoName.git"

if (-not (& $gh repo view "$user/$repoName" 2>$null)) {
  & $gh repo create $repoName --public --source=. --remote=origin --description "PintDrop Interactive Demo v1.3"
} else {
  & $git remote remove origin 2>$null
  & $git remote add origin $remote
}

& $git push -u origin main

Write-Host ""
Write-Host "GitHub repo: https://github.com/$user/$repoName"
Write-Host "Next: import at https://vercel.com/new (sign in with GitHub, select $repoName, Deploy)"
Write-Host "Vercel will auto-detect the static site — no build command needed."
