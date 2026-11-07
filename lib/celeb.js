// 셀럽 착장: 연예인·유명인이 공항패션·사복패션 같은 자리에서 입어 '화제가 된 옷'을 찾습니다.
// 기사에서 Claude가 "누가 / 어떤 상황(키워드)에서 / 어느 브랜드의 / 무슨 옷"을 뽑고,
// 같은 사람·같은 옷은 한 항목으로 합친 뒤, 점수는 기사가 아니라 '최근 블로그에 실제로 쓰인 글 수'로 매깁니다.
// 기사 본문과 사진은 저장하지 않고 제목·요약·링크만 씁니다.
const store = require('./store');
const { pool } = require('./util');
const naver = require('./naver');
const claude = require('./claude');
const { trendIndexOf, freshnessOf } = require('./analysis');
const { ITEM_POOL } = require('./catalog');

const BASE_QUERIES = ['공항패션', '사복패션', '연예인 착장', '셀럽 패션 착용', '스타 데일리룩 착용', '패션 화보 착용 브랜드',
  '완판 착용 연예인', '품절 착용 연예인 패션', '드라마 속 패션 착용'];
const KEEP_DAYS = 30;
const MAX_NEW = 150; // 한 번에 처리하는 새 기사 수 (비용을 일정하게)
const CHUNK = 50; // Claude에게 한 번에 보내는 기사 수 (답이 잘리지 않게 나눠서)
const HOT_DAYS = 14; // 이 기간 안에 기사가 난 옷을 봅니다
const MAX_SCORED = 60; // 블로그 글 수를 확인하는 옷 개수 (네이버 호출을 일정하게)
const MIN_BLOG7 = 3; // 이보다 블로그 글이 적으면 '거의 안 쓰인 착장'
const CATEGORIES = ['아우터', '상의', '하의', '원피스', '신발', '가방', '액세서리', '기타'];
const SITUATIONS = ['공항패션', '사복패션', '데일리룩', '화보', '드라마 패션', '시상식·행사', '무대·방송', '기타'];

const SYSTEM = `너는 한국 패션 기사에서 연예인·유명인의 착장 정보를 뽑는 편집자야.
기사 제목과 요약에 적힌 사실만 써. 적혀 있지 않은 브랜드·제품명·가격은 추측하지 말고 빈 문자열로 둬.
item 은 한국 쇼핑몰에서 쓰는 일반 아이템 이름으로 짧고 띄어쓰기 없이 써. 아래 목록에 맞는 이름이 있으면 그 이름을 그대로 써:
${ITEM_POOL.join(', ')}
item 에 브랜드 이름을 넣지 마. category 는 아우터·상의·하의·원피스·신발·가방·액세서리·기타 중 하나.
situation 은 그 옷을 입은 자리: 공항패션, 사복패션, 데일리룩, 화보, 드라마 패션, 시상식·행사, 무대·방송, 기타 중 하나.
buzz 는 기사에 완판·품절·화제·인기·대란·검색 급증처럼 그 옷이 인기라는 표현이 있으면 true.
한 기사에 여러 사람·여러 아이템이 나오면 각각 따로 적어. 착장 정보가 없는 기사는 건너뛰어.`;

const SCHEMA = {
  type: 'object',
  properties: {
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          article: { type: 'integer', description: '기사 번호' },
          celeb: { type: 'string', description: '입은 사람 이름' },
          situation: { type: 'string', enum: SITUATIONS },
          item: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          brand: { type: 'string' },
          product: { type: 'string', description: '기사에 적힌 제품명 (없으면 빈 문자열)' },
          color: { type: 'string' },
          price: { type: 'string', description: '기사에 적힌 가격 (없으면 빈 문자열)' },
          buzz: { type: 'boolean' },
        },
        required: ['article', 'celeb', 'situation', 'item', 'category', 'brand', 'product', 'color', 'price', 'buzz'],
        additionalProperties: false,
      },
    },
  },
  required: ['outfits'],
  additionalProperties: false,
};

function state() {
  const db = store.load();
  const st = (db.celeb ||= { items: [], seen: {}, lastRun: '', error: '' });
  st.edits ||= {};
  st.scores ||= {};
  return st;
}

const toDate = (rfc) => {
  const d = new Date(rfc);
  return isNaN(d) ? store.kstDate() : store.kstDate(0, d);
};

// 같은 보도자료가 여러 매체에 실리므로, 제목 앞부분이 같은 기사는 하나로 봅니다.
const titleKey = (t) => t.replace(/[^가-힣a-zA-Z0-9]/g, '').slice(0, 18);

// ---- 아이템 이름 통일 ----
// "트렌치 코트", "버버리 트렌치코트", "재킷"처럼 같은 아이템이 다르게 나와도 하나로 셉니다.
const SYNONYMS = { 재킷: '자켓', 쟈켓: '자켓', 트렌치: '트렌치코트', 가죽자켓: '레더자켓', 라이더자켓: '레더자켓', 폴라: '폴라티', 터틀넥니트: '터틀넥', 데님팬츠: '청바지', 진: '청바지', 스니커즈화: '스니커즈', 운동화: '스니커즈', 패딩점퍼: '숏패딩' };
const CATEGORY_GUESS = [
  ['아우터', /코트|자켓|패딩|점퍼|무스탕|야상|블레이저|가디건|바람막이|플리스|아노락|다운|베스트|조끼|셔켓/],
  ['원피스', /원피스|드레스/],
  ['하의', /팬츠|바지|청바지|슬랙스|스커트|레깅스|데님|진$|반바지/],
  ['신발', /부츠|로퍼|스니커즈|샌들|슬리퍼|구두|힐|플랫|뮬|메리제인/],
  ['가방', /백$|가방|백팩|토트|크로스백|클러치/],
  ['액세서리', /모자|비니|캡|햇|머플러|스카프|목도리|장갑|귀마개|벨트|안경|선글라스|목걸이|귀걸이|반지|시계|양말|니삭스|워머/],
  ['상의', /니트|티|셔츠|블라우스|맨투맨|후드|스웨터|폴라|터틀넥|탑|나시|크롭/],
];

function normItem(item, brand = '') {
  let s = String(item || '').replace(/\s+/g, '');
  if (brand) s = s.replace(String(brand).replace(/\s+/g, ''), '');
  return SYNONYMS[s] || s;
}

function guessCategory(item) {
  return (CATEGORY_GUESS.find(([, re]) => re.test(item)) || ['기타'])[0];
}

// 예전 데이터처럼 상황 키워드가 없을 때 기사 제목에서 짐작합니다.
function guessSituation(title = '') {
  if (/공항/.test(title)) return '공항패션';
  if (/사복/.test(title)) return '사복패션';
  if (/화보/.test(title)) return '화보';
  if (/드라마|극중|극 중/.test(title)) return '드라마 패션';
  if (/시상식|레드카펫|포토콜|행사|팬미팅|패션위크|쇼 /.test(title)) return '시상식·행사';
  if (/무대|방송|예능|뮤직/.test(title)) return '무대·방송';
  if (/데일리|일상|출근/.test(title)) return '데일리룩';
  return '기타';
}

async function collectArticles(s, celebs) {
  const queries = [...BASE_QUERIES, ...celebs.map((n) => `${n} 패션`)];
  const since = store.kstDate(-(HOT_DAYS - 1));
  const seenTitle = new Set();
  const out = [];
  for (const q of queries) {
    for (const a of await naver.searchNews(s, q, 100)) {
      const date = toDate(a.pubDate);
      const key = titleKey(a.title);
      if (date < since || seenTitle.has(key)) continue;
      seenTitle.add(key);
      out.push({ ...a, date });
    }
  }
  return out;
}

function promptFor(articles) {
  return `다음 기사들에서 착장 정보를 뽑아 줘.\n\n${articles.map((a, i) => `[${i}] ${a.title}\n${a.description}`).join('\n\n')}`;
}

// 하루 한 번: 새 기사만 Claude에게 보내고, 결과를 쌓은 뒤 옷마다 블로그 글 수를 확인해 점수를 매깁니다.
async function refresh() {
  const db = store.load();
  const s = db.settings;
  const st = state();
  try {
    const articles = await collectArticles(s, s.celebs || []);
    const fresh = articles.filter((a) => !st.seen[a.link]).slice(0, MAX_NEW);
    // 50건씩 나눠 보내고, 한 묶음이 끝날 때마다 저장해서 중간에 실패해도 앞부분은 남깁니다.
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const { outfits } = await claude.askJson({ system: SYSTEM, prompt: promptFor(chunk), schema: SCHEMA });
      for (const o of outfits) {
        const a = chunk[o.article];
        if (!a || !o.celeb.trim() || !o.item.trim()) continue;
        st.items.push({
          id: store.id(), date: a.date, celeb: o.celeb.trim(), item: o.item.trim(), category: o.category || '', situation: o.situation || '',
          buzz: Boolean(o.buzz), brand: o.brand.trim(), product: o.product.trim(), color: o.color.trim(), price: o.price.trim(), title: a.title, link: a.link,
        });
      }
      for (const a of chunk) st.seen[a.link] = a.date;
      store.save();
    }
    // 30일 넘은 기록은 지웁니다.
    const cutoff = store.kstDate(-KEEP_DAYS);
    st.items = st.items.filter((x) => x.date >= cutoff);
    for (const [link, d] of Object.entries(st.seen)) if (d < cutoff) delete st.seen[link];
    for (const id of Object.keys(st.edits)) if (!st.items.some((x) => x.id === id)) delete st.edits[id];
    st.lastRun = new Date().toISOString();
    st.error = '';
    st.lastNew = fresh.length;
    store.save();
    await scoreHots().catch((err) => { st.scoreError = err.message; });
    store.save();
    return st;
  } catch (err) {
    st.error = err.message;
    store.save();
    throw err;
  }
}

// ---- 화면에 쓰는 형태 ----
// 사용자가 고친 값(edits)을 덮어쓰고, 숨긴 것은 빼고, 아이템 이름을 통일하고, 상황 키워드를 채웁니다.
function cleanItems(items, edits = {}) {
  return items
    .map((x) => ({ ...x, ...(edits[x.id] || {}) }))
    .filter((x) => !x.hidden)
    .map((x) => {
      const item = normItem(x.item, x.brand);
      return {
        ...x, item,
        category: CATEGORIES.includes(x.category) && x.category !== '기타' ? x.category : guessCategory(item),
        situation: SITUATIONS.includes(x.situation) && x.situation !== '기타' ? x.situation : guessSituation(x.title),
      };
    });
}

// 같은 사람이 같은 날 입은 아이템 묶음(룩). 글 만들기에서 '같이 입은 아이템'을 담을 때 씁니다.
function looksOf(items) {
  const map = new Map();
  for (const x of [...items].sort((a, b) => b.date.localeCompare(a.date))) {
    const id = `${x.celeb}|${x.date}`;
    const look = map.get(id) || { id, celeb: x.celeb, date: x.date, pieces: [], articles: [] };
    const same = look.pieces.find((p) => p.item === x.item && (p.brand === x.brand || !p.brand || !x.brand));
    if (same) {
      same.ids.push(x.id);
      if (!same.brand && x.brand) same.brand = x.brand;
      if (!same.product && x.product) same.product = x.product;
    } else {
      look.pieces.push({ ids: [x.id], id: x.id, item: x.item, category: x.category, brand: x.brand, product: x.product, color: x.color, price: x.price });
    }
    if (!look.articles.some((a) => a.link === x.link)) look.articles.push({ title: x.title, link: x.link, date: x.date });
    map.set(id, look);
  }
  for (const l of map.values()) l.pieces.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  return [...map.values()];
}

// ---- 화제가 된 옷 ----
// 같은 사람·같은 아이템은 날짜·기사가 달라도 한 항목: 키워드(상황) + 브랜드 + 착장 이름으로 보여줍니다.
function mostCommon(list) {
  const n = {};
  for (const v of list.filter(Boolean)) n[v] = (n[v] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || '';
}

// 블로그·검색에 쓸 착장 이름: "문가영 공항패션 버버리 트렌치코트"
function hotName(h) {
  const parts = [h.celeb, h.situation && h.situation !== '기타' ? h.situation : '', h.brand, h.product || h.item];
  const out = [];
  for (const p of parts) if (p && !out.join(' ').includes(p)) out.push(p);
  return out.join(' ');
}

function hotsOf(items, days = HOT_DAYS) {
  const since = store.kstDate(-(days - 1));
  const map = new Map();
  for (const x of items.filter((i) => i.date >= since)) {
    const id = `${x.celeb}|${x.item}`;
    const h = map.get(id) || { id, celeb: x.celeb, item: x.item, ids: [], rows: [], articles: [] };
    h.ids.push(x.id);
    h.rows.push(x);
    if (!h.articles.some((a) => a.link === x.link)) h.articles.push({ title: x.title, link: x.link, date: x.date });
    map.set(id, h);
  }
  return [...map.values()].map((h) => {
    const h2 = {
      ...h,
      category: mostCommon(h.rows.map((r) => r.category)) || guessCategory(h.item),
      brand: mostCommon(h.rows.map((r) => r.brand)),
      product: mostCommon(h.rows.map((r) => r.product)),
      color: mostCommon(h.rows.map((r) => r.color)),
      price: mostCommon(h.rows.map((r) => r.price)),
      situation: mostCommon(h.rows.map((r) => r.situation)) || '기타',
      buzz: h.rows.some((r) => r.buzz),
      date: h.rows.map((r) => r.date).sort().pop(),
    };
    delete h2.rows;
    h2.name = hotName(h2);
    return h2;
  });
}

// 점수: 최근 블로그 글(7일·3일)이 핵심, 기사 수와 '완판·화제' 표현이 보태집니다.
function hotScore({ blog7 = 0, blog3 = 0, articles = 1, buzz = false }) {
  return Math.round((blog7 + blog3 * 1.5 + articles * 3) * (buzz ? 1.2 : 1) * 10) / 10;
}

// 이름과 아이템이 모두 들어간 글만 '그 착장을 다룬 글'로 봅니다.
function aboutOutfit(post, celebName, item) {
  const text = `${post.title}${post.description || ''}`.replace(/\s/g, '');
  return text.includes(celebName.replace(/\s/g, '')) && text.includes(item.replace(/\s/g, ''));
}

async function scoreHots() {
  const s = store.load().settings;
  const st = state();
  const today = store.kstDate();
  const hots = hotsOf(cleanItems(st.items, st.edits))
    .sort((a, b) => b.articles.length - a.articles.length || b.date.localeCompare(a.date))
    .slice(0, MAX_SCORED);
  const names = [...new Set(hots.map((h) => h.celeb))];
  const trends = names.length ? await naver.trend(s, names, null).catch(() => ({})) : {};
  const since7 = store.kstDate(-7).replace(/-/g, '');
  const since3 = store.kstDate(-3).replace(/-/g, '');
  await pool(hots, 4, async (h) => { // 4개씩 동시에: 60개를 하나씩 기다리면 몇 분이 걸려요
    const prev = st.scores[h.id];
    const query = `${h.celeb} ${h.item}`;
    let sc = prev;
    if (!prev || prev.date !== today || prev.query !== query || prev.blog7 == null) {
      try {
        // 최신순 100개로 최근에 쓰인 글 수를, 정확도순 30개로 전체 글 수·상위 글을 봅니다.
        const [recent, top] = await Promise.all([naver.blogStats(s, query, 100, 'date'), naver.blogStats(s, query, 30, 'sim')]);
        const about = recent.items.filter((p) => aboutOutfit(p, h.celeb, h.item));
        sc = {
          date: today, query,
          blog7: about.filter((p) => p.postdate >= since7).length,
          blog3: about.filter((p) => p.postdate >= since3).length,
          posts: top.total, fresh: freshnessOf(top.topDates || [], today),
          blogs: top.items.filter((p) => aboutOutfit(p, h.celeb, h.item)).slice(0, 5).map((p) => ({ title: p.title, link: p.link, blogger: p.blogger, date: p.postdate })),
        };
      } catch { sc = prev || null; }
    }
    if (!sc) return;
    const celebIndex = trends[h.celeb] ? trendIndexOf(trends[h.celeb].series) : 100;
    st.scores[h.id] = { ...sc, celebChange: celebIndex - 100, articles: h.articles.length, buzz: h.buzz, score: hotScore({ ...sc, articles: h.articles.length, buzz: h.buzz }) };
    });
  for (const id of Object.keys(st.scores)) if (!hots.some((h) => h.id === id)) delete st.scores[id];
}

// 이번 주 셀럽들이 많이 입은 아이템 (사람 수 기준)
function topItems(items, days = 7) {
  const since = store.kstDate(-days);
  const by = {};
  for (const x of items.filter((i) => i.date >= since)) (by[x.item] ||= new Set()).add(x.celeb);
  return Object.entries(by).map(([item, set]) => ({ item, count: set.size, celebs: [...set].slice(0, 5) }))
    .sort((a, b) => b.count - a.count).slice(0, 12);
}

// 오늘의 주제용: 키워드마다 최근 7일 셀럽 착용 수와 이름 (아이템 이름이 키워드를 포함하거나 그 반대)
function forKeywords(words, items = currentItems()) {
  const since = store.kstDate(-7);
  const recent = items.filter((i) => i.date >= since);
  const out = {};
  for (const w of words) {
    const names = [...new Set(recent.filter((i) => i.item.includes(w) || w.includes(i.item)).map((i) => i.celeb))];
    if (names.length) out[w] = { count: names.length, names: names.slice(0, 3) };
  }
  return out;
}

// 내 블로그에 이미 쓴 착장: 최근 30일 글 제목에 그 사람 이름과 아이템이 함께 있으면
function writtenHot(hot, posts) {
  const since = store.kstDate(-30);
  return posts.some((p) => (p.pubDate || '') >= since && aboutOutfit({ title: p.title || '' }, hot.celeb, hot.item));
}

function demoItems() {
  const d = (n) => store.kstDate(-n);
  const rows = [
    ['가수 A', '트렌치코트', '아우터', '버버리', '켄싱턴 트렌치', '공항패션', true, d(0)], ['가수 A', '로퍼', '신발', '구찌', '홀스빗 로퍼', '공항패션', false, d(0)],
    ['배우 B', '트렌치코트', '아우터', '', '', '사복패션', true, d(1)], ['배우 B', '와이드팬츠', '하의', '', '', '사복패션', false, d(1)],
    ['가수 D', '니트', '상의', '르메르', '', '화보', false, d(2)], ['모델 E', '숄더백', '가방', '프라다', '', '공항패션', false, d(3)],
  ];
  return rows.map(([celeb, item, category, brand, product, situation, buzz, date], i) => ({
    id: `demo${i}`, celeb, item, category, brand, product, situation, buzz, color: '', price: '', date, title: `${celeb}, 가을 ${item} ${situation} (예시)`, link: '#',
  }));
}

function isDemo() {
  const s = store.load().settings;
  return !claude.hasKey() || !(s.naverClientId && s.naverClientSecret);
}

// 화면과 오늘의 주제가 쓰는 착장 목록 (키가 없으면 예시)
const currentItems = () => (isDemo() ? cleanItems(demoItems()) : cleanItems(state().items, state().edits));

function view() {
  const db = store.load();
  const s = db.settings;
  const demoMode = isDemo();
  const items = currentItems();
  const st = state();
  const fav = s.celebs || [];
  const demoScore = (i, h) => ({ blog7: 40 - i * 12, blog3: 18 - i * 5, posts: 800 + i * 900, articles: h.articles.length, buzz: h.buzz, celebChange: 30 - i * 10, fresh: { medianAge: 120, oldShare: 30 },
    score: hotScore({ blog7: 40 - i * 12, blog3: 18 - i * 5, articles: h.articles.length, buzz: h.buzz }),
    blogs: i === 0 ? [1, 2].map((n) => ({ title: `${h.celeb} ${h.item} 정보 ${n} (예시)`, link: '#', blogger: `블로거${n}`, date: store.kstDate(-n).replace(/-/g, '') })) : [] });
  const looks = new Map(looksOf(items).map((l) => [`${l.celeb}|${l.date}`, l])); // 한 번만 계산해서 옷마다 찾아 씁니다
  const hots = hotsOf(items).map((h, i) => {
    const sc = demoMode ? demoScore(i, h) : st.scores[h.id] || null;
    const blogs = (sc?.blogs || []).map((b) => ({ ...b, mine: Boolean(s.blogId) && b.link.includes(`/${s.blogId}/`) }));
    return { ...h, score: sc ? { ...sc, blogs } : null, favorite: fav.includes(h.celeb), written: writtenHot(h, db.posts),
      sameLook: looks.get(`${h.celeb}|${h.date}`)?.pieces.filter((p) => p.item !== h.item).map((p) => p.item) || [] };
  });
  // 블로그 글이 충분히 쓰인 옷 중 점수 상위 20%(최소 1개)는 🔥
  const ranked = hots.filter((h) => h.score && h.score.blog7 >= MIN_BLOG7).sort((a, b) => b.score.score - a.score.score);
  const hot = new Set(ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2))).filter(() => ranked.length).map((h) => h.id));
  return {
    demo: demoMode,
    needs: { claude: !claude.hasKey(), naver: !(s.naverClientId && s.naverClientSecret) },
    hots: hots.map((h) => ({ ...h, hot: hot.has(h.id) })),
    minBlog7: MIN_BLOG7,
    top: topItems(items),
    categories: CATEGORIES,
    situations: SITUATIONS,
    favorites: fav,
    lastRun: st.lastRun, lastNew: st.lastNew ?? null, error: st.error,
    usage: claude.monthUsage(),
  };
}

// ---- 고치기·숨기기 ----
function editItem(id, patch) {
  const st = state();
  if (!st.items.some((x) => x.id === id)) throw Object.assign(new Error('착장을 찾을 수 없어요.'), { status: 404 });
  const e = (st.edits[id] ||= {});
  for (const k of ['celeb', 'item', 'brand', 'product']) if (typeof patch[k] === 'string') e[k] = patch[k].trim().slice(0, 60);
  if (typeof patch.category === 'string' && CATEGORIES.includes(patch.category)) e.category = patch.category;
  if (typeof patch.situation === 'string' && SITUATIONS.includes(patch.situation)) e.situation = patch.situation;
  if (typeof patch.hidden === 'boolean') e.hidden = patch.hidden;
  store.save();
  return e;
}

// ---- 이 옷으로 글 만들기 ----
// hotIds 로 여러 옷을 한 번에 담을 수 있습니다(화면에서 한 줄로 묶인 옷들). 첫 번째가 대표 옷입니다.
function boardFromHot(hotId, { title, plannedDate, hotIds } = {}) {
  const items = currentItems();
  const all = hotsOf(items);
  const ids = Array.isArray(hotIds) && hotIds.length ? hotIds : [hotId];
  const hots = ids.map((id) => all.find((h) => h.id === id)).filter(Boolean);
  if (!hots.length) throw Object.assign(new Error('착장을 찾을 수 없어요.'), { status: 404 });
  const hot = hots[0];
  const db = store.load();
  // 같은 날 같이 입은 다른 아이템도 상품으로 담습니다.
  const look = looksOf(items).find((l) => l.celeb === hot.celeb && l.date === hot.date);
  const extra = (look?.pieces || []).filter((p) => !hots.some((h) => h.item === p.item));
  const toProduct = (p, note) => ({
    id: store.id(), url: '', name: [p.brand, p.product || p.item].filter(Boolean).join(' '), brand: p.brand, image: '',
    price: null, originalPrice: null, status: '후보', type: '직접 구매', size: '', fit: '', coordi: '', soldOut: false,
    memo: `${hot.celeb} 착용 ${p.item}${p.color ? ` (${p.color})` : ''}${note}`, createdAt: new Date().toISOString(),
  });
  const links = [...new Map(hots.flatMap((h) => h.articles).map((a) => [a.link, a])).values()];
  const board = {
    id: store.id(),
    title: String(title || `${hot.situation !== '기타' ? hot.situation + ' ' : ''}${hot.celeb} ${hot.brand ? hot.brand + ' ' : ''}${hot.item} 정보와 비슷한 제품`).slice(0, 200),
    keyword: hot.item,
    plannedDate: /^\d{4}-\d{2}-\d{2}$/.test(plannedDate || '') ? plannedDate : '',
    sponsorDeadline: '',
    memo: [`${hot.name} (${hot.date})`, '출처 기사:', ...links.map((a) => `- ${a.title} ${a.link}`),
      '※ 기사 문장·보도 사진을 그대로 옮기지 말고 출처를 밝혀 주세요.'].join('\n'),
    postStatus: '구상', publishedUrl: '', checklist: {}, createdAt: new Date().toISOString(),
    products: [...hots.map((h) => toProduct(h, '')), ...extra.map((p) => toProduct(p, ' (같이 입은 아이템)'))],
  };
  db.boards.unshift(board);
  store.save();
  return board;
}

module.exports = {
  topBlogs: (items, celebName, n = 5) => items.filter((p) => `${p.title}${p.description || ''}`.replace(/\s/g, '').includes(celebName.replace(/\s/g, ''))).slice(0, n),
  currentItems, refresh, view, hotsOf, hotName, hotScore, aboutOutfit, looksOf, cleanItems, normItem, guessCategory, guessSituation, scoreHots, editItem,
  boardFromHot, writtenHot, topItems, forKeywords, promptFor, titleKey, SCHEMA, state, CATEGORIES, SITUATIONS,
};
