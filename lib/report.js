// 주간 리포트: 월~일 한 주 동안 발행한 글, 늘어난 조회수, 잘된 주제, 검색 노출, 다음 주 계획.
const store = require('./store');

function addDays(d, n) {
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}

// d 가 속한 주의 월요일
function mondayOf(d) {
  const dow = new Date(d + 'T00:00:00Z').getUTCDay(); // 0=일
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

// 조회수는 누적값이라, 그 주 안의 마지막 기록 - 그 주 전의 마지막 기록(없으면 0)을 그 주에 늘어난 조회수로 봅니다.
function weekViews(views, from, to) {
  const inWeek = views.filter((v) => v.date >= from && v.date <= to);
  if (!inWeek.length) return null;
  const before = views.filter((v) => v.date < from).pop();
  return Math.max(0, inWeek[inWeek.length - 1].views - (before ? before.views : 0));
}

function weekly(db, weekStart, { peaks = {} } = {}) {
  const from = weekStart;
  const to = addDays(from, 6);
  const published = db.posts.filter((p) => p.pubDate >= from && p.pubDate <= to);

  const viewRows = db.posts
    .map((p) => ({ title: p.title, link: p.link, keyword: p.keyword || '', gained: weekViews(p.views || [], from, to) }))
    .filter((x) => x.gained != null);
  const totalViews = viewRows.reduce((a, x) => a + x.gained, 0);
  const topPosts = [...viewRows].sort((a, b) => b.gained - a.gained).slice(0, 3);

  const byKeyword = {};
  for (const x of viewRows) if (x.keyword) byKeyword[x.keyword] = (byKeyword[x.keyword] || 0) + x.gained;
  const topKeywords = Object.entries(byKeyword).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([keyword, views]) => ({ keyword, views }));

  // 그 주에 확인한 검색 순위 중 가장 좋은 것
  const ranks = db.posts.map((p) => {
    const r = (p.ranks || []).filter((x) => x.date >= from && x.date <= to && x.rank != null).sort((a, b) => a.rank - b.rank)[0];
    return r ? { title: p.title, keyword: r.keyword, rank: r.rank } : null;
  }).filter(Boolean).sort((a, b) => a.rank - b.rank).slice(0, 5);

  const missing = published.filter((p) => p.index?.status === 'missing').map((p) => ({ title: p.title, link: p.link }));
  const viewsMissing = published.filter((p) => !(p.views || []).length).length;

  const nextFrom = addDays(to, 1);
  const nextTo = addDays(nextFrom, 6);
  const plans = db.boards.filter((b) => b.plannedDate >= nextFrom && b.plannedDate <= nextTo)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))
    .map((b) => ({ id: b.id, title: b.title, date: b.plannedDate, status: b.postStatus || '구상' }));
  const prepare = Object.entries(peaks).filter(([, p]) => p.prepare <= nextTo && p.peak >= nextFrom)
    .map(([word, p]) => ({ word, prepare: p.prepare, peak: p.peak }));

  return {
    from, to,
    published: published.map((p) => ({ title: p.title, link: p.link, date: p.pubDate, keyword: p.keyword || '' })),
    totalViews, topPosts, topKeywords, ranks, missing, viewsMissing, plans, prepare,
    next: { from: nextFrom, to: nextTo },
  };
}

module.exports = { weekly, mondayOf, weekViews, addDays };
