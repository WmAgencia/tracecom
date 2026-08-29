import { AnthropicClient } from '../src/ai/anthropic';
import { readFileSync, existsSync } from 'node:fs';
const fileEnv = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8').split(/\r?\n/)
        .filter((l: string) => l && !l.startsWith('#') && l.includes('='))
        .map((l: string) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    )
  : {};
const env = { ...fileEnv, ...process.env }; // env vars têm prioridade
const c = new AnthropicClient({
  apiKey: env.ANTHROPIC_API_KEY!,
  model: env.ANTHROPIC_MODEL!,
  baseUrl: env.ANTHROPIC_BASE_URL!,
  ...(env.ANTHROPIC_MAX_TOKENS ? { maxTokens: Number(env.ANTHROPIC_MAX_TOKENS) } : {}),
  ...(env.ANTHROPIC_EXTENDED_OUTPUT !== undefined
    ? { extendedOutput: env.ANTHROPIC_EXTENDED_OUTPUT === 'true' || env.ANTHROPIC_EXTENDED_OUTPUT === '1' }
    : {}),
  thinking: {
    enabled: env.ANTHROPIC_THINKING_ENABLED === 'true' || env.ANTHROPIC_THINKING_ENABLED === '1' || env.ANTHROPIC_THINKING_ENABLED === undefined,
    ...(env.ANTHROPIC_THINKING_BUDGET ? { budgetTokens: Number(env.ANTHROPIC_THINKING_BUDGET) } : {}),
  },
});
const t0 = Date.now();
const resp = await c.chat([
  { role: 'system', content: 'Você responde em UMA palavra.' },
  { role: 'user', content: 'Diga: pong' },
]);
const dt = Date.now() - t0;
console.log('OK base=' + c.baseUrl);
console.log('model=' + c.model);
console.log('latency_ms=' + dt);
console.log('content=' + JSON.stringify(resp.content));
console.log('stop=' + resp.stopReason);
console.log('usage=' + JSON.stringify(resp.usage));
console.log('thinking_chars=' + (resp.thinking?.length ?? 0));
