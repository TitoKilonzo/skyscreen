"""SkyScreen: a local web app for the saved breast cancer network (teaching only).

Start it from this folder:   python -m uvicorn app:app
Then open:                   http://127.0.0.1:8000
"""
import io
import json
import math
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).parent
DISCLAIMER = "Teaching model. Not for medical decisions."
FAR_OUT_SD = 15        # warn when a value is this many standard deviations from the training average
MAX_BODY = 1_000_000   # bytes accepted for an uploaded CSV
MAX_ROWS = 1000        # patients per batch file


# ---------------------------------------------------------------- loading
def load_model():
    info_path = HERE / "model_info.json"
    if not info_path.exists():
        sys.exit("\nmodel_info.json was not found next to app.py.\n"
                 "  - Using your Colab model? Copy the files from deploy_pack.zip into this folder.\n"
                 "  - Just want to try it? Run:  python make_demo_model.py\n")
    info = json.loads(info_path.read_text())
    model_path = HERE / info["model_file"]
    if not model_path.exists():
        sys.exit(f"\n{info['model_file']} was not found next to app.py. Copy it from deploy_pack.zip.\n")
    return info, joblib.load(model_path)


def find_scaler(model):
    """The StandardScaler inside the pipeline, if there is one."""
    for step in getattr(model, "named_steps", {}).values():
        if hasattr(step, "mean_") and hasattr(step, "scale_"):
            return step
    return None


info, model = load_model()
FEATURES = info["feature_names"]
scaler = find_scaler(model)
MEAN = scaler.mean_ if scaler is not None else None
STD = np.where(scaler.scale_ == 0, 1.0, scaler.scale_) if scaler is not None else None

app = FastAPI(title="SkyScreen (teaching only)", version="2")
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")


class Patient(BaseModel):
    features: dict[str, float]


# ---------------------------------------------------------------- scoring
def label_for(probability: float) -> str:
    return "malignant" if probability >= info["threshold"] else "benign"


def check_values(values: dict) -> dict:
    """Return the 30 values as clean floats, or raise a clear 422 error."""
    missing = [n for n in FEATURES if n not in values]
    if missing:
        raise HTTPException(422, f"{len(missing)} measurement(s) missing, for example: {missing[:3]}")
    clean = {}
    for name in FEATURES:
        value = values[name]
        if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)) \
                or not math.isfinite(value):
            raise HTTPException(422, f"'{name}' must be a number.")
        if value < 0:
            raise HTTPException(422, f"'{name}' cannot be negative.")
        clean[name] = float(value)
    return clean


def far_out(vec: np.ndarray) -> list:
    """Names of measurements very far from anything seen in training."""
    if scaler is None:
        return []
    z = (vec - MEAN) / STD
    return [(FEATURES[i], float(z[i])) for i in range(len(FEATURES)) if abs(z[i]) > FAR_OUT_SD]


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def explain(vec: np.ndarray, p_full: float) -> list:
    """Rough 'what pushed this result' list.

    For each measurement we swap it for the training average and see how far the
    result moves, measured in log-odds (a probability near 0% or 100% barely moves
    in plain percentages, log-odds keeps the differences visible). Positive = pushed
    towards malignant. It is an approximation because the measurements are related.
    """
    if scaler is None:
        return []
    grid = np.tile(vec, (len(FEATURES), 1))
    for i in range(len(FEATURES)):
        grid[i, i] = MEAN[i]
    p_without = model.predict_proba(pd.DataFrame(grid, columns=FEATURES))[:, 1]
    effect = logit(p_full) - logit(p_without)
    top = np.argsort(-np.abs(effect))[:6]
    return [{"name": FEATURES[i], "value": float(vec[i]), "typical": float(MEAN[i]),
             "effect": round(float(effect[i]), 3)} for i in top]


def score_one(values: dict) -> dict:
    clean = check_values(values)
    vec = np.array([clean[n] for n in FEATURES])
    frame = pd.DataFrame([vec], columns=FEATURES)
    probability = float(model.predict_proba(frame)[0, 1])
    warnings = [f"{name} = {clean[name]:g} is far outside what the model saw in training "
                f"({z:+.0f} standard deviations from the average). Check your units."
                for name, z in far_out(vec)]
    return {
        "malignant_probability": round(probability, 4),
        "prediction": label_for(probability),
        "threshold": info["threshold"],
        "drivers": explain(vec, probability),
        "warnings": warnings,
        "disclaimer": DISCLAIMER,
        "features": clean,
    }


def read_csv_body(body: bytes) -> pd.DataFrame:
    if len(body) > MAX_BODY:
        raise HTTPException(413, "The file is too large for this demo (the limit is 1 MB).")
    text = body.decode("utf-8-sig", errors="replace")
    if not text.strip():
        raise HTTPException(422, "The file is empty.")
    try:
        # only truly empty cells count as missing, so "n/a" is reported as text, not as empty
        table = pd.read_csv(io.StringIO(text), keep_default_na=False, na_values=[""])
    except (pd.errors.ParserError, pd.errors.EmptyDataError):
        raise HTTPException(422, "The file could not be read as a CSV file.")
    table.columns = [str(c).strip() for c in table.columns]
    if len(table.columns) == 1 and ";" in table.columns[0]:
        raise HTTPException(422, "The file uses semicolons between values. Save it as CSV with commas.")
    return table


# ---------------------------------------------------------------- pages and API
@app.get("/", include_in_schema=False)
def home():
    return FileResponse(HERE / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "features_expected": len(FEATURES)}


@app.get("/api/model-info")
def model_info():
    ranges = {}
    if scaler is not None:
        for i, name in enumerate(FEATURES):
            ranges[name] = {"mean": float(MEAN[i]), "std": float(STD[i])}
    return {
        "feature_names": FEATURES,
        "groups": {
            "mean": [n for n in FEATURES if n.startswith("mean ")],
            "error": [n for n in FEATURES if n.endswith(" error")],
            "worst": [n for n in FEATURES if n.startswith("worst ")],
        },
        "ranges": ranges,
        "threshold": info["threshold"],
        "saved_with_scikit_learn": info["scikit_learn_version"],
        "installed_scikit_learn": sklearn.__version__,
        "saved_on": info["saved_on"],
        "demo": bool(info.get("demo", False)),
        "explanations": scaler is not None,
        "max_rows": MAX_ROWS,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/examples")
def examples():
    path = HERE / "sample_patients.csv"
    if not path.exists():
        return []
    sample = pd.read_csv(path)
    return [{"label": f"Example {i + 1}", "features": sample.iloc[i].to_dict()} for i in range(min(len(sample), 5))]


@app.post("/api/predict")
def predict(patient: Patient):
    return score_one(patient.features)


@app.post("/api/predict/csv")
async def predict_csv(request: Request):
    """One patient from the text of a CSV file (a header row and ONE patient row)."""
    table = read_csv_body(await request.body())
    if len(table) != 1:
        raise HTTPException(422, f"This form scores one patient, but the file has {len(table)} rows. "
                                 "Use the Batch tab for several patients.")
    return score_one(table.iloc[0].to_dict())


@app.post("/api/predict/batch")
async def predict_batch(request: Request):
    """Many patients from the text of a CSV file. Bad rows are reported, not fatal."""
    table = read_csv_body(await request.body())
    if len(table) == 0:
        raise HTTPException(422, "The file has a header row but no patients.")
    if len(table) > MAX_ROWS:
        raise HTTPException(422, f"The file has {len(table)} rows. This demo accepts up to {MAX_ROWS}.")
    missing = [n for n in FEATURES if n not in table.columns]
    if missing:
        raise HTTPException(422, f"{len(missing)} column(s) missing, for example: {missing[:3]}. "
                                 "Use the template from this page.")

    id_column = next((c for c in table.columns if c.lower() in ("patient_id", "id", "patient", "name")), None)
    raw = table[FEATURES]
    numbers = raw.apply(pd.to_numeric, errors="coerce")

    rows = []
    good_index = []
    for position in range(len(table)):
        reason = None
        for name in FEATURES:
            original, parsed = raw.iat[position, FEATURES.index(name)], numbers.iat[position, FEATURES.index(name)]
            if pd.isna(original):
                reason = f"'{name}' is empty"
            elif pd.isna(parsed):
                reason = f"'{name}' is not a number"
            elif parsed < 0:
                reason = f"'{name}' is negative"
            if reason:
                break
        rows.append({
            "row": position + 1,
            "id": str(table[id_column].iat[position]) if id_column else str(position + 1),
            "status": "invalid" if reason else "ok",
            "error": reason,
            "malignant_probability": None,
            "prediction": None,
            "far_out": 0,
        })
        if not reason:
            good_index.append(position)

    if good_index:
        matrix = numbers.iloc[good_index].to_numpy(dtype=float)
        probabilities = model.predict_proba(pd.DataFrame(matrix, columns=FEATURES))[:, 1]
        for k, position in enumerate(good_index):
            rows[position]["malignant_probability"] = round(float(probabilities[k]), 4)
            rows[position]["prediction"] = label_for(float(probabilities[k]))
            rows[position]["far_out"] = len(far_out(matrix[k]))

    return {"rows": rows, "threshold": info["threshold"], "disclaimer": DISCLAIMER}
