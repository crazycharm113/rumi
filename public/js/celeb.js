// 셀럽 착장: 연예인이 공항패션·사복패션 등에서 입어 화제가 된 옷을 한 줄에 하나씩 보여줍니다.
// 점수는 기사 수가 아니라 최근 블로그에 실제로 쓰인 글 수가 중심이에요.
const celebUI = { days: 14, cat: '', situation: '', brandOnly: false, sort: 'score', dir: -1, person: '', favOnly: false, hideWritten: false, hideQuiet: true };
const celebOpen = new Set(); // 펼쳐 둔 항목
let celebData = null;

views.celeb = async () => {
  loading();
  celebData = await api('/api/celeb');
  renderCeleb();
};

function filteredHots(d) {
  const since = kstDate(-(celebUI.days - 1));
  let list = d.hots.filter((h) => h.date >= since);
  if (celebUI.person) list = list.filter((h) => h.celeb === celebUI.person);
  if (celebUI.favOnly) list = list.filter((h) => h.favorite);
  if (celebUI.hideWritten) list = list.filter((h) => !h.written);
  if (celebUI.cat) list = list.filter((h) => h.category === celebUI.cat);
  if (celebUI.situation) list = list.filter((h) => h.situation === celebUI.situation);
  if (celebUI.brandOnly) list = list.filter((h) => h.brand);
  // 블로그에 거의 안 쓰인 옷은 기본으로 숨깁니다 (블로그 수를 아직 못 구한 옷은 그대로 둠)
  const quiet = list.filter((h) => h.score && h.score.blog7 < d.minBlog7).length;
  if (celebUI.hideQuiet) list = list.filter((h) => !h.score || h.score.blog7 >= d.minBlog7);
  const val = (h) => ({
    celeb: h.celeb, situation: h.situation, brand: h.brand, name: h.product || h.item, articles: h.articles.length, score: h.score?.score ?? null,
    blog7: h.score?.blog7 ?? null, blog3: h.score?.blog3 ?? null, posts: h.score?.posts ?? null, date: h.date,
  }[celebUI.sort]);
  list.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * celebUI.dir || b.date.localeCompare(a.date);
  });
  return { list, quiet };
}

function renderCeleb() {
  const d = celebData;
  const missing = [d.needs.claude && 'Claude API 키', d.needs.naver && '네이버 API 키(검색 - 뉴스 포함)'].filter(Boolean).join('와 ');
  const people = [...new Set(d.hots.map((h) => h.celeb))].sort((a, b) => a.localeCompare(b, 'ko'));
  const { list, quiet } = filteredHots(d);
  const chipBtn = (key, value, label) => `<button class="chip-btn ${celebUI[key] === value ? 'on' : ''}" data-set="${key}" data-val="${esc(String(value))}">${esc(label)}</button>`;
  const sitCount = (s) => d.hots.filter((h) => h.situation === s).length;

  $app.innerHTML = `
    <h1>셀럽 착장</h1>
    <p class="lede">공항패션·사복패션 같은 자리에서 연예인이 입어 <b>화제가 된 옷</b>이에요. 점수는 최근 블로그에 실제로 쓰인 글이 많을수록 높고, 🔥는 지금 블로그에서 뜨는 옷이에요.</p>
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
      <div class="row"><span class="small muted filter-label">키워드</span>${chipBtn('situation', '', '전체')}${d.situations.filter((x) => x !== '기타' && sitCount(x)).map((x) => chipBtn('situation', x, `${x} ${sitCount(x)}`)).join('')}</div>
      <div class="row"><span class="small muted filter-label">기간</span>${chipBtn('days', 3, '3일')}${chipBtn('days', 7, '7일')}${chipBtn('days', 14, '14일')}</div>
      <div class="row"><span class="small muted filter-label">종류</span>${chipBtn('cat', '', '전체')}${d.categories.filter((c) => c !== '기타').map((c) => chipBtn('cat', c, c)).join('')}</div>
      <div class="row"><span class="small muted filter-label">사람</span>
        <select id="celebPerson" style="width:auto"><option value="">전체 ${people.length}명</option>${people.map((p) => `<option ${celebUI.person === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <label class="row small"><input type="checkbox" data-check="hideQuiet" ${celebUI.hideQuiet ? 'checked' : ''} style="width:auto"> 블로그에 거의 안 쓰인 옷 숨기기${quiet ? ` (${quiet}개)` : ''}</label>
        <label class="row small"><input type="checkbox" data-check="favOnly" ${celebUI.favOnly ? 'checked' : ''} style="width:auto"> ★ 관심 연예인만</label>
        <label class="row small"><input type="checkbox" data-check="brandOnly" ${celebUI.brandOnly ? 'checked' : ''} style="width:auto"> 브랜드 확인된 것만</label>
        <label class="row small"><input type="checkbox" data-check="hideWritten" ${celebUI.hideWritten ? 'checked' : ''} style="width:auto"> 이미 쓴 착장 빼기</label>
      </div>
    </section>

    ${list.length ? hotTable(list) : `<div class="card empty section">조건에 맞는 착장이 없어요.${quiet && celebUI.hideQuiet ? ' 블로그에 거의 안 쓰인 옷 숨기기를 끄면 더 보여요.' : ''}</div>`}
    <p class="small muted section">기사 제목·요약만 저장하고 본문과 사진은 저장하지 않아요. 블로그에 기사 문장이나 보도 사진을 그대로 옮기면 저작권 문제가 생길 수 있으니, 출처를 밝히고 직접 쓴 문장과 직접 찍은·허락받은 사진을 써 주세요.</p>`;
  bindCeleb();
}

function hotTable(list) {
  const maxScore = Math.max(...list.map((h) => h.score?.score || 0), 1);
  const head = (key, label, cls = '') => `<th class="${cls}" aria-sort="${celebUI.sort === key ? (celebUI.dir > 0 ? 'ascending' : 'descending') : 'none'}">
    <button data-sortcol="${key}">${label}${celebUI.sort === key ? (celebUI.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  return `<div class="table-wrap section"><table class="look-table">
    <thead><tr>
      ${head('celeb', '사람')}${head('situation', '키워드')}${head('brand', '브랜드')}${head('name', '착장 이름')}
      ${head('blog7', '7일 블로그', 'num')}${head('blog3', '3일', 'num')}${head('posts', '전체 글', 'num')}${head('articles', '기사', 'num')}
      ${head('score', '점수')}<th></th>
    </tr></thead>
    <tbody>${list.map((h) => hotRow(h, maxScore)).join('')}</tbody>
  </table></div>
  <p class="small muted">줄을 누르면 최근 블로그 글, 비슷한 제품, 고치기가 펼쳐져요. 7일·3일 블로그는 그 사람과 옷 이름이 함께 들어간 글 수(최대 100), 점수는 블로그 글이 중심이에요.</p>`;
}

function hotRow(h, maxScore) {
  const sc = h.score;
  const open = celebOpen.has(h.id);
  const cell = (v) => (v == null ? '<span class="muted">–</span>' : num(v));
  return `<tr class="look-row ${open ? 'open' : ''}" data-row="${esc(h.id)}">
      <td class="nowrap"><span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span> <button class="star ${h.favorite ? 'on' : ''}" data-fav="${esc(h.celeb)}" title="${h.favorite ? '관심 연예인에서 빼기' : '관심 연예인으로 추가'}" aria-label="관심 연예인">${h.favorite ? '★' : '☆'}</button>
        <b>${esc(h.celeb)}</b>${h.hot ? ' <span class="chip hot" title="블로그에서 뜨는 옷">🔥</span>' : ''}${h.written ? ' <span class="chip">작성함</span>' : ''}</td>
      <td class="nowrap">${h.situation !== '기타' ? `<span class="chip celeb">${esc(h.situation)}</span>` : '<span class="muted">–</span>'}${h.buzz ? ' <span class="chip hot" title="기사에 완판·화제 같은 표현이 있어요">화제</span>' : ''}</td>
      <td class="nowrap">${h.brand ? `<b>${esc(h.brand)}</b>` : '<span class="muted">미상</span>'}</td>
      <td><span class="piece-cat">${esc(h.category)}</span> <b>${esc(h.product || h.item)}</b>${h.product && h.product !== h.item ? ` <span class="muted small">${esc(h.item)}</span>` : ''}</td>
      <td class="num"><b>${cell(sc?.blog7)}</b></td>
      <td class="num">${cell(sc?.blog3)}</td>
      <td class="num">${cell(sc?.posts)}</td>
      <td class="num">${h.articles.length}</td>
      <td class="nowrap">${sc ? `<span class="bar" style="width:${Math.round((sc.score / maxScore) * 60)}px"></span><span class="score">${sc.score}</span>` : '<span class="muted">–</span>'}</td>
      <td class="nowrap"><button class="btn primary sm" data-board="${esc(h.id)}">글 만들기</button></td>
    </tr>${open ? `<tr class="look-detail"><td colspan="10">${hotDetail(h)}</td></tr>` : ''}`;
}

function blogList(h) {
  const blogs = h.score?.blogs;
  if (blogs == null) return '';
  const fmt = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : '');
  return `<div class="look-blogs"><div class="small muted">'${esc(h.celeb)} ${esc(h.item)}'으로 쓰인 블로그 상위 글</div>
    ${blogs.length ? `<ol class="blog-list">${blogs.map((b) => `<li>
      <a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer">${esc(b.title)}&nbsp;↗</a>
      ${b.mine ? '<span class="chip up">내 글</span>' : ''}
      <span class="small muted">${esc(b.blogger)}${b.date ? ` · ${esc(fmt(b.date))}` : ''}</span></li>`).join('')}</ol>`
      : '<p class="small" style="margin:4px 0">아직 이 옷으로 쓴 글이 거의 없어요. 먼저 쓰면 상위에 오를 기회예요.</p>'}</div>`;
}

function hotDetail(h) {
  const q = [h.brand, h.product || h.item].filter(Boolean).join(' ');
  return `<div class="row" style="margin:6px 0"><span class="small muted">블로그 글 키워드</span><b>${esc(h.name)}</b>
      <button class="btn ghost sm" data-copy="${esc(h.name)}">복사</button></div>
    <div class="row small" style="margin-bottom:4px">
      ${h.color ? `<span>색상 ${esc(h.color)}</span>` : ''}${h.price ? `<span>가격 ${esc(h.price)}</span>` : ''}
      ${h.sameLook.length ? `<span>같이 입은 아이템: ${h.sameLook.map(esc).join(', ')}</span>` : ''}
      <span class="spacer"></span>
      <a class="btn ghost sm" href="https://search.shopping.naver.com/search/all?query=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">쇼핑↗</a>
      <button class="btn ghost sm" data-similar="${esc(h.item)}" data-brand="${esc(h.brand)}">비슷한 제품</button>
      <button class="btn ghost sm" data-edit="${esc(h.id)}" title="잘못 뽑혔으면 고치기">고치기</button>
    </div>
    <div class="similar" hidden></div>
    ${blogList(h)}
    <div class="row small">출처 기사: ${h.articles.slice(0, 4).map((a, i) => `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" title="${esc(a.title)}">기사${h.articles.length > 1 ? ` ${i + 1}` : ''}&nbsp;↗</a>`).join(' ')}
      ${h.articles.length > 4 ? `<span class="muted">외 ${h.articles.length - 4}건</span>` : ''}</div>`;
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
    celebUI.dir = celebUI.sort === k ? -celebUI.dir : (['celeb', 'situation', 'brand', 'name', 'posts'].includes(k) ? 1 : -1);
    celebUI.sort = k;
    renderCeleb();
  }));
  const toggle = (id) => { celebOpen.has(id) ? celebOpen.delete(id) : celebOpen.add(id); renderCeleb(); };
  $app.querySelectorAll('tr.look-row').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button, a')) toggle(tr.dataset.row); }));
  $app.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(b.dataset.fav); }));
  $app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
  $app.querySelectorAll('[data-similar]').forEach((b) => b.addEventListener('click', () => showSimilar(b)));
  $app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editHot(b.dataset.edit)));
  $app.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); hotToBoard(b.dataset.board); }));
  document.getElementById('celebRefresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = '모으는 중… (1~2분)';
    try { await api('/api/celeb/refresh', { method: 'POST' }); toast('새 기사를 정리했어요'); } catch (err) { toast(err.message); }
    views.celeb();
  });
}

async function toggleFavorite(name) {
  const s = await api('/api/settings');
  const on = s.celebs.includes(name);
  await api('/api/settings', { method: 'PUT', body: { celebs: on ? s.celebs.filter((n) => n !== name) : [...s.celebs, name] } });
  toast(on ? `${name}님을 관심 연예인에서 뺐어요` : `${name}님을 관심 연예인에 추가했어요. 다음 수집부터 기사를 더 모아요.`);
  celebData.hots.forEach((h) => { if (h.celeb === name) h.favorite = !on; });
  celebData.favorites = on ? celebData.favorites.filter((n) => n !== name) : [...celebData.favorites, name];
  renderCeleb();
}

async function showSimilar(btn) {
  const box = btn.closest('td').querySelector('.similar');
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

async function editHot(id) {
  const h = celebData.hots.find((x) => x.id === id);
  if (!h) return;
  if (h.ids.some((i) => String(i).startsWith('demo'))) return toast('예시 착장은 고칠 수 없어요.');
  const r = await dialog('착장 고치기', [
    { name: 'celeb', label: '사람', value: h.celeb },
    { name: 'situation', label: '키워드(입은 자리)', value: h.situation, options: celebData.situations.map((c) => ({ value: c, label: c })) },
    { name: 'brand', label: '브랜드 (모르면 비워 두기)', value: h.brand },
    { name: 'item', label: '아이템', value: h.item },
    { name: 'product', label: '착장 이름·제품명', value: h.product },
    { name: 'category', label: '종류', value: h.category, options: celebData.categories.map((c) => ({ value: c, label: c })) },
  ], { extra: '<button class="btn danger sm" value="hide" formnovalidate style="justify-self:start">잘못 뽑힌 착장이라 숨기기</button>' });
  if (!r) return;
  // 이 옷으로 합쳐진 기사 조각을 모두 고칩니다.
  const body = r._action === 'hide' ? { hidden: true } : r;
  for (const iid of h.ids) await api(`/api/celeb/items/${iid}`, { method: 'PUT', body });
  toast(r._action === 'hide' ? '숨겼어요' : '고쳤어요');
  views.celeb();
}

async function hotToBoard(hotId) {
  const h = celebData.hots.find((x) => x.id === hotId);
  const r = await dialog('이 옷으로 글 만들기', [
    { name: 'title', label: '글 제목', value: `${h.situation !== '기타' ? h.situation + ' ' : ''}${h.celeb} ${h.brand ? h.brand + ' ' : ''}${h.item} 정보와 비슷한 제품`, required: true },
    { name: 'plannedDate', label: '발행 예정일 (선택)', type: 'date', value: kstDate(1) },
  ], { submit: '보드 만들기' });
  if (!r) return;
  const board = await api('/api/celeb/board', { method: 'POST', body: { hotId, ...r } });
  toast('상품 보드를 만들었어요. 옷과 같이 입은 아이템, 출처 기사가 담겨 있어요.');
  location.hash = `#/boards/${board.id}`;
}
