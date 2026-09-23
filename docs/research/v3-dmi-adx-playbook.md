# V3 — PLAYBOOK: DMI/ADX (J. Welles Wilder)

Fonte principal: `WILDER_1978` · apoio: `CMT_ASSOCIATION`, `KIRKPATRICK_DAHLQUIST_2016`.
Contratos: `relay/v3/playbooks.mjs` (DMI_*) · medicoes: `relay/v3/measurements.mjs::measureDmiPressure`.

## SOURCE-BACKED

- **ADX mede FORCA, nao direcao**; +DI/-DI comparam pressao compradora/vendedora.
  Wilder usa ADX > 25 como referencia de tendencia estabelecida (20 como zona de
  desenvolvimento); ADX e suavizado — por construcao e **lagging**.
- **Slope do ADX**: subindo = fortalecimento; caindo = enfraquecimento (mesmo com DI ainda
  dominante). Cruzamentos de DI em ADX baixo sao ruido de range.
- **Limitacoes**: em ranges o ADX permanece baixo e os DI cruzam com frequencia; o indicador
  nao antecipa reversoes.

## TRACECOM OPERATIONAL DEFINITION

- **Dominancia**: spread = +DI - -DI; rotulos PLUS (>3), MINUS (<-3), BALANCED.
- **Takeover**: inversao de sinal do spread com magnitude > 3 (`PLUS_TOOK_OVER`/`MINUS_TOOK_OVER`).
- **Resume**: apos contracao do spread, o lado original volta a dominar (`pressureChange` > 0).
- **Estado combinado**: `STRENGTH×TRENDSTATE×DOMINANCE` (ex.: STRONG_STRENGTHENING_PLUS).
- **BLOCKER informativo**: ADX < 20 => `ADX_WEAK` (nao impedir o cenario, mas impedir
  tratar DI como direcao).

## Uso pelo especialista

WHEN RELEVANT: todo ciclo. WHEN NOT RELEVANT: ADX < 15 (slope e ruido).
DETERMINISTIC MEASUREMENTS: `dmi.adx/adxSlope/plusDi/minusDi/spread/dominance/trendState/takeover/pressureChange`.
SUPPORTING: dominancia/takeover/strengthening a favor da tese.
COUNTER: dominancia contra, weakening, takeover contra.
Erros comuns: usar ADX para direcao; operar cruzamento de DI em range; ler slope em ADX < 15.
Causalidade: ADX e lagging — nunca tratar como tempo real; calculo causal por candle fechado.
