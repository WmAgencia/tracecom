import { deepFreeze } from "./features.mjs";

const ORDER = ["rsi", "dmi", "bollinger", "atr", "priceAction"];

export function consensus(features, specialists) {
  if (!features || !Array.isArray(specialists) || specialists.length === 0) {
    return deepFreeze({ side: "WAIT", thesis: [], blockers: ["FEATURES_MISSING"], invalidations: [], agreement: 0, unsatisfied: ["FEATURES_MISSING"] });
  }
  const byName = Object.fromEntries(specialists.map((s) => [s.specialist, s]));
  const blockers = ORDER.flatMap((name) => byName[name]?.blockers ?? []);
  const agreement = ORDER.filter((name) => byName[name]).length;
  const pb = features.priceAction?.pullback ?? { active: false, depth: null };

  const bullChecks = [
    [features.structure === "UPTREND", "ESTRUTURA_NAO_ALTA"],
    [pb.active === true, "SEM_PULLBACK"],
    [["SHALLOW", "NORMAL"].includes(pb.depth), "PULLBACK_PROFUNDO"],
    [features.rsi?.zone === "LOW" || features.rsi?.zone === "OVERSOLD", "RSI_FORA_DA_ZONA"],
    [byName.dmi?.domainAssessment === "TREND_UP", "DMI_NAO_ALTA"],
    [byName.atr?.domainAssessment === "ALIVE", "ATR_NAO_OPERAVEL"],
  ];
  const bearChecks = [
    [features.structure === "DOWNTREND", "ESTRUTURA_NAO_BAIXA"],
    [pb.active === true, "SEM_PULLBACK"],
    [["SHALLOW", "NORMAL"].includes(pb.depth), "PULLBACK_PROFUNDO"],
    [features.rsi?.zone === "HIGH" || features.rsi?.zone === "OVERBOUGHT", "RSI_FORA_DA_ZONA"],
    [byName.dmi?.domainAssessment === "TREND_DOWN", "DMI_NAO_BAIXA"],
    [byName.atr?.domainAssessment === "ALIVE", "ATR_NAO_OPERAVEL"],
  ];
  const unsatisfied = (checks) => checks.filter(([ok]) => !ok).map(([, label]) => label);
  const bullOk = blockers.length === 0 && unsatisfied(bullChecks).length === 0;
  const bearOk = blockers.length === 0 && unsatisfied(bearChecks).length === 0;
  const side = bullOk ? "BUY" : bearOk ? "SELL" : "WAIT";
  const thesis = side === "BUY"
    ? ["uptrend confirmado", "pullback raso/normal", "RSI em zona baixa", "DMI apontando alta", "ATR operavel"]
    : side === "SELL"
      ? ["downtrend confirmado", "pullback raso/normal", "RSI em zona alta", "DMI apontando baixa", "ATR operavel"]
      : [];
  return deepFreeze({
    side,
    thesis,
    blockers,
    invalidations: ["perda do ultimo fundo/topo confirmado", "CHoCH contra a estrutura", "ADX cai abaixo de 20"],
    agreement,
    unsatisfied: side === "WAIT" ? [...new Set([...blockers, ...unsatisfied(side === "WAIT" && features.structure === "DOWNTREND" ? bearChecks : bullChecks)])] : [],
  });
}
