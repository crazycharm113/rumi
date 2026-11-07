// 명품: 어떤 명품 브랜드가 요즘 많이 검색되는지 한눈에 보고, 브랜드를 열어 제품·기사·블로그·순위·누가 입었는지를 봅니다.
const luxState = { sort: 'rank', dir: 1, group: '', q: '' };

views.luxury = async (parts) => (parts[1] ? luxuryDetail(decodeURIComponent(parts[1])) : luxuryList());

// ---------- 목록 ----------
async function luxuryList() {
  loading('명품 브랜드를 살펴보는 중… (처음에는 30초 정도 걸려요)');
  const d = await api('/api/luxury');
  luxRender(d);
}

function luxRows(d) {
  const key = luxState.sort;
  let rows = d.rows.filter((r) => (!luxState.group || r.group === luxState.group) && (!luxState.q || r.name.includes(luxState.q)));
  rows = [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * luxState.dir;
  });
  return rows;
}

function luxRender(d) {
  const groups = [...new Set(d.rows.map((r) => r.group))];
  const rows = luxRows(d);
  const rising = [...d.rows].sort((a, b) => b.change - a.change).slice(0, 5).filter((r) => r.change > 0);
  const head = (k, label, cls = '') => `<th class="${cls}" aria-sort="${luxState.sort === k ? (luxState.dir > 0 ? 'ascending' : 'descending') : 'none'}">
    <button data-lsort="${k}">${label}${luxState.sort === k ? (luxState.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  $app.innerHTML = `
    <h1>명품</h1>
    <p class="lede">브랜드와 상관없이 요즘 많이 검색되는 명품 브랜드예요. 브랜드를 누르면 제품, 기사, 블로그, 쇼핑 클릭, 누가 입었는지를 볼 수 있어요.</p>
    ${d.demo ? dataBanner({ demo: true }, '명품 데이터') : ''}
    ${d.error ? `<div class="banner stale">명품 데이터를 가져오지 못했어요: ${esc(d.error)}</div>` : ''}
    ${rising.length ? `<section class="section card"><h2>이번 주 검색이 가장 많이 오른 브랜드</h2>
      <div class="row">${rising.map((r) => `<a class="chip celeb" href="#/luxury/${encodeURIComponent(r.name)}">${esc(r.name)} ${signed(r.change)}%</a>`).join('')}</div></section>` : ''}
    <section class="section card filters">
      <div class="row"><span class="small muted filter-label">분류</span>
        <button class="chip-btn ${!luxState.group ? 'on' : ''}" data-lgroup="">전체 ${d.rows.length}</button>
        ${groups.map((g) => `<button class="chip-btn ${luxState.group === g ? 'on' : ''}" data-lgroup="${esc(g)}">${esc(g)} ${d.rows.filter((r) => r.group === g).length}</button>`).join('')}
        <span class="spacer"></span><input id="luxQ" placeholder="브랜드 찾기" value="${esc(luxState.q)}" style="max-width:180px"></div>
    </section>
    <div class="table-wrap section"><table class="lux-table">
      <thead><tr>
        ${head('rank', '순위', 'num')}${head('name', '브랜드')}<th>최근 14일 검색</th>
        ${head('change', '7일 검색 변화', 'num')}${head('move', '어제 대비', 'num')}${head('level', '검색 수준', 'num')}
        ${head('shopChange', '쇼핑 클릭 변화', 'num')}${head('posts', '블로그 글', 'num')}${head('news7', '7일 기사', 'num')}
      </tr></thead>
      <tbody>${rows.map(luxRow).join('') || '<tr><td colspan="9" class="muted">조건에 맞는 브랜드가 없어요.</td></tr>'}</tbody>
    </table></div>
    <p class="small muted">검색 수준은 '코디' 검색량을 100으로 둔 상대값이에요. 네이버는 판매량을 공개하지 않아서, <b>쇼핑 클릭 변화</b>(네이버 쇼핑 패션잡화 클릭 추이)를 구매 관심의 대신 지표로 써요. 브랜드를 추가하려면 <a href="#/settings">설정</a>에서 넣으세요.</p>`;

  $app.querySelectorAll('[data-lsort]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.lsort;
    luxState.dir = luxState.sort === k ? -luxState.dir : (k === 'rank' || k === 'name' ? 1 : -1);
    luxState.sort = k;
    luxRender(d);
  }));
  $app.querySelectorAll('[data-lgroup]').forEach((b) => b.addEventListener('click', () => { luxState.group = b.dataset.lgroup; luxRender(d); }));
  document.getElementById('luxQ').addEventListener('input', debounce((e) => { luxState.q = e.target.value.trim(); luxRender(d); document.getElementById('luxQ').focus(); }, 300));
  $app.querySelectorAll('tr[data-brand]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/luxury/${encodeURIComponent(tr.dataset.brand)}`; }));
}

function luxMove(m) {
  if (m == null) return '<span class="muted">–</span>';
  if (m === 'new') return '<span class="move new">NEW</span>';
  if (m > 0) return `<span class="move up">▲${m}</span>`;
  if (m < 0) return `<span class="move down">▼${-m}</span>`;
  return '<span class="muted">–</span>';
}

function luxRow(r) {
  const pct = (v) => (v == null ? '<span class="muted">–</span>' : `<span class="pct ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${signed(v)}%</span>`);
  return `<tr class="look-row" data-brand="${esc(r.name)}">
    <td class="num"><b>${r.rank}</b></td>
    <td class="nowrap"><b>${esc(r.name)}</b> <span class="small muted">${esc(r.group)}</span></td>
    <td>${spark(r.spark)}</td>
    <td class="num">${pct(r.change)}</td>
    <td class="num">${luxMove(r.move)}</td>
    <td class="num">${r.level}</td>
    <td class="num">${pct(r.shopChange)}</td>
    <td class="num">${num(r.posts)}</td>
    <td class="num">${r.news7 == null ? '–' : r.news7 >= 30 ? '30+' : r.news7}</td>
  </tr>`;
}

// ---------- 상세 ----------
async function luxuryDetail(name) {
  loading(`${name} 정보를 모으는 중… (처음에는 몇십 초 걸려요)`);
  const d = await api(`/api/luxury/${encodeURIComponent(name)}`);
  const r = d.row;
  const fmtDate = (s) => (s && s.length === 8 ? `${s.slice(4, 6)}/${s.slice(6, 8)}` : '');
  const newsDate = (rfc) => { const t = new Date(rfc); return isNaN(t) ? '' : mmdd(kstDate(Math.round((t - Date.now()) / 864e5))); };
  const shop = (q) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}`;
  const a = d.audience;

  const stat = (label, value, sub = '') => `<div><div class="small muted">${label}</div><b>${value}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const pct = (v) => (v == null ? '–' : `<span class="pct ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${signed(v)}%</span>`);

  const products = d.ai?.products || [];
  const wearers = [...(d.ai?.wearers || []), ...d.wearersFromCeleb.map((w) => ({ ...w, fromCeleb: true }))];
  const seen = new Set();
  const uniqWearers = wearers.filter((w) => { const k = `${w.celeb}|${w.product}`; if (seen.has(k)) return false; seen.add(k); return true; });

  $app.innerHTML = `
    <p class="section"><a class="btn ghost sm" href="#/luxury">← 명품 목록</a></p>
    <h1>${esc(d.name)} <span class="small muted">${esc(d.group)}${d.aliases?.length ? ` · ${esc(d.aliases.join(', '))}` : ''}</span></h1>
    ${d.demo ? dataBanner({ demo: true }, '명품 데이터') : ''}
    ${r ? `<section class="section card"><div class="stats">
      ${stat('검색 순위', `${r.rank}위`, `${d.total}개 브랜드 중${r.move == null ? '' : r.move === 'new' ? ' · 새로 진입' : r.move > 0 ? ` · 어제보다 ▲${r.move}` : r.move < 0 ? ` · 어제보다 ▼${-r.move}` : ' · 어제와 같음'}`)}
      ${stat('7일 검색 변화', pct(r.change), `검색 수준 ${r.level}`)}
      ${stat('쇼핑 클릭 변화', pct(r.shopChange), '판매량 대신 지표')}
      ${stat('블로그 글', num(d.blogTotal ?? r.posts), `7일 기사 ${r.news7 == null ? '–' : r.news7 >= 30 ? '30+' : r.news7}건`)}
      ${stat('누가 찾나', a ? esc(a.label) : '–', a ? `여성 ${a.female}% · ${a.topAge ? `${esc(a.topAge.label)} ${a.topAge.share}%` : ''}` : '')}
    </div></section>` : ''}

    <section class="section card">
      <div class="section-head"><h2>인기 제품</h2>
        ${d.ai ? '<span class="small muted">블로그·기사에서 Claude가 정리</span>' : ''}</div>
      ${products.length ? `<div class="table-wrap" style="border:0"><table>
        <thead><tr><th>제품</th><th>종류</th><th class="num">언급</th><th>가격(글에 나온 값)</th><th></th></tr></thead>
        <tbody>${products.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.item)}</td><td class="num">${p.mentions}</td><td>${esc(p.price) || '<span class="muted">–</span>'}</td>
          <td class="nowrap"><a class="btn ghost sm" href="${esc(shop(`${d.name} ${p.name}`))}" target="_blank" rel="noopener noreferrer">쇼핑↗</a>
            ${p.source?.link && p.source.link !== '#' ? `<a class="btn ghost sm" href="${esc(p.source.link)}" target="_blank" rel="noopener noreferrer" title="${esc(p.source.title)}">근거 글↗</a>` : ''}
            <button class="btn ghost sm" data-add='${esc(JSON.stringify({ name: `${d.name} ${p.name}`, brand: d.name, memo: '명품 메뉴에서 담음' }))}'>담기</button></td></tr>`).join('')}</tbody></table></div>`
      : d.aiEnabled ? `<p class="muted small">${d.aiError ? `제품을 정리하지 못했어요: ${esc(d.aiError)}` : '정리된 제품이 없어요.'}</p>`
        : `<p class="muted small">제품 정리에는 Claude가 필요해요. <a href="#/settings">설정</a>에 Anthropic API 키를 넣으면 이 브랜드의 인기 제품이 나와요. 지금은 <a href="${esc(shop(d.name))}" target="_blank" rel="noopener noreferrer">네이버 쇼핑에서 ${esc(d.name)} 보기↗</a>를 쓰세요.</p>`}
    </section>

    <section class="section card">
      <h2>누가 입었나</h2>
      ${uniqWearers.length ? `<ul class="plain">${uniqWearers.slice(0, 15).map((w) => `<li class="row"><b>${esc(w.celeb)}</b>
        <span class="spacer">${esc(w.product || '')}${w.fromCeleb ? ' <span class="chip celeb">셀럽 착장</span>' : ''}</span>
        <a class="small" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer" title="${esc(w.title)}">기사&nbsp;↗</a></li>`).join('')}</ul>`
        : '<p class="muted small">최근 기사·블로그에서 찾은 착용자가 없어요. (제품 정리를 켜면 기사에서 착용자를 찾아요)</p>'}
    </section>

    <div class="grid grid-2 section">
      <section class="card"><div class="section-head"><h2>최근 기사</h2><span class="small muted">총 ${num(d.newsTotal)}건</span></div>
        ${d.news?.length ? `<ul class="plain">${d.news.slice(0, 8).map((n) => `<li class="row"><a class="spacer" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}&nbsp;↗</a><span class="small muted">${esc(newsDate(n.pubDate))}</span></li>`).join('')}</ul>` : '<p class="muted small">기사가 없어요.</p>'}</section>
      <section class="card"><div class="section-head"><h2>인기 블로그 글</h2><span class="small muted">'${esc(d.name)} 인기템' 검색 상위</span></div>
        ${d.blogs?.length ? `<ol class="blog-list">${d.blogs.slice(0, 8).map((b) => `<li><a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}&nbsp;↗</a>
          <span class="small muted">${esc(b.blogger)}${b.postdate ? ` · ${esc(fmtDate(b.postdate))}` : ''}</span></li>`).join('')}</ol>` : '<p class="muted small">글이 없어요.</p>'}</section>
    </div>
    <p class="small muted">쇼핑 클릭은 네이버 쇼핑 패션잡화 분야 기준 추이예요(실제 판매량이 아니에요). 기사·블로그 내용은 제목·요약만 쓰고, 글을 쓸 때는 출처를 밝히고 직접 쓴 문장과 직접 찍은 사진을 써 주세요.</p>
    <p><button class="btn ghost sm" id="luxRefresh">새로 가져오기</button></p>`;

  $app.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addToBoard(JSON.parse(b.dataset.add), d.name)));
  document.getElementById('luxRefresh').addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '가져오는 중…';
    try { await api(`/api/luxury/${encodeURIComponent(name)}?refresh=1`); } catch (err) { toast(err.message); }
    luxuryDetail(name);
  });
}
