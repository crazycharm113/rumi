// 주제 더 보기: 브리핑의 상위 6개 다음(7위~)의 키워드를 같은 카드로 12개씩 이어서 봅니다.
// 연령대·아이템 종류·키워드 검색으로 좁힐 수 있어요.
const exploreUI = { age: 'all', cat: '', q: '' };
let exploreOffset = 0;

views.explore = async () => {
  $app.innerHTML = `
    <h1>주제 더 보기</h1>
    <p class="lede">브리핑에 나오는 상위 6개 말고, 요즘 오르는 다른 키워드의 주제도 같은 기준으로 볼 수 있어요.</p>
    <div id="exploreMeta"></div>
    <section class="section card filters">
      <div class="row"><span class="small muted filter-label">연령</span><span id="exploreAges"></span></div>
      <div class="row"><span class="small muted filter-label">종류</span><span id="exploreCats"></span></div>
      <div class="row"><span class="small muted filter-label">검색</span>
        <input id="exploreQ" placeholder="키워드 (예: 코트)" value="${esc(exploreUI.q)}" style="max-width:240px">
        <span class="small muted" id="exploreCount"></span></div>
    </section>
    <div class="grid grid-3 section" id="exploreGrid"></div>
    <div class="row section" style="justify-content:center"><button class="btn" id="exploreMore" hidden>더 보기</button></div>`;
  document.getElementById('exploreQ').addEventListener('input', debounce((e) => { exploreUI.q = e.target.value.trim(); exploreReload(); }, 400));
  exploreReload();
};

async function exploreReload() {
  exploreOffset = 0;
  document.getElementById('exploreGrid').innerHTML = '<div class="skeleton" style="grid-column:1/-1">주제를 고르는 중… (처음 볼 때는 몇 초 걸려요)</div>';
  await exploreLoad(false);
}

async function exploreLoad(append) {
  const grid = document.getElementById('exploreGrid');
  const more = document.getElementById('exploreMore');
  more.disabled = true;
  try {
    const qs = `age=${exploreUI.age}&cat=${encodeURIComponent(exploreUI.cat)}&q=${encodeURIComponent(exploreUI.q)}&offset=${exploreOffset}&limit=12`;
    const r = await api(`/api/topics/more?${qs}`);
    if (!document.getElementById('exploreGrid')) return; // 다른 화면으로 이동함
    if (!append) grid.innerHTML = '';
    grid.insertAdjacentHTML('beforeend', r.topics.map((t) => topicCard(t, t.rank - 1)).join('')
      || (append ? '' : '<div class="card empty" style="grid-column:1/-1">조건에 맞는 주제가 없어요.</div>'));
    exploreOffset = r.offset + r.topics.length;
    more.hidden = !r.hasMore;
    more.disabled = false;
    more.textContent = `더 보기 (${r.total - exploreOffset}개 남음)`;
    document.getElementById('exploreCount').textContent = `${r.total}개 중 ${exploreOffset}개 보는 중`;
    document.getElementById('exploreMeta').innerHTML = r.demo ? dataBanner({ demo: true }, '키워드 데이터') : '';
    document.getElementById('exploreAges').innerHTML = TOPIC_AGES.map(([v, l]) => `<button class="chip-btn ${exploreUI.age === v ? 'on' : ''}" data-eage="${v}">${l}</button>`).join(' ');
    document.getElementById('exploreCats').innerHTML = [`<button class="chip-btn ${!exploreUI.cat ? 'on' : ''}" data-ecat="">전체 ${r.allCount}</button>`,
      ...r.categories.map((c) => `<button class="chip-btn ${exploreUI.cat === c.name ? 'on' : ''}" data-ecat="${esc(c.name)}">${esc(c.name)} ${c.count}</button>`)].join(' ');
    document.querySelectorAll('[data-eage]').forEach((b) => b.onclick = () => { exploreUI.age = b.dataset.eage; exploreReload(); });
    document.querySelectorAll('[data-ecat]').forEach((b) => b.onclick = () => { exploreUI.cat = b.dataset.ecat; exploreReload(); });
    more.onclick = () => exploreLoad(true);
  } catch (err) {
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">주제를 가져오지 못했어요: ${esc(err.message)}</div>`;
    more.hidden = true;
  }
}
