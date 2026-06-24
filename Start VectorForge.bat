@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0tools\startup\start-vectorforge.ps1"

endlocal
