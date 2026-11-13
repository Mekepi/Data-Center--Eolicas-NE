"""
run_pipeline.py
Orquestrador Único da Esteira Analítica (Etapas 01 a 07 + Sincronização SSOT)
PTC3567 · Ciência dos Dados em Automação e Engenharia · Grupo 6

Uso:
  python3 scripts/run_pipeline.py
  python3 scripts/run_pipeline.py --skip-ingest
  python3 scripts/run_pipeline.py --only-from 04
  python3 scripts/run_pipeline.py --only-from ssot
  python3 scripts/run_pipeline.py --skip-ingest --dry-run
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

_SCRIPTS_DIR = str(Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from config import ROOT_DIR, SCRIPTS_DIR


@dataclass(frozen=True)
class PipelineStage:
    stage_id: str
    filename: str
    label: str
    is_ingest: bool = False


PIPELINE_STAGES: tuple[PipelineStage, ...] = (
    PipelineStage("01", "01_ingest_ons_aneel_epe.py", "Ingestão ONS/ANEEL/EPE", is_ingest=True),
    PipelineStage("02", "02_build_dc_and_offshore_scenarios.py", "Cenários Data Centers & Eólica"),
    PipelineStage("03", "03_feature_engineering_anova.py", "Feature Engineering & ANOVA"),
    PipelineStage("04", "04_forecast_demanda_base.py", "Modelo A · Demanda Base"),
    PipelineStage("05", "05_forecast_wind_cf_and_curtailment.py", "Modelos B & C · CF e Curtailment"),
    PipelineStage("06", "06_monte_carlo_balance_2035.py", "Monte Carlo 2035 (12 Cenários + Subestações)"),
    PipelineStage("07", "07_sensitivity_and_final_report.py", "Sensibilidade Passo 5 & Relatório Final"),
    PipelineStage("ssot", "sync_frontend_ssot.py", "Sincronização SSOT Frontend"),
)

_STAGE_ALIASES = {
    "1": "01",
    "01": "01",
    "ingest": "01",
    "2": "02",
    "02": "02",
    "3": "03",
    "03": "03",
    "4": "04",
    "04": "04",
    "5": "05",
    "05": "05",
    "6": "06",
    "06": "06",
    "7": "07",
    "07": "07",
    "ssot": "ssot",
    "sync": "ssot",
    "sync_frontend_ssot": "ssot",
}


def normalize_stage_id(raw_stage: str) -> str:
    """Normaliza identificadores de etapa aceitos pela flag --only-from."""
    key = raw_stage.strip().lower()
    if key not in _STAGE_ALIASES:
        valid = ", ".join(s.stage_id for s in PIPELINE_STAGES)
        raise ValueError(f"Etapa inválida '{raw_stage}'. Opções válidas: {valid}")
    return _STAGE_ALIASES[key]


def resolve_stages(skip_ingest: bool = False, only_from: Optional[str] = None) -> List[PipelineStage]:
    """Resolve a sequência ordenada de etapas a executar a partir das flags CLI."""
    stages: List[PipelineStage] = list(PIPELINE_STAGES)

    if only_from:
        target_id = normalize_stage_id(only_from)
        start_idx = next(i for i, st in enumerate(stages) if st.stage_id == target_id)
        stages = stages[start_idx:]

    if skip_ingest:
        stages = [st for st in stages if not st.is_ingest]

    return stages


def run_stage(stage: PipelineStage, python_executable: str = sys.executable) -> float:
    """Executa uma etapa individual em subprocesso isolado com PYTHONPATH=scripts."""
    script_path: Path = SCRIPTS_DIR / stage.filename
    if not script_path.exists():
        raise FileNotFoundError(f"Script da etapa '{stage.stage_id}' não encontrado em: {script_path}")

    env = dict(os.environ)
    existing_pp = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{SCRIPTS_DIR}{os.pathsep}{existing_pp}" if existing_pp else str(SCRIPTS_DIR)

    print(f"\n[PIPELINE -> {stage.stage_id}] Iniciando {stage.filename} ({stage.label})...")
    t0 = time.monotonic()
    subprocess.run([python_executable, str(script_path)], cwd=str(ROOT_DIR), env=env, check=True)
    elapsed = time.monotonic() - t0
    print(f"[PIPELINE -> {stage.stage_id}] Concluído em {elapsed:.2f}s.")
    return elapsed


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Orquestrador único do pipeline analítico PTC3567 (Etapas 01–07 + SSOT)."
    )
    parser.add_argument(
        "--skip-ingest",
        action="store_true",
        help="Pula a Etapa 01 (01_ingest_ons_aneel_epe.py), reutilizando os CSVs brutos/processados locais.",
    )
    parser.add_argument(
        "--only-from",
        type=str,
        default=None,
        help="Inicia a execução a partir de uma etapa específica (01..07 ou ssot).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Exibe o plano de execução das etapas selecionadas sem executá-las.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        stages = resolve_stages(skip_ingest=args.skip_ingest, only_from=args.only_from)
    except ValueError as exc:
        print(f"[ERRO] {exc}", file=sys.stderr)
        return 2

    if not stages:
        print("[PIPELINE] Nenhuma etapa selecionada após aplicar os filtros.")
        return 0

    print("=" * 72)
    print("Orquestrador PTC3567 · Execução Sequencial da Esteira Analítica")
    print("=" * 72)
    for st in stages:
        print(f"  - [{st.stage_id}] {st.filename} — {st.label}")

    if args.dry_run:
        print("\n[DRY-RUN] Nenhuma etapa foi executada.")
        return 0

    total_t0 = time.monotonic()
    for st in stages:
        try:
            run_stage(st)
        except subprocess.CalledProcessError as exc:
            print(
                f"\n[FALHA] Etapa [{st.stage_id}] ({st.filename}) encerrou com código {exc.returncode}.",
                file=sys.stderr,
            )
            return exc.returncode or 1

    print(f"\n[SUCESSO] Pipeline concluído ({len(stages)} etapas em {time.monotonic() - total_t0:.2f}s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
