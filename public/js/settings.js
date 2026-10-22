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
        <h2>관심 브랜드</h2>
        <p class="small muted" style="margin:0">한 줄에 하나씩. 네이버 쇼핑 검색으로 하루 한 번 할인·신상을 모아요(최대 20개). 예: 탑텐, 무신사 스탠다드, 자라</p>
        <textarea name="brands" rows="4" placeholder="탑텐&#10;무신사 스탠다드&#10;자라">${esc(s.brands.join('\n'))}</textarea>
      </section>

      <section class="card grid">
        <h2>내 블로그</h2>
        <p class="small muted" style="margin:0">네이버 블로그 아이디나 주소(blog.naver.com/아이디)를 넣으면 성과 기록에서 글 목록을 RSS로 자동으로 가져와요. 비밀번호는 받지 않아요.</p>
        <label class="field">블로그 아이디<input name="blogId" value="${esc(s.blogId)}" placeholder="예: myfashionlog"></label>
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
    body.brands = body.brands.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    try {
      await api('/api/settings', { method: 'PUT', body });
      await api('/api/refresh', { method: 'POST' });
      toast('저장했어요. 오늘 데이터를 새로 가져옵니다.');
      route();
    } catch (err) { toast(err.message); }
  });
};

