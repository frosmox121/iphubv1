@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "SRC=agent\dist\IPHub-win32-x64"
if not exist "%SRC%\IPHub.exe" ( echo Primero ejecuta BUILD-EXE.bat ^(no existe %SRC%^) & pause & exit /b 1 )
echo Comprimiendo el exe en un solo ZIP...
if exist IPHub-exe.zip del IPHub-exe.zip
powershell -NoProfile -Command "Compress-Archive -Path '%SRC%\*' -DestinationPath 'IPHub-exe.zip' -CompressionLevel Optimal"
if not exist IPHub-exe.zip ( echo Fallo la compresion & pause & exit /b 1 )
echo Dividiendo en partes de 20 MB (IPHub-exe.part001, part002...)
powershell -NoProfile -Command "$s=[IO.File]::OpenRead('IPHub-exe.zip');$b=New-Object byte[] (20MB);$i=1;while(($n=$s.Read($b,0,$b.Length)) -gt 0){$f=('IPHub-exe.part{0:D3}' -f $i);$o=[IO.File]::Create($f);$o.Write($b,0,$n);$o.Close();$i++};$s.Close();Write-Host ('Partes creadas: '+($i-1))"
echo.
echo Listo. Mandame TODOS los archivos IPHub-exe.part*  (no el zip entero).
dir /b IPHub-exe.part*
pause
