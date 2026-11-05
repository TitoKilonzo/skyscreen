"""Quick check that every part of SkyScreen works.  Run:  python selftest.py
(needs:  python -m pip install -r requirements-dev.txt)"""
import io
import json
import sys

from fastapi.testclient import TestClient

import app as skyscreen

client = TestClient(skyscreen.app)
failures = []


def check(name, condition, detail=""):
    print(("PASS  " if condition else "FAIL  ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


info = client.get("/api/model-info").json()
names = info["feature_names"]
check("model-info lists 30 features", len(names) == 30)
check("page and assets are served", all(client.get(p).status_code == 200 for p in ("/", "/static/app.js", "/static/style.css")))

examples = client.get("/api/examples").json()
check("examples are available", len(examples) >= 1)

first = client.post("/api/predict", json={"features": examples[0]["features"]}).json()
check("predict returns a probability and label", 0 <= first["malignant_probability"] <= 1 and first["prediction"] in ("benign", "malignant"))
check("predict returns influence list", len(first["drivers"]) == 6 if info["explanations"] else True)

# same answers as the saved expected file (when it exists)
import pandas as pd
sample = pd.read_csv(skyscreen.HERE / "sample_patients.csv")
expected = pd.read_csv(skyscreen.HERE / "expected_from_colab.csv")["malignant_probability"]
got = [client.post("/api/predict", json={"features": sample.iloc[i].to_dict()}).json()["malignant_probability"] for i in range(len(sample))]
check("matches expected_from_colab.csv", max(abs(a - b) for a, b in zip(got, expected)) <= 0.0001)

bad = dict(examples[0]["features"]); bad.pop(names[0])
check("missing measurement gives 422", client.post("/api/predict", json={"features": bad}).status_code == 422)
neg = dict(examples[0]["features"]); neg[names[1]] = -1
check("negative value gives 422", client.post("/api/predict", json={"features": neg}).status_code == 422)
huge = dict(examples[0]["features"]); huge[names[3]] = 1e9
check("absurd value gives a warning", len(client.post("/api/predict", json={"features": huge}).json()["warnings"]) >= 1 or not info["explanations"])

one = sample.iloc[[0]].to_csv(index=False)
check("single-patient CSV works", client.post("/api/predict/csv", content=one).status_code == 200)
check("two-row CSV is refused on the single endpoint", client.post("/api/predict/csv", content=sample.to_csv(index=False)).status_code == 422)

batch_df = sample.copy().astype(object)
batch_df.insert(0, "patient_id", [f"P{i + 1}" for i in range(len(batch_df))])
batch_df.loc[1, names[2]] = ""            # empty cell
batch_df.loc[2, names[4]] = "n/a"         # text
batch_df.loc[3, names[5]] = -4            # negative
res = client.post("/api/predict/batch", content=batch_df.to_csv(index=False)).json()
status = [r["status"] for r in res["rows"]]
check("batch scores good rows and flags bad ones", status[0] == "ok" and status[1:4] == ["invalid"] * 3, str(status))
check("batch keeps patient ids", res["rows"][0]["id"] == "P1")
check("semicolon file is explained", "semicolon" in client.post("/api/predict/batch", content="a;b;c\n1;2;3\n").json()["detail"])
check("missing columns are explained", client.post("/api/predict/batch", content="a,b\n1,2\n").status_code == 422)
check("empty file is refused", client.post("/api/predict/batch", content="").status_code == 422)

print()
if failures:
    print(f"{len(failures)} check(s) failed.")
    sys.exit(1)
print("All checks passed.")
