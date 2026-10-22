// 프로그램이 켜져 있는 동안 정해진 주기로 할 일을 합니다. 꺼져 있던 동안 밀린 일은 켤 때 한 번 합니다.
const store = require('./store');
const { checkSavedProducts } = require('./alerts');
const { refreshBrandFeed } = require('./brandnews');
const perf = require('./performance');
const { hasNaver } = require('./service');

const HOUR = 3600e3;
const JOBS = [
  { key: 'backup', every: 24 * HOUR, ready: () => true, run: () => store.backupToday() },
  { key: 'indexCheck', every: 6 * HOUR, ready: (s, db) => hasNaver(s) && Boolean(s.blogId) && db.posts.some((p) => p.pubDate >= store.kstDate(-10)), run: () => perf.checkIndexing() },
  { key: 'priceCheck', every: 12 * HOUR, ready: (s, db) => db.boards.some((b) => b.products.some((p) => p.url)), run: () => checkSavedProducts() },
  { key: 'brandFeed', every: 24 * HOUR, ready: (s) => hasNaver(s) && s.brands.length > 0, run: () => refreshBrandFeed() },
  { key: 'rss', every: 24 * HOUR, ready: (s) => Boolean(s.blogId), run: () => perf.syncPosts() },
  { key: 'ranks', every: 24 * HOUR, ready: (s, db) => hasNaver(s) && Boolean(s.blogId) && db.posts.length > 0, run: () => perf.checkRecentRanks() },
];

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const db = store.load();
    for (const job of JOBS) {
      const last = db.jobs[job.key] ? new Date(db.jobs[job.key]).getTime() : 0;
      if (Date.now() - last < job.every || !job.ready(db.settings, db)) continue;
      try {
        await job.run();
        db.jobs[job.key] = new Date().toISOString();
        db.jobs[job.key + 'Error'] = '';
      } catch (err) {
        db.jobs[job.key + 'Error'] = err.message;
        // 실패하면 1시간 뒤 다시 시도하도록 시각만 당겨 둡니다.
        db.jobs[job.key] = new Date(Date.now() - job.every + HOUR).toISOString();
      }
      store.save();
    }
  } finally {
    busy = false;
  }
}

function start() {
  setTimeout(tick, 5000);
  setInterval(tick, 30 * 60e3).unref();
}

module.exports = { start, tick, JOBS };
