"""
One-shot crop training. Run from ml-service/:
    .venv\\Scripts\\python -m training.train_crop
Produces models/*.joblib, models/crop_model_meta.json, knowledge/crop_profiles.json,
reports/metrics.json and reports/*.png.
"""
from training import charts
from training import crop_training as ct


def main() -> None:
    df_raw = ct.load_dataset()
    quality = ct.data_quality_report(df_raw)
    print("Data quality:", quality)
    df = ct.clean(df_raw)

    d = ct.prepare(df)
    results, fitted = ct.evaluate_all(d)
    stack = fitted[ct.STACK_NAME]
    diagnostics = ct.stack_diagnostics(stack, d)

    meta = ct.save_artifacts(stack, d, df, results, diagnostics, quality)
    charts.model_comparison(results, ct.REPORTS_DIR / "model_comparison.png")
    charts.confusion_matrix_plot(diagnostics["confusion_matrix"], diagnostics["labels"],
                                 ct.REPORTS_DIR / "confusion_matrix_stack.png")
    charts.feature_importance_plot(diagnostics["permutation_importance"], ct.REPORTS_DIR / "feature_importance.png")

    print("\n" + results.round(4).to_string())
    print(f"\nSaved model {meta['model_version']} (test accuracy {meta['test_accuracy']}).")


if __name__ == "__main__":
    main()
