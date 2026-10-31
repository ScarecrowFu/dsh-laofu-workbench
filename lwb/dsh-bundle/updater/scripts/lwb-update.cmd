@echo off
rem Entry point for the LWB in-place updater. Kept to ASCII on purpose: every
rem real path arrives through the environment, because a batch file expands its
rem arguments through the console code page and would corrupt a Chinese user
rem profile. The work is done by the PowerShell script named below.
setlocal
if not defined LWB_UPDATE_SCRIPT exit /b 1
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LWB_UPDATE_SCRIPT%"
endlocal
