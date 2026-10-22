// 2단계: 관심 브랜드의 할인·신상 모음.
// 네이버 쇼핑 검색 API(공식)로 브랜드 상품을 가져오고, 날마다 본 가격을 기록해 두었다가
// 가격이 내려간 상품을 '할인', 처음 보이는 상품을 '신상'으로 보여줍니다. 쇼핑몰을 직접 수집하지 않습니다.
const store = require('./store');
const { call, headers, strip } = require('./naver');

const FASHION = /패션의류|패션잡화/;
const DROP_MIN = 5; // 5% 이상 내려가야 할인으로 봅니다.

async function brandItems(s, brand) {
  const get = async (sort) => {
    const json = await call(`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(brand)}&display=100&sort=${sort}`, { headers: headers(s) });
    return json.items;
  };
  const [popular, recent] = [await get('sim'), await get('date')];
  const want = brand.toLowerCase().replace(/\s/g, '');
  const mine = (it) => {
    const hay = [it.brand, it.maker, it.mallName, strip(it.title)].join(' ').toLowerCase().replace(/\s/g, '');
    return hay.includes(want) && FASHION.test(it.category1 || '');
  };
  const norm = (it, fromRecent) => ({
    id: String(it.productId),
    brand,
    title: strip(it.title),
    link: it.link,
    image: it.image,
    price: Number(it.lprice) || null,
    mall: it.mallName,
    category: [it.category2, it.category3].filter(Boolean).join(' > '),
    recent: fromRecent,
  });
  const map = new Map();
  for (const it of popular.filter(mine)) map.set(String(it.productId), norm(it, false));
  for (const it of recent.filter(mine)) map.set(String(it.productId), { ...(map.get(String(it.productId)) || norm(it, true)), recent: true });
  return [...map.values()];
}

// 가져온 상품을 가격 기록과 비교해 할인·신상을 가립니다.
// baseline: 그 브랜드를 처음 지켜보는 날. 이날 본 상품은 기준으로만 쓰고 신상으로 치지 않습니다.
function classify(items, history, today, baseline = false) {
  const sales = [];
  const launches = [];
  for (const it of items) {
    let h = history[it.id];
    if (!h) {
      h = history[it.id] = { brand: it.brand, firstSeen: today, lastSeen: today, prices: [] };
      if (!baseline && it.recent) h.isNew = true;
    }
    if (h.isNew && h.firstSeen >= store.kstDate(-3, new Date(today + 'T12:00:00+09:00'))) launches.push({ ...it, firstSeen: h.firstSeen });
    const ref = Math.max(0, ...h.prices.filter(([d]) => d < today && d >= store.kstDate(-14, new Date(today + 'T12:00:00+09:00'))).map(([, p]) => p || 0));
    if (ref && it.price && it.price < ref) {
      const pct = Math.round((1 - it.price / ref) * 100);
      if (pct >= DROP_MIN) sales.push({ ...it, before: ref, pct });
    }
    h.lastSeen = today;
    const last = h.prices[h.prices.length - 1];
    if (last && last[0] === today) last[1] = it.price;
    else h.prices.push([today, it.price]);
    h.prices = h.prices.slice(-30);
  }
  // 30일 넘게 안 보인 상품 기록은 지웁니다.
  const cutoff = store.kstDate(-30, new Date(today + 'T12:00:00+09:00'));
  for (const [id, h] of Object.entries(history)) if (h.lastSeen < cutoff) delete history[id];
  return { sales: sales.sort((a, b) => b.pct - a.pct), launches };
}

// 관심 브랜드 전체를 한 번에 갱신합니다(하루 한 번).
async function refreshBrandFeed() {
  const db = store.load();
  const s = db.settings;
  const today = store.kstDate();
  const out = { date: today, fetchedAt: new Date().toISOString(), brands: {} };
  for (const brand of s.brands) {
    try {
      const items = await brandItems(s, brand);
      const firstTime = !Object.values(db.history.brandItems).some((h) => h.brand === brand && h.firstSeen < today);
      const r = classify(items, db.history.brandItems, today, firstTime);
      out.brands[brand] = { ...r, recent: items.filter((x) => x.recent).slice(0, 12), baseline: firstTime };
    } catch (err) {
      out.brands[brand] = { error: err.message, sales: [], launches: [], recent: [] };
    }
  }
  db.cache.brandFeed = out;
  store.save();
  return out;
}

function demoFeed(brands) {
  const list = brands.length ? brands : ['예시 브랜드'];
  const today = store.kstDate();
  const brandsOut = {};
  list.forEach((b, i) => {
    const mk = (n, extra) => ({ id: `${i}-${n}`, brand: b, title: `${b} ${['울 블렌드 코트', '케이블 니트', '와이드 슬랙스', '레더 자켓', '캐시미어 머플러'][n % 5]}`, link: '#', image: '', price: 39000 + n * 20000, mall: b, category: '여성의류', ...extra });
    brandsOut[b] = {
      sales: [mk(0, { before: 89000, pct: 34 }), mk(1, { before: 69000, pct: 13 })].map((x) => ({ ...x, price: Math.round(x.before * (1 - x.pct / 100) / 100) * 100 })),
      launches: [mk(2, { firstSeen: today }), mk(3, { firstSeen: today })],
      recent: [],
    };
  });
  return { demo: true, date: today, brands: brandsOut };
}

module.exports = { brandItems, classify, refreshBrandFeed, demoFeed };
