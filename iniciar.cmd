@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 22.12 o superior & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Instala FFmpeg y agregalo al PATH & pause & exit /b 1)
where ffprobe >nul 2>nul || (echo Instala ffprobe y agregalo al PATH & pause & exit /b 1)
where yt-dlp >nul 2>nul || echo Aviso: instala yt-dlp para enlaces de redes sociales.
if not exist .env copy .env.example .env >nul
if not exist node_modules\@whiskeysockets\baileys\package.json call npm install
if errorlevel 1 (pause & exit /b 1)
call npm start
pause
