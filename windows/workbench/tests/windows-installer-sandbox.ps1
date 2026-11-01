param([switch]$HostedRunner)
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
  if($HostedRunner){
    if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){throw 'HostedRunner requires an ephemeral GitHub-hosted Windows runner'}
    $report.scope='GitHub-hosted Windows coexistence with actual workbench installer'
  }elseif($env:USERNAME -ne 'WDAGUtilityAccount'){throw 'Run only inside Windows Sandbox'}
  $spec=Get-Content C:\Kit\candidate.json -Raw | ConvertFrom-Json
  $installer=Join-Path C:\Input $spec.file
  $workbenchInstaller=Join-Path C:\WorkbenchInput $spec.workbenchFile
  if((Get-FileHash -LiteralPath $installer).Hash.ToLowerInvariant() -ne $spec.sha256){throw 'Cloud installer hash mismatch'}
  if((Get-FileHash -LiteralPath $workbenchInstaller).Hash.ToLowerInvariant() -ne $spec.workbenchSha256){throw 'Workbench installer hash mismatch'}
  $report.installerSha256=$spec.sha256
  # Stage hash-verified local copies so mapped-folder behavior cannot affect
  # installation. Application-control policies remain unchanged.
  $localInstallers=Join-Path $env:TEMP 'cainiao-coexistence-installers'
  New-Item -ItemType Directory -Path $localInstallers -Force | Out-Null
  foreach($source in @($installer,$workbenchInstaller)){
    $destination=Join-Path $localInstallers (Split-Path $source -Leaf)
    Copy-Item -LiteralPath $source -Destination $destination
    if((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash){throw 'Local installer copy hash mismatch'}
  }
  $installer=Join-Path $localInstallers $spec.file
  $workbenchInstaller=Join-Path $localInstallers $spec.workbenchFile
  $report.installerExecution='hash-verified local copies; application-control policy unchanged'
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
  $shortcutRoots=@('DesktopDirectory','CommonDesktopDirectory','StartMenu','CommonStartMenu') | ForEach-Object {[Environment]::GetFolderPath($_)} | Where-Object {$_ -and (Test-Path -LiteralPath $_)} | Select-Object -Unique
  $shortcuts=@($shortcutRoots | ForEach-Object {Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -Recurse -File} | ForEach-Object {@{path=$_.FullName;target=$shell.CreateShortcut($_.FullName).TargetPath}})
  $shortcuts | ConvertTo-Json -Depth 4 | Set-Content C:\Results\baseline-shortcuts.json
  $hostShortcuts=@($shortcuts | Where-Object {$_.target -eq $hostExe})
  if(!$hostShortcuts.Count){throw 'Workbench shortcut missing from user/public desktop and start menu'}
  $report.protectedWorkbenchShortcuts=$hostShortcuts.Count
  $protectedFiles=@{}
  foreach($f in @((Join-Path $env:USERPROFILE 'Documents\LingtuWorkbench\registry.json'),(Join-Path $env:USERPROFILE 'Documents\LingtuWorkbench\workbench-location.json'))){if(Test-Path -LiteralPath $f){$protectedFiles[$f]=(Get-FileHash -LiteralPath $f).Hash}}
  $sentinel=Join-Path $env:APPDATA 'wucheng-ecommerce-erp-v2\coexistence-sentinel.txt'
  New-Item -ItemType Directory -Path (Split-Path $sentinel) -Force | Out-Null
  'Preserve workbench profile' | Set-Content -LiteralPath $sentinel
  $protectedFiles[$sentinel]=(Get-FileHash -LiteralPath $sentinel).Hash
  $report.checks+='actual workbench 0.11.4 installed and started before cloud installation'
  $env:LINGTU_TEST_LEDGER='1';$env:LINGTU_ISOLATED_TEST='1'
  $cloudSentinel=$null
  if($spec.previousFile){
    'Installing previous standalone cloud before upgrade' | Set-Content C:\Results\stage.txt
    $previous=Join-Path C:\Input $spec.previousFile
    if((Get-FileHash -LiteralPath $previous).Hash.ToLowerInvariant() -ne $spec.previousSha256){throw 'Previous cloud installer hash mismatch'}
    $previousLocal=Join-Path $localInstallers $spec.previousFile
    Copy-Item -LiteralPath $previous -Destination $previousLocal
    if((Get-FileHash -LiteralPath $previousLocal).Hash.ToLowerInvariant() -ne $spec.previousSha256){throw 'Previous cloud copy hash mismatch'}
    $setup=Start-Process -FilePath $previousLocal -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if($setup.ExitCode -ne 0){throw 'Previous cloud installation failed'}
    $cloudExe=Join-Path $env:LOCALAPPDATA 'Programs\CainiaoWarehouse\CainiaoWarehouse.exe'
    Stop-OwnedApp $cloudExe
    $previousProcess=Open-CheckedApp $cloudExe '菜鸟云仓' 60
    Stop-Process -Id $previousProcess.Id
    $cloudSentinel=Join-Path $env:APPDATA 'cainiao-cloud-warehouse\coexistence-demo.txt'
    'SYNTHETIC TEST DATA - preserve across upgrade and reinstall' | Set-Content -LiteralPath $cloudSentinel
    $cloudSentinelHash=(Get-FileHash -LiteralPath $cloudSentinel).Hash
    $report.previousStandaloneVersion='0.9.5'
  }
  foreach($attempt in 1,2){
    "Installing standalone cloud warehouse: $attempt" | Set-Content C:\Results\stage.txt
    $setup=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if($setup.ExitCode -ne 0){throw "Cloud installation $attempt failed"}
    $cloudExe=Join-Path $env:LOCALAPPDATA 'Programs\CainiaoWarehouse\CainiaoWarehouse.exe'
    $report.cloudInstallationDirectory=Split-Path $cloudExe
    Stop-OwnedApp $cloudExe
    $cloudProcess=Open-CheckedApp $cloudExe '菜鸟云仓' 60
    if((Get-Item -LiteralPath $cloudExe).VersionInfo.ProductVersion -notlike '0.9.6*'){throw 'Installed cloud version is not 0.9.6'}
    if($cloudSentinel -and (Get-FileHash -LiteralPath $cloudSentinel).Hash -ne $cloudSentinelHash){throw 'Cloud test data changed during upgrade or reinstall'}
    if(!(Test-Path -LiteralPath (Join-Path $env:APPDATA 'cainiao-cloud-warehouse\settings.json'))){throw 'Independent cloud profile missing'}
    foreach($f in $hostFiles){if((Get-FileHash -LiteralPath $f).Hash -ne $hostHashes[$f]){throw 'Workbench program was overwritten'}}
    foreach($f in $protectedFiles.Keys){if((Get-FileHash -LiteralPath $f).Hash -ne $protectedFiles[$f]){throw 'Workbench data binding/profile was changed'}}
    if((Get-ItemProperty -LiteralPath $hostKey).UninstallString -ne $hostUninstall){throw 'Workbench uninstall identity changed'}
    foreach($link in $hostShortcuts){if(!(Test-Path -LiteralPath $link.path) -or $shell.CreateShortcut($link.path).TargetPath -ne $link.target){throw 'Workbench shortcut changed'}}
    $cloudRegistration=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -like '菜鸟云仓*' | Select-Object -First 1
    if(!$cloudRegistration -or $cloudRegistration.PSPath -eq $hostKey){throw 'Cloud uninstall registration is not independent'}
    $hostProcess=Open-CheckedApp $hostExe '五成电子商务工作台' 90
    $cloudProcess.Refresh()
    if($cloudProcess.HasExited -or !$cloudProcess.Responding){throw 'Cloud stopped responding while workbench was opened'}
    Stop-Process -Id $hostProcess.Id
    $report.checks+=@{attempt=$attempt;installed=$true;independentProfile=$true;hostProgramAndBindingsUnchanged=$true;separateUninstallEntry=$true;bothApplicationsStarted=$true}
    if($cloudSentinel){$report.syntheticCloudDataPreserved=$true}
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
  foreach($link in $hostShortcuts){if(!(Test-Path -LiteralPath $link.path) -or $shell.CreateShortcut($link.path).TargetPath -ne $link.target){throw 'Workbench shortcut removed or changed by cloud uninstall'}}
  if(!(Get-ItemProperty -LiteralPath $hostKey)){throw 'Workbench registration removed'}
  Remove-Item Env:LINGTU_TEST_LEDGER -ErrorAction SilentlyContinue
  Remove-Item Env:LINGTU_ISOLATED_TEST -ErrorAction SilentlyContinue
  $hostProcess=Open-CheckedApp $hostExe '五成电子商务工作台' 90
  Stop-Process -Id $hostProcess.Id
  $report.uninstalled=$true;$report.workbenchUsableAfterCloudUninstall=$true;$report.ok=$true
  'All coexistence checks passed' | Set-Content C:\Results\stage.txt
}catch{$report.error=$_ | Out-String}
$report | ConvertTo-Json -Depth 8 | Set-Content C:\Results\result.json -Encoding UTF8
if($env:USERNAME -eq 'WDAGUtilityAccount'){& "$env:WINDIR\System32\shutdown.exe" /s /t 0}
