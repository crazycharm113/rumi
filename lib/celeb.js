// 셀럽 착장: 네이버 뉴스에서 연예인·유명인 패션 기사를 모아, Claude가 기사 제목·요약에서
// "누가 / 어떤 아이템을 / 어느 브랜드로" 입었는지 뽑습니다. 기사 본문과 사진은 저장하지 않고 제목·요약·링크만 씁니다.
// 같은 사람이 같은 날 입은 아이템은 한 '착장(룩)'으로 묶고, 지금 쓰기 좋은 착장을 점수로 정렬합니다.
const store = require('./store');
const naver = require('./naver');
const claude = require('./claude');
const { trendIndexOf, freshnessOf } = require('./analysis');
const { ITEM_POOL } = require('./catalog');

const BASE_QUERIES = ['공항패션', '연예인 착장', '셀럽 패션 착용', '스타 데일리룩 착용', '패션 화보 착용 브랜드'];
const KEEP_DAYS = 30;
const MAX_NEW = 60; // 한 번에 Claude에게 보내는 새 기사 수 (비용을 일정하게)
const SCORE_DAYS = 7; // 점수를 매기는 착장 기간
const CATEGORIES = ['아우터', '상의', '하의', '원피스', '신발', '가방', '액세서리', '기타'];

const SYSTEM = `너는 한국 패션 기사에서 연예인·유명인의 착장 정보를 뽑는 편집자야.
기사 제목과 요약에 적힌 사실만 써. 적혀 있지 않은 브랜드·제품명·가격은 추측하지 말고 빈 문자열로 둬.
item 은 한국 쇼핑몰에서 쓰는 일반 아이템 이름으로 짧고 띄어쓰기 없이 써. 아래 목록에 맞는 이름이 있으면 그 이름을 그대로 써:
${ITEM_POOL.join(', ')}
item 에 브랜드 이름을 넣지 마. category 는 아우터·상의·하의·원피스·신발·가방·액세서리·기타 중 하나.
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
          item: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          brand: { type: 'string' },
          product: { type: 'string', description: '기사에 적힌 제품명 (없으면 빈 문자열)' },
          color: { type: 'string' },
          price: { type: 'string', description: '기사에 적힌 가격 (없으면 빈 문자열)' },
        },
        required: ['article', 'celeb', 'item', 'category', 'brand', 'product', 'color', 'price'],
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

async function collectArticles(s, celebs) {
  const queries = [...BASE_QUERIES, ...celebs.map((n) => `${n} 패션`)];
  const since = store.kstDate(-7);
  const seenTitle = new Set();
  const out = [];
  for (const q of queries) {
    for (const a of await naver.searchNews(s, q, 30)) {
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

// 하루 한 번: 새 기사만 Claude에게 보내고, 결과를 쌓은 뒤 착장 점수를 매깁니다.
async function refresh() {
  const db = store.load();
  const s = db.settings;
  const st = state();
  try {
    const articles = await collectArticles(s, s.celebs || []);
    const fresh = articles.filter((a) => !st.seen[a.link]).slice(0, MAX_NEW);
    if (fresh.length) {
      const { outfits } = await claude.askJson({ system: SYSTEM, prompt: promptFor(fresh), schema: SCHEMA });
      for (const o of outfits) {
        const a = fresh[o.article];
        if (!a || !o.celeb.trim() || !o.item.trim()) continue;
        st.items.push({
          id: store.id(), date: a.date, celeb: o.celeb.trim(), item: o.item.trim(), category: o.category || '',
          brand: o.brand.trim(), product: o.product.trim(), color: o.color.trim(), price: o.price.trim(), title: a.title, link: a.link,
        });
      }
      for (const a of fresh) st.seen[a.link] = a.date;
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
    await scoreLooks().catch((err) => { st.scoreError = err.message; });
    store.save();
    return st;
  } catch (err) {
    st.error = err.message;
    store.save();
    throw err;
  }
}

// ---- 화면에 쓰는 형태 ----
// 사용자가 고친 값(edits)을 덮어쓰고, 숨긴 것은 빼고, 아이템 이름을 통일합니다.
function cleanItems(items, edits = {}) {
  return items
    .map((x) => ({ ...x, ...(edits[x.id] || {}) }))
    .filter((x) => !x.hidden)
    .map((x) => {
      const item = normItem(x.item, x.brand);
      return { ...x, item, category: CATEGORIES.includes(x.category) && x.category !== '기타' ? x.category : guessCategory(item) };
    });
}

// 같은 사람이 같은 날 입은 아이템은 한 착장(룩)으로 묶습니다.
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
  const order = CATEGORIES;
  for (const l of map.values()) l.pieces.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return [...map.values()];
}

// 대표 아이템: 아우터 > 원피스 > 상의 ... 순서로 첫 번째
const mainPiece = (look) => look.pieces[0];

// ---- 지금 쓰기 좋은 착장 점수 ----
// 화제성(기사 수 · 그 사람 검색량 변화)과 경쟁도("이름 + 대표 아이템" 블로그 글 수 · 상위 글 나이)를 합칩니다.
function lookScore({ articles, celebIndex = 100, posts = null, fresh = null }) {
  const buzz = (1 + Math.min(articles, 5) * 0.25) * (Math.min(Math.max(celebIndex, 50), 300) / 100);
  const competition = posts == null ? 1 : Math.log10(posts + 10);
  const old = fresh && fresh.oldShare >= 60 ? 1.15 : 1;
  return Math.round((buzz / competition) * old * 1000) / 10;
}

async function scoreLooks() {
  const s = store.load().settings;
  const st = state();
  const today = store.kstDate();
  const looks = looksOf(cleanItems(st.items, st.edits)).filter((l) => l.date >= store.kstDate(-SCORE_DAYS));
  const names = [...new Set(looks.map((l) => l.celeb))];
  const trends = names.length ? await naver.trend(s, names, null).catch(() => ({})) : {};
  for (const look of looks) {
    const prev = st.scores[look.id];
    const query = `${look.celeb} ${mainPiece(look).item}`;
    let posts = prev?.posts ?? null;
    let fresh = prev?.fresh ?? null;
    let blogs = prev?.blogs ?? null;
    if (!prev || prev.date !== today || prev.query !== query || !prev.blogs) {
      try {
        const r = await naver.blogStats(s, query, 30); // 한 번의 호출로 글 수·상위 글 나이·상위 글 목록
        posts = r.total;
        fresh = freshnessOf(r.topDates || [], today);
        blogs = topBlogs(r.items, look.celeb);
      } catch { /* 경쟁도 없이 점수 */ }
    }
    const celebIndex = trends[look.celeb] ? trendIndexOf(trends[look.celeb].series) : 100;
    st.scores[look.id] = {
      date: today, query, articles: look.articles.length, celebChange: celebIndex - 100, posts, fresh, blogs,
      score: lookScore({ articles: look.articles.length, celebIndex, posts, fresh }),
    };
  }
  for (const id of Object.keys(st.scores)) if (!looks.some((l) => l.id === id)) delete st.scores[id];
}

// 이미 이 착장(사람 + 대표 아이템)으로 쓰인 블로그 글 상위 5개. 그 사람 이름이 제목·요약에 있는 글만 봅니다.
function topBlogs(items, celebName, n = 5) {
  const name = celebName.replace(/\s/g, '');
  return (items || [])
    .filter((p) => `${p.title}${p.description || ''}`.replace(/\s/g, '').includes(name))
    .slice(0, n)
    .map((p) => ({ title: p.title, link: p.link, blogger: p.blogger, date: p.postdate }));
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

// 내 블로그에 이미 쓴 착장: 최근 30일 글 제목에 그 사람 이름과 아이템 하나가 함께 있으면
function writtenLook(look, posts) {
  const since = store.kstDate(-30);
  return posts.some((p) => (p.pubDate || '') >= since && (p.title || '').includes(look.celeb)
    && look.pieces.some((x) => (p.title || '').replace(/\s/g, '').includes(x.item)));
}

function demoItems() {
  const d = (n) => store.kstDate(-n);
  const rows = [
    ['가수 A', '트렌치코트', '아우터', '버버리', '', d(0)], ['가수 A', '로퍼', '신발', '구찌', '홀스빗 로퍼', d(0)], ['가수 A', '숄더백', '가방', '', '', d(0)],
    ['배우 B', '트렌치코트', '아우터', '', '', d(1)], ['배우 B', '와이드팬츠', '하의', '', '', d(1)],
    ['가수 D', '니트', '상의', '르메르', '', d(2)], ['모델 E', '숄더백', '가방', '프라다', '', d(3)],
  ];
  return rows.map(([celeb, item, category, brand, product, date], i) => ({
    id: `demo${i}`, celeb, item, category, brand, product, color: '', price: '', date, title: `${celeb}, 가을 ${item} 착장 (예시)`, link: '#',
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
  const looks = looksOf(items.filter((x) => x.date >= store.kstDate(-SCORE_DAYS))).map((l, i) => {
    const sc = demoMode ? { articles: l.articles.length, celebChange: 30 - i * 10, posts: 800 + i * 900, fresh: { medianAge: 120, oldShare: i % 2 ? 70 : 20 }, score: 40 - i * 4,
      blogs: i === 0 ? [1, 2, 3].map((n) => ({ title: `${l.celeb} ${mainPiece(l).item} 코디 정보 ${n} (예시)`, link: '#', blogger: `블로거${n}`, date: store.kstDate(-n).replace(/-/g, '') })) : [] } : st.scores[l.id];
    const blogId = s.blogId;
    const blogs = (sc?.blogs || []).map((b) => ({ ...b, mine: Boolean(blogId) && b.link.includes(`/${blogId}/`) }));
    return { ...l, main: mainPiece(l).item, score: sc ? { ...sc, blogs } : null, favorite: fav.includes(l.celeb), written: writtenLook(l, db.posts) };
  });
  // 상위 20%(최소 1개)는 🔥
  const ranked = looks.filter((l) => l.score).sort((a, b) => b.score.score - a.score.score);
  const hot = new Set(ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2))).map((l) => l.id));
  return {
    demo: demoMode,
    needs: { claude: !claude.hasKey(), naver: !(s.naverClientId && s.naverClientSecret) },
    looks: looks.map((l) => ({ ...l, hot: hot.has(l.id) })),
    top: topItems(items),
    categories: CATEGORIES,
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
  if (typeof patch.hidden === 'boolean') e.hidden = patch.hidden;
  store.save();
  return e;
}

// ---- 이 착장으로 글 만들기 ----
function lookTitle(look) {
  const items = look.pieces.slice(0, 3).map((p) => p.item).join('·');
  const branded = look.pieces.find((p) => p.brand);
  return `${look.celeb} 착장 정보 · ${items}${branded ? ` (${branded.brand})` : ''}와 비슷한 제품`;
}

function boardFromLook(lookId, { title, plannedDate } = {}) {
  const look = looksOf(currentItems()).find((l) => l.id === lookId);
  if (!look) throw Object.assign(new Error('착장을 찾을 수 없어요.'), { status: 404 });
  const db = store.load();
  const board = {
    id: store.id(),
    title: String(title || lookTitle(look)).slice(0, 200),
    keyword: mainPiece(look).item,
    plannedDate: /^\d{4}-\d{2}-\d{2}$/.test(plannedDate || '') ? plannedDate : '',
    sponsorDeadline: '',
    memo: [`${look.celeb} 착장 (${look.date})`, '출처 기사:', ...look.articles.map((a) => `- ${a.title} ${a.link}`),
      '※ 기사 문장·보도 사진을 그대로 옮기지 말고 출처를 밝혀 주세요.'].join('\n'),
    postStatus: '구상', publishedUrl: '', checklist: {}, createdAt: new Date().toISOString(),
    products: look.pieces.map((p) => ({
      id: store.id(), url: '', name: [p.brand, p.product || p.item].filter(Boolean).join(' '), brand: p.brand, image: '',
      price: null, originalPrice: null, status: '후보', type: '직접 구매', size: '', fit: '', coordi: '', soldOut: false,
      memo: `${look.celeb} 착용 ${p.item}${p.color ? ` (${p.color})` : ''}`, createdAt: new Date().toISOString(),
    })),
  };
  db.boards.unshift(board);
  store.save();
  return board;
}

module.exports = {
  topBlogs, currentItems, refresh, view, looksOf, cleanItems, normItem, guessCategory, lookScore, scoreLooks, editItem,
  boardFromLook, lookTitle, writtenLook, topItems, forKeywords, promptFor, titleKey, SCHEMA, state, CATEGORIES,
};
