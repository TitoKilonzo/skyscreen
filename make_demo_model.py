"""Build a small demo model so SkyScreen works without Colab.

It trains the same kind of network (scaler + neural network) on scikit-learn's built-in
breast cancer dataset and writes the same files your Colab deploy_pack contains.

    python make_demo_model.py           # creates the files if they are missing
    python make_demo_model.py --force   # replaces existing files (including a Colab model!)
"""
import datetime
import json
import sys
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).parent
MODEL_FILE = HERE / "breast_cancer_model.joblib"


def main():
    if MODEL_FILE.exists() and "--force" not in sys.argv:
        print("A model is already here, so nothing was changed. Use --force to replace it.")
        return

    data = load_breast_cancer(as_frame=True)
    X = data.data
    y = 1 - data.target                      # in this dataset 0 = malignant, so flip it: malignant = 1
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42, stratify=y)

    net = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(16,), max_iter=2000, random_state=0))
    net.fit(X_train, y_train)
    accuracy = net.score(X_test, y_test)

    joblib.dump(net, MODEL_FILE)
    info = {
        "model_file": MODEL_FILE.name,
        "python_version": sys.version.split()[0],
        "scikit_learn_version": sklearn.__version__,
        "feature_names": list(X.columns),
        "malignant_is": 1,
        "threshold": 0.5,
        "saved_on": str(datetime.date.today()),
        "demo": True,
    }
    (HERE / "model_info.json").write_text(json.dumps(info, indent=2))

    # sample patients: pick two clear malignant and three clear benign cases from the test set
    probabilities = net.predict_proba(X_test)[:, 1]
    picks = list(X_test.index[probabilities > 0.9][:2]) + list(X_test.index[probabilities < 0.1][:3])
    sample = X_test.loc[picks]
    sample.to_csv(HERE / "sample_patients.csv", index=False)
    pd.DataFrame({"malignant_probability": net.predict_proba(sample)[:, 1].round(4)}) \
        .to_csv(HERE / "expected_from_colab.csv", index=False)

    print(f"Demo model saved (accuracy on held-out patients: {accuracy:.3f}).")
    print("Files: breast_cancer_model.joblib, model_info.json, sample_patients.csv, expected_from_colab.csv")


if __name__ == "__main__":
    main()
