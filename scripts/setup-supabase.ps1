# Bukmarkz: load the database into your Supabase project (Windows PowerShell).
# Run:  powershell -ExecutionPolicy Bypass -File .\setup-supabase.ps1
# It never stores your password. Supabase asks for it and you type it yourself.
$ErrorActionPreference = 'Stop'
$ref = 'yazxbfokxsqtadsewsqy'
$repo = 'https://github.com/BalaKrishna44/BUKMARKZ-AI.git'
$branch = 'feat/app-shell-hosting-legal'
$dir = Join-Path $HOME 'Documents\BUKMARKZ-AI'

function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing: $cmd. $hint" -ForegroundColor Red; Read-Host 'Install it, open a NEW PowerShell window, and run this script again. Press Enter to close'; exit 1 } }

Write-Host "`n[1/5] Checking tools" -ForegroundColor Cyan
Need git  'Install Git from https://git-scm.com/download/win'
Need node 'Install Node.js LTS from https://nodejs.org'
Need npm  'Comes with Node.js'

Write-Host "`n[2/5] Getting the code into $dir" -ForegroundColor Cyan
if (Test-Path (Join-Path $dir '.git')) { git -C $dir fetch origin $branch; git -C $dir checkout $branch; git -C $dir pull origin $branch }
else { git clone -b $branch $repo $dir }
Set-Location $dir

Write-Host "`n[3/5] Supabase CLI" -ForegroundColor Cyan
# npx runs the CLI without a global install
$sb = { param($a) & npx.cmd --yes supabase@latest @a }
& $sb @('--version')
Write-Host 'A browser window will open: click Authorize.' -ForegroundColor Yellow
& $sb @('login')
Write-Host "Now type your DATABASE PASSWORD when asked (nothing shows while typing: normal)." -ForegroundColor Yellow
& $sb @('link', '--project-ref', $ref)

Write-Host "`n[4/5] Vault secrets" -ForegroundColor Cyan
Write-Host "Before the push, open Supabase > SQL Editor and run these two lines (use your own long random string for the second):" -ForegroundColor Yellow
Write-Host "  select vault.create_secret('https://$ref.supabase.co','project_url');"
Write-Host "  select vault.create_secret('YOUR_RANDOM_STRING','digest_cron_secret');"
Read-Host 'Press Enter when both lines ran in the SQL Editor'

Write-Host "`n[5/5] Pushing the 39 migrations" -ForegroundColor Cyan
& $sb @('db', 'push')
Write-Host "`nDone. If you saw an error above, copy ALL of it and paste it to Claude." -ForegroundColor Green
Read-Host 'Press Enter to close'
