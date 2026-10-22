// 패션 블로거 작업 도우미 — 본인만 쓰는 도구라 로그인 없이 내 컴퓨터(127.0.0.1)에서만 열립니다.
const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const store = require('./lib/store');
const service = require('./lib/service');
const { scrape } = require('./lib/product');
const { REGIONS, AGE_GROUPS } = require('./lib/catalog');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const MASK = '••••••••';

const STATUSES = ['후보', '구매 완료', '촬영 완료', '발행 완료'];
const TYPES = ['직접 구매', '협찬', '제휴 링크'];

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env는 없어도 됩니다 */ }
}

// ---- 설정 ----
function publicSettings() {
  const s = store.load().settings;
  return {
    region: s.region,
    age: s.age,
    keywords: s.keywords,
    naverClientId: s.naverClientId ? MASK : '',
    naverClientSecret: s.naverClientSecret ? MASK : '',
    kmaServiceKey: s.kmaServiceKey ? MASK : '',
    hasNaver: service.hasNaver(s),
    hasKma: Boolean(s.kmaServiceKey),
    regions: Object.keys(REGIONS),
    ages: Object.entries(AGE_GROUPS).map(([value, g]) => ({ value, label: g.label })),
  };
}

function updateSettings(body) {
  const db = store.load();
  const s = db.settings;
  if (body.region && REGIONS[body.region]) s.region = body.region;
  if (body.age && AGE_GROUPS[body.age]) s.age = body.age;
  if (Array.isArray(body.keywords)) {
    const words = [...new Set(body.keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 60);
    if (words.length) s.keywords = words;
  }
  for (const key of ['naverClientId', 'naverClientSecret', 'kmaServiceKey']) {
    if (typeof body[key] === 'string' && body[key] !== MASK) s[key] = body[key].trim();
  }
  store.save();
  return publicSettings();
}

// ---- 상품 보드 ----
function findBoard(id) {
  const b = store.load().boards.find((x) => x.id === id);
  if (!b) throw httpError(404, '보드를 찾을 수 없습니다.');
  return b;
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function cleanProduct(p) {
  const out = pick(p, ['url', 'name', 'brand', 'image', 'memo', 'size', 'fit', 'coordi']);
  for (const k of Object.keys(out)) out[k] = String(out[k] ?? '').slice(0, 2000);
  for (const k of ['price', 'originalPrice']) {
    if (p[k] !== undefined) out[k] = p[k] === null || p[k] === '' ? null : Math.max(0, Math.round(Number(p[k]))) || null;
  }
  if (p.status && STATUSES.includes(p.status)) out.status = p.status;
  if (p.type && TYPES.includes(p.type)) out.type = p.type;
  if (p.soldOut !== undefined) out.soldOut = Boolean(p.soldOut);
  return out;
}

// ---- 라우팅 ----
const routes = [
  ['GET', /^\/api\/settings$/, () => publicSettings()],
  ['PUT', /^\/api\/settings$/, (m, body) => updateSettings(body)],
  ['GET', /^\/api\/briefing$/, (m, b, q) => service.getBriefing({ force: q.get('refresh') === '1' })],
  ['GET', /^\/api\/keywords$/, async (m, b, q) => {
    const r = await service.getKeywordRows({ force: q.get('refresh') === '1' });
    return { ...r, ageLabel: AGE_GROUPS[r.age].label };
  }],
  ['GET', /^\/api\/blogger-items$/, (m, b, q) => service.getBloggerItems({ force: q.get('refresh') === '1' })],
  ['POST', /^\/api\/refresh$/, () => { store.clearCache(); return { ok: true }; }],

  ['GET', /^\/api\/boards$/, () => store.load().boards],
  ['POST', /^\/api\/boards$/, (m, body) => {
    const board = {
      id: store.id(),
      title: String(body.title || '새 글').slice(0, 200),
      keyword: String(body.keyword || '').slice(0, 100),
      plannedDate: body.plannedDate || '',
      memo: String(body.memo || '').slice(0, 5000),
      createdAt: new Date().toISOString(),
      products: [],
    };
    store.load().boards.unshift(board);
    store.save();
    return board;
  }],
  ['PUT', /^\/api\/boards\/([\w]+)$/, (m, body) => {
    const b = findBoard(m[1]);
    for (const k of ['title', 'keyword', 'plannedDate', 'memo']) if (typeof body[k] === 'string') b[k] = body[k].slice(0, 5000);
    store.save();
    return b;
  }],
  ['DELETE', /^\/api\/boards\/([\w]+)$/, (m) => {
    const db = store.load();
    findBoard(m[1]);
    db.boards = db.boards.filter((x) => x.id !== m[1]);
    store.save();
    return { ok: true };
  }],
  ['POST', /^\/api\/boards\/([\w]+)\/products$/, (m, body) => {
    const b = findBoard(m[1]);
    const p = {
      id: store.id(), url: '', name: '', brand: '', image: '', price: null, originalPrice: null,
      status: '후보', type: '직접 구매', memo: '', size: '', fit: '', coordi: '', soldOut: false,
      createdAt: new Date().toISOString(),
      ...cleanProduct(body),
    };
    if (p.price != null) p.priceCheckedAt = store.kstDate();
    b.products.push(p);
    store.save();
    return p;
  }],
  ['PUT', /^\/api\/boards\/([\w]+)\/products\/([\w]+)$/, (m, body) => {
    const b = findBoard(m[1]);
    const p = b.products.find((x) => x.id === m[2]);
    if (!p) throw httpError(404, '상품을 찾을 수 없습니다.');
    const patch = cleanProduct(body);
    if (patch.price !== undefined && patch.price !== p.price) patch.priceCheckedAt = store.kstDate();
    Object.assign(p, patch);
    store.save();
    return p;
  }],
  ['DELETE', /^\/api\/boards\/([\w]+)\/products\/([\w]+)$/, (m) => {
    const b = findBoard(m[1]);
    b.products = b.products.filter((x) => x.id !== m[2]);
    store.save();
    return { ok: true };
  }],
  ['POST', /^\/api\/scrape$/, (m, body) => scrape(String(body.url || ''))],
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw httpError(413, '요청이 너무 큽니다.');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw httpError(400, '잘못된 요청입니다.'); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveStatic(req, res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : path.normalize(pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      // 화면 주소(#)가 아닌 경로도 첫 화면으로 보냅니다.
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { 'Content-Type': MIME['.html'] });
        res.end(e2 ? 'not found' : html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
  if (!route) return send(res, 404, { error: '없는 주소입니다.' });
  try {
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const result = await route[2](url.pathname.match(route[1]), body, url.searchParams);
    send(res, 200, result);
  } catch (err) {
    send(res, err.status || 500, { error: err.message || '알 수 없는 오류' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`패션 블로거 작업 도우미가 열렸습니다 → http://localhost:${PORT}`);
  });
}

module.exports = { server };
