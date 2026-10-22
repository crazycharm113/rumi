// 공통 도우미와 라우터. 화면마다 views[이름] = async (parts, params) => {...} 로 등록합니다.
const $app = document.getElementById('app');
const views = {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n == null ? '' : n.toLocaleString('ko-KR') + '원');
const num = (n) => (n == null ? '–' : n.toLocaleString('ko-KR'));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const timeText = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const mmdd = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');

// 한국 시간 기준 날짜
function kstDate(offset = 0) {
  return new Date(Date.now() + 9 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
}

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
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function copyText(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast('복사했어요');
  } catch {
    // 클립보드 권한이 없으면 직접 복사할 수 있게 보여줍니다.
    prompt('아래 내용을 복사하세요 (Ctrl+C)', text);
  }
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

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// 간단한 입력 창. fields: [{name,label,type,value,options}] → 입력값 객체 또는 null(취소)
function dialog(title, fields, { submit = '저장', extra = '' } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<form method="dialog" class="grid">
      <h2>${esc(title)}</h2>
      ${fields.map((f) => `<label class="field">${esc(f.label)}${f.options
        ? `<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''}>`}</label>`).join('')}
      ${extra}
      <div class="row"><span class="spacer"></span><button class="btn" value="cancel" formnovalidate>취소</button><button class="btn primary" value="ok">${esc(submit)}</button></div>
    </form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const action = d.returnValue;
      const data = Object.fromEntries(new FormData(d.querySelector('form')).entries());
      d.remove();
      // 저장은 입력값, 취소는 null, 그 밖의 버튼(예: 삭제)은 { _action } 으로 돌려줍니다.
      resolve(action === 'ok' ? data : !action || action === 'cancel' ? null : { _action: action });
    });
    d.showModal();
  });
}

async function makeBoard(keyword, title, extra = {}) {
  const board = await api('/api/boards', { method: 'POST', body: { keyword, title, ...extra } });
  toast('상품 보드를 만들었어요');
  location.hash = `#/boards/${board.id}`;
}

// 주제를 캘린더에 올리기: 날짜를 고르면 발행 예정일이 정해진 보드를 만듭니다.
async function scheduleTopic(keyword, title, date) {
  const r = await dialog('캘린더에 올리기', [
    { name: 'title', label: '글 제목', value: title, required: true },
    { name: 'plannedDate', label: '발행 예정일', type: 'date', value: date || kstDate(1), required: true },
  ], { submit: '올리기' });
  if (!r) return;
  await api('/api/boards', { method: 'POST', body: { keyword, title: r.title, plannedDate: r.plannedDate } });
  toast(`${mmdd(r.plannedDate)}에 올렸어요`);
  route();
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

async function refreshAll() {
  loading('새 데이터를 가져오는 중… (키워드가 많으면 몇십 초 걸릴 수 있어요)');
  try {
    await api('/api/refresh', { method: 'POST' });
  } catch (e) { toast(e.message); }
  route();
}

async function updateBell() {
  try {
    const { alerts } = await api('/api/alerts');
    const n = alerts.filter((a) => !a.read).length;
    const b = document.getElementById('bellCount');
    b.textContent = n;
    b.hidden = n === 0;
  } catch { /* 무시 */ }
}

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = (path || '/').split('/').filter(Boolean);
  const tab = parts[0] || 'home';
  document.querySelectorAll('.tabs a, .bell').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    await (views[tab] || views.home)(parts, params);
  } catch (err) {
    errorView(err);
  }
  updateBell();
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
