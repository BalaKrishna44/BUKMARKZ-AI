# Bukmarkz: build the browser-extension zip files for the Chrome, Edge and Firefox stores (Windows PowerShell).
# Run:  powershell -ExecutionPolicy Bypass -File .\build-extension.ps1
# Only PUBLIC values are used here (the Supabase anon key is public by design). Nothing is stored.
$ErrorActionPreference = 'Stop'
$repo = Join-Path $HOME 'Documents\BUKMARKZ-AI'
$out  = Join-Path $HOME 'Desktop\bukmarkz-extension'
$env:BUKMARKZ_SUPABASE_URL = 'https://yazxbfokxsqtadsewsqy.supabase.co'

if (-not (Test-Path (Join-Path $repo '.git'))) { git clone https://github.com/BalaKrishna44/BUKMARKZ-AI.git $repo }
git -C $repo fetch origin main
git -C $repo checkout main
git -C $repo pull origin main
$ext = Join-Path $repo 'ext3'
Set-Location $ext

Write-Host "`nPaste your Supabase ANON key (the long key starting eyJ) and press Enter." -ForegroundColor Yellow
Write-Host "Use the 'anon public' row on Supabase > Project Settings > API Keys > Legacy. NOT service_role." -ForegroundColor Yellow
$key = (Read-Host 'anon key').Trim()
if ($key.Length -lt 100 -or -not $key.StartsWith('eyJ')) { Write-Host 'That does not look like the anon key. Stopping.' -ForegroundColor Red; exit 1 }
# a service_role key has "service_role" inside its payload: refuse it
try { $p = $key.Split('.')[1].Replace('-','+').Replace('_','/'); while ($p.Length % 4) { $p += '=' }
      $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
      if ($json -match 'service_role') { Write-Host 'That is the SERVICE ROLE key. Never put it in an extension. Stopping.' -ForegroundColor Red; exit 1 } } catch {}
$env:BUKMARKZ_SUPABASE_ANON_KEY = $key

npm.cmd install --no-audit --no-fund
New-Item -ItemType Directory -Force -Path $out | Out-Null
foreach ($b in 'chrome','edge','firefox') {
  Write-Host "`nBuilding $b" -ForegroundColor Cyan
  $env:BROWSER = $b
  node scripts/build.mjs
  $dir = if ($b -eq 'chrome') { 'dist' } else { "dist-$b" }
  $zip = Join-Path $out "bukmarkz-$b.zip"
  if (Test-Path $zip) { Remove-Item $zip }
  Compress-Archive -Path (Join-Path $ext "$dir\*") -DestinationPath $zip
}
Write-Host "`nDone. The three zip files are in: $out" -ForegroundColor Green
Start-Process explorer.exe $out
Read-Host 'Press Enter to close'
