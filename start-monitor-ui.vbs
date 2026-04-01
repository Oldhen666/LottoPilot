Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")
projectRoot = fso.GetParentFolderName(WScript.ScriptFullName)
' 0 = 隐藏窗口，不显示 CMD
shell.Run "cmd /c cd /d """ & projectRoot & """ && npm run monitor:app", 0, False
