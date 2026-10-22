// 패션 블로거 작업 도우미 — 본인만 쓰는 도구라 로그인 없이 내 컴퓨터(127.0.0.1)에서만 열립니다.
const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const store = require('./lib/store');
const service = require('./lib/service');
const { scrape } = require('./lib/product');
const { REGIONS, AGE_GROUPS } = require('./lib/catalog');
const alerts = require('./lib/alerts');
const calendar = require('./lib/calendar');
const helper = require('./lib/helper');
const perf = require('./lib/performance');
const brandnews = require('./lib/brandnews');
const scheduler = require('./lib/scheduler');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const MASK = '••••••••';

const STATUSES = ['후보', '구매 완료', '촬영 완료', '발행 완료'];
const TYPES = ['직접 구매', '협찬', '제휴 링크'];
const POST_STATUSES = ['구상', '촬영', '작성', '발행'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const db = store.load();
  const s = db.settings;
  return {
    region: s.region,
    age: s.age,
    keywords: s.keywords,
    brands: s.brands,
    blogId: s.blogId,
    naverKeyType: s.naverKeyType,
    naverClientId: s.naverClientId ? MASK : '',
    naverClientSecret: s.naverClientSecret ? MASK : '',
    kmaServiceKey: s.kmaServiceKey ? MASK : '',
    hasNaver: service.hasNaver(s),
    hasKma: Boolean(s.kmaServiceKey),
    regions: Object.keys(REGIONS),
    ages: Object.entries(AGE_GROUPS).map(([value, g]) => ({ value, label: g.label })),
    jobs: db.jobs,
  };
}

const cleanList = (list, max) => [...new Set(list.map((k) => String(k).trim()).filter(Boolean))].slice(0, max);

function updateSettings(body) {
  const db = store.load();
  const s = db.settings;
  if (body.region && REGIONS[body.region]) s.region = body.region;
  if (body.age && AGE_GROUPS[body.age]) s.age = body.age;
  if (['hub', 'legacy'].includes(body.naverKeyType)) s.naverKeyType = body.naverKeyType;
  if (Array.isArray(body.keywords)) {
    const words = cleanList(body.keywords, 60);
    if (words.length) s.keywords = words;
  }
  if (Array.isArray(body.brands)) {
    const brands = cleanList(body.brands, 20);
    if (brands.join() !== s.brands.join()) delete db.jobs.brandFeed; // 브랜드가 바뀌면 바로 다시 가져옵니다.
    s.brands = brands;
  }
  if (typeof body.blogId === 'string') {
    const id = perf.normalizeBlogId(body.blogId);
    if (id !== s.blogId) delete db.jobs.rss;
    s.blogId = id;
  }
  for (const key of ['naverClientId', 'naverClientSecret', 'kmaServiceKey']) {
    if (typeof body[key] === 'string' && body[key] !== MASK) s[key] = body[key].trim();
  }
  store.save();
  setTimeout(scheduler.tick, 100);
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
  if (p.soldOut !== undefined && p.soldOut !== null) out.soldOut = Boolean(p.soldOut);
  return out;
}

function updateBoard(b, body) {
  for (const k of ['title', 'keyword', 'memo', 'publishedUrl']) if (typeof body[k] === 'string') b[k] = body[k].slice(0, 5000);
  for (const k of ['plannedDate', 'sponsorDeadline']) {
    if (typeof body[k] === 'string' && (body[k] === '' || DATE_RE.test(body[k]))) b[k] = body[k];
  }
  if (body.postStatus && POST_STATUSES.includes(body.postStatus)) {
    b.postStatus = body.postStatus;
    // 글을 발행하면 담긴 상품도 '발행 완료'로 바꿉니다. 이후 품절되면 '글 수정 필요' 알림이 갑니다.
    if (body.postStatus === '발행') for (const p of b.products) p.status = '발행 완료';
  }
  if (body.checklist && typeof body.checklist === 'object') {
    b.checklist = { ...(b.checklist || {}) };
    for (const [k, v] of Object.entries(body.checklist)) if (/^\w{1,30}$/.test(k)) b.checklist[k] = Boolean(v);
  }
}

function newBoard(body) {
  const b = {
    id: store.id(), title: '새 글', keyword: '', plannedDate: '', sponsorDeadline: '', memo: '',
    postStatus: '구상', publishedUrl: '', checklist: {}, createdAt: new Date().toISOString(), products: [],
  };
  updateBoard(b, { ...body, title: String(body.title || '새 글') });
  return b;
}

// ---- 일정 ----
function cleanEvent(body, e = {}) {
  const out = { ...e };
  if (typeof body.title === 'string') out.title = body.title.slice(0, 200);
  if (typeof body.brand === 'string') out.brand = body.brand.slice(0, 100);
  if (['sale', 'launch', 'etc'].includes(body.type)) out.type = body.type;
  if (DATE_RE.test(body.start || '')) out.start = body.start;
  if (body.end === '' || DATE_RE.test(body.end || '')) out.end = body.end || out.start;
  if (!out.title || !out.start) throw httpError(400, '일정 이름과 시작일을 넣어 주세요.');
  if (out.end < out.start) out.end = out.start;
  return out;
}

async function calendarMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = store.kstDate().slice(0, 7);
  const db = store.load();
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const weather = await service.getWeather().catch(() => ({}));
  return { month, from, to, days: calendar.build(db, from, to, weather.days || {}), events: db.events };
}

// ---- 성과 ----
function findPost(logNo) {
  const p = store.load().posts.find((x) => x.logNo === logNo);
  if (!p) throw httpError(404, '글을 찾을 수 없습니다.');
  return p;
}

// ---- 라우팅 ----
const routes = [
  ['GET', /^\/api\/settings$/, () => publicSettings()],
  ['PUT', /^\/api\/settings$/, (m, body) => updateSettings(body)],
  ['GET', /^\/api\/briefing$/, async (m, b, q) => {
    const db = store.load();
    const brief = await service.getBriefing({ force: q.get('refresh') === '1' });
    const weekEnd = store.kstDate(6);
    const week = calendar.build(db, store.kstDate(), weekEnd, brief.weather.days || {});
    return {
      ...brief,
      brandFeed: service.getBrandFeed(),
      alerts: db.alerts.filter((a) => !a.dismissed).slice(0, 8),
      unreadAlerts: db.alerts.filter((a) => !a.read && !a.dismissed).length,
      week,
      emptyDays: calendar.emptyDays(db.boards, brief.topics),
    };
  }],
  ['GET', /^\/api\/keywords$/, async (m, b, q) => {
    const r = await service.getKeywordRows({ force: q.get('refresh') === '1' });
    return { ...r, ageLabel: AGE_GROUPS[r.age].label };
  }],
  ['GET', /^\/api\/blogger-items$/, (m, b, q) => service.getBloggerItems({ force: q.get('refresh') === '1' })],
  ['POST', /^\/api\/refresh$/, () => { store.clearCache(); return { ok: true }; }],

  // 상품 보드
  ['GET', /^\/api\/boards$/, () => store.load().boards],
  ['POST', /^\/api\/boards$/, (m, body) => {
    const board = newBoard(body);
    store.load().boards.unshift(board);
    store.save();
    return board;
  }],
  ['PUT', /^\/api\/boards\/(\w+)$/, (m, body) => {
    const b = findBoard(m[1]);
    updateBoard(b, body);
    store.save();
    return b;
  }],
  ['DELETE', /^\/api\/boards\/(\w+)$/, (m) => {
    const db = store.load();
    findBoard(m[1]);
    db.boards = db.boards.filter((x) => x.id !== m[1]);
    store.save();
    return { ok: true };
  }],
  ['POST', /^\/api\/boards\/(\w+)\/products$/, (m, body) => {
    const b = findBoard(m[1]);
    const p = {
      id: store.id(), url: '', name: '', brand: '', image: '', price: null, originalPrice: null,
      status: '후보', type: '직접 구매', memo: '', size: '', fit: '', coordi: '', soldOut: false,
      createdAt: new Date().toISOString(),
      ...cleanProduct(body),
    };
    if (p.price != null) {
      p.priceCheckedAt = store.kstDate();
      p.priceHistory = [[store.kstDate(), p.price]];
    }
    b.products.push(p);
    store.save();
    return p;
  }],
  ['PUT', /^\/api\/boards\/(\w+)\/products\/(\w+)$/, (m, body) => {
    const b = findBoard(m[1]);
    const p = b.products.find((x) => x.id === m[2]);
    if (!p) throw httpError(404, '상품을 찾을 수 없습니다.');
    const patch = cleanProduct(body);
    if (patch.price !== undefined && patch.price !== p.price) patch.priceCheckedAt = store.kstDate();
    Object.assign(p, patch);
    store.save();
    return p;
  }],
  ['DELETE', /^\/api\/boards\/(\w+)\/products\/(\w+)$/, (m) => {
    const b = findBoard(m[1]);
    b.products = b.products.filter((x) => x.id !== m[2]);
    store.save();
    return { ok: true };
  }],
  ['POST', /^\/api\/scrape$/, (m, body) => scrape(String(body.url || ''))],

  // 포스팅 도우미
  ['GET', /^\/api\/boards\/(\w+)\/helper$/, (m, b, q) => {
    const board = findBoard(m[1]);
    const ids = q.get('products');
    const chosen = ids ? board.products.filter((p) => ids.split(',').includes(p.id)) : board.products;
    return { table: helper.productTable(chosen), titles: helper.titleIdeas(board), tags: helper.tagIdeas(board), checklist: helper.checklist(board) };
  }],

  // 알림
  ['GET', /^\/api\/alerts$/, () => {
    const db = store.load();
    return { alerts: db.alerts.filter((a) => !a.dismissed), lastCheck: db.jobs.priceCheck || '', error: db.jobs.priceCheckError || '' };
  }],
  ['POST', /^\/api\/alerts\/check$/, (m, body) => {
    // 상품마다 5초씩 간격을 두므로 오래 걸릴 수 있어 기다리지 않고 바로 답합니다.
    alerts.checkSavedProducts({ onlyBoard: body.boardId }).then(() => {
      if (!body.boardId) { store.load().jobs.priceCheck = new Date().toISOString(); store.save(); }
    });
    return { started: true };
  }],
  ['POST', /^\/api\/alerts\/read$/, () => {
    for (const a of store.load().alerts) a.read = true;
    store.save();
    return { ok: true };
  }],
  ['DELETE', /^\/api\/alerts\/(\w+)$/, (m) => {
    const a = store.load().alerts.find((x) => x.id === m[1]);
    if (a) { a.dismissed = true; store.save(); }
    return { ok: true };
  }],

  // 브랜드 할인·신상
  ['GET', /^\/api\/brand-feed$/, () => service.getBrandFeed()],
  ['POST', /^\/api\/brand-feed\/refresh$/, async () => {
    if (!service.hasNaver(store.load().settings)) throw httpError(400, '네이버 API 키가 필요합니다.');
    await brandnews.refreshBrandFeed();
    store.load().jobs.brandFeed = new Date().toISOString();
    store.save();
    return service.getBrandFeed();
  }],

  // 캘린더
  ['GET', /^\/api\/calendar$/, (m, b, q) => calendarMonth(q.get('month'))],
  ['POST', /^\/api\/events$/, (m, body) => {
    const e = { id: store.id(), type: 'etc', brand: '', ...cleanEvent(body) };
    store.load().events.push(e);
    store.save();
    return e;
  }],
  ['PUT', /^\/api\/events\/(\w+)$/, (m, body) => {
    const db = store.load();
    const i = db.events.findIndex((x) => x.id === m[1]);
    if (i === -1) throw httpError(404, '일정을 찾을 수 없습니다.');
    db.events[i] = cleanEvent(body, db.events[i]);
    store.save();
    return db.events[i];
  }],
  ['DELETE', /^\/api\/events\/(\w+)$/, (m) => {
    const db = store.load();
    db.events = db.events.filter((x) => x.id !== m[1]);
    store.save();
    return { ok: true };
  }],

  // 성과 기록
  ['GET', /^\/api\/posts$/, () => {
    const db = store.load();
    return { blogId: db.settings.blogId, hasNaver: service.hasNaver(db.settings), posts: db.posts, summary: perf.topicSummary(db.posts), lastSync: db.jobs.rss || '', error: db.jobs.rssError || '' };
  }],
  ['POST', /^\/api\/posts\/sync$/, async () => { await perf.syncPosts(); return { ok: true }; }],
  ['PUT', /^\/api\/posts\/(\w+)$/, (m, body) => {
    const p = findPost(m[1]);
    if (typeof body.keyword === 'string') p.keyword = body.keyword.trim().slice(0, 100);
    if (typeof body.boardId === 'string') {
      p.boardId = body.boardId;
      const b = store.load().boards.find((x) => x.id === body.boardId);
      if (b) {
        if (!p.keyword) p.keyword = b.keyword;
        b.publishedUrl ||= p.link;
        if (b.postStatus !== '발행') updateBoard(b, { postStatus: '발행' });
      }
    }
    store.save();
    return p;
  }],
  ['POST', /^\/api\/posts\/(\w+)\/views$/, (m, body) => {
    const p = findPost(m[1]);
    const date = DATE_RE.test(body.date || '') ? body.date : store.kstDate();
    const views = Math.max(0, Math.round(Number(body.views)));
    if (!Number.isFinite(views)) throw httpError(400, '조회수를 숫자로 넣어 주세요.');
    p.views = (p.views || []).filter((v) => v.date !== date);
    p.views.push({ date, views });
    p.views.sort((a, b) => a.date.localeCompare(b.date));
    store.save();
    return p;
  }],
  ['POST', /^\/api\/posts\/(\w+)\/rank$/, async (m) => {
    const p = findPost(m[1]);
    await perf.checkRank(p);
    return p;
  }],
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
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
    if (!process.env.NO_SCHEDULER) scheduler.start();
  });
}

module.exports = { server };
