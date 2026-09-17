# RELATÓRIO — FASE 6.4: CURRÍCULO PROFISSIONAL + QUALITY GATE 75/100

> Gauntlet Loop: 4 pesquisadores paralelos → orquestração → síntese → implementação → gauntlets frescos → correção → reteste.
> PRACTICE only · zero REAL · stake R$10 · Brain G2/JIT/snapshots t0/journal/Professor/Segundo Cérebro preservados.

## 1. O que cada pesquisador estudou (fontes primárias registradas no Segundo Cérebro)

| # | Fontes | Entregável |
|---|---|---|
| R1 | Fidelity Technical Indicator Guide (RSI/ATR/DMI-ADX) + TA-Lib ADX | `20 - Professional Curriculum/Indicators Reference - RSI ATR DMI ADX.md` + auditoria de fórmulas vs `relay/feature-engine.mjs` |
| R2 | Charles Schwab (ADX+RSI) · CMT Association (educação, ADX/regimes, RSI avançado) · StockCharts RSI/ADX | `Momentum and Trend Strength - RSI ADX Reading Guide.md` + hipótese `hyp_curriculum_rsi_adx_trajectory` |
| R3 | CME Group (TA, Support & Resistance) · TradingView Donchian | `Structure and Location - Support Resistance Donchian.md` + `Lesson - Decision Sequence and Trade Thesis.md` |
| R4 | IQ Option (OTC, horários/sessões) | `Market Sessions and OTC - Operational Rules.md` |

Todos os `sourceIds` foram adicionados a `99 - Sources/SOURCE_REGISTRY.md` (Tier A/B), com URLs oficiais. Notas indexadas: 38 → **45** (KB `kb_87672d9d8b89`).

## 2. Fórmulas auditadas (Feature Engine vs referências)

| indicador | veredito | observação |
|---|---|---|
| RSI14 | **MATCH** | SMA seed + recursão Wilder; igual a TA-Lib/Fidelity. (Defeito paralelo: 2 RSI Cutler em módulos legados shadow — não usados pela decisão.) |
| ATR14 | **MATCH** | TR + SMA seed + recursão Wilder. |
| ADX14/+DI/-DI/DI_SPREAD | **MATCH** | regras estritas de DM, soma de Wilder, DI→DX→ADX; ordem correta. |
| Donchian | **MATCH** | janela inclui a barra atual; rompimento contra a banda anterior. |
| **Defeito alto (6.3→6.4)** | — | `price-structure.mjs` calculava ATR como SMA rolante (sem Wilder) além do ATR do Feature Engine — dois ATRs no mesmo ciclo. **Corrigido**: price-structure passou a consumir o ATR/contexto do Feature Engine. |

## 3. O que foi ensinado aos Traders
Sequência: **CONTEXTO → REGIME → ESTRUTURA → LOCALIZAÇÃO → SETUP → MOMENTUM → FORÇA → VOLATILIDADE → TRIGGER → MICROESTRUTURA → TIMING → QUALIDADE DA ENTRADA → DECISÃO**, com leitura de **trajetória** (RSI/ADX/DI/ATR/Donchian slopes persistidos no snapshot t0 via `trajectory`) e construção de tese (que pode concluir WAIT).

## 4. O que foi ensinado aos Críticos (adversarial)
`criticBrainAssessment` ganhou contradições objetivas (CONTEST, nunca VETO e nunca criam direção): `rsi_extremo_contra_entrada`, `rsi_exausto_mesmo_a_favor`, `rsi_sem_momentum_para_compra/venda`, `conflito_di_contra_entrada`, `adx_fraco_para_setup`, `volatilidade_spike_na_entrada`, `preco_esticado_contra_a_entrada`, `rompimento_ja_percorrido`, `compra_no_topo_do_range`, `venda_no_fundo_do_range` + checklist expandido (sem_entrada_atrasada, forca_direcional_adequada, di_alinhado_com_acao, rsi_com_espaco).

## 5. Score 75/100 (rubrica, não probabilidade)
- `tradeQualityScore` 0–100 com 19 checks ponderados (setup/trigger 8, regime 8+4, estrutura 6, DI 6, ADX 6+4, critic 6, localização 6+6, extensão 8, headroom 4, displacement 8, RSI 8, aceleração 8, velocidade 4, streak 4, dados 3, knowledge 3).
- Gate operacional: `qualityGateEnabled=true`, `minTradeQualityScore=75` (clamp 50–95), aplicado **no JIT antes do commit**.
- `estimatedWinProbability` continua `null` — a rubrica **não** é probabilidade e não será promovida como tal sem calibração prospectiva.
- Evidência in-sample (6.3): braço E (micro/qualidade) 12 aceitos, WR 50%, PnL −0,91 vs controle 46%/−5,62 — insuficiente para validar; por isso o efeito do 75 será medido prospectivamente.

## 6. Timing/JIT e Entry Location
- JIT mantido: candidato → janela 60s → timer em `submitAt` → revalidação final com snapshot mais recente → commit.
- **Entry Location Quality**: `entryDisplacementATR` (candidato→entrada) + extensão (ATR) + RSI extremo; violação ⇒ `VALID_SETUP_BUT_BAD_ENTRY_PRICE → WAIT` (setup/direção intactos, apenas abstém).

## 7. Microstructure Veto (últimos segundos)
`finalMicrostructureVeto`: somente PASS/VETO — `ADVERSE_TICK_DISPLACEMENT` (≥0,25 ATR contra, tick recente) ou `RAPID_ADVERSE_TICK` (≥0,15 ATR em ≤3s). Nunca cria BUY/SELL; motivo persistido no audit.

## 8. Causa dos mercados marcados como FECHADOS (corrigido)
**Causa raiz:** o resolver só ingeria `get-initialization-data` no bootstrap; `SUSPENDED`/`NOT_FOUND` ficavam congelados até reconectar, e o snapshot persistido (`resolver_json`) era tratado como verdade. Durante manutenção OTC da IQ (observada ~05:00–06:30 BRT) o TraceCom continuava exibindo SUSPENSO/FECHADO mesmo quando o broker voltava.
**Correção:** refresh em tempo real via `get-initialization-data` + `get-options` a cada **60s** (e **20s** enquanto algum mercado habilitado não estiver OPEN); snapshot persistido com status negativo vira **UNKNOWN** até confirmação do broker; NORMAL/OTC seguem separados. Gauntlet `P64-AVAIL-01` valida idade do resolver ≤180s.

## 9. Verificação
- Testes: **1008 pass** (3 novos: score/location/veto + gate no runtime; 15 no arquivo JIT).
- Gauntlets: **6.4 = 11/11** · 6.3 = 12/12 · 6 = 27/27 · 6.2 = 13/14 (único check aguardando mercado OTC reabrir desde o restart; era 14/14 quando aberto).
- Commits: `34a7aef`, `a2ac1e4` (+ relatório). Deploys: relay Railway e Vercel (proxy).
- Zero REAL; stake R$10; hard cap 100.

## 10. Limitações
- OTC suspenso pela IQ na janela de manutenção (broker truth), sem entradas possíveis — rearmar quando reabrir.
- Limiar 75 é decisão de engenharia (order da fase), não calibração; pode reduzir cobertura agressivamente → será avaliado prospectivamente com os braços SHADOW (A–F) e o registro `SHADOW_ARMS` (score/motivos por candidato).
- Fontes Fidelity/CME responderam 403 a fetch direto (conteúdo recuperado via espelho de texto e snippets indexados, confiança 0.8–0.85, registrado nas notas).
- Efeito real do curriculo/gate no WR ainda **não tem evidência prospectiva**.
