# Reference Architecture Research

The repositories under `research/repos/` are read-only reference snapshots. No
source file from them is imported into TraceCom.

| Reference | License status | Use in TraceCom |
| --- | --- | --- |
| FinAgent | No license identified in GitHub metadata | Study multimodal observation/reflection/memory concepts only; no source reuse. |
| Compass Stock Agent | No license identified in GitHub metadata | Study screenshot resize/compress/Vision request pipeline only; no source reuse. |
| TradingAgents | Apache-2.0 | Study provider abstraction, structured outputs, state graph and decision logs. |
| Lumibot | GPL-3.0 | Study lifecycle and paper/backtest separation only; no code incorporation into this product. |
| Nautilus Trader | LGPL-3.0 | Study event timestamps, replay and data lifecycle only; no wholesale dependency. |
| AI Hedge Fund | MIT | Study optional agent organization only; no investor persona strategy copied. |

## Adopted Design

- One local Vision Web surface owns screen sharing and crop selection.
- Local feature computation remains deterministic and reuses TraceCom's existing quant engine.
- One server-side Fable 5.1 request receives a sanitized crop plus a structured market snapshot.
- The output is validated into `BUY`, `SELL` or `WAIT`; invalid, stale or missing evidence becomes `WAIT`.
- Existing shadow, calibration, experiment and history layers remain the evaluation boundary.
- The existing `extension/` remains a legacy read-only integration and is not a Vision Web dependency.

## Explicitly Not Adopted

- Private IQ Option DOM, activeId and WebSocket discovery as a product requirement.
- Broker execution or automated clicks.
- Full multi-agent orchestration from any reference repository.
- GPL/LGPL source incorporation into the TraceCom runtime.
