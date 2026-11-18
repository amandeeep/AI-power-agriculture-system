"""
Train the leaf-disease model on a CPU (no GPU needed). Run from ml-service/:
    .venv\\Scripts\\python -m training.train_disease --data data/plantvillage
CPU version of notebooks/03 (which needs a Colab GPU):
  1. frozen ImageNet MobileNetV2 runs ONCE over every image -> 1280-d features (cached to disk);
  2. a Dropout + Dense softmax head is trained on those features (seconds per epoch);
  3. the head is attached to the frozen base and saved as ONE .keras model that takes raw 0-255
     224x224 RGB, exactly the format app/services/disease.py and the registry expect.
There is no fine-tuning of the base (too slow on a CPU). Augmentation = horizontal-flip copies of the
training images (--flip-aug).
Outputs: models/disease_mnv2.keras, models/class_names.json, reports/disease_metrics.json,
reports/disease_confusion_matrix.png, reports/disease_training_curves.png.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR, REPORTS_DIR, KNOWLEDGE_DIR = ROOT / "models", ROOT.parent / "reports", ROOT / "knowledge"
IMG_SIZE, SEED = (224, 224), 42
BACKGROUND_CLASS = "Background_without_leaves"  # PlantVillage's non-leaf photos -> "no leaf found" in the service
EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


def _norm(name: str) -> str:
    name = name.lower().replace("(including_sour)", "").replace("(maize)", "")
    return re.sub(r"[^a-z]", "", name)


def map_folders(data_dir: Path) -> dict[Path, str]:
    """Dataset folder -> canonical PlantVillage class name (the keys of disease_treatments.json)."""
    canon = sorted(json.loads((KNOWLEDGE_DIR / "disease_treatments.json").read_text(encoding="utf-8"))["classes"])
    by_norm = {_norm(c): c for c in canon}
    mapping, skipped = {}, []
    for d in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        c = BACKGROUND_CLASS if d.name == BACKGROUND_CLASS else by_norm.get(_norm(d.name))
        if c:
            mapping[d] = c
        else:
            skipped.append(d.name)
    missing = set(canon) - set(mapping.values())
    if missing:
        raise SystemExit(f"Dataset is missing classes: {sorted(missing)} (folders found: {[d.name for d in data_dir.iterdir()]})")
    print(f"{len(mapping)} class folders mapped; skipped: {skipped or 'none'}")
    return mapping


def list_images(mapping: dict[Path, str]) -> tuple[list[str], np.ndarray, list[str]]:
    class_names = sorted(set(mapping.values()))
    idx = {c: i for i, c in enumerate(class_names)}
    paths, labels = [], []
    for folder, cls in mapping.items():
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in EXTS:
                paths.append(str(f)); labels.append(idx[cls])
    return paths, np.array(labels), class_names


def build_base(tf):
    keras = tf.keras
    inputs = keras.Input(shape=IMG_SIZE + (3,), name="image")  # raw 0-255 RGB
    x = keras.layers.Rescaling(1 / 127.5, offset=-1, name="mobilenet_preprocess")(inputs)
    base = keras.applications.MobileNetV2(input_shape=IMG_SIZE + (3,), include_top=False, weights="imagenet")
    base.trainable = False
    x = base(x, training=False)
    x = keras.layers.GlobalAveragePooling2D(name="gap")(x)
    return keras.Model(inputs, x, name="mnv2_features")


def extract(tf, extractor, paths: list[str], flip: bool, batch: int) -> np.ndarray:
    def load(p):
        img = tf.io.decode_image(tf.io.read_file(p), channels=3, expand_animations=False)
        img = tf.image.resize(tf.cast(img, tf.float32), IMG_SIZE, method="bilinear", antialias=True)
        return tf.image.flip_left_right(img) if flip else img

    ds = tf.data.Dataset.from_tensor_slices(paths).map(load, num_parallel_calls=4).batch(batch).prefetch(2)
    out, done, t0 = [], 0, time.time()
    for xb in ds:
        out.append(extractor(xb, training=False).numpy()); done += len(xb)
        if len(out) % 20 == 0:
            rate = done / (time.time() - t0)
            print(f"  {done}/{len(paths)} images  {rate:.0f} img/s  ~{(len(paths) - done) / rate / 60:.1f} min left", flush=True)
    return np.concatenate(out).astype(np.float32)


def cached_features(tf, extractor, paths: list[str], cache: Path, flip: bool, batch: int) -> np.ndarray:
    """Features per image path; only images missing from the cache are run through the network."""
    known: dict[str, np.ndarray] = {}
    if cache.exists():
        c = np.load(cache, allow_pickle=False)
        if "paths" in c:
            known = dict(zip(c["paths"].tolist(), c["X"]))
    todo = [p for p in paths if p not in known]
    print(f"Features: {len(paths) - len(todo)} cached, {len(todo)} to extract ({cache.name})")
    if todo:
        known.update(zip(todo, extract(tf, extractor, todo, flip, batch)))
        keys = sorted(known)
        np.savez(cache, paths=np.array(keys), X=np.stack([known[k] for k in keys]))
    return np.stack([known[p] for p in paths]).astype(np.float32)


def charts(hist, cm, class_names, acc, n_test) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    from matplotlib.colors import LinearSegmentedColormap

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for ax, key, title in ((axes[0], "accuracy", "Accuracy"), (axes[1], "loss", "Loss")):
        ax.plot(hist[key], color="#2a78d6", label="train")
        ax.plot(hist["val_" + key], color="#eb6834", label="validation")
        ax.set_title(title, loc="left", fontweight="bold"); ax.set_xlabel("Epoch"); ax.legend(frameon=False)
        ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(REPORTS_DIR / "disease_training_curves.png", dpi=130); plt.close(fig)

    short = [c.replace("___", ": ").replace("_", " ")[:32] for c in class_names]
    fig, ax = plt.subplots(figsize=(16, 14))
    sns.heatmap(cm, cmap=LinearSegmentedColormap.from_list("b", ["#f4f8fd", "#a9c8f0", "#2a78d6", "#0d3c7a"]),
                xticklabels=short, yticklabels=short, square=True, cbar_kws={"shrink": 0.6, "label": "Images"}, ax=ax)
    ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
    ax.set_title(f"MobileNetV2: confusion matrix on test set (n={n_test}, accuracy {acc:.3f})", loc="left", fontweight="bold")
    fig.tight_layout(); fig.savefig(REPORTS_DIR / "disease_confusion_matrix.png", dpi=130); plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/plantvillage", help="folder with one sub-folder per class")
    ap.add_argument("--flip-aug", action="store_true", help="add horizontally flipped copies of the training images")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--epochs", type=int, default=40)
    args = ap.parse_args()

    import tensorflow as tf
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, precision_recall_fscore_support
    from sklearn.model_selection import train_test_split
    keras = tf.keras
    tf.keras.utils.set_random_seed(SEED)

    data_dir = (ROOT / args.data).resolve() if not Path(args.data).is_absolute() else Path(args.data)
    paths, labels, class_names = list_images(map_folders(data_dir))
    print(f"{len(paths)} images, {len(class_names)} classes")
    idx = np.arange(len(paths))
    tr, rest = train_test_split(idx, test_size=0.2, stratify=labels, random_state=SEED)
    va, te = train_test_split(rest, test_size=0.5, stratify=labels[rest], random_state=SEED)
    print(f"split train {len(tr)} / val {len(va)} / test {len(te)}")

    extractor = build_base(tf)
    X = cached_features(tf, extractor, paths, ROOT / "data" / "plantvillage_features.npz", False, args.batch)
    Xf = None
    if args.flip_aug:
        print("Flipped training copies...")
        Xf = np.zeros_like(X)
        Xf[tr] = cached_features(tf, extractor, [paths[i] for i in tr],
                                 ROOT / "data" / "plantvillage_features_flip.npz", True, args.batch)

    Xtr, ytr = X[tr], labels[tr]
    if Xf is not None:
        Xtr, ytr = np.concatenate([Xtr, Xf[tr]]), np.concatenate([ytr, ytr])

    head_in = keras.Input(shape=(X.shape[1],))
    h = keras.layers.Dropout(0.3, name="dropout")(head_in)
    h = keras.layers.Dense(len(class_names), activation="softmax", name="predictions")(h)
    head = keras.Model(head_in, h)
    head.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    cbs = [keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=5, restore_best_weights=True),
           keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.3, patience=2, min_lr=1e-6)]
    t0 = time.time()
    hist = head.fit(Xtr, ytr, validation_data=(X[va], labels[va]), epochs=args.epochs, batch_size=128,
                    callbacks=cbs, verbose=2).history
    print(f"Head trained in {time.time() - t0:.0f} s")

    y_prob = head.predict(X[te], verbose=0); y_true = labels[te]; y_pred = y_prob.argmax(1)
    acc = accuracy_score(y_true, y_pred)
    p, r, f1, _ = precision_recall_fscore_support(y_true, y_pred, average="macro", zero_division=0)
    top3 = float(np.mean([t in row for t, row in zip(y_true, np.argsort(y_prob, 1)[:, -3:])]))
    low_conf = float(np.mean(y_prob.max(1) < 0.5))
    print(f"TEST accuracy {acc:.4f} | macro P {p:.4f} R {r:.4f} F1 {f1:.4f} | top-3 {top3:.4f} | below 0.5 conf {low_conf:.4f}")
    report = classification_report(y_true, y_pred, target_names=class_names, output_dict=True, zero_division=0)

    # One end-to-end model: raw image -> probabilities.
    inp = keras.Input(shape=IMG_SIZE + (3,), name="image")
    out = head.get_layer("predictions")(head.get_layer("dropout")(extractor(inp)))
    model = keras.Model(inp, out, name="disease_mnv2")
    MODELS_DIR.mkdir(exist_ok=True); REPORTS_DIR.mkdir(exist_ok=True)
    model.save(MODELS_DIR / "disease_mnv2.keras")
    (MODELS_DIR / "class_names.json").write_text(json.dumps(class_names, indent=2), encoding="utf-8")

    # Sanity check: reload and run the SERVICE's own preprocessing on a few test images.
    from app.services.disease import preprocess
    reloaded = keras.models.load_model(MODELS_DIR / "disease_mnv2.keras")
    sample = te[:: max(1, len(te) // 50)][:50]
    agree = np.mean([reloaded.predict(preprocess(Path(paths[i]).read_bytes()), verbose=0)[0].argmax() == labels[i] for i in sample])
    print(f"Reloaded model through the service preprocessing: {agree:.2%} correct on {len(sample)} test images")

    metrics = {
        "model_version": f"disease-mnv2-v1-{datetime.now(timezone.utc):%Y%m%d}",
        "tensorflow_version": tf.__version__,
        "method": "frozen ImageNet MobileNetV2 features + Dropout(0.3)/Dense softmax head, trained on CPU"
                  + (" with horizontal-flip augmentation" if args.flip_aug else "") + "; no base fine-tuning",
        "dataset": {"name": "PlantVillage (color, without augmentation; Mendeley Data tywbtsjrjv v1)",
                    "images": len(paths), "classes": len(class_names),
                    "split": "80/10/10 train/val/test, stratified, seed 42"},
        "training": {"epochs": len(hist["loss"]), "image_size": list(IMG_SIZE), "head_batch_size": 128},
        "test": {"n": int(len(te)), "accuracy": round(float(acc), 4), "precision_macro": round(float(p), 4),
                 "recall_macro": round(float(r), 4), "f1_macro": round(float(f1), 4),
                 "top3_accuracy": round(top3, 4), "share_below_0_5_confidence": round(low_conf, 4)},
        "service_preprocess_check": {"n": int(len(sample)), "accuracy": round(float(agree), 4)},
        "per_class": {k: v for k, v in report.items() if k in class_names},
    }
    (REPORTS_DIR / "disease_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    charts(hist, confusion_matrix(y_true, y_pred), class_names, acc, len(te))
    print(f"Saved models/disease_mnv2.keras ({(MODELS_DIR / 'disease_mnv2.keras').stat().st_size / 1e6:.1f} MB) + reports.")


if __name__ == "__main__":
    main()
