@echo off
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js desde https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Instalando dependencias del servidor...
  call npm install --omit=dev --no-fund --no-audit
)
echo Servidor en http://127.0.0.1:3001
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:3001"
node start.js
echo.
echo Si se detuvo por falta de espacio, borra agent\node_modules y vacia la papelera.
pause
