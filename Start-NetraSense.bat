@echo off
title NetraSense One-Click Launcher
echo ========================================================
echo           NETRASENSE ONE-CLICK LAUNCHER
echo ========================================================
echo.
echo Starting frontend server on http://localhost:8080...
start http://localhost:8080/dashboard
npm run dev
pause
