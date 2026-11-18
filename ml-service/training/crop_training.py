"""
Crop-recommendation training pipeline (single source of truth).

Used by notebooks/02_crop_models.ipynb (step by step, with outputs) and by
`python -m training.train_crop` (one shot). Steps:

  1. load + data-quality report (missing values, duplicates, class balance)
  2. label-encode, stratified 80/20 split, StandardScaler fitted on TRAIN only
  3. baselines (DecisionTree, RandomForest, LogisticRegression, SVM) vs a
     StackingClassifier (RF + ExtraTrees + GradientBoosting -> LogisticRegression, 5-fold)
  4. stratified 5-fold CV on the training set (scaler inside a Pipeline, so no leakage)
     plus held-out test metrics: accuracy, macro precision / recall / F1
  5. confusion matrix + permutation feature importance for the stacked model
  6. save artifacts (model, scaler, encoder, meta) and knowledge/crop_profiles.json
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    RandomForestClassifier,
    StackingClassifier,
)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

FEATURES = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
TARGET = "label"
SEED = 42
STACK_NAME = "Stacked Ensemble"

ML_ROOT = Path(__file__).resolve().parent.parent  # ml-service/
PROJECT_ROOT = ML_ROOT.parent  # agri-dss/
DATA_FILE = ML_ROOT / "data" / "Crop_recommendation.csv"
MODELS_DIR = ML_ROOT / "models"
KNOWLEDGE_DIR = ML_ROOT / "knowledge"
REPORTS_DIR = PROJECT_ROOT / "reports"


# --- 1. data --------------------------------------------------------------------------------------

def load_dataset(path: Path = DATA_FILE) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing_cols = set(FEATURES + [TARGET]) - set(df.columns)
    if missing_cols:
        raise ValueError(f"dataset is missing columns: {sorted(missing_cols)}")
    return df[FEATURES + [TARGET]]


def data_quality_report(df: pd.DataFrame) -> dict:
    return {
        "rows": int(len(df)),
        "classes": int(df[TARGET].nunique()),
        "missing_values": {c: int(v) for c, v in df.isna().sum().items()},
        "duplicate_rows": int(df.duplicated().sum()),
        "rows_per_class": {"min": int(df[TARGET].value_counts().min()), "max": int(df[TARGET].value_counts().max())},
    }


def clean(df: pd.DataFrame) -> pd.DataFrame:
    return df.dropna().drop_duplicates().reset_index(drop=True)


# --- 2. preprocessing -----------------------------------------------------------------------------

def prepare(df: pd.DataFrame):
    """Encode labels, stratified 80/20 split, scale. Returns a dict of everything downstream needs."""
    encoder = LabelEncoder().fit(df[TARGET])
    X = df[FEATURES].to_numpy(dtype=float)
    y = encoder.transform(df[TARGET])
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    scaler = StandardScaler().fit(X_train)  # fitted on train only
    return {
        "encoder": encoder,
        "scaler": scaler,
        "X_train": X_train,
        "X_test": X_test,
        "y_train": y_train,
        "y_test": y_test,
        "X_train_s": scaler.transform(X_train),
        "X_test_s": scaler.transform(X_test),
    }


# --- 3. models ------------------------------------------------------------------------------------

def cv_splitter() -> StratifiedKFold:
    return StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)


def build_baselines() -> dict:
    return {
        "Decision Tree": DecisionTreeClassifier(random_state=SEED),
        "Random Forest": RandomForestClassifier(n_estimators=300, random_state=SEED, n_jobs=-1),
        "Logistic Regression": LogisticRegression(max_iter=5000, random_state=SEED),
        "SVM (RBF)": SVC(kernel="rbf", C=10, gamma="scale", random_state=SEED),
    }


def build_stack() -> StackingClassifier:
    base = [
        ("rf", RandomForestClassifier(n_estimators=300, random_state=SEED, n_jobs=-1)),
        ("et", ExtraTreesClassifier(n_estimators=300, random_state=SEED, n_jobs=-1)),
        # subsample < 1 = stochastic gradient boosting: faster on 22 classes and slightly regularized
        ("gb", GradientBoostingClassifier(n_estimators=150, learning_rate=0.1, max_depth=3, subsample=0.8, random_state=SEED)),
    ]
    return StackingClassifier(
        estimators=base,
        final_estimator=LogisticRegression(max_iter=5000, random_state=SEED),
        cv=cv_splitter(),  # meta-model is trained on out-of-fold base-model probabilities
        stack_method="predict_proba",
        n_jobs=1,
    )


def all_models() -> dict:
    return {**build_baselines(), STACK_NAME: build_stack()}


# --- 4. evaluation --------------------------------------------------------------------------------

def evaluate_model(name: str, model, d: dict) -> tuple[dict, object]:
    """Stratified 5-fold CV on train (scaler inside the pipeline) + fit on full train, score on test."""
    pipe = Pipeline([("scaler", StandardScaler()), ("model", model)])
    t0 = time.perf_counter()
    cv = cross_validate(
        pipe, d["X_train"], d["y_train"], cv=cv_splitter(),
        scoring=["accuracy", "f1_macro"], n_jobs=1,
    )
    cv_time = time.perf_counter() - t0

    t0 = time.perf_counter()
    fitted = sklearn.clone(model).fit(d["X_train_s"], d["y_train"])
    fit_time = time.perf_counter() - t0
    y_pred = fitted.predict(d["X_test_s"])
    p, r, f1, _ = precision_recall_fscore_support(d["y_test"], y_pred, average="macro", zero_division=0)

    return {
        "model": name,
        "cv_accuracy_mean": float(cv["test_accuracy"].mean()),
        "cv_accuracy_std": float(cv["test_accuracy"].std()),
        "cv_f1_macro_mean": float(cv["test_f1_macro"].mean()),
        "test_accuracy": float(accuracy_score(d["y_test"], y_pred)),
        "test_precision_macro": float(p),
        "test_recall_macro": float(r),
        "test_f1_macro": float(f1),
        "fit_seconds": round(fit_time, 2),
        "cv_seconds": round(cv_time, 2),
    }, fitted


def evaluate_all(d: dict, verbose: bool = True) -> tuple[pd.DataFrame, dict]:
    rows, fitted = [], {}
    for name, model in all_models().items():
        row, fitted[name] = evaluate_model(name, model, d)
        rows.append(row)
        if verbose:
            print(f"{name:<20} cv_acc={row['cv_accuracy_mean']:.4f}±{row['cv_accuracy_std']:.4f} "
                  f"test_acc={row['test_accuracy']:.4f} f1={row['test_f1_macro']:.4f} ({row['cv_seconds']}s)")
    return pd.DataFrame(rows).set_index("model"), fitted


def stack_diagnostics(stack, d: dict) -> dict:
    """Confusion matrix, per-class report, and permutation importance for the stacked model."""
    labels = list(d["encoder"].classes_)
    y_pred = stack.predict(d["X_test_s"])
    perm = permutation_importance(
        stack, d["X_test_s"], d["y_test"], n_repeats=10, random_state=SEED, scoring="accuracy", n_jobs=1
    )
    rf = stack.named_estimators_["rf"]
    return {
        "labels": labels,
        "confusion_matrix": confusion_matrix(d["y_test"], y_pred).tolist(),
        "classification_report": classification_report(
            d["y_test"], y_pred, target_names=labels, output_dict=True, zero_division=0
        ),
        "permutation_importance": {
            f: {"mean": float(m), "std": float(s)}
            for f, m, s in zip(FEATURES, perm.importances_mean, perm.importances_std)
        },
        "rf_impurity_importance": {f: float(v) for f, v in zip(FEATURES, rf.feature_importances_)},
    }


# --- 6. artifacts ---------------------------------------------------------------------------------

def crop_profiles(df: pd.DataFrame) -> dict:
    """Per-crop mean/std/min/max of every feature: ideal ranges for weather_score and fertilizer rules."""
    out = {}
    for crop, g in df.groupby(TARGET):
        out[crop] = {
            f: {
                "mean": round(float(g[f].mean()), 2),
                "std": round(float(g[f].std(ddof=1)), 2),
                "min": round(float(g[f].min()), 2),
                "max": round(float(g[f].max()), 2),
            }
            for f in FEATURES
        }
    return out


def save_artifacts(stack, d: dict, df: pd.DataFrame, results: pd.DataFrame, diagnostics: dict, quality: dict) -> dict:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    trained_at = datetime.now(timezone.utc)
    version = f"crop-stack-v1-{trained_at:%Y%m%d}"
    joblib.dump(stack, MODELS_DIR / "crop_stack.joblib", compress=3)
    joblib.dump(d["scaler"], MODELS_DIR / "scaler.joblib")
    joblib.dump(d["encoder"], MODELS_DIR / "label_encoder.joblib")

    stack_row = results.loc[STACK_NAME]
    meta = {
        "model_version": version,
        "trained_at": trained_at.isoformat(timespec="seconds"),
        "sklearn_version": sklearn.__version__,
        "features": FEATURES,
        "classes": list(d["encoder"].classes_),
        "test_accuracy": round(float(stack_row["test_accuracy"]), 4),
        "test_f1_macro": round(float(stack_row["test_f1_macro"]), 4),
    }
    (MODELS_DIR / "crop_model_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    (KNOWLEDGE_DIR / "crop_profiles.json").write_text(
        json.dumps({"source": "Crop_recommendation.csv per-crop statistics", "crops": crop_profiles(df)}, indent=2),
        encoding="utf-8",
    )

    metrics = {
        "model_version": version,
        "generated_at": meta["trained_at"],
        "dataset": {"file": DATA_FILE.name, **quality},
        "protocol": {
            "split": "stratified 80/20 hold-out, random_state=42",
            "cv": "stratified 5-fold on the training set, StandardScaler inside the pipeline",
            "train_rows": int(len(d["y_train"])),
            "test_rows": int(len(d["y_test"])),
        },
        "comparison": results.reset_index().round(4).to_dict(orient="records"),
        "stacked_ensemble": diagnostics,
    }
    (REPORTS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return meta
