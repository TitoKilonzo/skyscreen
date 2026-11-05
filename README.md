# SkyScreen

A local web app for the breast cancer neural network you trained in Colab. It runs on your own
computer, needs no internet after setup, and has a sky blue and white design.

> **Teaching model only. Never use it for real medical decisions, and do not enter real patient data.**

## What it does

- **Single patient:** type the 30 measurements, load one of five examples, or upload a one-patient CSV.
  You get a gauge with the probability of malignant, a plain-language verdict, and a chart of which
  measurements pushed the result most.
- **Decision threshold slider:** move the line that separates benign from malignant and watch the
  labels change straight away (single results, session list and batch table).
- **Batch CSV:** drop in a file with up to 1000 patients. Good rows are scored, bad rows are listed with
  the reason, and you can filter, sort and download the results as CSV.
- **Safety nets:** warnings for values far outside the training range (usually a unit mistake), a red
  banner if the scikit-learn version differs from the one the model was saved with, and clear messages
  for missing columns, empty cells, text, negatives and semicolon-separated files.
- **Session list and print:** the last 8 predictions (kept in the browser tab only), copy summary, print.

## What is in this folder

| File | Purpose |
|---|---|
| `run.bat` / `run.sh` | One-step start for Windows / Linux and macOS |
| `app.py` | The server and API |
| `static/` | The web page (`index.html`, `style.css`, `app.js`) |
| `make_demo_model.py` | Builds a demo model so you can try the app without Colab |
| `selftest.py` | Checks that every part works |
| `colab/export_from_colab.py` | The two cells to paste into Colab to export your own model |
| `requirements-web.txt` | `fastapi` and `uvicorn` |
| `requirements-demo.txt` | Packages for the demo model |
| `requirements-dev.txt` | Only needed for `selftest.py` |

## Quick start on Windows with VS Code

### 1. Install the tools (once)
- **Python 3.10 or newer, 64-bit**, from python.org/downloads. Tick **Add python.exe to PATH**.
  If you will use your Colab model, install the same first two numbers as Colab's Python (for example 3.12).
- **VS Code** from code.visualstudio.com, then the **Python** extension from the Extensions panel.

### 2. Put the project in a short folder
Extract this zip to something like `C:\skyscreen` (no spaces).

### 3. Open it in VS Code
**File > Open Folder...** and choose `C:\skyscreen`, then **Terminal > New Terminal**.

### 4. Start it
Pick one:

**A. Try it with the built-in demo model.** In the terminal run:
```powershell
.\run.bat
```
The first run creates `.venv`, installs the packages (internet needed once), builds the demo model,
and opens http://127.0.0.1:8000 in your browser. Later runs start in seconds.

**B. Use your own Colab model.**
1. In Colab, run your notebook from the top, then paste the two cells from `colab/export_from_colab.py`
   and run them. `deploy_pack.zip` downloads.
2. Extract it and copy these files into the project folder, next to `app.py`:
   `breast_cancer_model.joblib`, `model_info.json`, `requirements.txt`, `sample_patients.csv`,
   `expected_from_colab.csv`.
3. Run `.\run.bat`. Because `requirements.txt` is there, it installs the exact versions from Colab.
   The pill in the top right will say **Colab model**.

Leave the terminal open while you use the page. Press **Ctrl+C** in the terminal to stop.

### Doing it by hand instead of run.bat
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt        # your Colab file; for the demo use requirements-demo.txt
python -m pip install -r requirements-web.txt
python make_demo_model.py                        # demo only; skip if you copied your Colab files
python -m uvicorn app:app
```
Then open http://127.0.0.1:8000. If PowerShell blocks activation, run
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` first.
Select the `.venv` interpreter in VS Code with `Ctrl+Shift+P`, **Python: Select Interpreter**.

### Linux or macOS
```bash
bash run.sh
```

## Using the page

1. On **Single patient**, choose an example or type values, then press **Predict**.
   Hover a box to see the typical range for that measurement.
2. Read the gauge and the influence bars. Red bars push towards malignant, blue towards benign.
3. On **Batch CSV**, press **Download template** to get a correctly named file (it already contains the
   five examples), fill in your rows, then drop it on the page.

## Check that everything works

```powershell
python -m pip install -r requirements-dev.txt
python selftest.py
```
It should end with `All checks passed.` It also confirms the app reproduces `expected_from_colab.csv`.

## Troubleshooting

| What you see | Fix |
|---|---|
| `'python' is not recognized` | Reinstall Python with **Add python.exe to PATH**, then open a new terminal. |
| Scripts are disabled when activating | Use `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`, or run `run.bat` which avoids PowerShell activation. |
| `No matching distribution found` during install | Your Python differs from Colab's. Install the matching first two numbers, delete `.venv`, run `run.bat` again. |
| `model_info.json was not found` | Copy your Colab files here, or run `python make_demo_model.py`. |
| Red "Version mismatch" box | Delete `.venv` and run `run.bat` again so `requirements.txt` is installed exactly. |
| `Address already in use` | Run `python -m uvicorn app:app --port 8001` and open `http://127.0.0.1:8001`. |
| Page says it cannot reach SkyScreen | The terminal running it was closed. Start it again. |
| Batch says columns are missing | Use **Download template** and keep the 30 names exactly. |
| Batch says the file uses semicolons | In Excel use **Save As > CSV (Comma delimited)**. |
| Setup fails halfway | Delete the `.venv` folder and run `run.bat` again. |

## Safety

- Trained on 569 patients from a benchmark dataset. The output is a probability, not a diagnosis.
- Everything stays on your computer. Nothing is stored or sent anywhere.
- Keep the default address `127.0.0.1`. Never add `--host 0.0.0.0`: there is no password.
- Only load `.joblib` files you trust, because loading one can run code.
- The influence chart is an approximation (the measurements are related to each other), not a medical explanation.
