import copy
import importlib.util
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest import mock

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

import sync_frontend_ssot as sync_mod
from config import SCRIPTS_DIR
from run_pipeline import main as run_pipeline_main, resolve_stages
from sync_frontend_ssot import (
    build_ssot_payload,
    load_pipeline_metadata,
    read_csv_records_safe,
    resolve_substations_with_p95,
    safe_bool,
    safe_float,
    safe_int,
    safe_str,
    sync_frontend_ssot,
    validate_ssot_cross_consistency,
)


def _make_consistent_synthetic_payload() -> Dict[str, Any]:
    return {
        "substationLoadConcentration": [
            {"substation": "SE Pecém II", "state": "CE", "voltageKV": 500},
            {"substation": "SE Pici", "state": "CE", "voltageKV": 230},
            {"substation": "SE Pici", "state": "CE", "voltageKV": 69},
        ],
        "modelABenchmark2025": [
            {
                "horizon": "Programação Diária (24h Day-Ahead)",
                "architecture": "Challenger Não-Linear · Rede Neural ResMLP (L-BFGS-B)",
                "r2Score": 0.9012,
            }
        ],
        "modelCBenchmark2025": [
            {
                "architecture": "Challenger Não-Linear · GBDT + Rede Neural ResMLP",
                "r2Volume": 0.8975,
            }
        ],
        "monteCarlo12Scenarios2035": [
            {
                "dcScenarioId": "central",
                "windScenarioId": "intermediate",
                "windCapacityMW": 36400.0,
                "probExceedInterchangePct": 11.4,
                "importP95MW": 7450.2,
                "curtailmentWithDcTWh": 19.85,
                "compensatoryWindExpansionGW": 2.14,
            }
        ],
        "transmissionSensitivity2035": [
            {
                "configId": "TX-03 (Referência Base PDE / ONS 2035)",
                "probCriticalImportPct": 11.40,
                "importP95MW": 7450.2,
                "curtailmentWithDcTWh": 19.85,
                "compensatoryWindGW": 2.14,
            }
        ],
        "h2vSynergySensitivity2035": [
            {
                "scenarioId": "H2V-01 · Somente Data Centers 24/7 (Escopo Puro Grupo 6)",
                "h2vNominalMW": 0.0,
                "probCriticalImportPct": 11.40,
                "importP95MW": 7450.2,
                "remainingCurtailmentTWh": 19.85,
                "totalAbsorbedCurtailmentTWh": 3.60,
                "compensatoryWindGW": 2.14,
            },
            {
                "scenarioId": "H2V-04 · DC Central + H2V Pecém/Suape 2,0 GW (Inflexível 24/7)",
                "h2vNominalMW": 2000.0,
                "probCriticalImportPct": 28.40,
                "totalAbsorbedCurtailmentTWh": 11.20,
                "compensatoryWindGW": 10.90,
            },
            {
                "scenarioId": "H2V-05 · DC Central + H2V Pecém/Suape 2,0 GW (Flexível / Sinergia Eólica)",
                "h2vNominalMW": 2000.0,
                "probCriticalImportPct": 13.20,
                "totalAbsorbedCurtailmentTWh": 12.85,
                "compensatoryWindGW": 3.10,
            },
        ],
        "passo5FinalExecutiveReportMd": (
            "# Relatório Técnico Consolidado Final — PTC3567 (Grupo 6)\n"
            "Modelo A 24h R² = 0,9012 | Modelo C R² Volume = 0,8975 | "
            "H2V Inflexível 28,40% (+10,90 GW) | H2V Flexível 12,85 TWh (13,20%)."
        ),
    }


class TestSyncFrontendSsot(unittest.TestCase):
    def test_safe_parsers_handle_blanks_nan_inf_and_ptbr_numbers(self) -> None:
        self.assertEqual(safe_str(None, "fallback"), "fallback")
        self.assertEqual(safe_str("  NaN  ", "fallback"), "fallback")
        self.assertEqual(safe_str("  Pecém II "), "Pecém II")

        self.assertEqual(safe_float("", 3.5), 3.5)
        self.assertEqual(safe_float("NaN", -1.0), -1.0)
        self.assertEqual(safe_float(float("nan"), 0.0), 0.0)
        self.assertEqual(safe_float(float("inf"), 0.0), 0.0)
        self.assertEqual(safe_float("-", 0.0), 0.0)
        self.assertAlmostEqual(safe_float("12,75"), 12.75)
        self.assertAlmostEqual(safe_float("1.596,8"), 1596.8)
        self.assertAlmostEqual(safe_float("1,234.56"), 1234.56)

        self.assertEqual(safe_int("2035.0", 0), 2035)
        self.assertEqual(safe_int("", 230), 230)

        self.assertTrue(safe_bool("True"))
        self.assertTrue(safe_bool("sim"))
        self.assertFalse(safe_bool("false"))
        self.assertFalse(safe_bool("", False))

    def test_read_csv_records_safe_handles_semicolon_bom_and_blank_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "sample.csv"
            csv_path.write_text(
                "\ufeffcol_a;col_b;col_c\n"
                "  ;;  \n"
                "alpha;12,5;\n"
                "beta;NaN;sim\n",
                encoding="utf-8",
            )
            rows = read_csv_records_safe(csv_path)
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["col_a"], "alpha")
            self.assertAlmostEqual(safe_float(rows[0]["col_b"]), 12.5)
            self.assertEqual(safe_float(rows[1]["col_b"], -99.0), -99.0)
            self.assertTrue(safe_bool(rows[1]["col_c"]))

    def test_external_metadata_and_orchestrator_stage_resolution(self) -> None:
        meta = load_pipeline_metadata()
        self.assertEqual(len(meta["dcProjectNotes"]), 14)
        self.assertGreaterEqual(len(meta["featureMetadata"]), 14)
        self.assertEqual(len(meta["scriptsCatalog"]), 7)
        self.assertEqual(len(meta["uiCatalog"]["databasesCatalog"]), 10)
        self.assertEqual(len(meta["uiCatalog"]["groupDecisions"]), 4)
        self.assertEqual(len(meta["uiCatalog"]["observationWindows"]), 5)

        all_stages = resolve_stages()
        self.assertEqual([s.stage_id for s in all_stages], ["01", "02", "03", "04", "05", "06", "07", "ssot"])

        skip_ingest = resolve_stages(skip_ingest=True)
        self.assertEqual([s.stage_id for s in skip_ingest], ["02", "03", "04", "05", "06", "07", "ssot"])

        from_04 = resolve_stages(only_from="04")
        self.assertEqual([s.stage_id for s in from_04], ["04", "05", "06", "07", "ssot"])

        self.assertEqual(run_pipeline_main(["--skip-ingest", "--dry-run"]), 0)
        with self.assertRaises(ValueError):
            resolve_stages(only_from="invalid-stage")

    def test_resolve_substations_with_composite_key_prevents_voltage_collision(self) -> None:
        sub_scen_rows = [
            {
                "subestacao_conexao": "SE Pici",
                "estado": "CE",
                "tensao_conexao_kv": "230",
                "n_projetos": "1",
                "potencia_it_total_mw": "120",
                "demanda_efetiva_2035_mw": "110.0",
                "participacao_pct": "6.9",
            },
            {
                "subestacao_conexao": "SE Pici",
                "estado": "CE",
                "tensao_conexao_kv": "69",
                "n_projetos": "1",
                "potencia_it_total_mw": "40",
                "demanda_efetiva_2035_mw": "35.0",
                "participacao_pct": "2.2",
            },
        ]
        sub_risk_rows = [
            {"subestacao": "SE Pici", "estado": "CE", "tensao_kv": "230", "carga_p95_mw": "148.5"},
            {"subestacao": "SE Pici", "estado": "CE", "tensao_kv": "69", "carga_p95_mw": "49.2"},
        ]

        resolved = resolve_substations_with_p95(sub_scen_rows, sub_risk_rows)
        self.assertEqual(len(resolved), 2)
        by_kv = {(r["substation"], r["state"], r["voltageKV"]): r for r in resolved}
        self.assertAlmostEqual(by_kv[("SE Pici", "CE", 230)]["p95MonteCarloMW"], 148.5)
        self.assertAlmostEqual(by_kv[("SE Pici", "CE", 69)]["p95MonteCarloMW"], 49.2)

    def test_cross_consistency_validator_catches_tx_h2v_md_and_substation_drift(self) -> None:
        valid_payload = _make_consistent_synthetic_payload()
        self.assertEqual(validate_ssot_cross_consistency(valid_payload), [])

        bad_sub = copy.deepcopy(valid_payload)
        bad_sub["substationLoadConcentration"].append(
            {"substation": "SE Pici", "state": "CE", "voltageKV": 230}
        )
        self.assertTrue(any("duplicada" in v for v in validate_ssot_cross_consistency(bad_sub)))

        bad_tx = copy.deepcopy(valid_payload)
        bad_tx["transmissionSensitivity2035"][0]["probCriticalImportPct"] = 9.00
        self.assertTrue(any("probCriticalImport" in v for v in validate_ssot_cross_consistency(bad_tx)))

        bad_md = copy.deepcopy(valid_payload)
        bad_md["passo5FinalExecutiveReportMd"] = bad_md["passo5FinalExecutiveReportMd"].replace("28,40%", "26,40%")
        self.assertTrue(any("H2V 2,0 GW Inflexível" in v for v in validate_ssot_cross_consistency(bad_md)))

    def test_build_ssot_payload_parity_with_official_scripts_and_reports(self) -> None:
        payload = build_ssot_payload()

        self.assertEqual(len(payload["dataCentersPipeline"]), 14)
        total_it = sum(p["itPowerMW"] for p in payload["dataCentersPipeline"])
        self.assertAlmostEqual(total_it, 3495.0, places=1)

        subs = payload["substationLoadConcentration"]
        self.assertEqual(len(subs), 9)
        composite_keys = {(s["substation"], s["state"], s["voltageKV"]) for s in subs}
        self.assertEqual(len(composite_keys), len(subs), "Substation composite keys must be unique")

        self.assertGreaterEqual(len(payload["anovaTestResults"]), 4)
        self.assertEqual(len(payload["monthlyWindProfiles"]), 12)
        self.assertEqual(len(payload["hourlyValidation2025Profile"]), 24)
        self.assertEqual(len(payload["monteCarlo12Scenarios2035"]), 12)
        for row in payload["monteCarlo12Scenarios2035"]:
            self.assertIn(row["windScenarioId"], {"base", "intermediate", "high"})
        expected_tl_len = payload["config"]["targetEndYear"] - payload["config"]["projectionStartYear"] + 1
        self.assertEqual(payload["annualRiskTimeline2026_2035"][0]["year"], payload["config"]["projectionStartYear"])
        self.assertEqual(payload["annualRiskTimeline2026_2035"][-1]["year"], payload["config"]["targetEndYear"])
        self.assertEqual(len(payload["annualRiskTimeline2026_2035"]), expected_tl_len)
        self.assertEqual(len(payload["transmissionSensitivity2035"]), 5)
        self.assertEqual(len(payload["h2vSynergySensitivity2035"]), 5)
        self.assertEqual(len(payload["scriptsPipeline"]), 7)
        self.assertEqual(len(payload["bundleDigest"]), 16)
        self.assertEqual(payload["config"]["hoursPerYear"], 8760)
        self.assertEqual(payload["config"]["projectionStartYear"], 2025)
        self.assertEqual(payload["config"]["targetEndYear"], 2035)
        self.assertEqual(payload["lineage"]["comparativeNonLinearArchitecture"], "Rede Neural ResMLP")
        self.assertIsInstance(payload["lineage"]["localRawCachePresent"], bool)
        self.assertEqual(len(payload["uiCatalog"]["databasesCatalog"]), 10)
        self.assertEqual(len(payload["uiCatalog"]["groupDecisions"]), 4)

        # Every script starterCode must match the real disk file in scripts/*.py verbatim (ignoring CRLF/LF checkout differences)
        for spec in payload["scriptsPipeline"]:
            real_path = SCRIPTS_DIR / spec["filename"]
            self.assertTrue(real_path.exists(), f"Missing real script {real_path}")
            self.assertEqual(
                spec["starterCode"].replace("\r\n", "\n"),
                real_path.read_text(encoding="utf-8").replace("\r\n", "\n"),
                f"SSOT script mismatch for {spec['filename']}",
            )
            self.assertFalse(math.isnan(payload["lineage"]["trainHours"]))

    def test_model_c_stage_c1_wires_residual_mlp_classifier(self) -> None:
        ml_source = (SCRIPTS_DIR / "ml_models_numpy.py").read_text(encoding="utf-8")
        s05_source = (SCRIPTS_DIR / "05_forecast_wind_cf_and_curtailment.py").read_text(encoding="utf-8")
        self.assertIn("class ResidualMLPClassifier:", ml_source)
        self.assertIn("w2_base = solve(", ml_source)
        self.assertIn("ResidualMLPClassifier(", s05_source)
        self.assertIn("cm_mlp", s05_source)

        if importlib.util.find_spec("numpy") and importlib.util.find_spec("scipy"):
            import numpy as np
            from ml_models_numpy import LogisticLBFGSModel, ResidualMLPClassifier, compute_roc_auc_fast

            rng = np.random.default_rng(42)
            X = rng.normal(0.0, 1.0, size=(850, 4))
            # Componente linear dominante (~92% separação) + fronteira não-linear acoplada
            logits_true = 2.0 * X[:, 0] + 1.5 * np.tanh(1.8 * X[:, 1] * X[:, 2]) - 0.3
            y = (logits_true > 0.0).astype(int)
            X_tr, y_tr = X[:600], y[:600]
            X_te, y_te = X[600:], y[600:]

            lin = LogisticLBFGSModel(reg_l2=1e-3, max_iter=180).fit(X_tr, y_tr)
            mlp = ResidualMLPClassifier(hidden_units=16, reg_l2=8e-4, max_iter=180, seed=42).fit(X_tr, y_tr)
            self.assertIsNotNone(mlp.params_)
            self.assertGreater(float(np.max(np.abs(mlp.params_[2]))), 1e-4)
            auc_lin = compute_roc_auc_fast(y_te, lin.predict_proba(X_te))
            auc_mlp = compute_roc_auc_fast(y_te, mlp.predict_proba(X_te))
            self.assertGreater(auc_mlp, auc_lin)

    def test_model_c_stage_c2_supports_silu_tail_extrapolation(self) -> None:
        from config import ML_MODEL_PARAMS

        c2_cfg = ML_MODEL_PARAMS["modelCStageC2ResMlp"]
        self.assertEqual(c2_cfg.get("activation"), "silu")

        ml_source = (SCRIPTS_DIR / "ml_models_numpy.py").read_text(encoding="utf-8")
        self.assertIn("def _activate_with_grad(", ml_source)
        self.assertIn('if activation not in ("tanh", "silu"):', ml_source)

        s05_source = (SCRIPTS_DIR / "05_forecast_wind_cf_and_curtailment.py").read_text(encoding="utf-8")
        self.assertIn('activation=str(c2_mlp_cfg.get("activation", "tanh"))', s05_source)

        if importlib.util.find_spec("numpy") and importlib.util.find_spec("scipy"):
            import numpy as np
            from ml_models_numpy import LinearRidgeModel, ResidualMLPRegressor, compute_regression_metrics

            z = np.linspace(-6.0, 6.0, 25)
            act, d_act = ResidualMLPRegressor._activate_with_grad(z, "silu")
            eps = 1e-6
            fd = (ResidualMLPRegressor._activate(z + eps, "silu") - ResidualMLPRegressor._activate(z - eps, "silu")) / (2.0 * eps)
            self.assertTrue(np.allclose(d_act, fd, atol=1e-6))
            self.assertGreater(float(act[-1]), 5.9)

            rng = np.random.default_rng(7)
            n_tr, n_te = 900, 400
            X_tr = rng.normal(0.0, 1.0, size=(n_tr, 4))
            X_te = rng.normal(0.8, 1.3, size=(n_te, 4))  # deslocamento para cauda superior (estilo 2025)

            def true_vol(X: np.ndarray) -> np.ndarray:
                surplus = 1.6 * X[:, 0] + 0.9 * X[:, 1]
                hinge = np.log1p(np.exp(surplus - 0.5))
                return 2500.0 + 950.0 * surplus + 1400.0 * hinge + 220.0 * X[:, 2]

            y_tr = true_vol(X_tr) + rng.normal(0.0, 35.0, size=n_tr)
            y_te = true_vol(X_te)

            lin = LinearRidgeModel(alpha=20.0).fit(X_tr, y_tr)
            mlp = ResidualMLPRegressor(
                hidden_units=12,
                reg_l2=1.5e-2,
                reg_l2_skip=4e-3,
                reg_l2_grid=(3e-3, 1e-2, 3e-2, 1e-1),
                cv_folds=3,
                n_ensemble=2,
                activation="silu",
                max_iter=160,
                seed=42,
            ).fit(X_tr, y_tr)

            m_lin = compute_regression_metrics(y_te, lin.predict(X_te))
            m_mlp = compute_regression_metrics(y_te, mlp.predict(X_te))
            self.assertGreater(m_mlp["r2"], m_lin["r2"])
            self.assertLess(m_mlp["mae"], m_lin["mae"])

    def test_live_report_cross_consistency_when_regenerated_post_passo_2(self) -> None:
        payload = build_ssot_payload()
        md_text = payload["passo5FinalExecutiveReportMd"]
        if "simulados diretamente pelo motor Block-Bootstrap" not in md_text:
            self.skipTest(
                "Relatórios em reports/ ainda pré-Passos 1–2 (execute run_pipeline.py --skip-ingest em ambiente numpy/pandas)."
            )
        self.assertEqual(validate_ssot_cross_consistency(payload), [])

    def test_sync_frontend_ssot_writes_matching_json_and_ts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            json_out = tmp_dir / "pipeline-ssot.json"
            ts_out = tmp_dir / "pipelineSsot.ts"
            payload = sync_frontend_ssot(json_out_path=json_out, ts_out_path=ts_out)

            self.assertTrue(json_out.exists())
            self.assertTrue(ts_out.exists())
            parsed_json = json.loads(json_out.read_text(encoding="utf-8"))
            self.assertEqual(parsed_json["lineage"]["trainHours"], payload["lineage"]["trainHours"])
            ts_text = ts_out.read_text(encoding="utf-8")
            self.assertIn("export const PIPELINE_SSOT: PipelineSsotBundle =", ts_text)

    def test_sync_frontend_ssot_blocks_write_when_cross_consistency_fails(self) -> None:
        bad_payload = _make_consistent_synthetic_payload()
        bad_payload["transmissionSensitivity2035"][0]["probCriticalImportPct"] = 99.9

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            json_out = tmp_dir / "pipeline-ssot.json"
            ts_out = tmp_dir / "pipelineSsot.ts"
            with mock.patch.object(sync_mod, "build_ssot_payload", return_value=bad_payload):
                with self.assertRaisesRegex(ValueError, "Bloqueio SSOT"):
                    sync_frontend_ssot(json_out_path=json_out, ts_out_path=ts_out, validate=True)
            self.assertFalse(json_out.exists())
            self.assertFalse(ts_out.exists())

    def test_scripts_01_to_07_align_with_config_and_resmlp_c2_2(self) -> None:
        for script_path in sorted(SCRIPTS_DIR.glob("0[1-7]_*.py")):
            src = script_path.read_text(encoding="utf-8")
            self.assertIn("from config import", src, f"{script_path.name} deve importar parâmetros de config.py")

        s05 = (SCRIPTS_DIR / "05_forecast_wind_cf_and_curtailment.py").read_text(encoding="utf-8")
        export_section = s05.split("def export_2025_comparative_profiles", 1)[1]
        self.assertIn('pa["pred_l_base_resmlp_24h_mw"]', export_section)
        self.assertIn('preds_b["resmlp_1h"]', export_section)
        self.assertIn('preds_b["resmlp_24h"]', export_section)
        self.assertNotIn("pred_l_base_gbdt_24h_mw", export_section)
        self.assertNotIn('preds_b["gbdt_1h"]', export_section)

        s06 = (SCRIPTS_DIR / "06_monte_carlo_balance_2035.py").read_text(encoding="utf-8")
        self.assertIn("PROJECTION_START_YEAR", s06)
        self.assertIn("float(HOURS_PER_YEAR) / float(block_size_hours)", s06)
        self.assertNotIn("* 52.0", s06)
        self.assertNotIn("/ 0.21", s06)

        from config import MONTE_CARLO_PARAMS

        self.assertEqual(
            MONTE_CARLO_PARAMS["iterationsTimeline"],
            MONTE_CARLO_PARAMS["iterationsMain"],
            "iterationsTimeline must match iterationsMain for 2035 parity",
        )

        s07 = (SCRIPTS_DIR / "07_sensitivity_and_final_report.py").read_text(encoding="utf-8")
        self.assertIn("TX_SENSITIVITY_SPECS", s07)
        self.assertIn("H2V_SENSITIVITY_SPECS", s07)
        self.assertIn("ANEEL_PROJECTED_YEARS", s07)

    def test_c2_3_grid_and_hourly_baseline_contracts_and_optional_loading(self) -> None:
        base_payload = build_ssot_payload()
        self.assertEqual(base_payload["config"]["hourlyBaselineJsonUrl"], "/data/hourly-baseline-8760.json")
        self.assertIn("simulatorMonteCarloGrid", base_payload)
        self.assertIsInstance(base_payload["lineage"]["hourlyBaselineAvailable"], bool)
        self.assertIsInstance(base_payload["lineage"]["simulatorGridAvailable"], bool)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            missing_baseline = tmp_dir / "missing_baseline.json"
            missing_grid = tmp_dir / "missing_grid.csv"
            empty_payload = build_ssot_payload(
                baseline_json_path=missing_baseline,
                simulator_grid_path=missing_grid,
            )
            self.assertEqual(empty_payload["simulatorMonteCarloGrid"], [])
            self.assertFalse(empty_payload["lineage"]["hourlyBaselineAvailable"])
            self.assertEqual(empty_payload["lineage"]["hourlyBaselineDigest"], "")
            self.assertEqual(empty_payload["lineage"]["hourlyBaselineHoursCount"], 0)
            self.assertFalse(empty_payload["lineage"]["simulatorGridAvailable"])
            self.assertEqual(empty_payload["lineage"]["simulatorGridRowsCount"], 0)

            # Simula artefatos reais gerados pela Etapa 06 (8.760h + grade paramétrica)
            hours = 8760
            regime_block = {
                "lBaseMW": [12500.0] * hours,
                "cfWind": [0.45] * hours,
                "gSolarMW": [1200.0] * hours,
                "gHydroMW": [3500.0] * hours,
                "gThermalMW": [900.0] * hours,
                "curtailmentMW": [850.0] * hours,
            }
            baseline_obj = {
                "schemaVersion": "1.0.0",
                "hoursCount": hours,
                "baselineYear": 2025,
                "digest": "abc123def4567890",
                "month": [1] * hours,
                "day": [1] * hours,
                "hour": [h % 24 for h in range(hours)],
                "regimes": {
                    "annual_blend": regime_block,
                    "dry_windy": regime_block,
                    "wet_calm": regime_block,
                },
            }
            baseline_file = tmp_dir / "hourly-baseline-8760.json"
            baseline_file.write_text(json.dumps(baseline_obj), encoding="utf-8")

            mc_rows = base_payload["monteCarlo12Scenarios2035"]
            mc_high_ref = next(
                r for r in mc_rows if r["dcScenarioId"] == "central" and r["windScenarioId"] == "high"
            )
            grid_lines = [
                "year,dc_scenario,wind_scenario,seasonal_regime,pue,dc_utilization,import_limit_mw,export_limit_mw,"
                "dc_load_mw,wind_capacity_mw,prob_exceder_intercambio_pct,lole_horas_criticas_ano,"
                "importacao_p50_mw,importacao_p95_mw,curtailment_sem_dc_twh_ano,curtailment_com_dc_twh_ano,"
                "curtailment_evitado_gwh_ano,expansao_eolica_compensatoria_gw"
            ]
            for r in mc_rows:
                grid_lines.append(
                    f"2035,{r['dcScenarioId']},{r['windScenarioId']},annual_blend,1.28,0.8,7000.0,9500.0,"
                    f"{r['dcLoadMW']},{r['windCapacityMW']},{r['probExceedInterchangePct']},"
                    f"{r['loleCriticalHoursYear']},{r['importP50MW']},{r['importP95MW']},"
                    f"{r['curtailmentWithoutDcTWh']},{r['curtailmentWithDcTWh']},"
                    f"{r['curtailmentAvoidedGWh']},{r['compensatoryWindExpansionGW']}"
                )
            # Variante offshore desligada (44,4 GW em vez de 48,0 GW) não deve colidir com a âncora MC12 nominal
            grid_lines.append(
                f"2035,central,high,annual_blend,1.28,0.8,7000.0,9500.0,"
                f"{mc_high_ref['dcLoadMW']},44400.0,9.9,45.0,{mc_high_ref['importP50MW']},8100.0,"
                f"{mc_high_ref['curtailmentWithoutDcTWh']},{mc_high_ref['curtailmentWithDcTWh']},"
                f"{mc_high_ref['curtailmentAvoidedGWh']},{mc_high_ref['compensatoryWindExpansionGW']}"
            )
            grid_file = tmp_dir / "grade_simulador_monte_carlo_2025_2035.csv"
            grid_file.write_text("\n".join(grid_lines) + "\n", encoding="utf-8")

            populated_payload = build_ssot_payload(
                baseline_json_path=baseline_file,
                simulator_grid_path=grid_file,
            )
            self.assertTrue(populated_payload["lineage"]["hourlyBaselineAvailable"])
            self.assertEqual(populated_payload["lineage"]["hourlyBaselineDigest"], "abc123def4567890")
            self.assertEqual(populated_payload["lineage"]["hourlyBaselineHoursCount"], 8760)
            self.assertTrue(populated_payload["lineage"]["simulatorGridAvailable"])
            self.assertEqual(populated_payload["lineage"]["simulatorGridRowsCount"], len(mc_rows) + 1)
            self.assertEqual(len(populated_payload["simulatorMonteCarloGrid"]), len(mc_rows) + 1)
            self.assertEqual(validate_ssot_cross_consistency(populated_payload), [])

            # Se divergir de monteCarlo12Scenarios2035 em ponto nominal, validate_ssot_cross_consistency bloqueia
            drifted_payload = copy.deepcopy(populated_payload)
            drifted_payload["simulatorMonteCarloGrid"][0]["probExceedInterchangePct"] = 99.0
            self.assertTrue(
                any("grade vs MC12" in v for v in validate_ssot_cross_consistency(drifted_payload))
            )

    def test_c2_3_script_06_defines_8760h_and_parametric_grid_exporters(self) -> None:
        s06 = (SCRIPTS_DIR / "06_monte_carlo_balance_2035.py").read_text(encoding="utf-8")
        self.assertIn("def build_and_export_hourly_baseline_8760(", s06)
        self.assertIn("def export_simulator_monte_carlo_grid(", s06)
        self.assertIn("build_and_export_hourly_baseline_8760(df_base)", s06)
        self.assertIn("export_simulator_monte_carlo_grid(", s06)
        self.assertIn("HOURLY_BASELINE_JSON_PATH", s06)
        self.assertIn("HOURLY_BASELINE_CSV_FILENAME", s06)
        self.assertIn("SIMULATOR_GRID_CSV_FILENAME", s06)
        self.assertIn("SEASONAL_REGIME_MONTHS", s06)
        self.assertIn('"g_hidraulica_mw"', s06)
        self.assertIn('modern["g_hidro_mw"] = modern["g_hidraulica_mw"]', s06)
        self.assertIn("OFFSHORE_COMMERCIAL_START_YEAR", s06)
        self.assertIn("override_wind", s06)
        self.assertIn("anchor_2035", s06)

    def test_c2_5_config_and_uicatalog_complete_contract(self) -> None:
        from config import build_ons_urls, export_frontend_config_dict

        src_dir = SCRIPTS_DIR.parent / "src"
        cfg = export_frontend_config_dict()
        self.assertEqual(cfg["projectionStartYear"], 2025)
        self.assertEqual(cfg["baselineYear"], 2025)
        self.assertEqual(cfg["rampStartYear"], 2026)
        self.assertEqual(cfg["targetEndYear"], 2035)
        self.assertEqual(cfg["hoursPerYear"], 8760)
        self.assertEqual(cfg["daysPerYear"], 365)
        self.assertEqual(cfg["weeksPerYear"], 52)
        self.assertEqual(cfg["quartersPerYear"], 4)

        bounds = cfg["simulatorSliderBounds"]
        self.assertEqual(bounds["year"]["min"], 2025)
        self.assertEqual(bounds["year"]["max"], 2035)
        self.assertEqual(bounds["year"]["default"], 2035)
        self.assertEqual(bounds["defaultObservationWindow"], "year")

        urls = build_ons_urls()
        self.assertIn("ons_curva_carga_2025", urls)
        self.assertIn("ons_balanco_2025", urls)
        self.assertIn("ons_capacidade_geracao", urls)
        self.assertIn("ons_constrained_off_eolica_2025_12", urls)
        self.assertNotIn("2026_10", urls["ons_constrained_off_eolica_2025_12"])

        payload = build_ssot_payload()
        ui = payload["uiCatalog"]
        self.assertEqual([w["id"] for w in ui["observationWindows"]], ["day", "week", "month", "quarter", "year"])
        self.assertEqual([r["id"] for r in ui["seasonalRegimes"]], ["annual_blend", "dry_windy", "wet_calm"])
        self.assertEqual(len(ui["monthShortNames"]), 12)
        self.assertEqual(len(ui["databasesCatalog"]), 10)
        self.assertEqual(len(ui["groupDecisions"]), 4)
        self.assertTrue(ui["pdfAssetPath"].endswith(".pdf"))
        self.assertTrue(all(len(c["id"]) > 0 for c in ui["anovaCategories"]))
        self.assertTrue(len(ui["dcScenarioCards"]) >= 3)
        self.assertFalse((src_dir / "data" / "databasesCatalog.ts").exists())

    def test_c2_5_anti_hardcode_guardrails_across_scripts_and_frontend(self) -> None:
        src_dir = SCRIPTS_DIR.parent / "src"

        # Nenhum script analítico 01..07 ou sincronizador deve reintroduzir URL fixa 2026_10
        for py_path in sorted(SCRIPTS_DIR.glob("*.py")):
            if py_path.name == "test_sync_frontend_ssot.py":
                continue
            text = py_path.read_text(encoding="utf-8")
            self.assertNotIn("RESTRICAO_COFF_EOLICA_2026_10.csv", text, f"URL congelada em {py_path.name}")

        s07 = (SCRIPTS_DIR / "07_sensitivity_and_final_report.py").read_text(encoding="utf-8")
        self.assertIn("PECEM_H2V_HUB_SHARE", s07)
        self.assertNotIn("PECEM_H2V_HUB_SHARE = 0.75", s07)

        # Zero arquivos com style={{ ou símbolos legados em src/
        for ts_path in list(src_dir.rglob("*.ts")) + list(src_dir.rglob("*.tsx")):
            if ts_path.name.endswith(".test.ts") or ts_path.name == "pipelineSsot.ts":
                continue
            content = ts_path.read_text(encoding="utf-8")
            self.assertNotIn("style={{", content, f"Estilo inline proibido em {ts_path.name}")
            self.assertNotIn("simulateHourlyWeek", content, f"Símbolo legado em {ts_path.name}")
            self.assertNotIn("DEFAULT_ENERGY_MODEL_CONFIG", content, f"Config estático legado em {ts_path.name}")
            self.assertNotIn("GROUP_DECISIONS", content, f"Catálogo estático legado em {ts_path.name}")

    def test_c3_1_causal_grid_features_symmetrical_weighting_and_calibration(self) -> None:
        s03 = (SCRIPTS_DIR / "03_feature_engineering_anova.py").read_text(encoding="utf-8")
        for feat_name in (
            "folga_escoamento_sin_mw",
            "excesso_sobre_escoamento_mw",
            "despacho_total_est_excesso_mw",
            "interacao_solar_eolica_mw",
            "g_hidro_roll_mean_24h",
            "rampa_excedente_1h_mw",
            "excedente_renovavel_roll_mean_24h",
        ):
            self.assertIn(feat_name, s03, f"Feature C3-1 ausente em Script 03: {feat_name}")
        self.assertIn("INTERCHANGE_EXPORT_LIMIT_MW", s03)
        self.assertIn("EXPORT_SOLAR_CURTAILMENT_COEF", s03)

        ml_src = (SCRIPTS_DIR / "ml_models_numpy.py").read_text(encoding="utf-8")
        for symbol in (
            "def _prepare_sample_weights(",
            "sample_weight: Optional[np.ndarray] = None",
            "self.calib_a_",
            "self.calib_b_",
            "cv_folds: int = 4",
            "n_ensemble: int = 1",
        ):
            self.assertIn(symbol, ml_src, f"Contrato ML C3-1 ausente em ml_models_numpy.py: {symbol}")

        s05 = (SCRIPTS_DIR / "05_forecast_wind_cf_and_curtailment.py").read_text(encoding="utf-8")
        self.assertIn("def _impute_with_train_medians(", s05)
        self.assertIn("modelCRecencyMinWeight", s05)
        self.assertIn('c1_mlp_cfg["regL2Grid"]', s05)
        self.assertIn('c1_mlp_cfg["cvFolds"]', s05)
        self.assertIn('c1_mlp_cfg["nEnsemble"]', s05)
        self.assertIn('c2_mlp_cfg["regL2Skip"]', s05)
        self.assertIn('c2_mlp_cfg["regL2Grid"]', s05)
        self.assertIn('c2_mlp_cfg["cvFolds"]', s05)
        self.assertIn('c2_mlp_cfg["nEnsemble"]', s05)
        self.assertIn('c2_mlp_cfg.get("activation"', s05)
        self.assertIn('c1_gbdt_cfg["l2LeafReg"]', s05)
        self.assertIn('c2_gbdt_cfg["l2LeafReg"]', s05)

        curt_feats_block = s05.split("FEATURES_CURTAILMENT = [", 1)[1].split("]", 1)[0]
        self.assertNotIn('"month_sin"', curt_feats_block)
        self.assertNotIn('"month_cos"', curt_feats_block)
        for required_feat in (
            '"folga_escoamento_sin_mw"',
            '"excesso_sobre_escoamento_mw"',
            '"despacho_total_est_excesso_mw"',
            '"interacao_solar_eolica_mw"',
            '"g_hidro_roll_mean_24h"',
        ):
            self.assertIn(required_feat, curt_feats_block)

        # Garantir ponderação temporal simétrica em todos os 3 classificadores (C1) e 3 regressores (C2)
        self.assertEqual(s05.count("sample_weight=sample_weights)"), 3)
        self.assertEqual(s05.count("sample_weight=w_tr_pos"), 3)

        meta = load_pipeline_metadata()
        for meta_feat in (
            "folga_escoamento_sin_mw",
            "excesso_sobre_escoamento_mw",
            "despacho_total_est_excesso_mw",
            "interacao_solar_eolica_mw",
            "g_hidro_roll_mean_24h",
        ):
            self.assertIn(meta_feat, meta["featureMetadata"])

    def test_c3_2_seasonal_chesf_dispatch_solar_h2v_offshore_and_grid_parity(self) -> None:
        from config import CHESF_DISPATCH_PARAMS, MONTE_CARLO_PARAMS

        for key in (
            "wetMonths",
            "dryMonths",
            "wetFloorBonusMW",
            "wetSlope",
            "drySlope",
            "thermalInflexWeight",
            "hydroObsBlend",
        ):
            self.assertIn(key, CHESF_DISPATCH_PARAMS, f"Chave C3-2 ausente em CHESF_DISPATCH_PARAMS: {key}")

        for key in (
            "firmWindCfDryWindy",
            "firmWindCfWetCalm",
            "firmWindCfOffshoreMarginal",
            "offshoreMarginalBlendMult",
        ):
            self.assertIn(key, MONTE_CARLO_PARAMS, f"Chave C3-2 ausente em MONTE_CARLO_PARAMS: {key}")

        s06 = (SCRIPTS_DIR / "06_monte_carlo_balance_2035.py").read_text(encoding="utf-8")
        for symbol in (
            '"month": modern["month"]',
            '"hydro": hydro_arr',
            '"thermal": thermal_arr',
            "def _compute_firm_wind_cf(",
            "month_arr: np.ndarray | None = None",
            "obs_hydro_mw: np.ndarray | None = None",
            "obs_thermal_mw: np.ndarray | None = None",
            "curtail_surplus_active = pre_h2v_margin >= export_threshold",
            "np.maximum(0.0, export_limit_mw - EXPORT_SOLAR_CURTAILMENT_COEF * solar_block)",
            'for reg in ("wet_calm", "dry_windy"):',
            'for reg in ("annual_blend", "wet_calm"):',
        ):
            self.assertIn(symbol, s06, f"Refinamento C3-2 ausente em Script 06: {symbol}")

        s07 = (SCRIPTS_DIR / "07_sensitivity_and_final_report.py").read_text(encoding="utf-8")
        self.assertIn("month_arr=month_2025_arr", s07)
        self.assertIn("obs_hydro_mw=hydro_2025_arr", s07)
        self.assertIn("obs_thermal_mw=thermal_2025_arr", s07)

        ts_model = (SCRIPTS_DIR.parent / "src" / "utils" / "energyModel.ts").read_text(encoding="utf-8")
        for ts_symbol in (
            "export interface ChesfDispatchContext",
            "netNeedBaseMW",
            "observedHydroMW",
            "observedThermalMW",
            "Math.max(0, config.interchangeExportLimitMW - ssotCfg.exportSolarCurtailmentCoef * solarGenMW)",
        ):
            self.assertIn(ts_symbol, ts_model, f"Paridade C3-2 ausente em energyModel.ts: {ts_symbol}")


if __name__ == "__main__":
    unittest.main()


