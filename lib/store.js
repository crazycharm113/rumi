// 모든 데이터를 data/db.json 한 파일에 저장합니다. 본인만 쓰는 도구라 DB 서버 없이 파일로 충분합니다.
const fs = require('fs');
const path = require('path');
const { DEFAULT_KEYWORDS } = require('./catalog');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function defaults() {
  return {
    settings: {
      naverClientId: process.env.NAVER_CLIENT_ID || '',
      naverClientSecret: process.env.NAVER_CLIENT_SECRET || '',
      kmaServiceKey: process.env.KMA_SERVICE_KEY || '',
      region: '서울',
      age: 'all',
      keywords: DEFAULT_KEYWORDS.map((k) => k.word),
    },
    boards: [],
    cache: {},
    history: { weather: {}, ranks: {} },
  };
}

let db = null;

function load() {
  if (db) return db;
  const base = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = {
      ...base,
      ...saved,
      settings: { ...base.settings, ...saved.settings },
      history: { ...base.history, ...saved.history },
    };
    // .env 값은 화면에서 비워둔 경우에만 채웁니다.
    for (const [key, env] of [
      ['naverClientId', 'NAVER_CLIENT_ID'],
      ['naverClientSecret', 'NAVER_CLIENT_SECRET'],
      ['kmaServiceKey', 'KMA_SERVICE_KEY'],
    ]) {
      if (!db.settings[key] && process.env[env]) db.settings[key] = process.env[env];
    }
  } catch {
    db = base;
  }
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
function kstDate(offsetDays = 0, from = new Date()) {
  const t = new Date(from.getTime() + 9 * 3600e3 + offsetDays * 86400e3);
  return t.toISOString().slice(0, 10);
}

function kstHour(from = new Date()) {
  return new Date(from.getTime() + 9 * 3600e3).getUTCHours();
}

// 하루 단위 캐시. 오늘 데이터가 있으면 그대로 쓰고, 가져오기에 실패하면 마지막 데이터를 갱신 시각과 함께 돌려줍니다.
async function cached(key, fetcher, { force = false } = {}) {
  const d = load();
  const today = kstDate();
  const hit = d.cache[key];
  if (!force && hit && hit.date === today) return { ...hit, stale: false };
  try {
    const data = await fetcher();
    d.cache[key] = { date: today, fetchedAt: new Date().toISOString(), data };
    save();
    return { ...d.cache[key], stale: false };
  } catch (err) {
    if (hit) return { ...hit, stale: true, error: err.message };
    throw err;
  }
}

function clearCache() {
  load().cache = {};
  save();
}

module.exports = { load, save, id, kstDate, kstHour, cached, clearCache };
