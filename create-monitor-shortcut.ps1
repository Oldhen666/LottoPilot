# 在桌面创建「LottoPilot 监控」快捷方式
# 右键 -> 使用 PowerShell 运行

$projectRoot = $PSScriptRoot
$targetPath = Join-Path $projectRoot "start-monitor-ui.vbs"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "LottoPilot 监控.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "LottoPilot 数据监控"
$shortcut.IconLocation = "imageres.dll,109"
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "已创建桌面快捷方式: LottoPilot 监控.lnk" -ForegroundColor Green
Write-Host "双击即可打开监控界面" -ForegroundColor Cyan
