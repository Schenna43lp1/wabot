@echo off
setlocal
title WhatsApp-Alltagshelfer
cd /d "%~dp0"
rem The QR code needs about 36 lines. Must run before chcp, as PowerShell 5 changes the font under UTF-8.
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoProfile -Command "try { $u = $Host.UI.RawUI; $s = $u.WindowSize; $h = [Math]::Min(42, $u.MaxPhysicalWindowSize.Height); if ($h -gt $s.Height) { $s.Height = $h; $u.WindowSize = $s } } catch {}" >nul 2>&1
for /f "tokens=2 delims=:" %%C in ('chcp') do set "OLD_CP=%%C"
chcp 65001 >nul

where node >nul 2>&1
if errorlevel 1 goto no_node
node -e "process.exit(+(parseInt(process.versions.node) < 24))" >nul 2>&1
if errorlevel 1 goto old_node

rem Loading the modules also detects an incomplete or outdated installation.
node --input-type=module -e "await import('./src/whatsapp.js'); await import('./src/product.js')" >nul 2>&1
if not errorlevel 1 goto menu

echo.
echo   Pakete werden installiert, das dauert einen Moment ...
echo.
call npm ci --no-audit --no-fund --loglevel=error
if errorlevel 1 goto install_failed

:menu
node src\cli.js
if errorlevel 1 goto crashed
set "RESULT=0"
goto end

:no_node
echo.
echo   Node.js fehlt. Bitte Version 24 oder neuer installieren:
echo   https://nodejs.org
echo.
echo   Danach dieses Fenster schliessen und start.cmd erneut starten.
goto failed

:old_node
echo.
echo   Node.js ist zu alt. Installiert ist:
node --version
echo   Gebraucht wird Version 24 oder neuer: https://nodejs.org
goto failed

:install_failed
echo.
echo   Die Installation ist fehlgeschlagen.
echo   - Besteht eine Internetverbindung?
echo   - Laeuft der Bot noch in einem anderen Fenster?
goto failed

:crashed
echo.
echo   Das Startmenue wurde mit einem Fehler beendet. Die Meldung steht oben.

:failed
set "RESULT=1"
echo.
pause

:end
if defined OLD_CP chcp %OLD_CP: =% >nul 2>&1
exit /b %RESULT%
