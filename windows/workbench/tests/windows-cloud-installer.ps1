# Never run this acceptance script on a developer computer or self-hosted runner.
$ErrorActionPreference = 'Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted'){
  throw 'Cloud installer acceptance requires an ephemeral GitHub-hosted Windows runner'
}
$report=@{ok=$false;scope='cloud-only fresh or upgrade and reinstall on ephemeral GitHub-hosted Windows';workbenchRuntimeTested=$false;legacyCoexistence='not tested: baseline unavailable';checks=@();livePlatformTested=$false}
New-Item -ItemType Directory -Path C:\Results -Force | Out-Null
$cloudExe=Join-Path $env:LOCALAPPDATA 'Programs\CainiaoWarehouse\CainiaoWarehouse.exe'
$profile=Join-Path $env:APPDATA 'cainiao-cloud-warehouse'
$settings=Join-Path $profile 'settings.json'
$database=Join-Path $profile 'workspace\data\erp.sqlite'
$discovery=Join-Path $profile 'workspace\state\local-web.json'
$backup=Join-Path $env:TEMP ('cloud-acceptance-backup-'+[guid]::NewGuid().ToString('N'))
$script:shell=New-Object -ComObject Shell.Application
$desktopRoots=@('DesktopDirectory','CommonDesktopDirectory') | ForEach-Object {[Environment]::GetFolderPath($_)} | Where-Object {$_ -and (Test-Path -LiteralPath $_)}
$menuRoots=@('StartMenu','CommonStartMenu') | ForEach-Object {[Environment]::GetFolderPath($_)} | Where-Object {$_ -and (Test-Path -LiteralPath $_)}
function Stop-OwnedApp {
  Get-Process | Where-Object {$_.Path -and $_.Path -eq $cloudExe} | Stop-Process -ErrorAction SilentlyContinue
  for($i=0;$i -lt 30;$i++){
    if(!(Get-Process | Where-Object {$_.Path -and $_.Path -eq $cloudExe})){return}
    Start-Sleep -Milliseconds 200
  }
  throw 'Cloud processes did not stop'
}
function Assert-Hash([string]$file,[string]$expected){
  if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected){throw 'Acceptance file hash mismatch'}
}
function Stage-Installer([string]$name,[string]$sha){
  if(!$name -or [IO.Path]::GetFileName($name) -ne $name -or $sha -notmatch '^[a-fA-F0-9]{64}$'){throw 'Invalid installer manifest entry'}
  $source=Join-Path C:\Input $name
  Assert-Hash $source $sha
  $destination=Join-Path $backup $name
  Copy-Item -LiteralPath $source -Destination $destination
  Assert-Hash $destination $sha
  return $destination
}
function Install-Cloud([string]$installer){
  Stop-OwnedApp
  $setup=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if($setup.ExitCode -ne 0){throw 'Cloud silent installation failed'}
  Stop-OwnedApp
}
function Open-Cloud {
  Start-Process -FilePath $cloudExe | Out-Null
  for($i=0;$i -lt 120;$i++){
    $ready=Get-Process | Where-Object {$_.Path -eq $cloudExe -and $_.MainWindowTitle -eq '菜鸟云仓' -and $_.Responding}
    if($ready -and (Test-Path -LiteralPath $settings)){return}
    Start-Sleep -Seconds 1
  }
  throw 'Cloud GUI did not become ready'
}
function Get-Link([string]$file){
  # Shell.Application reads Unicode targets without WScript ANSI conversion.
  $folder=$script:shell.NameSpace((Split-Path -LiteralPath $file))
  $item=$folder.ParseName((Split-Path $file -Leaf))
  return @{path=$file;target=$item.ExtendedProperty('System.Link.TargetParsingPath');arguments=$item.ExtendedProperty('System.Link.Arguments')}
}
function Get-CloudLinks($roots){
  return @($roots | ForEach-Object {Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -Recurse -File} | ForEach-Object {Get-Link $_.FullName} | Where-Object {$_.target -eq $cloudExe})
}
function Assert-Preserved {
  Assert-Hash $settings $script:settingsHash
  Assert-Hash $database $script:databaseHash
}
try {
  New-Item -ItemType Directory -Path $backup | Out-Null
  $spec=Get-Content -LiteralPath C:\Kit\candidate.json -Raw | ConvertFrom-Json
  $candidate=Stage-Installer $spec.file $spec.sha256
  if(!$spec.version){throw 'Candidate version missing'}
  if(Test-Path -LiteralPath $profile){throw 'Acceptance runner cloud profile must initially be absent'}
  if($spec.previousFile){
    $previous=Stage-Installer $spec.previousFile $spec.previousSha256
    Install-Cloud $previous
    if($spec.previousVersion -and (Get-Item -LiteralPath $cloudExe).VersionInfo.ProductVersion -notlike "$($spec.previousVersion)*"){throw 'Previous installed version mismatch'}
    $report.previousVersion=$spec.previousVersion
  }else{
    Install-Cloud $candidate
  }
  Open-Cloud
  Stop-OwnedApp
  # Initialize the actual current schema through the repository's existing DB module.
  $env:ERP_DATA_DIR=Join-Path $profile 'workspace\data'
  $env:CLOUD_ACCEPTANCE_DB_MODULE=(Join-Path (Split-Path $PSScriptRoot -Parent) 'core\erp\db.js')
  @'
import {pathToFileURL} from 'node:url';
const {getDb,closeDb}=await import(pathToFileURL(process.env.CLOUD_ACCEPTANCE_DB_MODULE));
const db=getDb();
db.prepare('INSERT OR IGNORE INTO warehouses(id,name) VALUES (?,?)').run('cainiao','Synthetic acceptance warehouse');
db.prepare('INSERT INTO skus(sku,name) VALUES (?,?)').run('CLOUD-ACCEPTANCE-DEMO','Synthetic acceptance SKU');
db.prepare('INSERT INTO inventory_snapshots(sku,warehouse_id,snapshot_date,quantity,source) VALUES (?,?,?,?,?)').run('CLOUD-ACCEPTANCE-DEMO','cainiao','2026-11-11',123,'synthetic-installer-acceptance');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
closeDb();
'@ | node --input-type=module
  if($LASTEXITCODE -ne 0){throw 'Synthetic schema seed failed'}
  Remove-Item Env:ERP_DATA_DIR,Env:CLOUD_ACCEPTANCE_DB_MODULE
  Copy-Item -LiteralPath $settings -Destination (Join-Path $backup 'settings.json')
  Copy-Item -LiteralPath $database -Destination (Join-Path $backup 'erp.sqlite')
  $script:settingsHash=(Get-FileHash -LiteralPath $settings).Hash
  $script:databaseHash=(Get-FileHash -LiteralPath $database).Hash
  foreach($attempt in 1,2){
    "Installing candidate attempt $attempt" | Set-Content C:\Results\stage.txt
    Install-Cloud $candidate
    Assert-Preserved
    if((Get-Item -LiteralPath $cloudExe).VersionInfo.ProductVersion -notlike "$($spec.version)*"){throw 'Candidate installed version mismatch'}
    Open-Cloud
    Assert-Preserved
    $registration=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object {$_.DisplayName -like '菜鸟云仓*'})
    if($registration.Count -ne 1 -or $registration[0].PSChildName -notmatch '^\{?[0-9a-fA-F-]{36}\}?$' -or $registration[0].PSChildName -like '*00b66daa*'){throw 'Independent cloud uninstall GUID missing'}
    $desktopLinks=Get-CloudLinks $desktopRoots
    $menuLinks=Get-CloudLinks $menuRoots
    $webLinks=@($menuLinks | Where-Object {$_.path -like '*（网页版）.lnk' -and $_.arguments -eq '--web'})
    if(!$desktopLinks.Count -or !$webLinks.Count){throw 'Installed desktop or web shortcut missing'}
    $owner=$null
    for($i=0;$i -lt 60;$i++){
      if(Test-Path -LiteralPath $discovery){try{$owner=Get-Content -LiteralPath $discovery -Raw | ConvertFrom-Json}catch{}}
      if($owner){break};Start-Sleep -Seconds 1
    }
    if(!$owner -or $owner.origin -notmatch '^http://127\.0\.0\.1:[0-9]+$'){throw 'Local backend discovery missing'}
    $ownerProcess=Get-Process -Id $owner.pid
    if($ownerProcess.Path -ne $cloudExe){throw 'Discovery does not belong to cloud executable'}
    $health=Invoke-RestMethod ($owner.origin+'/api/v1/health')
    if($health.brand -ne 'cainiao-cloud-warehouse' -or $health.instanceId -ne $owner.instanceId -or $health.version -ne $spec.version){throw 'Installed HTTP identity mismatch'}
    $inventory=Invoke-RestMethod ($owner.origin+'/api/v1/call/getInventory') -Method Post -ContentType 'application/json' -Body '{}' -Headers @{Authorization=('Bearer '+$owner.ownerToken)}
    if(!$inventory.ok -or !($inventory.value.items | Where-Object {$_.sku -eq 'CLOUD-ACCEPTANCE-DEMO' -and $_.quantity -eq 123})){throw 'Installed HTTP synthetic inventory mismatch'}
    Start-Process -FilePath $webLinks[0].path -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $same=Get-Content -LiteralPath $discovery -Raw | ConvertFrom-Json
    if($same.pid -ne $owner.pid -or $same.instanceId -ne $owner.instanceId){throw 'Web shortcut started another backend'}
    $healthAfter=Invoke-RestMethod ($same.origin+'/api/v1/health')
    if($healthAfter.instanceId -ne $owner.instanceId){throw 'Web shortcut HTTP owner changed'}
    Assert-Preserved
    Stop-OwnedApp
    Assert-Preserved
    $report.checks+=@{attempt=$attempt;version=$spec.version;guiReady=$true;independentProfile=$true;separateUninstallGuid=$true;desktopShortcut=$true;webShortcut=$true;sameBackend=$true;readonlySyntheticInventory123=$true;settingsAndDatabaseHashesPreserved=$true}
  }
  $uninstaller=@(Get-ChildItem -LiteralPath (Split-Path $cloudExe) -Filter '*Uninstall*.exe' -File)
  if($uninstaller.Count -ne 1){throw 'Cloud uninstaller missing'}
  $removed=Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if($removed.ExitCode -ne 0){throw 'Cloud uninstall failed'}
  for($i=0;$i -lt 60 -and (Test-Path -LiteralPath $cloudExe);$i++){Start-Sleep -Seconds 1}
  if(Test-Path -LiteralPath $cloudExe){throw 'Cloud executable remains after uninstall'}
  Assert-Preserved
  foreach($link in $webLinks){if(Test-Path -LiteralPath $link.path){throw 'Web shortcut remains after uninstall'}}
  $report.uninstalled=$true;$report.profileAndSyntheticDataRetained=$true;$report.ok=$true
}catch{
  # Do not serialize exceptions, request headers, discovery or bearer credentials.
  $report.error='Cloud installer acceptance failed; inspect stage and failed check in runner log'
  Write-Warning ('Acceptance failed at line '+$_.InvocationInfo.ScriptLineNumber)
}finally{
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath C:\Results\result.json -Encoding UTF8
}
if(!$report.ok){throw 'Cloud-only installer acceptance failed'}
