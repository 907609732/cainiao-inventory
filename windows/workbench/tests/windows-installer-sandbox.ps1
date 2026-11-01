$ErrorActionPreference = 'Stop'
$report = @{ok=$false; checks=@(); scope='Windows Sandbox, network disabled'; livePlatformTested=$false}
try {
  if ($env:USERNAME -ne 'WDAGUtilityAccount') { throw 'Run only inside Windows Sandbox' }
  $spec = Get-Content C:\Kit\candidate.json -Raw | ConvertFrom-Json
  $installer = Join-Path C:\Input $spec.file
  if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.sha256) { throw 'Installer hash mismatch' }
  $report.installerSha256 = $spec.sha256
  foreach ($attempt in 1,2) {
    $setup = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installation $attempt exited $($setup.ExitCode)" }
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\wucheng-ecommerce-erp-v2\云仓库存同步.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installed executable missing' }
    Get-Process | Where-Object {$_.Path -eq $exe} | Stop-Process -ErrorAction SilentlyContinue
    $env:LINGTU_TEST_LEDGER='1'
    $env:LINGTU_ISOLATED_TEST='1'
    $profile = Join-Path $env:TEMP "cainiao-install-$attempt"
    $env:LINGTU_REGISTRY_PATH = Join-Path $profile 'registry.json'
    $env:CAINIAO_APP_DATA_DIR = Join-Path $profile 'workspace'
    $env:ERP_DATA_DIR = Join-Path $profile 'workspace\data'
    $process = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$profile" -PassThru -RedirectStandardError "C:\Results\launch-$attempt.stderr.log"
    $ready = $false
    for ($i=0; $i -lt 45; $i++) {
      Start-Sleep -Seconds 1
      $process.Refresh()
      if ($process.HasExited) { throw "Installed program exited: $($process.ExitCode)" }
      if ($process.MainWindowTitle -like '*云仓*' -and $process.Responding) { $ready=$true; break }
    }
    if (!$ready) { throw 'Installed window did not become ready' }
    $report.checks += @{attempt=$attempt; installed=$true; nativeWindow=$process.MainWindowTitle; responding=$process.Responding}
    Stop-Process -Id $process.Id
  }
  $uninstaller = Get-ChildItem -LiteralPath (Split-Path $exe) -Filter '*Uninstall*.exe' -File | Select-Object -First 1
  if (!$uninstaller) { throw 'Uninstaller missing' }
  $removed = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($removed.ExitCode -ne 0) { throw "Uninstaller exited $($removed.ExitCode)" }
  for ($i=0; $i -lt 30 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path -LiteralPath $exe) { throw 'Executable remains after uninstall' }
  $report.uninstalled=$true
  $report.ok=$true
} catch { $report.error = $_ | Out-String }
$report | ConvertTo-Json -Depth 8 | Set-Content C:\Results\result.json -Encoding UTF8
if ($env:USERNAME -eq 'WDAGUtilityAccount') { & "$env:WINDIR\System32\shutdown.exe" /s /t 0 }
