/**
 * SESSAO IQ: deteccao de SSID expirado (sem loop infinito) vs desconexao transitória.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const staleModule = await import("../../relay/iq-session-stale.mjs");
const { evaluateIqSessionStaleness } = staleModule as any;

describe("detecção de sessão IQ expirada", () => {
  it("WS vivo + time valid + PRACTICE NAO verificado por 3 conexoes => IQ_SESSION_EXPIRED / IQ_LOGIN_REQUIRED", () => {
    let strikes = 0;
    let stale = false;
    for (let i = 0; i < 3; i += 1) {
      const evalResult: any = evaluateIqSessionStaleness({ wsConnected: true, timeValid: true, practiceVerified: false, strikes, priorStale: stale });
      strikes = evalResult.strikes;
      stale = evalResult.stale;
      if (evalResult.state === "IQ_SESSION_EXPIRED") {
        expect(evalResult.reason).toBe("IQ_LOGIN_REQUIRED");
        break;
      }
    }
    expect(stale).toBe(true);
  });

  it("desconexao transitória (WS down / time invalido) NAO conta strikes", () => {
    const down = evaluateIqSessionStaleness({ wsConnected: false, timeValid: false, practiceVerified: false, strikes: 2 });
    expect(down.stale).toBe(false);
    expect(down.strikes).toBe(0);
    const skew = evaluateIqSessionStaleness({ wsConnected: true, timeValid: false, practiceVerified: false, strikes: 2 });
    expect(skew.stale).toBe(false);
    expect(skew.strikes).toBe(0);
  });

  it("conta verificada reseta strikes; sessao valida => SESSION_OK", () => {
    const ok = evaluateIqSessionStaleness({ wsConnected: true, timeValid: true, practiceVerified: true, strikes: 2 });
    expect(ok.stale).toBe(false);
    expect(ok.strikes).toBe(0);
    expect(ok.state).toBe("SESSION_OK");
  });
});