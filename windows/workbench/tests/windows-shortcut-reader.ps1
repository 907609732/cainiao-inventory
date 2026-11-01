$ErrorActionPreference='Stop'
$source=Get-Content (Join-Path $PSScriptRoot 'windows-installer-sandbox.ps1') -Raw -Encoding UTF8
$parseErrors=$null;$tokens=$null
$ast=[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors){throw 'Installer test script parse failed'}
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ShortcutTarget'},$true)
if(!$fn){throw 'Shortcut reader not found'}
Invoke-Expression $fn.Extent.Text
$script:shortcutShell=New-Object -ComObject Shell.Application
$fixture=Join-Path $env:TEMP ('cainiao-shortcut-regression-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$ascii=Join-Path $fixture 'test.lnk'
$legacy=New-Object -ComObject WScript.Shell
$link=$legacy.CreateShortcut($ascii)
$expected=Join-Path $env:WINDIR 'System32\notepad.exe'
$link.TargetPath=$expected;$link.Save()
# A non-ANSI filename reproduces the legacy reader failure on typical locales.
$unicode=Join-Path $fixture '🧪五成电子商务工作台.lnk'
Move-Item -LiteralPath $ascii -Destination $unicode
$before=(Get-FileHash -LiteralPath $unicode).Hash
if((Get-ShortcutTarget $unicode) -ne $expected){throw 'Unicode shortcut lookup failed'}
if((Get-FileHash -LiteralPath $unicode).Hash -ne $before){throw 'Reader modified shortcut'}
'Unicode shortcut regression passed; link unchanged'
