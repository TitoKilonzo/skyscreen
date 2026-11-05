# ===== CELL 1: run in your Colab notebook (after running it from the top) =====
import json, sys, shutil, datetime
from pathlib import Path
import joblib, scipy, threadpoolctl
import sklearn, numpy as np, pandas as pd

pack = Path("deploy_pack")
pack.mkdir(exist_ok=True)

# 1. The whole pipeline: scaler and network together
joblib.dump(final_net, pack / "breast_cancer_model.joblib")

# 2. Exact package versions
(pack / "requirements.txt").write_text(
    f"scikit-learn=={sklearn.__version__}\n"
    f"numpy=={np.__version__}\n"
    f"scipy=={scipy.__version__}\n"
    f"pandas=={pd.__version__}\n"
    f"joblib=={joblib.__version__}\n"
    f"threadpoolctl=={threadpoolctl.__version__}\n")

# 3. Model details
info = {
    "model_file": "breast_cancer_model.joblib",
    "python_version": sys.version.split()[0],
    "scikit_learn_version": sklearn.__version__,
    "feature_names": list(X.columns),
    "malignant_is": 1,
    "threshold": 0.5,
    "saved_on": str(datetime.date.today()),
}
(pack / "model_info.json").write_text(json.dumps(info, indent=2))

# 4. Five sample patients and Colab's answers
sample = X_test.iloc[:5]
sample.to_csv(pack / "sample_patients.csv", index=False)
expected = pd.DataFrame({"malignant_probability": final_net.predict_proba(sample)[:, 1].round(4)})
expected.to_csv(pack / "expected_from_colab.csv", index=False)

print("Python", info["python_version"], "| scikit-learn", info["scikit_learn_version"])
print(sorted(p.name for p in pack.iterdir()))


# ===== CELL 2: zip and download =====
shutil.make_archive("deploy_pack", "zip", "deploy_pack")
from google.colab import files
files.download("deploy_pack.zip")
