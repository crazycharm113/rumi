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
      naverKeyType: process.env.NAVER_KEY_TYPE === 'legacy' ? 'legacy' : 'hub',
      kmaServiceKey: process.env.KMA_SERVICE_KEY || '',
      region: '서울',
      age: 'all',
      keywords: DEFAULT_KEYWORDS.map((k) => k.word),
      brands: [],
      blogId: '',
    },
    boards: [],
    events: [],
    alerts: [],
    posts: [],
    jobs: {},
    cache: {},
    history: { weather: {}, ranks: {}, brandItems: {} },
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
  } catch (err) {
    // 파일이 깨졌으면 그대로 덮어쓰지 않도록 옆에 따로 보관하고 빈 상태로 시작합니다(백업에서 복원 가능).
    if (err.code !== 'ENOENT') {
      try { fs.renameSync(DB_FILE, path.join(DATA_DIR, `db.broken-${Date.now()}.json`)); } catch { /* 무시 */ }
    }
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

// ---- 백업 ----
// 하루 한 번 data/backup/db-YYYY-MM-DD.json 으로 복사하고 최근 7개만 남깁니다.
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const KEEP_BACKUPS = 7;

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
      .map((name) => ({ name, date: name.slice(3, 13), size: fs.statSync(path.join(BACKUP_DIR, name)).size }));
  } catch {
    return [];
  }
}

function backupToday({ force = false } = {}) {
  if (!fs.existsSync(DB_FILE)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `db-${kstDate()}.json`;
  const dest = path.join(BACKUP_DIR, name);
  if (!force && fs.existsSync(dest)) return name;
  fs.copyFileSync(DB_FILE, dest);
  for (const b of listBackups().slice(KEEP_BACKUPS)) fs.unlinkSync(path.join(BACKUP_DIR, b.name));
  return name;
}

// 가져오기·복원: 지금 데이터를 먼저 백업한 뒤 통째로 바꿉니다.
function replaceAll(data) {
  if (!data || typeof data !== 'object' || !data.settings || !Array.isArray(data.boards)) {
    throw Object.assign(new Error('블로그 작업대 백업 파일이 아니에요.'), { status: 400 });
  }
  save();
  backupToday({ force: true });
  db = null;
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  return load();
}

function restoreBackup(name) {
  if (!/^db-\d{4}-\d{2}-\d{2}\.json$/.test(name)) throw Object.assign(new Error('잘못된 백업 이름이에요.'), { status: 400 });
  return replaceAll(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8')));
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
  // 브랜드 할인·신상 결과는 하루 한 번 스케줄러가 채우므로 남겨 둡니다.
  const { brandFeed } = load().cache;
  load().cache = brandFeed ? { brandFeed } : {};
  save();
}

module.exports = { listBackups, backupToday, replaceAll, restoreBackup, load, save, id, kstDate, kstHour, cached, clearCache };
