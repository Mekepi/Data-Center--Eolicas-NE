import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict

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
        self.assertEqual(len(payload["annualRiskTimeline2026_2035"]), 10)
        self.assertEqual(len(payload["transmissionSensitivity2035"]), 5)
        self.assertEqual(len(payload["h2vSynergySensitivity2035"]), 5)
        self.assertEqual(len(payload["scriptsPipeline"]), 7)

        # Every script starterCode must match the real disk file in scripts/*.py verbatim
        for spec in payload["scriptsPipeline"]:
            real_path = SCRIPTS_DIR / spec["filename"]
            self.assertTrue(real_path.exists(), f"Missing real script {real_path}")
            self.assertEqual(
                spec["starterCode"],
                real_path.read_text(encoding="utf-8"),
                f"SSOT script mismatch for {spec['filename']}",
            )
            self.assertFalse(math.isnan(payload["lineage"]["trainHours"]))

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


if __name__ == "__main__":
    unittest.main()
