/**
 * SIDE PREFERENCE — escolha automatica entre BINARIO e BLITZ quando os dois estao ativos.
 * Regra do operador: quem tiver o MELHOR WR (com constancia) e quem manda a ordem.
 * Constancia = limite inferior de Wilson 95% (penaliza amostra pequena/instavel).
 * Empate ou dados insuficientes: BLITZ (maior volume historico).
 */
export const SIDE_PREFERENCE_VERSION = "side-preference-v1";
export const MIN_SAMPLE = 8;

export function wilsonLower(wins, n, z = 1.96) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (c - s) / d);
}

export function pickPreferredSide(binary = null, blitz = null, minSample = MIN_SAMPLE) {
  const eligible = (side) => Boolean(side) && Number(side.n) >= minSample && side.low !== null && side.low !== undefined;
  if (eligible(binary) && eligible(blitz)) return binary.low > blitz.low ? "BINARY" : "BLITZ";
  if (eligible(binary)) return "BINARY";
  return "BLITZ";
}
