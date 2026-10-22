// 블로그 작업대 화면. 프레임워크 없이 해시 주소(#/...)로 화면을 바꿉니다.
const $app = document.getElementById('app');

// ---- 도우미 ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n == null ? '' : n.toLocaleString('ko-KR') + '원');
const num = (n) => (n == null ? '–' : n.toLocaleString('ko-KR'));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const timeText = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function spark(values, w = 84, h = 22) {
  if (!values?.length) return '';
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / 100) * (h - 4)).toFixed(1)}`).join(' ');
  const split = 6 * step;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <rect x="${split}" y="0" width="${w - split}" height="${h}" fill="var(--accent-soft)" rx="3"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function dataBanner(meta, what) {
  if (meta.demo) {
    return `<div class="banner demo">지금 보이는 ${what}는 <b>예시 데이터</b>입니다. <a href="#/settings">설정</a>에서 API 키를 넣으면 실제 데이터로 바뀝니다.</div>`;
  }
  if (meta.stale) {
    return `<div class="banner stale">새 데이터를 가져오지 못해 마지막 데이터(${esc(timeText(meta.fetchedAt))})를 보여줍니다. ${esc(meta.error || '')}</div>`;
  }
  return '';
}

function loading(text = '불러오는 중…') {
  $app.innerHTML = `<div class="skeleton">${esc(text)}</div>`;
}

function errorView(err) {
  $app.innerHTML = `<h1>문제가 생겼어요</h1><div class="card"><p>${esc(err.message)}</p>
    <p class="muted small">API 키가 맞는지 <a href="#/settings">설정</a>에서 확인해 주세요.</p>
    <button class="btn" onclick="route()">다시 시도</button></div>`;
}

async function makeBoard(keyword, title) {
  const board = await api('/api/boards', { method: 'POST', body: { keyword, title } });
  toast('상품 보드를 만들었어요');
  location.hash = `#/boards/${board.id}`;
}

async function setAge(age) {
  await api('/api/settings', { method: 'PUT', body: { age } });
  route();
}

function ageSelect(current, ages) {
  return `<label class="row small muted">연령대
    <select style="width:auto" onchange="setAge(this.value)" aria-label="연령대 필터">
      ${ages.map((a) => `<option value="${a.value}" ${a.value === current ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
    </select></label>`;
}

// ---- 오늘의 브리핑 ----
async function viewHome() {
  loading('오늘의 브리핑을 준비하는 중…');
  const [b, settings, boards] = await Promise.all([api('/api/briefing'), api('/api/settings'), api('/api/boards')]);
  const w = b.weather;
  const today = new Date();
  const dateText = today.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = boards.filter((x) => x.plannedDate && x.plannedDate >= b.date && x.plannedDate <= weekEnd)
    .sort((x, y) => x.plannedDate.localeCompare(y.plannedDate));

  $app.innerHTML = `
    <h1>${esc(dateText)}</h1>
    <p class="lede">오늘 올릴 만한 주제 3개와 그 이유입니다.</p>
    ${dataBanner(b.keywordsMeta, '키워드 데이터')}

    <section class="section card">${weatherBar(w)}</section>

    <section class="section">
      <div class="section-head"><h2>오늘 올릴 주제 3개</h2>
        <span class="small muted">${esc(b.ageLabel)} 기준 · 기회 점수는 참고용</span></div>
      <div class="grid grid-3">
        ${b.topics.length ? b.topics.map(topicCard).join('') : `<div class="card empty">추천할 주제가 없습니다. <a href="#/settings">키워드</a>를 더 추가해 보세요.</div>`}
      </div>
    </section>

    <div class="grid grid-2 section">
      <section class="card">
        <div class="section-head"><h2>급상승 키워드</h2>${ageSelect(b.age, settings.ages)}</div>
        <ol class="rank">${b.rising.map(risingRow).join('')}</ol>
        <div class="row" style="margin-top:10px"><a class="btn sm" href="#/keywords">키워드 기회 분석 전체 보기 →</a></div>
      </section>
      <section class="card">
        <div class="section-head"><h2>이번 주 발행 예정</h2><a class="btn sm" href="#/boards">상품 보드</a></div>
        ${upcoming.length ? `<ol class="rank">${upcoming.map((x) => `<li style="grid-template-columns:64px 1fr auto">
            <span class="small muted">${esc(x.plannedDate.slice(5).replace('-', '/'))}</span>
            <a class="w" href="#/boards/${x.id}">${esc(x.title)}</a>
            <span class="small muted">상품 ${x.products.length}개</span></li>`).join('')}</ol>`
          : `<p class="muted small">상품 보드에서 발행 예정일을 정하면 여기에 보여요.</p>`}
        <div class="card stage-note" style="margin-top:14px">관심 브랜드의 할인·신상, 저장한 상품의 가격·품절 알림, 콘텐츠 캘린더는 <b>2단계</b>에서 붙입니다.</div>
      </section>
    </div>
    <p class="small muted section">키워드 갱신: ${esc(timeText(b.keywordsMeta.fetchedAt) || '예시')} ·
      <button class="btn ghost sm" onclick="refreshAll()">지금 새로 가져오기</button></p>
  `;
}

function weatherBar(w) {
  if (!w || w.error) return `<div class="weather"><span class="muted">날씨를 가져오지 못했습니다. ${esc(w?.error || '')}</span></div>`;
  const t = w.today;
  const diffY = w.diffYesterday == null ? '' : `어제보다 ${w.diffYesterday === 0 ? '비슷' : `${Math.abs(w.diffYesterday)}°C ${w.diffYesterday > 0 ? '높음' : '낮음'}`}`;
  const diffT = w.diffTomorrow == null ? '' : `내일 ${w.diffTomorrow === 0 ? '비슷' : `${Math.abs(w.diffTomorrow)}°C ${w.diffTomorrow > 0 ? '오름' : '내려감'}`}`;
  return `<div class="weather">
    <div><div class="small muted">${esc(w.region)} 오늘${w.demo ? ' · 예시' : ''}</div><div class="temp">${t.tmn}° / ${t.tmx}°</div></div>
    <div class="meta">
      <span>${esc(t.sky || '')}${t.pop ? ` · 강수확률 ${t.pop}%` : ''}</span>
      <span class="small muted">${[diffY, diffT].filter(Boolean).join(' · ')}</span>
    </div>
    <div class="meta">
      <span class="small muted">평균 ${t.avg}°C · ${esc(w.clothing.label)}</span>
      <div class="wear">${w.clothing.items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>
    </div>
    ${w.drop ? `<div class="alert">📉 ${esc(w.drop.date.slice(5).replace('-', '/'))} 평균 기온이 ${Math.abs(w.drop.diff)}°C 떨어집니다. ${esc(w.drop.clothing.items.slice(0, 3).join(', '))} 글을 미리 준비해 두세요.</div>` : ''}
    ${w.stale ? `<div class="alert">마지막 날씨(${esc(timeText(w.fetchedAt))})를 보여줍니다.</div>` : ''}
  </div>`;
}

function topicCard(t, i) {
  return `<article class="card topic">
    <div class="num">주제 ${i + 1}</div>
    <h3>${esc(t.word)}</h3>
    <div class="reasons">${t.reasons.map((r) => `<span class="chip ${r.kind}">${esc(r.text)}</span>`).join('')}</div>
    <div><div class="small muted">제목 아이디어</div>
      <ul class="titles">${t.titleIdeas.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="foot">
      <span class="small muted">기회 점수 <span class="score">${t.score}</span></span>
      <button class="btn primary sm" data-word="${esc(t.word)}" data-title="${esc(t.titleIdeas[0])}" onclick="makeBoard(this.dataset.word, this.dataset.title)">상품 보드 만들기</button>
    </div>
  </article>`;
}

function risingRow(r) {
  let move = '<span class="move muted">–</span>';
  if (r.move === 'new') move = '<span class="move new">NEW</span>';
  else if (r.move > 0) move = `<span class="move up">▲${r.move}</span>`;
  else if (r.move < 0) move = `<span class="move down">▼${-r.move}</span>`;
  return `<li><span class="n">${r.rank}</span>
    <a class="w" href="#/keywords?focus=${encodeURIComponent(r.word)}">${esc(r.word)}</a>
    <span class="pct ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${signed(r.change)}%</span>${move}</li>`;
}

async function refreshAll() {
  loading('새 데이터를 가져오는 중… (키워드가 많으면 몇십 초 걸릴 수 있어요)');
  try {
    await api('/api/refresh', { method: 'POST' });
  } catch (e) { toast(e.message); }
  route();
}

// ---- 키워드 기회 분석 ----
let kwState = { tab: 'score', sort: 'score', dir: -1 };

async function viewKeywords(params) {
  loading('키워드를 분석하는 중…');
  const [data, settings] = await Promise.all([api('/api/keywords'), api('/api/settings')]);
  const focus = params.get('focus');

  const render = async () => {
    let body = '';
    if (kwState.tab === 'score') body = scoreTable(data.rows, focus);
    else body = await bloggerItems();
    $app.innerHTML = `
      <h1>키워드 기회 분석</h1>
      <p class="lede">검색 관심은 오르는데 블로그 글은 적은 키워드일수록 위에 옵니다.</p>
      ${dataBanner(data, '키워드 데이터')}
      <div class="section-head section">
        <div class="subtabs" role="tablist">
          <button role="tab" class="${kwState.tab === 'score' ? 'on' : ''}" data-t="score">기회 점수</button>
          <button role="tab" class="${kwState.tab === 'items' ? 'on' : ''}" data-t="items">요즘 많이 올라오는 아이템</button>
        </div>
        ${kwState.tab === 'score' ? ageSelect(data.age, settings.ages) : ''}
      </div>
      ${body}`;
    $app.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { kwState.tab = b.dataset.t; render(); }));
    $app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      kwState.dir = kwState.sort === k ? -kwState.dir : (k === 'word' || k === 'posts' ? 1 : -1);
      kwState.sort = k;
      render();
    }));
    if (focus) document.getElementById(`kw-${CSS.escape(focus)}`)?.scrollIntoView({ block: 'center' });
  };
  await render();
}

function scoreTable(rows, focus) {
  const k = kwState.sort;
  const sorted = [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * kwState.dir;
  });
  const maxScore = Math.max(...rows.map((r) => r.score || 0), 1);
  const head = (key, label, cls = '') => `<th class="${cls}" aria-sort="${kwState.sort === key ? (kwState.dir > 0 ? 'ascending' : 'descending') : 'none'}">
    <button data-sort="${key}">${label}${kwState.sort === key ? (kwState.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  return `
    <details class="explain"><summary>기회 점수는 이렇게 계산해요 (참고용)</summary>
      <p><b>기회 점수 = 관심도 변화 지수 ÷ log<sub>10</sub>(블로그 글 수 + 10)</b></p>
      <ul>
        <li><b>관심도 변화 지수</b>: 네이버 데이터랩 검색어트렌드에서 최근 7일 평균 ÷ 그 전 7일 평균 × 100 (100이면 변화 없음).</li>
        <li><b>블로그 글 수</b>: 네이버 블로그 검색 결과 총 건수(근사치). 글이 10배 많으면 점수가 한 단계 내려가도록 로그를 썼습니다.</li>
        <li><b>관심 수준</b>: '코디' 검색량을 100으로 둔 상대값. 1 미만은 검색이 너무 적어 추천에서 뺍니다.</li>
      </ul>
      <p>점수가 높다고 무조건 좋은 주제는 아닙니다. 내 블로그 성격과 시즌을 함께 보고 고르세요.</p>
    </details>
    <div class="table-wrap"><table>
      <thead><tr>
        ${head('word', '키워드')}
        <th>최근 14일 흐름</th>
        ${head('change', '7일 관심도 변화', 'num')}
        ${head('level', '관심 수준', 'num')}
        ${head('posts', '블로그 글 수', 'num')}
        ${head('score', '기회 점수')}
        <th></th>
      </tr></thead>
      <tbody>${sorted.map((r) => `<tr id="kw-${esc(r.word)}" class="${r.lowVolume ? 'low' : ''}" ${r.word === focus ? 'style="background:var(--accent-soft)"' : ''}>
        <td><b>${esc(r.word)}</b>${r.lowVolume ? ' <span class="chip warn">검색 적음</span>' : ''}</td>
        <td>${spark(r.spark)}</td>
        <td class="num"><span class="pct ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}">${signed(r.change)}%</span></td>
        <td class="num">${r.level}</td>
        <td class="num">${num(r.posts)}</td>
        <td><span class="bar" style="width:${Math.round(((r.score || 0) / maxScore) * 90)}px"></span><span class="score">${r.score ?? '–'}</span></td>
        <td><button class="btn sm" data-word="${esc(r.word)}" onclick="makeBoard(this.dataset.word, this.dataset.word + ' 코디')">보드 만들기</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">흐름 그래프의 색칠된 부분이 최근 7일입니다. 지켜볼 키워드는 <a href="#/settings">설정</a>에서 바꿀 수 있어요.</p>`;
}

async function bloggerItems() {
  const d = await api('/api/blogger-items');
  const bars = (list, cls) => {
    const max = Math.max(...list.map((x) => x.count), 1);
    return list.map((x) => `<div class="hbar ${cls}"><span>${esc(x.word)}</span>
      <div class="track"><div class="fill" style="width:${(x.count / max) * 100}%"></div></div>
      <span class="small muted" style="text-align:right">${x.count}</span></div>`).join('') || '<p class="muted small">언급된 항목이 없습니다.</p>';
  };
  return `${dataBanner(d, '아이템 집계')}
    <p class="small muted">최근 블로그 글 ${d.total}개(검색어: ${d.queries.map(esc).join(', ')})의 제목·요약에서 언급된 글 수입니다. 주제를 고를 때 근거로 보세요.</p>
    <div class="grid grid-2">
      <section class="card"><h2>옷 종류</h2>${bars(d.items, '')}</section>
      <section class="card"><h2>브랜드</h2>${bars(d.brands, 'brand')}</section>
    </div>`;
}

// ---- 상품 보드 ----
const STATUSES = ['후보', '구매 완료', '촬영 완료', '발행 완료'];
const TYPES = ['직접 구매', '협찬', '제휴 링크'];

async function viewBoards() {
  loading();
  const boards = await api('/api/boards');
  $app.innerHTML = `
    <h1>상품 보드</h1>
    <p class="lede">글 하나에 보드 하나. 포스팅 후보 상품을 글 단위로 모아 둡니다.</p>
    <form class="card row" id="newBoard">
      <input name="title" placeholder="예: 10월 출근룩 아우터 3종" required style="flex:1;min-width:200px">
      <button class="btn primary">보드 만들기</button>
    </form>
    <div class="grid grid-3 section">
      ${boards.length ? boards.map(boardCard).join('') : `<div class="card empty">아직 보드가 없어요. 오늘의 브리핑에서 주제를 골라 바로 만들 수도 있어요.</div>`}
    </div>`;
  document.getElementById('newBoard').addEventListener('submit', async (e) => {
    e.preventDefault();
    await makeBoard('', new FormData(e.target).get('title'));
  });
}

function boardCard(b) {
  const counts = STATUSES.map((s) => [s, b.products.filter((p) => p.status === s).length]).filter(([, n]) => n);
  return `<a class="card board-card" href="#/boards/${b.id}">
    <h3>${esc(b.title)}</h3>
    <div class="small muted">${b.plannedDate ? `발행 예정 ${esc(b.plannedDate)}` : '발행일 미정'} · 상품 ${b.products.length}개</div>
    <div class="thumbs">${b.products.slice(0, 5).map((p) => p.image ? `<img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span></span>').join('')}</div>
    <div class="status-strip">${counts.map(([s, n]) => `<span class="chip">${esc(s)} ${n}</span>`).join('')}
      ${b.products.some((p) => p.type === '협찬') ? '<span class="chip season">협찬 포함</span>' : ''}</div>
  </a>`;
}

async function viewBoard(id) {
  loading();
  const boards = await api('/api/boards');
  const b = boards.find((x) => x.id === id);
  if (!b) { $app.innerHTML = `<h1>보드를 찾을 수 없어요</h1><a class="btn" href="#/boards">목록으로</a>`; return; }

  $app.innerHTML = `
    <p class="section"><a class="btn ghost sm" href="#/boards">← 상품 보드</a></p>
    <div class="card">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <label class="field wide" style="grid-column:1/-1">글 제목<input data-b="title" value="${esc(b.title)}" style="font-size:18px;font-weight:600"></label>
        <label class="field">발행 예정일<input type="date" data-b="plannedDate" value="${esc(b.plannedDate)}"></label>
        <label class="field">주제 키워드<input data-b="keyword" value="${esc(b.keyword)}"></label>
        <label class="field" style="grid-column:1/-1">글 메모<textarea data-b="memo" placeholder="글의 방향, 촬영 계획 등">${esc(b.memo)}</textarea></label>
      </div>
      ${b.products.some((p) => p.type !== '직접 구매') ? `<p class="chip warn" style="margin-top:12px">협찬·제휴 상품이 있어요. 글에 광고 표시 문구를 꼭 넣으세요.</p>` : ''}
    </div>

    <section class="section card add-box">
      <h2>상품 추가</h2>
      <form class="row" id="addForm">
        <input name="url" type="url" placeholder="상품 링크를 붙여넣으세요" style="flex:1;min-width:220px">
        <button class="btn primary" id="addBtn">링크로 추가</button>
        <button class="btn" type="button" id="manualBtn">직접 입력</button>
      </form>
      <p class="small muted" style="margin:0">상품명·브랜드·가격·썸네일을 가능한 범위에서 자동으로 채웁니다. 쇼핑몰에 따라 일부만 채워질 수 있어요.</p>
    </section>

    <section class="section grid">
      ${b.products.length ? b.products.map(productCard).join('') : '<div class="card empty">아직 담은 상품이 없어요.</div>'}
    </section>

    <p class="section"><button class="btn danger sm" id="delBoard">이 보드 삭제</button></p>`;

  const saveBoard = debounce(async (field, value) => {
    await api(`/api/boards/${id}`, { method: 'PUT', body: { [field]: value } });
    toast('저장했어요');
  }, 500);
  $app.querySelectorAll('[data-b]').forEach((el) => el.addEventListener('input', () => saveBoard(el.dataset.b, el.value)));

  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = new FormData(e.target).get('url').trim();
    if (!url) return;
    const btn = document.getElementById('addBtn');
    btn.disabled = true; btn.textContent = '읽는 중…';
    let info = {};
    try {
      info = await api('/api/scrape', { method: 'POST', body: { url } });
    } catch (err) {
      toast(`${err.message} 링크만 저장했어요.`);
    }
    await api(`/api/boards/${id}/products`, { method: 'POST', body: { url, ...info } });
    viewBoard(id);
  });
  document.getElementById('manualBtn').addEventListener('click', async () => {
    await api(`/api/boards/${id}/products`, { method: 'POST', body: { name: '새 상품' } });
    viewBoard(id);
  });
  document.getElementById('delBoard').addEventListener('click', async () => {
    if (!confirm(`'${b.title}' 보드를 삭제할까요? 담은 상품도 함께 지워집니다.`)) return;
    await api(`/api/boards/${id}`, { method: 'DELETE' });
    location.hash = '#/boards';
  });

  $app.querySelectorAll('[data-p]').forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => saveProduct(id, el.closest('[data-pid]').dataset.pid, el.dataset.p, el.value, el.tagName === 'SELECT'));
  });
  $app.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
    await api(`/api/boards/${id}/products/${el.dataset.del}`, { method: 'DELETE' });
    viewBoard(id);
  }));
}

const productTimers = {};
function saveProduct(boardId, pid, field, value, immediate) {
  const key = pid + field;
  clearTimeout(productTimers[key]);
  productTimers[key] = setTimeout(async () => {
    const body = { [field]: field === 'price' || field === 'originalPrice' ? (value === '' ? null : Number(value)) : value };
    await api(`/api/boards/${boardId}/products/${pid}`, { method: 'PUT', body });
    toast('저장했어요');
    if (immediate) viewBoard(boardId);
  }, immediate ? 0 : 500);
}

function productCard(p) {
  const disc = p.originalPrice && p.price && p.originalPrice > p.price ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const opt = (list, cur) => list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
  return `<article class="card product" data-pid="${p.id}">
    ${p.image ? `<img class="img" src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span class="img"></span>'}
    <div>
      <div class="row">
        <span class="chip">${esc(p.brand || '브랜드 없음')}</span>
        ${p.type !== '직접 구매' ? `<span class="chip season">${esc(p.type)}</span>` : ''}
        ${p.soldOut ? '<span class="chip down">품절</span>' : ''}
        <span class="spacer"></span>
        ${p.url ? `<a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">상품 페이지 ↗</a>` : ''}
        <button class="btn ghost sm danger" data-del="${p.id}" aria-label="상품 삭제">삭제</button>
      </div>
      <p class="name">${esc(p.name || '이름 없음')}</p>
      <div class="price">${disc ? `<span class="disc">${disc}%</span>` : ''}${p.price ? won(p.price) : '<span class="muted">가격 미입력</span>'}${disc ? `<s>${won(p.originalPrice)}</s>` : ''}
        ${p.priceCheckedAt ? `<span class="small muted"> · ${esc(p.priceCheckedAt)} 기준</span>` : ''}</div>
      <div class="fields">
        <label class="field">상태<select data-p="status">${opt(STATUSES, p.status)}</select></label>
        <label class="field">상품 유형<select data-p="type">${opt(TYPES, p.type)}</select></label>
        <label class="field">판매가(원)<input type="number" min="0" data-p="price" value="${p.price ?? ''}"></label>
        <label class="field">정가(원)<input type="number" min="0" data-p="originalPrice" value="${p.originalPrice ?? ''}"></label>
        <label class="field wide">상품명<input data-p="name" value="${esc(p.name)}"></label>
        <label class="field">브랜드<input data-p="brand" value="${esc(p.brand)}"></label>
        <label class="field">사이즈<input data-p="size" value="${esc(p.size)}" placeholder="예: M (평소 55)"></label>
        <label class="field wide">착용감<input data-p="fit" value="${esc(p.fit)}" placeholder="예: 어깨 여유, 소매 길이 적당"></label>
        <label class="field wide">코디 아이디어<textarea data-p="coordi" placeholder="예: 와이드 슬랙스 + 로퍼">${esc(p.coordi)}</textarea></label>
        <label class="field wide">링크<input data-p="url" value="${esc(p.url)}"></label>
      </div>
    </div>
  </article>`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---- 설정 ----
async function viewSettings() {
  loading();
  const s = await api('/api/settings');
  $app.innerHTML = `
    <h1>설정</h1>
    <p class="lede">키는 이 컴퓨터의 <code>data/db.json</code>에만 저장되고 다른 곳으로 보내지 않습니다.</p>
    <form id="sForm" class="grid">
      <section class="card grid">
        <h2>내 지역과 연령대</h2>
        <div class="grid grid-2">
          <label class="field">날씨 지역<select name="region">${s.regions.map((r) => `<option ${r === s.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label class="field">연령대 (홈과 분석 화면에 함께 적용)<select name="age">${s.ages.map((a) => `<option value="${a.value}" ${a.value === s.age ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
        </div>
      </section>

      <section class="card grid">
        <h2>네이버 API ${s.hasNaver ? '<span class="chip up">연결됨</span>' : '<span class="chip warn">미설정 · 예시 데이터 사용 중</span>'}</h2>
        <p class="small muted" style="margin:0">네이버 개발자센터(developers.naver.com) → 애플리케이션 등록 → 사용 API에 <b>데이터랩(검색어트렌드)</b>과 <b>검색</b>을 추가하면 Client ID와 Secret이 나옵니다.</p>
        <div class="grid grid-2">
          <label class="field">Client ID<input name="naverClientId" value="${esc(s.naverClientId)}" autocomplete="off"></label>
          <label class="field">Client Secret<input name="naverClientSecret" type="password" value="${esc(s.naverClientSecret)}" autocomplete="off"></label>
        </div>
      </section>

      <section class="card grid">
        <h2>기상청 단기예보 ${s.hasKma ? '<span class="chip up">연결됨</span>' : '<span class="chip warn">미설정 · 예시 날씨 사용 중</span>'}</h2>
        <p class="small muted" style="margin:0">공공데이터포털(data.go.kr)에서 '기상청_단기예보 조회서비스'를 활용 신청하면 나오는 서비스 키(인코딩·디코딩 아무거나)를 넣으세요.</p>
        <label class="field">서비스 키<input name="kmaServiceKey" type="password" value="${esc(s.kmaServiceKey)}" autocomplete="off"></label>
      </section>

      <section class="card grid">
        <h2>지켜볼 키워드</h2>
        <p class="small muted" style="margin:0">한 줄에 하나씩. 네이버 데이터랩은 하루 1,000번까지 부를 수 있고, 키워드 4개당 1번씩 씁니다(하루 한 번 저장해 두고 재사용).</p>
        <textarea name="keywords" rows="10">${esc(s.keywords.join('\n'))}</textarea>
      </section>

      <div class="row">
        <button class="btn primary">저장</button>
        <button class="btn" type="button" onclick="refreshAll()">저장한 데이터 비우고 새로 가져오기</button>
      </div>
    </form>`;

  document.getElementById('sForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    body.keywords = body.keywords.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    try {
      await api('/api/settings', { method: 'PUT', body });
      await api('/api/refresh', { method: 'POST' });
      toast('저장했어요. 오늘 데이터를 새로 가져옵니다.');
      viewSettings();
    } catch (err) { toast(err.message); }
  });
}

// ---- 라우터 ----
async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = (path || '/').split('/').filter(Boolean);
  const tab = parts[0] || 'home';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    if (tab === 'keywords') await viewKeywords(params);
    else if (tab === 'boards' && parts[1]) await viewBoard(parts[1]);
    else if (tab === 'boards') await viewBoards();
    else if (tab === 'settings') await viewSettings();
    else await viewHome();
  } catch (err) {
    errorView(err);
  }
}

window.addEventListener('hashchange', route);
route();
