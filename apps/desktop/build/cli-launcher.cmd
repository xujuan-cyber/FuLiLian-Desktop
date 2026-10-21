@echo off
setlocal
set "LAUNCHER=%LOCALAPPDATA%\fulilian\bin\fulilian.cmd"
if exist "%LAUNCHER%" (
  call "%LAUNCHER%" %*
  exit /b %ERRORLEVEL%
)
echo.
echo [FuLiLian] 命令行运行时尚未安装。
echo.
echo 请先启动一次 FuLiLian 图形界面完成运行时初始化，或运行：
echo     %LOCALAPPDATA%\fulilian\fulilian-setup.exe --repair
echo.
pause
exit /b 1
