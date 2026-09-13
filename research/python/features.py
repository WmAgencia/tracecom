"""Offline feature-discovery helpers. Heavy packages are intentionally optional."""
from __future__ import annotations

from math import log
from typing import Iterable


def causal_returns(prices: Iterable[float], window: int) -> list[float | None]:
    values = list(prices)
    out: list[float | None] = []
    for i, value in enumerate(values):
        if i < window or values[i - window] == 0:
            out.append(None)
        else:
            out.append(log(value / values[i - window]))
    return out


def discover_with_tsfresh(rows):
    """Optional offline hook; never imported by the browser/runtime path."""
    try:
        from tsfresh import extract_features  # type: ignore
    except ImportError as exc:
        raise RuntimeError("tsfresh is optional; install it only in the research worker") from exc
    return extract_features(rows, column_id="groundTruthId", column_sort="timestamp")
