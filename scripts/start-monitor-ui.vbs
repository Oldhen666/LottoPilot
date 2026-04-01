' 后台启动 Monitor Web 界面（无窗口）
' 双击运行后，打开浏览器访问 http://localhost:3333
' 若要停止：任务管理器 -> 结束 node.exe 进程
Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
CreateObject("Wscript.Shell").Run "cmd /c cd /d """ & projectRoot & """ && npm run monitor:ui", 0, False
