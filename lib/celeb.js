// 셀럽 착장: 네이버 뉴스에서 연예인·유명인 패션 기사를 모아, Claude가 기사 제목·요약에서
// "누가 / 어떤 아이템을 / 어느 브랜드로" 입었는지 뽑습니다. 기사 본문과 사진은 저장하지 않고 제목·요약·링크만 씁니다.
const store = require('./store');
const naver = require('./naver');
const claude = require('./claude');

const BASE_QUERIES = ['공항패션', '연예인 착장', '셀럽 패션 착용', '스타 데일리룩 착용', '패션 화보 착용 브랜드'];
const KEEP_DAYS = 30;
const MAX_NEW = 60; // 한 번에 Claude에게 보내는 새 기사 수 (비용을 일정하게)

const SYSTEM = `너는 한국 패션 기사에서 연예인·유명인의 착장 정보를 뽑는 편집자야.
기사 제목과 요약에 적힌 사실만 써. 적혀 있지 않은 브랜드·제품명·가격은 추측하지 말고 빈 문자열로 둬.
item 은 한국 쇼핑몰에서 쓰는 일반 아이템 이름으로 짧게 (예: 트렌치코트, 니트, 와이드팬츠, 로퍼, 숄더백).
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
          brand: { type: 'string' },
          product: { type: 'string', description: '기사에 적힌 제품명 (없으면 빈 문자열)' },
          color: { type: 'string' },
          price: { type: 'string', description: '기사에 적힌 가격 (없으면 빈 문자열)' },
        },
        required: ['article', 'celeb', 'item', 'brand', 'product', 'color', 'price'],
        additionalProperties: false,
      },
    },
  },
  required: ['outfits'],
  additionalProperties: false,
};

function state() {
  const db = store.load();
  return (db.celeb ||= { items: [], seen: {}, lastRun: '', error: '' });
}

const toDate = (rfc) => {
  const d = new Date(rfc);
  return isNaN(d) ? store.kstDate() : store.kstDate(0, d);
};

// 같은 보도자료가 여러 매체에 실리므로, 제목 앞부분이 같은 기사는 하나로 봅니다.
const titleKey = (t) => t.replace(/[^가-힣a-zA-Z0-9]/g, '').slice(0, 18);

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

// 하루 한 번: 새 기사만 Claude에게 보내고, 결과를 쌓아 둡니다.
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
          id: store.id(), date: a.date, celeb: o.celeb.trim(), item: o.item.trim(), brand: o.brand.trim(),
          product: o.product.trim(), color: o.color.trim(), price: o.price.trim(), title: a.title, link: a.link,
        });
      }
      for (const a of fresh) st.seen[a.link] = a.date;
    }
    // 30일 넘은 기록은 지웁니다.
    const cutoff = store.kstDate(-KEEP_DAYS);
    st.items = st.items.filter((x) => x.date >= cutoff);
    for (const [link, d] of Object.entries(st.seen)) if (d < cutoff) delete st.seen[link];
    st.lastRun = new Date().toISOString();
    st.error = '';
    st.lastNew = fresh.length;
    store.save();
    return st;
  } catch (err) {
    st.error = err.message;
    store.save();
    throw err;
  }
}

// 같은 사람·아이템·브랜드는 하나로 묶고 기사 수를 셉니다.
function grouped(items) {
  const map = new Map();
  for (const x of [...items].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = `${x.celeb}|${x.item}|${x.brand}`;
    const g = map.get(k);
    if (g) { g.articles.push({ title: x.title, link: x.link, date: x.date }); if (!g.product && x.product) g.product = x.product; }
    else map.set(k, { ...x, articles: [{ title: x.title, link: x.link, date: x.date }] });
  }
  return [...map.values()];
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

function demo() {
  const d = (n) => store.kstDate(-n);
  const rows = [
    ['가수 A', '트렌치코트', '버버리', '', d(0)], ['배우 B', '트렌치코트', '', '', d(1)], ['배우 C', '로퍼', '구찌', '홀스빗 로퍼', d(1)],
    ['가수 D', '니트', '르메르', '', d(2)], ['배우 B', '와이드팬츠', '', '', d(3)], ['모델 E', '숄더백', '프라다', '', d(2)],
  ];
  return rows.map(([celeb, item, brand, product, date], i) => ({
    id: `demo${i}`, celeb, item, brand, product, color: '', price: '', date, title: `${celeb}, 가을 ${item} 착장 (예시)`, link: '#',
  }));
}

function isDemo() {
  const s = store.load().settings;
  return !claude.hasKey() || !(s.naverClientId && s.naverClientSecret);
}

// 화면과 오늘의 주제가 쓰는 착장 목록 (키가 없으면 예시)
const currentItems = () => (isDemo() ? demo() : state().items);

function view() {
  const s = store.load().settings;
  const demoMode = isDemo();
  const items = currentItems();
  const st = state();
  return {
    demo: demoMode,
    needs: { claude: !claude.hasKey(), naver: !(s.naverClientId && s.naverClientSecret) },
    outfits: grouped(items),
    top: topItems(items),
    lastRun: st.lastRun, lastNew: st.lastNew ?? null, error: st.error,
    usage: claude.monthUsage(),
  };
}

module.exports = { currentItems, refresh, view, grouped, topItems, forKeywords, promptFor, titleKey, SCHEMA, state };
