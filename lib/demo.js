// API 키를 넣기 전에도 화면을 둘러볼 수 있도록 만드는 예시 데이터. 날짜별로 같은 값이 나오도록 시드를 씁니다.
const { kstDate } = require('./store');

function seeded(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function demoTrends(keywords, age) {
  const out = {};
  for (const k of keywords) {
    const rnd = seeded(`${k}|${age}|${kstDate()}`);
    const base = 3 + rnd() * 40;
    const slope = (rnd() - 0.35) * 0.12;
    const series = Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(base * (1 + slope * i) * (0.85 + rnd() * 0.3) * 10) / 10));
    out[k] = { series, anchorAvg: 60 };
  }
  return out;
}

function demoCounts(keywords) {
  return Object.fromEntries(keywords.map((k) => {
    const rnd = seeded(`${k}|posts`);
    return [k, Math.round(Math.pow(10, 4 + rnd() * 2.5))];
  }));
}

function demoPosts() {
  const rnd = seeded(`posts|${kstDate()}`);
  const items = ['트렌치코트', '니트', '가디건', '블레이저', '와이드팬츠', '로퍼', '셔켓', '레더자켓', '부츠', '머플러', '청바지', '슬랙스'];
  const brands = ['무신사', '자라', '유니클로', '탑텐', '코스', '마뗑킴', '스파오', '뉴발란스'];
  return Array.from({ length: 300 }, () => {
    const a = items[Math.floor(Math.pow(rnd(), 1.6) * items.length)];
    const b = items[Math.floor(rnd() * items.length)];
    const br = rnd() < 0.5 ? brands[Math.floor(Math.pow(rnd(), 1.4) * brands.length)] : '';
    return { title: `${a} ${b} 데일리룩 ${br}`, description: '' };
  });
}

function demoShop(keywords) {
  return Object.fromEntries(keywords.map((k) => {
    const rnd = seeded(`${k}|shop|${kstDate()}`);
    return [k, { shopChange: Math.round((rnd() - 0.3) * 60), hasClicks: true }];
  }));
}

function demoPeaks(keywords) {
  const out = {};
  keywords.slice(0, 8).forEach((k, i) => {
    const peak = kstDate(10 + i * 9);
    out[k] = { peak, prepare: kstDate(10 + i * 9 - 14), lastYear: kstDate(10 + i * 9 - 364), rise: 40 + i * 12 };
  });
  return out;
}

function demoAudience(word) {
  const rnd = seeded(`${word}|aud`);
  const female = Math.round(45 + rnd() * 40);
  const age = ['20', '30', '40'][Math.floor(rnd() * 3)];
  return { female, male: 100 - female, ages: { [age]: 38 }, topAge: { code: age, label: `${age}대`, share: 38 }, label: `${age}대${female >= 60 ? ' 여성' : ''}` };
}

function demoDiscover(watched) {
  const { DISCOVERY_WORDS } = require('./catalog');
  return DISCOVERY_WORDS.filter((w) => !watched.includes(w)).slice(0, 8).map((word, i) => {
    const rnd = seeded(`${word}|disc|${kstDate()}`);
    const spark = Array.from({ length: 14 }, (_, j) => Math.round(30 + j * (4 + i) * rnd() + rnd() * 10));
    const peak = Math.max(...spark);
    return { word, change: 60 - i * 6, spark: spark.map((v) => Math.round((v / peak) * 100)) };
  });
}

module.exports = { demoTrends, demoCounts, demoPosts, demoShop, demoPeaks, demoAudience, demoDiscover };
