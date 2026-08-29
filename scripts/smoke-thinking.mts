import { AnthropicClient } from '../src/ai/anthropic';
import { readFileSync, existsSync } from 'node:fs';
const fileEnv = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8').split(/\r?\n/)
        .filter((l: string) => l && !l.startsWith('#') && l.includes('='))
        .map((l: string) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    )
  : {};
const env = { ...fileEnv, ...process.env };
const c = new AnthropicClient({
  apiKey: env.ANTHROPIC_API_KEY!,
  model: env.ANTHROPIC_MODEL!,
  baseUrl: env.ANTHROPIC_BASE_URL!,
  maxTokens: Number(env.ANTHROPIC_MAX_TOKENS ?? 8192),
  extendedOutput: env.ANTHROPIC_EXTENDED_OUTPUT !== 'false' && env.ANTHROPIC_EXTENDED_OUTPUT !== '0',
  thinking: {
    enabled: env.ANTHROPIC_THINKING_ENABLED !== 'false' && env.ANTHROPIC_THINKING_ENABLED !== '0',
    budgetTokens: Number(env.ANTHROPIC_THINKING_BUDGET ?? 8000),
  },
});
const t0 = Date.now();
const resp = await c.chat([
  {
    role: 'system',
    content: 'Você é um analista quantitativo. Pense com cuidado antes de responder.',
  },
  {
    role: 'user',
    content:
      'Se BTCUSDT acabou de romper resistência em 77000 com volume 2x a média, RSI em 65 e MACD cruzando alta no gráfico 1h, qual a decisão probabilística (BUY/WAIT/SELL)? Justifique em 3 linhas.',
  },
]);
const dt = Date.now() - t0;
console.log('latency_ms=' + dt);
console.log('--- THINKING ---');
console.log(resp.thinking ?? '(nenhum bloco thinking)');
console.log('--- CONTENT ---');
console.log(resp.content);
console.log('--- USAGE ---');
console.log(JSON.stringify(resp.usage));
