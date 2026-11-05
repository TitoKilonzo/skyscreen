#!/usr/bin/env bash
# Starts SkyScreen on Linux or macOS:  bash run.sh
set -e
cd "$(dirname "$0")"

[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate

if [ ! -f .venv/.installed ]; then
  python -m pip install --upgrade pip
  if [ -f requirements.txt ]; then python -m pip install -r requirements.txt
  else python -m pip install -r requirements-demo.txt; fi
  python -m pip install -r requirements-web.txt
  touch .venv/.installed
fi

[ -f breast_cancer_model.joblib ] || python make_demo_model.py

echo "SkyScreen is starting at http://127.0.0.1:8000  (Ctrl+C to stop)"
python -m uvicorn app:app
