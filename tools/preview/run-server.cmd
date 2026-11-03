@echo off
cd /d "%~dp0"
set PORT=5180
if not "%~1"=="" set PORT=%~1
"C:\Users\sharyuke\Documents\work\douwan\tools\node\node.exe" "%~dp0server.mjs" --port %PORT% --host 0.0.0.0
