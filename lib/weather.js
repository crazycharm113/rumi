// 기상청 단기예보 (공공데이터포털 VilageFcstInfoService_2.0)
const { REGIONS, clothingFor } = require('./catalog');
const { kstDate, kstHour } = require('./store');

// 위경도 → 기상청 격자(nx, ny). 기상청이 공개한 람베르트 정각원추도법 변환식입니다.
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEG = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEG, slat2 = SLAT2 * DEG, olon = OLON * DEG, olat = OLAT * DEG;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEG * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEG - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// 02시 발표분에 오늘 최저·최고기온이 들어 있습니다. 발표 직후(02:10 전)에는 전날 23시 발표분을 씁니다.
function baseDateTime(now = new Date()) {
  const h = kstHour(now);
  const m = new Date(now.getTime() + 9 * 3600e3).getUTCMinutes();
  if (h > 2 || (h === 2 && m >= 15)) return { base_date: kstDate(0, now).replace(/-/g, ''), base_time: '0200' };
  return { base_date: kstDate(-1, now).replace(/-/g, ''), base_time: '2300' };
}

function summarize(items) {
  const byDate = {};
  for (const it of items) {
    const d = `${it.fcstDate.slice(0, 4)}-${it.fcstDate.slice(4, 6)}-${it.fcstDate.slice(6, 8)}`;
    const day = (byDate[d] ||= { tmps: [], pop: 0 });
    const v = Number(it.fcstValue);
    if (it.category === 'TMP') day.tmps.push(v);
    if (it.category === 'TMN') day.tmn = v;
    if (it.category === 'TMX') day.tmx = v;
    if (it.category === 'POP') day.pop = Math.max(day.pop, v);
    if (it.fcstTime === '1200' && it.category === 'SKY') day.sky = v;
    if (it.fcstTime === '1200' && it.category === 'PTY') day.pty = v;
  }
  const out = {};
  for (const [d, day] of Object.entries(byDate)) {
    const tmn = day.tmn ?? (day.tmps.length ? Math.min(...day.tmps) : null);
    const tmx = day.tmx ?? (day.tmps.length ? Math.max(...day.tmps) : null);
    if (tmn == null || tmx == null) continue;
    out[d] = { tmn, tmx, avg: Math.round(((tmn + tmx) / 2) * 10) / 10, pop: day.pop, sky: skyText(day.sky, day.pty) };
  }
  return out;
}

function skyText(sky, pty) {
  if (pty === 1 || pty === 4) return '비';
  if (pty === 2) return '비/눈';
  if (pty === 3) return '눈';
  if (sky === 1) return '맑음';
  if (sky === 3) return '구름 많음';
  if (sky === 4) return '흐림';
  return '';
}

async function fetchForecast(serviceKey, region) {
  const [lat, lon] = REGIONS[region] || REGIONS['서울'];
  const { nx, ny } = toGrid(lat, lon);
  const { base_date, base_time } = baseDateTime();
  // 공공데이터포털은 '인코딩 키'와 '디코딩 키'를 함께 줍니다. 이미 인코딩된 키는 다시 인코딩하지 않습니다.
  const key = serviceKey.includes('%') ? serviceKey : encodeURIComponent(serviceKey);
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${key}` +
    `&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('기상청 응답을 읽을 수 없습니다. 서비스 키를 확인하세요.'); }
  const header = json.response?.header;
  if (header?.resultCode !== '00') throw new Error(`기상청 오류: ${header?.resultMsg || res.status}`);
  return summarize(json.response.body.items.item);
}

// 키가 없을 때 쓰는 예시 날씨 (월별 서울 평년 기온 근처)
function demoForecast() {
  const normals = [[-6, 2], [-4, 5], [1, 11], [7, 18], [13, 23], [18, 27], [22, 29], [22, 30], [17, 26], [10, 20], [3, 12], [-3, 4]];
  const out = {};
  for (let i = -1; i <= 2; i++) {
    const d = kstDate(i);
    const [lo, hi] = normals[Number(d.slice(5, 7)) - 1];
    const drift = i === 1 ? -3 : i === 2 ? -4 : 0;
    out[d] = { tmn: lo + drift, tmx: hi + drift, avg: (lo + hi) / 2 + drift, pop: i === 1 ? 60 : 10, sky: i === 1 ? '흐림' : '맑음' };
  }
  return out;
}

// 브리핑에 쓰는 형태로 정리: 오늘 기온, 어제·내일과의 차이, 기온에 맞는 옷
function buildWeather(days, history) {
  const today = kstDate();
  const t = days[today];
  if (!t) return null;
  const yesterday = history[kstDate(-1)] || days[kstDate(-1)];
  const tomorrow = days[kstDate(1)];
  const clothing = clothingFor(t.avg);
  // 앞으로 사흘 중 기온이 크게(4도 이상) 떨어지는 날이 있으면 미리 알려줍니다.
  let drop = null;
  for (let i = 1; i <= 2; i++) {
    const d = days[kstDate(i)];
    if (d && t.avg - d.avg >= 4) { drop = { date: kstDate(i), avg: d.avg, diff: Math.round((d.avg - t.avg) * 10) / 10, clothing: clothingFor(d.avg) }; break; }
  }
  return {
    today: t,
    diffYesterday: yesterday ? Math.round((t.avg - yesterday.avg) * 10) / 10 : null,
    diffTomorrow: tomorrow ? Math.round((tomorrow.avg - t.avg) * 10) / 10 : null,
    clothing,
    drop,
  };
}

module.exports = { toGrid, baseDateTime, summarize, fetchForecast, demoForecast, buildWeather };
