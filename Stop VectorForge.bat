@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0tools\startup\stop-vectorforge.ps1"

endlocal
