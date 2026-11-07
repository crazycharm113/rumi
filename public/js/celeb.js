// 셀럽 착장: 연예인·유명인 패션 기사에서 Claude가 뽑은 착장을 사람·날짜별 '착장'으로 묶어 보여줍니다.
// 지금 쓰기 좋은 순으로 정렬하고, 비슷한 제품 찾기와 '이 착장으로 글 만들기'로 바로 글감이 되게 합니다.
const celebUI = { days: 7, cat: '', brandOnly: false, sort: 'score', dir: -1, person: '', favOnly: false, hideWritten: false };
const celebOpen = new Set(); // 펼쳐 둔 착장
let celebData = null;

views.celeb = async () => {
  loading();
  celebData = await api('/api/celeb');
  renderCeleb();
};

function filteredLooks(d) {
  const since = kstDate(-(celebUI.days - 1));
  let looks = d.looks.filter((l) => l.date >= since);
  if (celebUI.person) looks = looks.filter((l) => l.celeb === celebUI.person);
  if (celebUI.favOnly) looks = looks.filter((l) => l.favorite);
  if (celebUI.hideWritten) looks = looks.filter((l) => !l.written);
  // 종류·브랜드 필터는 조각(아이템) 단위로 걸고, 남는 조각이 없는 착장은 뺍니다.
  looks = looks.map((l) => ({
    ...l,
    shown: l.pieces.filter((p) => (!celebUI.cat || p.category === celebUI.cat) && (!celebUI.brandOnly || p.brand)),
  })).filter((l) => l.shown.length);
  const val = (l) => ({
    celeb: l.celeb, date: l.date, articles: l.articles.length, score: l.score?.score ?? null,
    celebChange: l.score?.celebChange ?? null, posts: l.score?.posts ?? null, freshAge: l.score?.fresh?.medianAge ?? null,
  }[celebUI.sort]);
  return looks.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * celebUI.dir || b.date.localeCompare(a.date);
  });
}

function renderCeleb() {
  const d = celebData;
  const missing = [d.needs.claude && 'Claude API 키', d.needs.naver && '네이버 API 키(검색 - 뉴스 포함)'].filter(Boolean).join('와 ');
  const people = [...new Set(d.looks.map((l) => l.celeb))].sort((a, b) => a.localeCompare(b, 'ko'));
  const looks = filteredLooks(d);
  const chipBtn = (key, value, label) => `<button class="chip-btn ${celebUI[key] === value ? 'on' : ''}" data-set="${key}" data-val="${esc(String(value))}">${esc(label)}</button>`;

  $app.innerHTML = `
    <h1>셀럽 착장</h1>
    <p class="lede">최근 연예인·유명인 패션 기사에서 누가 무엇을 입었는지 착장별로 묶었어요. 🔥는 지금 쓰기 좋은 착장이에요.</p>
    ${d.demo ? `<div class="banner demo">지금 보이는 착장은 <b>예시</b>입니다. <a href="#/settings">설정</a>에 ${missing}를 넣으면 실제 기사로 바뀌어요.</div>` : ''}
    ${d.error ? `<div class="banner stale">마지막 수집에 실패했어요: ${esc(d.error)}</div>` : ''}
    <div class="row section">
      <span class="small muted">${d.lastRun ? `갱신: ${esc(timeText(d.lastRun))}${d.lastNew != null ? ` · 새 기사 ${d.lastNew}개` : ''} · 하루 한 번 자동` : '아직 수집 전'}
        ${!d.demo ? ` · 이번 달 Claude 사용 약 $${d.usage.usd} (${d.usage.calls}회)` : ''}</span>
      <span class="spacer"></span>
      ${!d.demo ? '<button class="btn sm" id="celebRefresh">지금 모으기</button>' : ''}
    </div>

    <section class="section card">
      <h2>이번 주 셀럽이 많이 입은 아이템</h2>
      ${d.top.length ? `<div class="row">${d.top.map((t) => `<span class="chip celeb" title="${esc(t.celebs.join(', '))}">${esc(t.item)} · ${t.count}명</span>`).join('')}</div>
        <p class="small muted" style="margin-bottom:0">많이 입은 아이템은 오늘의 주제 순위가 조금 올라가고 '셀럽 착용' 표시가 붙어요.</p>` : '<p class="muted small">이번 주 착장 기사가 아직 없어요.</p>'}
    </section>

    <section class="section card filters">
      <div class="row"><span class="small muted filter-label">기간</span>${chipBtn('days', 1, '오늘')}${chipBtn('days', 3, '3일')}${chipBtn('days', 7, '7일')}</div>
      <div class="row"><span class="small muted filter-label">종류</span>${chipBtn('cat', '', '전체')}${d.categories.filter((c) => c !== '기타').map((c) => chipBtn('cat', c, c)).join('')}</div>
      <div class="row"><span class="small muted filter-label">사람</span>
        <select id="celebPerson" style="width:auto"><option value="">전체 ${people.length}명</option>${people.map((p) => `<option ${celebUI.person === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <label class="row small"><input type="checkbox" data-check="favOnly" ${celebUI.favOnly ? 'checked' : ''} style="width:auto"> ★ 관심 연예인만</label>
        <label class="row small"><input type="checkbox" data-check="brandOnly" ${celebUI.brandOnly ? 'checked' : ''} style="width:auto"> 브랜드 확인된 것만</label>
        <label class="row small"><input type="checkbox" data-check="hideWritten" ${celebUI.hideWritten ? 'checked' : ''} style="width:auto"> 이미 쓴 착장 빼기</label>
      </div>
    </section>

    ${looks.length ? lookTable(looks) : '<div class="card empty section">조건에 맞는 착장이 없어요.</div>'}
    <p class="small muted section">기사 제목·요약만 저장하고 본문과 사진은 저장하지 않아요. 블로그에 기사 문장이나 보도 사진을 그대로 옮기면 저작권 문제가 생길 수 있으니, 출처를 밝히고 직접 쓴 문장과 직접 찍은·허락받은 사진을 써 주세요.</p>`;
  bindCeleb();
}

function lookTable(looks) {
  const maxScore = Math.max(...looks.map((l) => l.score?.score || 0), 1);
  const head = (key, label, cls = '') => `<th class="${cls}" aria-sort="${celebUI.sort === key ? (celebUI.dir > 0 ? 'ascending' : 'descending') : 'none'}">
    <button data-sortcol="${key}">${label}${celebUI.sort === key ? (celebUI.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  return `<div class="table-wrap section"><table class="look-table">
    <thead><tr>
      ${head('celeb', '사람')}${head('date', '날짜')}<th>착장</th>
      ${head('articles', '기사', 'num')}${head('celebChange', '이름 검색', 'num')}${head('posts', '같은 글 수', 'num')}${head('freshAge', '상위 글', 'num')}
      ${head('score', '쓰기 좋은 점수')}<th></th>
    </tr></thead>
    <tbody>${looks.map((l) => lookRow(l, maxScore)).join('')}</tbody>
  </table></div>
  <p class="small muted">줄을 누르면 아이템별 쇼핑·비슷한 제품·고치기가 펼쳐져요. 🔥는 점수 상위 20%, 상위 글의 %는 6개월 넘은 글 비율이에요.</p>`;
}

function lookRow(l, maxScore) {
  const sc = l.score;
  const open = celebOpen.has(l.id);
  const change = sc?.celebChange;
  const fresh = sc?.fresh;
  return `<tr class="look-row ${open ? 'open' : ''}" data-row="${esc(l.id)}">
      <td class="nowrap"><span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span> <button class="star ${l.favorite ? 'on' : ''}" data-fav="${esc(l.celeb)}" title="${l.favorite ? '관심 연예인에서 빼기' : '관심 연예인으로 추가'}" aria-label="관심 연예인">${l.favorite ? '★' : '☆'}</button>
        <b>${esc(l.celeb)}</b>${l.hot ? ' <span class="chip hot" title="점수 상위 20%">🔥</span>' : ''}${l.written ? ' <span class="chip">작성함</span>' : ''}</td>
      <td class="nowrap muted">${esc(mmdd(l.date))}</td>
      <td class="look-pieces">${l.shown.map((p) => `<div><span class="piece-cat">${esc(p.category)}</span> <b>${esc(p.item)}</b>${p.brand ? ` <span class="muted">${esc(p.brand)}</span>` : ''}</div>`).join('')}</td>
      <td class="num">${l.articles.length}</td>
      <td class="num">${change == null ? '<span class="muted">–</span>' : `<span class="pct ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${signed(change)}%</span>`}</td>
      <td class="num">${sc?.posts == null ? '<span class="muted">–</span>' : num(sc.posts)}</td>
      <td class="num nowrap">${fresh ? `${fresh.medianAge}일 <span class="small ${fresh.oldShare >= 60 ? 'tag-new' : 'muted'}" title="상위 글 작성일 중간값 · 6개월 넘은 글 비율">${fresh.oldShare}%</span>` : '<span class="muted">–</span>'}</td>
      <td class="nowrap">${sc ? `<span class="bar" style="width:${Math.round((sc.score / maxScore) * 60)}px"></span><span class="score">${sc.score}</span>` : '<span class="muted">–</span>'}</td>
      <td class="nowrap"><button class="btn primary sm" data-board="${esc(l.id)}">글 만들기</button></td>
    </tr>${open ? `<tr class="look-detail"><td colspan="9">${lookDetail(l)}</td></tr>` : ''}`;
}

function lookDetail(l) {
  return `<ul class="pieces">${l.pieces.map((p) => `<li data-piece="${esc(p.id)}">
      <span class="piece-cat">${esc(p.category)}</span>
      <span class="piece-main"><b>${esc(p.item)}</b>${p.color ? ` <span class="muted small">(${esc(p.color)})</span>` : ''}
        <span class="small">${p.brand ? esc(p.brand) : '<span class="muted">브랜드 미상</span>'}${p.product ? ` · ${esc(p.product)}` : ''}${p.price ? ` · ${esc(p.price)}` : ''}</span></span>
      <span class="piece-actions">
        <a class="btn ghost sm" href="https://search.shopping.naver.com/search/all?query=${encodeURIComponent([p.brand, p.product || p.item].filter(Boolean).join(' '))}" target="_blank" rel="noopener noreferrer">쇼핑↗</a>
        <button class="btn ghost sm" data-similar="${esc(p.item)}" data-brand="${esc(p.brand)}">비슷한 제품</button>
        <button class="btn ghost sm" data-edit="${esc(p.id)}" title="잘못 뽑혔으면 고치기">고치기</button>
      </span>
      <div class="similar" hidden></div>
    </li>`).join('')}</ul>
    <div class="row small">출처 기사: ${l.articles.slice(0, 4).map((a, i) => `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" title="${esc(a.title)}">기사${l.articles.length > 1 ? ` ${i + 1}` : ''}&nbsp;↗</a>`).join(' ')}
      ${l.articles.length > 4 ? `<span class="muted">외 ${l.articles.length - 4}건</span>` : ''}</div>`;
}

function bindCeleb() {
  $app.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.set;
    celebUI[k] = k === 'days' ? Number(b.dataset.val) : b.dataset.val;
    renderCeleb();
  }));
  $app.querySelectorAll('[data-check]').forEach((c) => c.addEventListener('change', () => { celebUI[c.dataset.check] = c.checked; renderCeleb(); }));
  document.getElementById('celebPerson').addEventListener('change', (e) => { celebUI.person = e.target.value; renderCeleb(); });

  $app.querySelectorAll('[data-sortcol]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sortcol;
    celebUI.dir = celebUI.sort === k ? -celebUI.dir : (k === 'celeb' || k === 'posts' || k === 'freshAge' ? 1 : -1);
    celebUI.sort = k;
    renderCeleb();
  }));
  const toggle = (id) => { celebOpen.has(id) ? celebOpen.delete(id) : celebOpen.add(id); renderCeleb(); };
  $app.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggle(b.dataset.toggle); }));
  $app.querySelectorAll('tr.look-row').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) toggle(tr.dataset.row); }));
  $app.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(b.dataset.fav); }));
  $app.querySelectorAll('[data-similar]').forEach((b) => b.addEventListener('click', () => showSimilar(b)));
  $app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editPiece(b.dataset.edit)));
  $app.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); lookToBoard(b.dataset.board); }));
  document.getElementById('celebRefresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '모으는 중… (1~2분)';
    try { await api('/api/celeb/refresh', { method: 'POST' }); toast('새 기사를 정리했어요'); } catch (err) { toast(err.message); }
    views.celeb();
  });
}

const findPiece = (id) => celebData.looks.flatMap((l) => l.pieces.map((p) => ({ ...p, celeb: l.celeb }))).find((p) => p.id === id);

async function toggleFavorite(name) {
  const s = await api('/api/settings');
  const on = s.celebs.includes(name);
  await api('/api/settings', { method: 'PUT', body: { celebs: on ? s.celebs.filter((n) => n !== name) : [...s.celebs, name] } });
  toast(on ? `${name}님을 관심 연예인에서 뺐어요` : `${name}님을 관심 연예인에 추가했어요. 다음 수집부터 기사를 더 모아요.`);
  celebData.looks.forEach((l) => { if (l.celeb === name) l.favorite = !on; });
  celebData.favorites = on ? celebData.favorites.filter((n) => n !== name) : [...celebData.favorites, name];
  renderCeleb();
}

async function showSimilar(btn) {
  const box = btn.closest('li').querySelector('.similar');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<span class="small muted">찾는 중…</span>';
  try {
    const r = await api(`/api/celeb/similar?item=${encodeURIComponent(btn.dataset.similar)}&brand=${encodeURIComponent(btn.dataset.brand)}`);
    box.innerHTML = `<div class="small muted">블로그에서 많이 언급된 다른 ${esc(r.item)}</div>
      ${r.alternatives.length ? `<ul class="plain small">${r.alternatives.map((x) => `<li class="row">
        <a href="${esc(x.shopUrl)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.name)}</b>&nbsp;↗</a>
        <span class="muted">언급 ${x.mentions}회</span>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-add='${esc(JSON.stringify({ name: x.name, brand: x.brand, memo: `비슷한 제품 (${btn.dataset.brand || '셀럽 착용'} ${r.item} 대안)` }))}' data-kw="${esc(r.item)}">담기</button>
      </li>`).join('')}</ul>` : '<p class="small muted" style="margin:4px 0">블로그에서 찾은 다른 브랜드 제품이 없어요.</p>'}
      <div class="row small">${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}&nbsp;↗</a>`).join('')}</div>`;
    box.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addToBoard(JSON.parse(b.dataset.add), b.dataset.kw)));
  } catch (err) {
    box.innerHTML = `<span class="small muted">${esc(err.message)}</span>`;
  }
}

async function editPiece(id) {
  const p = findPiece(id);
  if (!p) return;
  if (String(id).startsWith('demo')) return toast('예시 착장은 고칠 수 없어요.');
  const r = await dialog('착장 고치기', [
    { name: 'celeb', label: '사람', value: p.celeb },
    { name: 'item', label: '아이템', value: p.item },
    { name: 'category', label: '종류', value: p.category, options: celebData.categories.map((c) => ({ value: c, label: c })) },
    { name: 'brand', label: '브랜드 (모르면 비워 두기)', value: p.brand },
    { name: 'product', label: '제품명', value: p.product },
  ], { extra: '<button class="btn danger sm" value="hide" formnovalidate style="justify-self:start">잘못 뽑힌 착장이라 숨기기</button>' });
  if (!r) return;
  // 같은 착장으로 묶인 기사 조각을 모두 고칩니다.
  const body = r._action === 'hide' ? { hidden: true } : r;
  for (const pid of p.ids) await api(`/api/celeb/items/${pid}`, { method: 'PUT', body });
  toast(r._action === 'hide' ? '숨겼어요' : '고쳤어요');
  views.celeb();
}

async function lookToBoard(lookId) {
  const look = celebData.looks.find((l) => l.id === lookId);
  const items = look.pieces.slice(0, 3).map((p) => p.item).join('·');
  const branded = look.pieces.find((p) => p.brand);
  const r = await dialog('이 착장으로 글 만들기', [
    { name: 'title', label: '글 제목', value: `${look.celeb} 착장 정보 · ${items}${branded ? ` (${branded.brand})` : ''}와 비슷한 제품`, required: true },
    { name: 'plannedDate', label: '발행 예정일 (선택)', type: 'date', value: kstDate(1) },
  ], { submit: '보드 만들기' });
  if (!r) return;
  const board = await api('/api/celeb/board', { method: 'POST', body: { lookId, ...r } });
  toast('상품 보드를 만들었어요. 착장 아이템과 출처 기사가 담겨 있어요.');
  location.hash = `#/boards/${board.id}`;
}
