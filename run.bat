@echo off
REM Starts SkyScreen on Windows. Double-click this file, or run it from the VS Code terminal.
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo Creating the virtual environment...
  python -m venv .venv || (echo Could not run python. Install Python 3 and tick "Add python.exe to PATH". & pause & exit /b 1)
)
call .venv\Scripts\activate.bat

if not exist .venv\.installed (
  echo Installing packages, this needs internet the first time...
  python -m pip install --upgrade pip
  if exist requirements.txt (
    python -m pip install -r requirements.txt || goto :fail
  ) else (
    python -m pip install -r requirements-demo.txt || goto :fail
  )
  python -m pip install -r requirements-web.txt || goto :fail
  echo done> .venv\.installed
)

if not exist breast_cancer_model.joblib (
  echo No Colab model found, building the demo model...
  python make_demo_model.py || goto :fail
)

echo.
echo SkyScreen is starting at http://127.0.0.1:8000  (press Ctrl+C to stop)
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:8000"
python -m uvicorn app:app
goto :eof

:fail
echo.
echo Setup failed. Read the message above, or see Troubleshooting in README.md.
pause
exit /b 1
