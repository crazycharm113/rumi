// 상품 보드(글 하나 = 보드 하나)와 포스팅 도우미
const STATUSES = ['후보', '구매 완료', '촬영 완료', '발행 완료'];
const TYPES = ['직접 구매', '협찬', '제휴 링크'];
const POST_STATUSES = ['구상', '촬영', '작성', '발행'];

views.boards = async (parts, params) => {
  if (parts[1]) return viewBoard(parts[1], params.get('tab') || 'products');
  loading();
  const boards = await api('/api/boards');
  const filter = params.get('status') || 'all';
  const shown = filter === 'all' ? boards : boards.filter((b) => (b.postStatus || '구상') === filter);
  $app.innerHTML = `
    <h1>상품 보드</h1>
    <p class="lede">글 하나에 보드 하나. 포스팅 후보 상품을 글 단위로 모아 둡니다.</p>
    <form class="card row" id="newBoard">
      <input name="title" placeholder="예: 10월 출근룩 아우터 3종" required style="flex:1;min-width:200px">
      <button class="btn primary">보드 만들기</button>
    </form>
    <div class="row section">
      ${['all', ...POST_STATUSES].map((s) => `<a class="chip-btn ${filter === s ? 'on' : ''}" href="#/boards?status=${encodeURIComponent(s)}">${s === 'all' ? '전체' : esc(s)} ${s === 'all' ? boards.length : boards.filter((b) => (b.postStatus || '구상') === s).length}</a>`).join('')}
    </div>
    <div class="grid grid-3 section">
      ${shown.length ? shown.map(boardCard).join('') : `<div class="card empty">해당하는 보드가 없어요. 오늘의 브리핑에서 주제를 골라 바로 만들 수도 있어요.</div>`}
    </div>`;
  document.getElementById('newBoard').addEventListener('submit', async (e) => {
    e.preventDefault();
    await makeBoard('', new FormData(e.target).get('title'));
  });
};

function boardCard(b) {
  const counts = STATUSES.map((s) => [s, b.products.filter((p) => p.status === s).length]).filter(([, n]) => n);
  return `<a class="card board-card" href="#/boards/${b.id}">
    <div class="row"><span class="cal-item ${POST_STATUS_CLASS[b.postStatus || '구상']}">${esc(b.postStatus || '구상')}</span>
      ${b.products.some((p) => p.type === '협찬') ? '<span class="chip season">협찬</span>' : ''}
      ${b.products.some((p) => p.soldOut) ? '<span class="chip down">품절 포함</span>' : ''}</div>
    <h3>${esc(b.title)}</h3>
    <div class="small muted">${b.plannedDate ? `발행 예정 ${esc(b.plannedDate)}` : '발행일 미정'} · 상품 ${b.products.length}개${b.sponsorDeadline ? ` · 협찬 마감 ${esc(b.sponsorDeadline)}` : ''}</div>
    <div class="thumbs">${b.products.slice(0, 5).map((p) => p.image ? `<img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span></span>').join('')}</div>
    <div class="status-strip">${counts.map(([s, n]) => `<span class="chip">${esc(s)} ${n}</span>`).join('')}</div>
  </a>`;
}

async function viewBoard(id, tab) {
  loading();
  const boards = await api('/api/boards');
  const b = boards.find((x) => x.id === id);
  if (!b) { $app.innerHTML = `<h1>보드를 찾을 수 없어요</h1><a class="btn" href="#/boards">목록으로</a>`; return; }
  const hasPaid = b.products.some((p) => p.type !== '직접 구매');

  $app.innerHTML = `
    <p class="section"><a class="btn ghost sm" href="#/boards">← 상품 보드</a></p>
    <div class="card">
      <div class="grid board-fields">
        <label class="field" style="grid-column:1/-1">글 제목<input data-b="title" value="${esc(b.title)}" style="font-size:18px;font-weight:600"></label>
        <label class="field">글 상태<select data-b="postStatus">${POST_STATUSES.map((s) => `<option ${s === (b.postStatus || '구상') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field">발행 예정일<input type="date" data-b="plannedDate" value="${esc(b.plannedDate)}"></label>
        <label class="field">주제 키워드<input data-b="keyword" value="${esc(b.keyword)}"></label>
        <label class="field">협찬 마감일<input type="date" data-b="sponsorDeadline" value="${esc(b.sponsorDeadline || '')}"></label>
        ${b.postStatus === '발행' ? `<label class="field" style="grid-column:1/-1">발행한 글 주소<input data-b="publishedUrl" value="${esc(b.publishedUrl || '')}" placeholder="https://blog.naver.com/..."></label>` : ''}
        <label class="field" style="grid-column:1/-1">글 메모<textarea data-b="memo" placeholder="글의 방향, 촬영 계획 등">${esc(b.memo)}</textarea></label>
      </div>
      ${hasPaid ? `<p class="chip warn" style="margin-top:12px">협찬·제휴 상품이 있어요. 글에 광고 표시 문구를 꼭 넣으세요. (글쓰기 도우미 → 체크리스트)</p>` : ''}
    </div>

    <div class="section subtabs" role="tablist">
      <button role="tab" class="${tab === 'products' ? 'on' : ''}" onclick="location.hash='#/boards/${id}'">상품 ${b.products.length}</button>
      <button role="tab" class="${tab === 'helper' ? 'on' : ''}" onclick="location.hash='#/boards/${id}?tab=helper'">글쓰기 도우미</button>
    </div>
    <div id="boardTab"></div>
    <p class="section"><button class="btn danger sm" id="delBoard">이 보드 삭제</button></p>`;

  const saveBoard = debounce(async (field, value) => {
    await api(`/api/boards/${id}`, { method: 'PUT', body: { [field]: value } });
    toast('저장했어요');
  }, 500);
  $app.querySelectorAll('[data-b]').forEach((el) => {
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', async () => {
        await api(`/api/boards/${id}`, { method: 'PUT', body: { [el.dataset.b]: el.value } });
        toast(el.value === '발행' ? '발행 완료로 표시했어요. 담긴 상품도 발행 완료로 바꿨어요.' : '저장했어요');
        viewBoard(id, tab);
      });
    } else {
      el.addEventListener('input', () => saveBoard(el.dataset.b, el.value));
    }
  });
  document.getElementById('delBoard').addEventListener('click', async () => {
    if (!confirm(`'${b.title}' 보드를 삭제할까요? 담은 상품도 함께 지워집니다.`)) return;
    await api(`/api/boards/${id}`, { method: 'DELETE' });
    location.hash = '#/boards';
  });

  if (tab === 'helper') await renderHelper(b);
  else renderProducts(b);
}

function renderProducts(b) {
  const id = b.id;
  const box = document.getElementById('boardTab');
  box.innerHTML = `
    <section class="section card add-box">
      <h2>상품 추가</h2>
      <form class="row" id="addForm">
        <input name="url" type="url" placeholder="상품 링크를 붙여넣으세요" style="flex:1;min-width:220px">
        <button class="btn primary" id="addBtn">링크로 추가</button>
        <button class="btn" type="button" id="manualBtn">직접 입력</button>
      </form>
      <p class="small muted" style="margin:0">상품명·브랜드·가격·썸네일을 가능한 범위에서 자동으로 채웁니다. 저장한 상품은 12시간마다 가격·품절을 다시 확인해요.
        ${b.products.some((p) => p.url) ? `<button class="btn ghost sm" id="checkNow">지금 가격 확인</button>` : ''}</p>
    </section>
    <section class="section grid">
      ${b.products.length ? b.products.map(productCard).join('') : '<div class="card empty">아직 담은 상품이 없어요.</div>'}
    </section>`;

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
    viewBoard(id, 'products');
  });
  document.getElementById('manualBtn').addEventListener('click', async () => {
    await api(`/api/boards/${id}/products`, { method: 'POST', body: { name: '새 상품' } });
    viewBoard(id, 'products');
  });
  document.getElementById('checkNow')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    await api('/api/alerts/check', { method: 'POST', body: { boardId: id } });
    toast('가격을 확인하고 있어요. 상품마다 몇 초씩 걸려요.');
    setTimeout(() => viewBoard(id, 'products'), Math.min(30000, 2000 + b.products.length * 5500));
  });

  box.querySelectorAll('[data-p]').forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => saveProduct(id, el.closest('[data-pid]').dataset.pid, el.dataset.p, el.value, el.tagName === 'SELECT'));
  });
  box.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('이 상품을 보드에서 뺄까요?')) return;
    await api(`/api/boards/${id}/products/${el.dataset.del}`, { method: 'DELETE' });
    viewBoard(id, 'products');
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
    if (immediate) viewBoard(boardId, 'products');
  }, immediate ? 0 : 500);
}

function priceTrend(p) {
  const h = p.priceHistory || [];
  if (h.length < 2) return '';
  const first = h[0][1], last = h[h.length - 1][1];
  if (!first || !last || first === last) return '';
  return `<span class="small ${last < first ? 'tag-sale' : 'muted'}"> · 처음 ${won(first)}에서 ${last < first ? '▼' : '▲'}</span>`;
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
        ${p.priceCheckedAt ? `<span class="small muted"> · ${esc(p.priceCheckedAt)} 기준</span>` : ''}${priceTrend(p)}</div>
      ${p.lastCheckError ? `<div class="small muted">마지막 자동 확인 실패: ${esc(p.lastCheckError)}</div>` : ''}
      <div class="fields">
        <label class="field">상태<select data-p="status">${opt(STATUSES, p.status)}</select></label>
        <label class="field">상품 유형<select data-p="type">${opt(TYPES, p.type)}</select></label>
        <label class="field">판매가(원)<input type="number" min="0" data-p="price" value="${p.price ?? ''}"></label>
        <label class="field">사이즈<input data-p="size" value="${esc(p.size)}" placeholder="예: M (평소 55)"></label>
        <label class="field wide">코디 아이디어<input data-p="coordi" value="${esc(p.coordi)}" placeholder="예: 와이드 슬랙스 + 로퍼"></label>
      </div>
      <details class="more"><summary>상품 정보 더 보기·수정</summary>
        <div class="fields">
          <label class="field wide">상품명<input data-p="name" value="${esc(p.name)}"></label>
          <label class="field">브랜드<input data-p="brand" value="${esc(p.brand)}"></label>
          <label class="field">정가(원)<input type="number" min="0" data-p="originalPrice" value="${p.originalPrice ?? ''}"></label>
          <label class="field wide">착용감<input data-p="fit" value="${esc(p.fit)}" placeholder="예: 어깨 여유, 소매 길이 적당"></label>
          <label class="field wide">메모<textarea data-p="memo">${esc(p.memo)}</textarea></label>
          <label class="field wide">링크<input data-p="url" value="${esc(p.url)}"></label>
        </div>
      </details>
    </div>
  </article>`;
}

// ---- 글쓰기 도우미 ----
async function renderHelper(b) {
  const box = document.getElementById('boardTab');
  if (!b.products.length) {
    box.innerHTML = `<div class="card empty section">상품을 먼저 담으면 상품 정보 표와 체크리스트를 만들어 드려요.</div>`;
  }
  const selected = new Set(b.products.map((p) => p.id));
  const picked = new Set();

  const draw = async () => {
    const h = await api(`/api/boards/${b.id}/helper?products=${[...selected].join(',')}`);
    box.innerHTML = `
      <section class="section card">
        <div class="section-head"><h2>상품 정보 표</h2>
          <span class="row"><button class="btn sm" id="copyTextTable">텍스트로 복사</button><button class="btn primary sm" id="copyTable">표 복사</button></span></div>
        <p class="small muted">'표 복사' 후 네이버 블로그 에디터에 붙여넣으면 표로 들어가요. 넣을 상품을 고르세요.</p>
        <div class="row" style="margin-bottom:10px">${b.products.map((p) => `<label class="chip-btn ${selected.has(p.id) ? 'on' : ''}"><input type="checkbox" data-sel="${p.id}" ${selected.has(p.id) ? 'checked' : ''} hidden>${esc(p.name || '이름 없음')}</label>`).join('')}</div>
        <div class="table-preview">${h.table.html}</div>
      </section>

      <div class="grid grid-2 section">
        <section class="card">
          <h2>제목 후보</h2>
          <ul class="plain">${h.titles.map((t) => `<li class="row"><span class="spacer">${esc(t)}</span><button class="btn ghost sm" data-copy="${esc(t)}">복사</button></li>`).join('')}</ul>
        </section>
        <section class="card">
          <div class="section-head"><h2>태그 후보</h2><button class="btn sm" id="copyTags">고른 태그 복사</button></div>
          <p class="small muted" style="margin-top:0">눌러서 고르세요. 아무것도 안 고르면 전부 복사해요.</p>
          <div class="row">${h.tags.map((t) => `<button class="chip-btn ${picked.has(t) ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
        </section>
      </div>

      <section class="section card">
        <div class="section-head"><h2>발행 전 체크리스트</h2>${h.checklist.done ? '<span class="chip up">모두 확인</span>' : ''}</div>
        ${h.checklist.warnings.map((w) => `<p class="chip down" style="margin:0 0 8px">${esc(w)}</p>`).join('')}
        <ul class="checklist">${h.checklist.items.map((i) => `<li class="${i.important ? 'important' : ''}">
          <label class="row"><input type="checkbox" data-check="${i.key}" ${i.checked ? 'checked' : ''} style="width:auto"> <b>${esc(i.label)}</b></label>
          ${i.detail ? `<div class="small muted">${esc(i.detail)}</div>` : ''}
          ${i.template ? `<div class="template"><pre>${esc(i.template)}</pre><button class="btn sm" data-copy="${esc(i.template)}">문구 복사</button></div>` : ''}
        </li>`).join('')}</ul>
        <p class="small muted">광고 표시는 법적 판단이 아닌 체크용 안내예요. 최신 기준(공정위 추천·보증 심사지침)은 직접 확인하세요.</p>
        <div class="row">${b.postStatus === '발행'
          ? `<span class="chip up">발행 완료</span>${b.publishedUrl ? `<a class="btn ghost sm" href="${esc(b.publishedUrl)}" target="_blank" rel="noopener noreferrer">발행한 글 ↗</a>` : ''}`
          : `<button class="btn primary" id="publish">발행 완료로 표시</button>`}</div>
      </section>`;

    box.querySelectorAll('[data-sel]').forEach((el) => el.addEventListener('change', () => {
      el.checked ? selected.add(el.dataset.sel) : selected.delete(el.dataset.sel);
      draw();
    }));
    box.querySelectorAll('[data-copy]').forEach((el) => el.addEventListener('click', () => copyText(el.dataset.copy)));
    box.querySelector('#copyTable').addEventListener('click', () => copyText(h.table.text, h.table.html));
    box.querySelector('#copyTextTable').addEventListener('click', () => copyText(h.table.text));
    box.querySelectorAll('[data-tag]').forEach((el) => el.addEventListener('click', () => {
      picked.has(el.dataset.tag) ? picked.delete(el.dataset.tag) : picked.add(el.dataset.tag);
      el.classList.toggle('on');
    }));
    box.querySelector('#copyTags').addEventListener('click', () => copyText((picked.size ? [...picked] : h.tags).map((t) => '#' + t).join(' ')));
    box.querySelectorAll('[data-check]').forEach((el) => el.addEventListener('change', async () => {
      await api(`/api/boards/${b.id}`, { method: 'PUT', body: { checklist: { [el.dataset.check]: el.checked } } });
      b.checklist = { ...(b.checklist || {}), [el.dataset.check]: el.checked };
      draw();
    }));
    box.querySelector('#publish')?.addEventListener('click', async () => {
      if (!h.checklist.done && !confirm('체크리스트에 확인하지 않은 항목이 있어요. 그래도 발행 완료로 표시할까요?')) return;
      const r = await dialog('발행 완료로 표시', [{ name: 'publishedUrl', label: '발행한 글 주소 (선택)', value: '' }], { submit: '발행 완료' });
      if (!r) return;
      await api(`/api/boards/${b.id}`, { method: 'PUT', body: { postStatus: '발행', publishedUrl: r.publishedUrl } });
      toast('발행 완료! 성과 기록에서 조회수와 검색 순위를 볼 수 있어요.');
      viewBoard(b.id, 'helper');
    });
  };
  if (b.products.length) await draw();
}
