@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Windows.ps1" -Action Model -Profile Small
if errorlevel 1 echo Action failed. See the message above.
pause
