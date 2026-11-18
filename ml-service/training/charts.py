"""
Report charts (static PNG, light theme) for reports/.

Palette: validated categorical slots 1-3 (blue, orange, aqua), a single-hue sequential ramp
for the confusion matrix, text in neutral inks (never series colour), recessive grid.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless: works in scripts, notebooks and CI
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]  # categorical slots 1-3, fixed order
INK, INK_2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e5e4e0", "#fcfcfb"
SEQ_BLUE = LinearSegmentedColormap.from_list("seq_blue", ["#f4f8fd", "#a9c8f0", "#2a78d6", "#0d3c7a"])

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK_2, "xtick.color": INK_2, "ytick.color": INK_2,
    "text.color": INK, "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
})


def model_comparison(results: pd.DataFrame, out: Path) -> Path:
    """Dot plot: one row per model, one marker per metric. Dots need no zero baseline, so a
    zoomed axis (all models score 0.9+) is honest here, unlike truncated bars."""
    metrics = [("cv_accuracy_mean", "CV accuracy (5-fold)"), ("test_accuracy", "Test accuracy"),
               ("test_f1_macro", "Test F1 (macro)")]
    df = results.sort_values("test_f1_macro")
    fig, ax = plt.subplots(figsize=(8, 0.6 * len(df) + 1.6))
    y = np.arange(len(df))
    offsets = (-0.18, 0, 0.18)
    for (col, label), color, off in zip(metrics, SERIES, offsets):
        ax.scatter(df[col], y + off, s=70, color=color, label=label, zorder=3, edgecolors=SURFACE, linewidths=2)
    # Single direct label: the headline number per model (test F1), in ink, not series colour.
    for yi, v in zip(y, df["test_f1_macro"]):
        ax.annotate(f"{v:.3f}", (v, yi + 0.18), xytext=(8, 0), textcoords="offset points",
                    va="center", fontsize=9, color=INK_2)
    lo = max(0.0, np.floor(df[[m for m, _ in metrics]].to_numpy().min() * 50) / 50 - 0.01)
    ax.set_xlim(lo, 1.005)
    ax.set_yticks(y, df.index)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xlabel("Score")
    ax.set_title("Crop recommendation: baselines vs stacked ensemble", loc="left")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.14), ncol=3, frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    plt.close(fig)
    return out


def confusion_matrix_plot(cm: list[list[int]], labels: list[str], out: Path) -> Path:
    cm = np.asarray(cm)
    fig, ax = plt.subplots(figsize=(10, 9))
    im = ax.imshow(cm, cmap=SEQ_BLUE, vmin=0)
    ax.set_xticks(range(len(labels)), labels, rotation=60, ha="right", fontsize=8)
    ax.set_yticks(range(len(labels)), labels, fontsize=8)
    ax.spines[:].set_visible(False)
    thresh = cm.max() * 0.55
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            if cm[i, j]:  # label non-zero cells only: keeps off-diagonal errors visible
                ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=8,
                        color="white" if cm[i, j] > thresh else INK)
    ax.set_xlabel("Predicted crop")
    ax.set_ylabel("Actual crop")
    acc = np.trace(cm) / cm.sum()
    ax.set_title(f"Stacked ensemble: confusion matrix on test set (n={cm.sum()}, accuracy {acc:.3f})", loc="left")
    fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02, label="Samples")
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    plt.close(fig)
    return out


def feature_importance_plot(perm: dict, out: Path) -> Path:
    items = sorted(perm.items(), key=lambda kv: kv[1]["mean"])
    names = [k for k, _ in items]
    means = [v["mean"] for _, v in items]
    stds = [v["std"] for _, v in items]
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.barh(names, means, xerr=stds, color=SERIES[0], height=0.6,
            error_kw={"ecolor": INK_2, "elinewidth": 1, "capsize": 3}, edgecolor=SURFACE, linewidth=2)
    for yi, (m, s) in enumerate(zip(means, stds)):
        ax.annotate(f"{m:.3f}", (m + s, yi), xytext=(6, 0), textcoords="offset points", va="center",
                    fontsize=9, color=INK_2)
    ax.set_xlim(0, max(m + s for m, s in zip(means, stds)) * 1.18)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_xlabel("Drop in test accuracy when the feature is shuffled (mean ± std, 10 repeats)")
    ax.set_title("Stacked ensemble: permutation feature importance", loc="left")
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    plt.close(fig)
    return out
