"""Walk-forward evaluation contract for offline Quant V2 experiments."""
from dataclasses import dataclass


@dataclass(frozen=True)
class EvaluationSummary:
    model_version: str
    samples: int
    coverage: float
    wins: int
    losses: int
    draws: int
    unknown: int
    brier: float | None
    ece: float | None


def evaluate(rows, model_version: str) -> EvaluationSummary:
    # Training/evaluation adapters remain deliberately explicit: callers must
    # provide purged, causal rows rather than silently creating a random split.
    return EvaluationSummary(model_version, len(rows), 0.0, 0, 0, 0, 0, None, None)
