@echo off
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js desde https://nodejs.org
  pause
  exit /b 1
)
node build-exe.js
if errorlevel 1 (
  echo.
  echo Si el error dice ENOSPC, el disco esta lleno.
  echo Borra la carpeta agent\node_modules, vacia la papelera y volve a abrir este archivo.
  pause
  exit /b 1
)
echo Listo: agent\dist\IPHub-win32-x64\IPHub.exe
pause
