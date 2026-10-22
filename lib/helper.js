// 3단계: 포스팅 도우미. 글을 대신 쓰지 않고, 반복 입력(상품 정보 표·제목·태그)과 발행 전 점검만 줄입니다.
const store = require('./store');
const { personalTitles } = require('./titles');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = (n) => (n ? n.toLocaleString('ko-KR') + '원' : '');
const dotDate = (d) => (d || store.kstDate()).replace(/-/g, '.');

// 네이버 블로그 에디터에 붙여넣을 수 있는 표 (HTML + 일반 텍스트)
function productTable(products) {
  const rows = products.map((p) => ({
    brand: p.brand || '',
    name: p.name || '',
    price: won(p.price),
    size: p.size || '',
    url: p.url || '',
    note: p.type === '협찬' ? '협찬' : p.type === '제휴 링크' ? '제휴' : '',
  }));
  const priceDates = products.map((p) => p.priceCheckedAt).filter(Boolean).sort();
  const priceDate = priceDates[priceDates.length - 1] || store.kstDate();
  const th = 'style="border:1px solid #ddd;padding:6px 10px;background:#f5f5f5"';
  const td = 'style="border:1px solid #ddd;padding:6px 10px"';
  const html = `<table style="border-collapse:collapse">
<tr><th ${th}>브랜드</th><th ${th}>상품명</th><th ${th}>가격</th><th ${th}>사이즈</th><th ${th}>구매 링크</th></tr>
${rows.map((r) => `<tr><td ${td}>${esc(r.brand)}</td><td ${td}>${esc(r.name)}${r.note ? ` (${r.note})` : ''}</td><td ${td}>${esc(r.price)}</td><td ${td}>${esc(r.size)}</td><td ${td}>${r.url ? `<a href="${esc(r.url)}">바로가기</a>` : ''}</td></tr>`).join('\n')}
</table>
<p style="font-size:12px;color:#888">* 가격은 ${dotDate(priceDate)} 기준이며 변동될 수 있어요.</p>`;
  const text = [
    '브랜드 | 상품명 | 가격 | 사이즈 | 구매 링크',
    ...rows.map((r) => [r.brand, r.name + (r.note ? ` (${r.note})` : ''), r.price, r.size, r.url].join(' | ')),
    `* 가격은 ${dotDate(priceDate)} 기준이며 변동될 수 있어요.`,
  ].join('\n');
  return { html, text, priceDate };
}

function priceBand(products) {
  const prices = products.map((p) => p.price).filter(Boolean);
  if (!prices.length) return '';
  const max = Math.max(...prices);
  if (max < 30000) return '3만원 이하';
  if (max < 100000) return `${Math.ceil(max / 10000)}만원 이하`;
  return `${Math.floor(max / 100000) * 10}만원대`;
}

function seasonWord(month) {
  return ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울'][month - 1];
}

// 제목 후보: 키워드·월·시즌·상품 수·가격대·브랜드를 조합합니다.
function titleIdeas(board, now = new Date(), posts = []) {
  const kw = board.keyword || board.title;
  const month = Number(store.kstDate(0, now).slice(5, 7));
  const season = seasonWord(month);
  const ps = board.products;
  const n = ps.length;
  const brands = [...new Set(ps.map((p) => p.brand).filter(Boolean))];
  const band = priceBand(ps);
  const ideas = [
    `${month}월 ${kw} 코디 추천${n > 1 ? ` ${n}가지` : ''}`,
    `${season} ${kw} 데일리룩, 이렇게 입었어요`,
    n > 1 ? `${kw} ${n}종 비교 후기 (사이즈·착용감)` : `${kw} 솔직 후기 (사이즈·착용감)`,
    band && `${band} ${kw} 추천`,
    brands.length === 1 && `${brands[0]} ${kw} 착용 후기`,
    brands.length > 1 && `${brands.slice(0, 2).join(' vs ')} ${kw} 비교`,
    `출근룩으로 좋은 ${kw} 코디`,
  ];
  // 내 블로그 제목 스타일을 따른 제목을 먼저 보여줍니다.
  const mine = posts.length && board.keyword ? personalTitles(board.keyword, posts, { month, n: 3 }) : [];
  return [...new Set([...mine, ...ideas.filter(Boolean)])];
}

function tagIdeas(board, now = new Date()) {
  const kw = (board.keyword || '').replace(/\s/g, '');
  const month = Number(store.kstDate(0, now).slice(5, 7));
  const season = seasonWord(month);
  const brands = board.products.map((p) => (p.brand || '').replace(/\s/g, '')).filter(Boolean);
  const tags = [
    kw, kw && `${kw}코디`, kw && `${kw}추천`, kw && `${season}${kw}`,
    `${month}월코디`, `${season}코디`, `${season}데일리룩`, '데일리룩', '오오티디', '패션블로거',
    ...brands, ...brands.map((b) => kw && `${b}${kw}`),
  ];
  return [...new Set(tags.filter(Boolean))].slice(0, 20);
}

// 발행 전 체크리스트. auto 항목은 보드 내용으로 자동 판단하고, 나머지는 사용자가 체크합니다.
function checklist(board) {
  const ps = board.products;
  const sponsored = ps.filter((p) => p.type === '협찬');
  const affiliate = ps.filter((p) => p.type === '제휴 링크');
  const soldOut = ps.filter((p) => p.soldOut);
  const noPrice = ps.filter((p) => !p.price);
  const c = board.checklist || {};
  const priceDate = productTable(ps).priceDate;
  const items = [];
  if (affiliate.length) {
    items.push({ key: 'affiliateLinks', label: `제휴 링크 ${affiliate.length}개를 글에 넣었나요?`, detail: affiliate.map((p) => p.name).join(', '), checked: Boolean(c.affiliateLinks) });
  }
  if (sponsored.length || affiliate.length) {
    const lines = [];
    if (sponsored.length) lines.push(`이 글은 ${[...new Set(sponsored.map((p) => p.brand || '브랜드'))].join(', ')}로부터 제품을 제공받아 작성했어요.`);
    if (affiliate.length) lines.push('이 글에는 제휴 링크가 포함되어 있어, 구매가 이뤄지면 일정 수수료를 받을 수 있어요.');
    items.push({
      key: 'disclosure', label: '광고 표시 문구를 제목이나 글 첫 부분에 잘 보이게 넣었나요?',
      template: lines.join('\n'), checked: Boolean(c.disclosure), important: true,
    });
  }
  items.push({ key: 'priceDate', label: '가격 기준일을 적었나요?', template: `* 가격은 ${dotDate(priceDate)} 기준이며 변동될 수 있어요.`, checked: Boolean(c.priceDate) });
  items.push({ key: 'images', label: '글에 쓴 사진은 직접 찍었거나 사용이 허용된 것인가요?', checked: Boolean(c.images) });
  const warnings = [];
  if (soldOut.length) warnings.push(`품절 상품이 있어요: ${soldOut.map((p) => p.name).join(', ')}`);
  if (noPrice.length) warnings.push(`가격이 비어 있는 상품이 ${noPrice.length}개 있어요.`);
  if (board.sponsorDeadline && board.sponsorDeadline < store.kstDate() && board.postStatus !== '발행') warnings.push(`협찬 마감일(${board.sponsorDeadline})이 지났어요.`);
  return { items, warnings, done: items.every((i) => i.checked) };
}

module.exports = { productTable, titleIdeas, tagIdeas, checklist };
