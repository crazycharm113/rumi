// Claude API (Anthropic). 설정에 넣은 API 키로 부르고, 이번 달 쓴 토큰과 대략의 비용을 기록합니다.
const store = require('./store');

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // 달러, 100만 토큰당 $4 / $20

let cached = { key: '', client: null };

function sdk() {
  try {
    const mod = require('@anthropic-ai/sdk');
    return mod.default || mod;
  } catch {
    throw Object.assign(new Error('Claude 라이브러리가 아직 설치되지 않았어요. 프로그램을 껐다 켜면 자동으로 설치돼요.'), { status: 503 });
  }
}

function client() {
  const key = store.load().settings.anthropicApiKey;
  if (!key) throw Object.assign(new Error('설정에 Claude API 키를 먼저 넣어 주세요.'), { status: 400 });
  if (cached.key !== key) {
    const Anthropic = sdk();
    cached = { key, client: new Anthropic({ apiKey: key }) };
  }
  return cached.client;
}

const hasKey = () => Boolean(store.load().settings.anthropicApiKey);

function recordUsage(usage) {
  if (!usage) return;
  const db = store.load();
  const month = store.kstDate().slice(0, 7);
  const u = ((db.history.claudeUsage ||= {})[month] ||= { input: 0, output: 0, calls: 0 });
  u.input += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  u.output += usage.output_tokens || 0;
  u.calls += 1;
  store.save();
}

function monthUsage() {
  const u = store.load().history.claudeUsage?.[store.kstDate().slice(0, 7)] || { input: 0, output: 0, calls: 0 };
  return { ...u, usd: Math.round((u.input * PRICE.input + u.output * PRICE.output) * 100) / 100 };
}

// JSON 스키마에 맞춘 답을 받습니다. 거절(refusal)되면 기본 대체 모델로 자동으로 다시 시도합니다.
async function askJson({ system, prompt, schema, effort = 'low', maxTokens = 16000 }) {
  const Anthropic = sdk();
  let res;
  try {
    res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Claude API 키가 올바르지 않아요. 설정에서 확인해 주세요.'), { status: 400 });
    if (err instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error('이 API 키로는 Claude를 쓸 수 없어요. Anthropic 콘솔에서 크레딧과 권한을 확인해 주세요.'), { status: 400 });
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Claude 호출 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.'), { status: 429 });
    if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`Claude API 오류(${err.status}): ${err.message}`), { status: 502 });
    throw err;
  }
  recordUsage(res.usage);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('Claude가 이 요청에 답하지 않았어요.'), { status: 422 });
  if (res.stop_reason === 'max_tokens') throw Object.assign(new Error('답이 너무 길어 잘렸어요. 기사 수를 줄여 다시 시도해 주세요.'), { status: 502 });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Claude 답을 읽지 못했어요.'), { status: 502 });
  }
}

module.exports = { MODEL, PRICE, hasKey, askJson, monthUsage, recordUsage };
