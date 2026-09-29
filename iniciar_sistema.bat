@echo off
title Sistema Hospitalario - Servidor Local
echo ============================================================
echo      INICIANDO SISTEMA HOSPITALARIO (SIMULACION LOCAL)
echo ============================================================
echo Abriendo navegador en http://localhost:3001 ...
start http://localhost:3001
echo Servidor en ejecucion. Para detenerlo, cierra esta ventana.
echo ============================================================
node server.js
pause
