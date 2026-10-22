// 내 블로그 글 제목에서 '틀'을 배워 새 주제의 제목 아이디어를 만듭니다.
// 제목 속 아이템 이름을 {kw}, 'N월'을 {month}월, 계절을 {season}으로 바꿔 틀을 만들고, 주제를 채워 넣습니다.
const { ITEM_WORDS, BRAND_WORDS } = require('./catalog');

const SEASONS = ['봄', '여름', '가을', '겨울'];
// 아이템 목록에 없는 넓은 이름도 제목 틀을 찾을 때는 씁니다.
const GENERIC = ['코트', '패딩', '자켓', '재킷', '바지', '신발'];

function seasonOf(month) {
  return ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울'][month - 1];
}

// 제목 하나를 틀로 바꿉니다. 아이템 이름이 없거나 특정 브랜드 제목이면 null.
function toTemplate(title, words) {
  const t = String(title || '').trim();
  if (!t || BRAND_WORDS.some((b) => t.includes(b))) return null;
  const kw = words.find((w) => t.includes(w)); // words 는 긴 단어부터 정렬되어 있음
  if (!kw) return null;
  let tpl = t.split(kw).join('{kw}');
  tpl = tpl.replace(/(^|[^\d])(1[0-2]|[1-9])월/g, '$1{month}월');
  tpl = tpl.replace(new RegExp(`(^|[^가-힣])(${SEASONS.join('|')})`, 'g'), '$1{season}');
  return tpl;
}

function hasBatchim(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return /[013678lmnr]$/i.test(word); // 영어·숫자는 대략적으로
  return (c - 0xac00) % 28 !== 0;
}

function rieul(word) {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 8;
}

// 틀에 주제를 채우고, 주제 바로 뒤 조사를 받침에 맞게 고칩니다.
function fill(tpl, kw, month) {
  const b = hasBatchim(kw);
  const josa = { 와: b ? '과' : '와', 과: b ? '과' : '와', 은: b ? '은' : '는', 는: b ? '은' : '는', 이: b ? '이' : '가', 가: b ? '이' : '가', 을: b ? '을' : '를', 를: b ? '을' : '를' };
  return tpl
    .replace(/\{kw\}(으로|로)(?![가-힣])/g, () => kw + (b && !rieul(kw) ? '으로' : '로'))
    .replace(/\{kw\}(와|과|은|는|이|가|을|를)(?![가-힣])/g, (m, j) => kw + josa[j])
    .split('{kw}').join(kw)
    .split('{month}').join(String(month))
    .split('{season}').join(seasonOf(month));
}

// posts: 최신 글부터. 반환: 내 제목 스타일로 만든 제목 (최대 n개, 중복 없이)
// offset 을 주면 틀 목록을 그만큼 돌려서 시작해, 주제마다 다른 틀이 먼저 나오게 합니다.
function personalTitles(kw, posts, { keywords = [], month, n = 3, offset = 0 } = {}) {
  const words = [...new Set([...keywords, ...ITEM_WORDS, ...GENERIC, ...posts.map((p) => p.keyword).filter(Boolean)])]
    .filter((w) => w.length >= 2)
    .sort((a, b) => b.length - a.length);
  const templates = [...new Set(posts.map((p) => toTemplate(p.title, words)).filter(Boolean))].slice(0, 30);
  if (!templates.length) return [];
  const start = offset % templates.length;
  const ordered = [...templates.slice(start), ...templates.slice(0, start)];
  return [...new Set(ordered.map((tpl) => fill(tpl, kw, month)))].slice(0, n);
}

module.exports = { toTemplate, fill, personalTitles, hasBatchim };
