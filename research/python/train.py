"""Offline-only training entry point for Quant V2."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelMetadata:
    model_version: str
    feature_version: str
    training_start: int
    training_end: int
    samples: int
    target_horizon_seconds: int = 60


def train_offline(rows, metadata: ModelMetadata):
    if not rows:
        raise ValueError("training dataset is empty")
    return {"status": "EXPERIMENTAL", "metadata": metadata.__dict__, "model": "classical-baseline-placeholder"}
