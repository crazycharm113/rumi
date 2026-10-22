@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo [안내] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  echo.
  start "" https://nodejs.org/ko
  pause
  exit /b
)
echo 블로그 작업대를 켜는 중입니다. 이 창을 닫으면 프로그램도 꺼집니다.

node start.js --open
pause
