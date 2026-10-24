@echo off
rem genoffice launcher for the packaged Windows app: <install>\resources\cli\hermesoffice.cmd
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\HermesOffice.exe" "%~dp0hermesoffice.cjs" %*
endlocal
