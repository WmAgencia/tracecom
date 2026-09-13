"""Optional offline model adapters. No dependency is imported by runtime."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelResult:
    model_version: str
    p_up: float
    p_down: float
    p_no_edge: float
    sample_size: int


def logistic_baseline(score: float, sample_size: int) -> ModelResult:
    p_up = max(0.0, min(1.0, 0.5 + score / 2))
    return ModelResult("t60_logreg_shadow_v1", p_up, 1 - p_up, 0.0, sample_size)
