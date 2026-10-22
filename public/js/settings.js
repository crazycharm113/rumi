// 설정: 지역·연령대·API 키·관심 브랜드·블로그·키워드
views.settings = async () => {
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
        <div class="small muted" style="margin:0">
          <p style="margin:0 0 6px"><b>2026년 7월 31일부터 새 키는 NAVER API HUB에서 받아요.</b> 네이버 개발자센터에서는 더 이상 새로 신청할 수 없어요.</p>
          <ol style="margin:0;padding-left:18px">
            <li>네이버 클라우드 플랫폼(ncloud.com)에 가입·로그인</li>
            <li>콘솔에서 <b>NAVER API HUB</b> 이용 신청 → Application 등록</li>
            <li>사용할 API로 <b>Search Trend(검색어 트렌드)</b>, <b>검색 - 블로그</b>, <b>Shopping Insight(쇼핑인사이트)</b>를 선택</li>
            <li>발급된 Client ID와 Client Secret을 아래에 붙여넣기</li>
          </ol>
        </div>
        <label class="field">키 종류<select name="naverKeyType">
          <option value="hub" ${s.naverKeyType !== 'legacy' ? 'selected' : ''}>NAVER API HUB 키 (새로 받는 키)</option>
          <option value="legacy" ${s.naverKeyType === 'legacy' ? 'selected' : ''}>개발자센터 기존 키 (2026년 7월 이전 발급분)</option>
        </select></label>
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
        <h2>관심 브랜드</h2>
        <p class="small muted" style="margin:0">한 줄에 하나씩. 블로그 검색으로 하루 한 번 '브랜드 + 세일/신상' 최근 글을 모아요(최대 20개). 예: 탑텐, 무신사 스탠다드, 자라</p>
        <textarea name="brands" rows="4" placeholder="탑텐&#10;무신사 스탠다드&#10;자라">${esc(s.brands.join('\n'))}</textarea>
      </section>

      <section class="card grid">
        <h2>내 블로그</h2>
        <p class="small muted" style="margin:0">네이버 블로그 아이디나 주소(blog.naver.com/아이디)를 넣으면 성과 기록에서 글 목록을 RSS로 자동으로 가져와요. 비밀번호는 받지 않아요.</p>
        <label class="field">블로그 아이디<input name="blogId" value="${esc(s.blogId)}" placeholder="예: myfashionlog"></label>
      </section>

      <section class="card grid">
        <h2>지켜볼 키워드</h2>
        <p class="small muted" style="margin:0">한 줄에 하나씩. 검색어 트렌드는 키워드 4개당 1번씩 부르고, 하루 한 번 저장해 두고 재사용해요.</p>
        <textarea name="keywords" rows="10">${esc(s.keywords.join('\n'))}</textarea>
      </section>

      <section class="card grid">
        <h2>자동 업데이트</h2>
        <p class="small muted" style="margin:0">프로그램을 켤 때마다 GitHub에서 새 버전을 확인해 자동으로 받아요. 저장소가 비공개라면 읽기 권한 토큰이 필요해요(공개 저장소면 비워 두세요).</p>
        <label class="field">GitHub 토큰 (선택)<input name="githubToken" type="password" value="${esc(s.githubToken)}" autocomplete="off" placeholder="github_pat_..."></label>
      </section>

      <section class="card grid" id="backupBox">
        <h2>백업</h2>
        <p class="small muted" style="margin:0">하루 한 번 자동으로 백업해 최근 7일 치를 <code>data\\backup</code> 폴더에 보관해요. 다른 PC로 옮길 때는 내보낸 파일을 그 PC에서 가져오면 돼요. 내보낸 파일에는 API 키도 들어 있으니 공개된 곳에 올리지 마세요.</p>
        <div class="row">
          <button class="btn" type="button" onclick="exportData()">내보내기 (파일 저장)</button>
          <label class="btn" style="cursor:pointer">가져오기<input type="file" accept=".json,application/json" hidden onchange="importData(this.files[0])"></label>
          <button class="btn ghost" type="button" onclick="backupNow()">지금 백업</button>
        </div>
        <div id="backupList" class="small muted">백업 목록을 불러오는 중…</div>
      </section>

      <div class="row">
        <button class="btn primary">저장</button>
        <button class="btn" type="button" onclick="refreshAll()">저장한 데이터 비우고 새로 가져오기</button>
        <span class="spacer"></span>
        <button class="btn danger" type="button" onclick="shutdownApp()">프로그램 끄기</button>
      </div>
    </form>`;

  renderBackups();
  document.getElementById('sForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    body.keywords = body.keywords.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    body.brands = body.brands.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    try {
      await api('/api/settings', { method: 'PUT', body });
      await api('/api/refresh', { method: 'POST' });
      toast('저장했어요. 오늘 데이터를 새로 가져옵니다.');
      route();
    } catch (err) { toast(err.message); }
  });
};


async function shutdownApp() {
  if (!confirm('블로그 작업대를 끌까요? 다시 쓰려면 "블로그 작업대.vbs"를 실행하세요.')) return;
  await api('/api/shutdown', { method: 'POST' }).catch(() => {});
  $app.innerHTML = '<h1>프로그램을 껐어요</h1><div class="card"><p>이 창을 닫아도 돼요. 다시 쓰려면 폴더의 <b>블로그 작업대.vbs</b>를 실행하세요.</p></div>';
}

async function renderBackups() {
  const box = document.getElementById('backupList');
  if (!box) return;
  const { backups } = await api('/api/backups');
  box.innerHTML = backups.length
    ? `<ul class="plain">${backups.map((b) => `<li class="row"><span class="spacer">${esc(b.date)} 백업 <span class="muted">(${Math.round(b.size / 1024)}KB)</span></span>
        <button class="btn ghost sm" type="button" data-restore="${esc(b.name)}">이걸로 되돌리기</button></li>`).join('')}</ul>`
    : '아직 백업이 없어요.';
  box.querySelectorAll('[data-restore]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm(`${el.dataset.restore.slice(3, 13)} 백업으로 되돌릴까요? 지금 데이터는 오늘 날짜로 먼저 백업해 둬요.`)) return;
    await api(`/api/backups/${el.dataset.restore}/restore`, { method: 'POST' });
    toast('되돌렸어요');
    route();
  }));
}

async function backupNow() {
  await api('/api/backups', { method: 'POST' });
  toast('백업했어요');
  renderBackups();
}

async function exportData() {
  const data = await api('/api/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `blog-helper-backup-${kstDate()}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('읽을 수 없는 파일이에요.'); }
  if (!confirm('이 파일의 데이터로 바꿀까요? 지금 데이터는 오늘 날짜로 먼저 백업해 둬요.')) return;
  try {
    await api('/api/import', { method: 'POST', body: data });
    toast('가져왔어요');
    route();
  } catch (err) { toast(err.message); }
}
