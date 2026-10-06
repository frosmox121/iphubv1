@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist IPHub-exe.part001 ( echo Pone todas las IPHub-exe.part### en esta carpeta & pause & exit /b 1 )
echo Uniendo partes...
copy /b IPHub-exe.part* IPHub-exe-unido.zip >nul
powershell -NoProfile -Command "Expand-Archive -Force 'IPHub-exe-unido.zip' 'IPHub-exe'"
echo Listo: carpeta IPHub-exe\IPHub.exe
pause
