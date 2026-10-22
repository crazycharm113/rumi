// 3단계: 성과 기록. 글 목록은 내 블로그 RSS로 자동으로 가져오고, 검색 노출 순위는 네이버 블로그 검색 API로 확인합니다.
// 조회수는 네이버가 외부에 공식 제공하지 않아 직접 입력합니다. 블로그 비밀번호는 받지 않습니다.
const store = require('./store');
const naver = require('./naver');

function normalizeBlogId(input) {
  const s = String(input || '').trim();
  const m = s.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]+)$/);
  return m ? m[1] : '';
}

function cdata(block, tag) {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : '';
}

function parseRss(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((b) => {
    const link = (cdata(b, 'guid') || cdata(b, 'link')).replace(/\?.*$/, '');
    const logNo = (link.match(/(\d{9,})/) || [])[1] || link;
    const pub = new Date(cdata(b, 'pubDate'));
    return {
      logNo,
      link,
      title: naver.strip(cdata(b, 'title')),
      category: naver.strip(cdata(b, 'category')),
      tags: cdata(b, 'tag').split(',').map((t) => t.trim()).filter(Boolean),
      pubDate: isNaN(pub) ? '' : store.kstDate(0, pub),
    };
  });
}

async function fetchRss(blogId) {
  const res = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`블로그 RSS를 가져오지 못했습니다(${res.status}). 블로그 아이디를 확인하세요.`);
  return parseRss(await res.text());
}

// RSS 글을 기존 기록과 합칩니다. 조회수·순위·연결한 보드는 그대로 둡니다.
function merge(posts, fresh, boards) {
  const byNo = new Map(posts.map((p) => [p.logNo, p]));
  for (const f of fresh) {
    const cur = byNo.get(f.logNo);
    if (cur) Object.assign(cur, { title: f.title, link: f.link, category: f.category, tags: f.tags, pubDate: f.pubDate || cur.pubDate });
    else {
      const board = boards.find((b) => (b.publishedUrl && b.publishedUrl.includes(f.logNo)) || b.title.trim() === f.title.trim());
      const p = { ...f, boardId: board?.id || '', keyword: board?.keyword || '', views: [], ranks: [] };
      posts.push(p);
      byNo.set(f.logNo, p);
    }
  }
  return posts.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
}

async function syncPosts() {
  const db = store.load();
  const blogId = db.settings.blogId;
  if (!blogId) throw new Error('설정에서 블로그 아이디를 먼저 넣어 주세요.');
  db.posts = merge(db.posts, await fetchRss(blogId), db.boards);
  db.jobs.rss = new Date().toISOString();
  store.save();
  return db.posts;
}

// 검색 결과 상위 100개 안에서 내 글의 순위(1~100), 없으면 null
function findRank(results, blogId, logNo) {
  const i = results.findIndex((r) => r.link.includes(`/${blogId}/${logNo}`) || (r.link.includes(blogId) && r.link.includes(logNo)));
  return i === -1 ? null : i + 1;
}

async function checkRank(post) {
  const db = store.load();
  if (!post.keyword) throw new Error('순위를 볼 검색 키워드를 먼저 정해 주세요.');
  const results = await naver.searchBlog(db.settings, post.keyword);
  const rank = findRank(results, db.settings.blogId, post.logNo);
  const today = store.kstDate();
  post.ranks = (post.ranks || []).filter((r) => r.date !== today);
  post.ranks.push({ date: today, rank, keyword: post.keyword });
  post.ranks = post.ranks.slice(-60);
  store.save();
  return rank;
}

// 최근 60일 안에 쓴 글 중 키워드가 있는 글의 순위를 하루 한 번 확인합니다(하루 최대 30개).
async function checkRecentRanks() {
  const db = store.load();
  const today = store.kstDate();
  const targets = db.posts.filter((p) => p.keyword && p.pubDate >= store.kstDate(-60) && !(p.ranks || []).some((r) => r.date === today)).slice(0, 30);
  for (const p of targets) {
    try { await checkRank(p); } catch { /* 한 글이 실패해도 나머지는 계속 */ }
  }
  return targets.length;
}

const latest = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

// 어떤 주제가 잘 되는지: 키워드별 글 수, 최근 조회수 평균, 최고 순위
function topicSummary(posts) {
  const groups = {};
  for (const p of posts) {
    const k = p.keyword || '(키워드 없음)';
    const g = (groups[k] ||= { keyword: k, posts: 0, viewsSum: 0, viewsCount: 0, bestRank: null });
    g.posts++;
    const v = latest(p.views);
    if (v) { g.viewsSum += v.views; g.viewsCount++; }
    const r = latest(p.ranks);
    if (r && r.rank != null && (g.bestRank == null || r.rank < g.bestRank)) g.bestRank = r.rank;
  }
  return Object.values(groups)
    .map((g) => ({ keyword: g.keyword, posts: g.posts, avgViews: g.viewsCount ? Math.round(g.viewsSum / g.viewsCount) : null, bestRank: g.bestRank }))
    .sort((a, b) => (b.avgViews ?? -1) - (a.avgViews ?? -1));
}

module.exports = { normalizeBlogId, parseRss, fetchRss, merge, syncPosts, findRank, checkRank, checkRecentRanks, topicSummary };
