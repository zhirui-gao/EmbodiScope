@echo off
rem Serve EmbodiScope + local datasets:  serve.bat D:\datasets [E:\more] [--port 8686]
where node >nul 2>nul || (echo Node.js ^>= 18 is required: https://nodejs.org & exit /b 1)
if "%~1"=="" (echo usage: serve.bat ^<dataset-folder^> [more folders] [--port 8686] & exit /b 1)
start "" http://localhost:8686
node "%~dp0scripts\serve.mjs" %*
