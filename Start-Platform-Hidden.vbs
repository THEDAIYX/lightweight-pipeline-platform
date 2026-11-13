Option Explicit

Dim shell, fso, projectDir, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(projectDir, "Start-Platform.ps1")

If Not fso.FileExists(scriptPath) Then
  MsgBox "找不到 Start-Platform.ps1：" & vbCrLf & scriptPath, vbCritical, "动力站模型平台"
  WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(scriptPath)
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
