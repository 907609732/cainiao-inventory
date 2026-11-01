$ErrorActionPreference = 'Stop'
$report = @{ok=$false; checks=@(); scope='Windows Sandbox coexistence with actual workbench installer'; livePlatformTested=$false}
function Stop-OwnedApp([string]$file) {
  Get-Process | Where-Object {$_.Path -eq $file} | Stop-Process -ErrorAction SilentlyContinue
}
function Open-CheckedApp([string]$file,[string]$title,[int]$limit=90) {
  $p=Start-Process -FilePath $file -PassThru
  for($i=0;$i -lt $limit;$i++) {
    Start-Sleep -Seconds 1
    $p.Refresh()
    if($p.HasExited){throw "Program exited before ready: $file"}
    if($p.MainWindowTitle -eq $title -and $p.Responding){return $p}
  }
  throw "Window did not become ready: $title"
}
try {
  if($env:USERNAME -ne 'WDAGUtilityAccount'){throw 'Run only inside Windows Sandbox'}
  $spec=Get-Content C:\Kit\candidate.json -Raw | ConvertFrom-Json
  $installer=Join-Path C:\Input $spec.file
  $workbenchInstaller=Join-Path C:\WorkbenchInput $spec.workbenchFile
  if((Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant() -ne $spec.sha256){throw 'Cloud installer hash mismatch'}
  if((Get-FileHash -LiteralPath $workbenchInstaller).Hash.ToLowerInvariant() -ne $spec.workbenchSha256){throw 'Workbench installer hash mismatch'}
  $report.installerSha256=$spec.sha256
  'Installing original workbench' | Set-Content C:\Results\stage.txt
  $setup=Start-Process -FilePath $workbenchInstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if($setup.ExitCode -ne 0){throw 'Workbench installation failed'}
  $hostExe=Join-Path $env:LOCALAPPDATA 'Programs\wucheng-ecommerce-erp-v2\云仓库存同步.exe'
  Stop-OwnedApp $hostExe
  $hostProcess=Open-CheckedApp $hostExe '五成电子商务工作台' 180
  Stop-Process -Id $hostProcess.Id
  $hostFiles=@($hostExe,(Join-Path (Split-Path $hostExe) 'resources\app.asar'))
  $hostHashes=@{};foreach($f in $hostFiles){$hostHashes[$f]=(Get-FileHash -LiteralPath $f).Hash}
  $hostRegistration=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -like '五成电子商务工作台*' | Select-Object -First 1
  if(!$hostRegistration){throw 'Workbench registration missing'}
  $hostKey=$hostRegistration.PSPath
  $hostUninstall=$hostRegistration.UninstallString
  $shell=New-Object -ComObject WScript.Shell
  $hostShortcut=Join-Path ([Environment]::GetFolderPath('Desktop')) '五成电子商务工作台.lnk'
  $hostTarget=$shell.CreateShortcut($hostShortcut).TargetPath
  if($hostTarget -ne $hostExe){throw 'Workbench shortcut missing'}
  $protectedFiles=@{}
  foreach($f in @((Join-Path $env:USERPROFILE 'Documents\LingtuWorkbench\registry.json'),(Join-Path $env:USERPROFILE 'Documents\LingtuWorkbench\workbench-location.json'))){if(Test-Path -LiteralPath $f){$protectedFiles[$f]=(Get-FileHash -LiteralPath $f).Hash}}
  $sentinel=Join-Path $env:APPDATA 'wucheng-ecommerce-erp-v2\coexistence-sentinel.txt'
  New-Item -ItemType Directory -Path (Split-Path $sentinel) -Force | Out-Null
  'Preserve workbench profile' | Set-Content -LiteralPath $sentinel
  $protectedFiles[$sentinel]=(Get-FileHash -LiteralPath $sentinel).Hash
  $report.checks+='actual workbench 0.11.4 installed and started before cloud installation'
  $env:LINGTU_TEST_LEDGER='1';$env:LINGTU_ISOLATED_TEST='1'
  foreach($attempt in 1,2){
    "Installing standalone cloud warehouse: $attempt" | Set-Content C:\Results\stage.txt
    $setup=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if($setup.ExitCode -ne 0){throw "Cloud installation $attempt failed"}
    $cloudExe=Join-Path $env:LOCALAPPDATA 'Programs\CainiaoWarehouse\CainiaoWarehouse.exe'
    $report.cloudInstallationDirectory=Split-Path $cloudExe
    Stop-OwnedApp $cloudExe
    $cloudProcess=Open-CheckedApp $cloudExe '菜鸟云仓' 60
    if(!(Test-Path -LiteralPath (Join-Path $env:APPDATA 'cainiao-cloud-warehouse\settings.json'))){throw 'Independent cloud profile missing'}
    foreach($f in $hostFiles){if((Get-FileHash -LiteralPath $f).Hash -ne $hostHashes[$f]){throw 'Workbench program was overwritten'}}
    foreach($f in $protectedFiles.Keys){if((Get-FileHash -LiteralPath $f).Hash -ne $protectedFiles[$f]){throw 'Workbench data binding/profile was changed'}}
    if((Get-ItemProperty -LiteralPath $hostKey).UninstallString -ne $hostUninstall){throw 'Workbench uninstall identity changed'}
    if($shell.CreateShortcut($hostShortcut).TargetPath -ne $hostTarget){throw 'Workbench shortcut changed'}
    $cloudRegistration=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -like '菜鸟云仓*' | Select-Object -First 1
    if(!$cloudRegistration -or $cloudRegistration.PSPath -eq $hostKey){throw 'Cloud uninstall registration is not independent'}
    $report.checks+=@{attempt=$attempt;installed=$true;independentProfile=$true;hostProgramAndBindingsUnchanged=$true;separateUninstallEntry=$true}
    Stop-Process -Id $cloudProcess.Id
  }
  'Uninstalling cloud while retaining workbench' | Set-Content C:\Results\stage.txt
  $uninstaller=Get-ChildItem -LiteralPath (Split-Path $cloudExe) -Filter '*Uninstall*.exe' -File | Select-Object -First 1
  $removed=Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if($removed.ExitCode -ne 0){throw 'Cloud uninstall failed'}
  for($i=0;$i -lt 30 -and (Test-Path -LiteralPath $cloudExe);$i++){Start-Sleep -Seconds 1}
  if(Test-Path -LiteralPath $cloudExe){throw 'Cloud executable remains after uninstall'}
  foreach($f in $hostFiles){if((Get-FileHash -LiteralPath $f).Hash -ne $hostHashes[$f]){throw 'Cloud uninstall removed or changed workbench'}}
  foreach($f in $protectedFiles.Keys){if((Get-FileHash -LiteralPath $f).Hash -ne $protectedFiles[$f]){throw 'Cloud uninstall changed workbench data binding'}}
  if(!(Test-Path -LiteralPath $hostShortcut) -or !(Get-ItemProperty -LiteralPath $hostKey)){throw 'Workbench shortcut or registration removed'}
  Remove-Item Env:LINGTU_TEST_LEDGER -ErrorAction SilentlyContinue
  Remove-Item Env:LINGTU_ISOLATED_TEST -ErrorAction SilentlyContinue
  $hostProcess=Open-CheckedApp $hostExe '五成电子商务工作台' 90
  Stop-Process -Id $hostProcess.Id
  $report.uninstalled=$true;$report.workbenchUsableAfterCloudUninstall=$true;$report.ok=$true
  'All coexistence checks passed' | Set-Content C:\Results\stage.txt
}catch{$report.error=$_ | Out-String}
$report | ConvertTo-Json -Depth 8 | Set-Content C:\Results\result.json -Encoding UTF8
if($env:USERNAME -eq 'WDAGUtilityAccount'){& "$env:WINDIR\System32\shutdown.exe" /s /t 0}
