Option Explicit

Dim shell, fso, projectDir, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(projectDir, "Start-Platform.ps1")

If Not fso.FileExists(scriptPath) Then
  MsgBox "Start-Platform.ps1 was not found:" & vbCrLf & scriptPath, vbCritical, "Power Station Model Platform"
  WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False
