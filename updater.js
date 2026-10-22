// 자동 업데이트: 실행할 때 GitHub의 최신 버전을 확인하고, 새 버전이 있으면 받아서 덮어씁니다.
// data 폴더(내 보드·키)와 .env, 실행 파일(실행하기.bat/.command)은 건드리지 않습니다.
// 인터넷이 안 되거나 실패해도 지금 있는 버전으로 그냥 실행됩니다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = process.env.UPDATE_REPO || 'crazycharm113/rumi';
const BRANCH = 'main';
const ROOT = __dirname;
const VERSION_FILE = path.join(ROOT, '.version');
const MANIFEST_FILE = path.join(ROOT, '.update-manifest');
// 업데이트하지 않는 경로. 실행 중인 .bat 파일을 덮어쓰면 창이 오작동할 수 있어 제외합니다.
const KEEP = [/^data\//, /^\.env$/, /^\.git\//, /^\.version$/, /^\.update-manifest$/, /^실행하기\.(bat|command)$/];

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*GITHUB_TOKEN\s*=\s*(\S+)/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch { /* .env 없음 */ }
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8')).settings?.githubToken || '';
  } catch { return ''; }
}

function headers(accept) {
  const h = { 'User-Agent': 'blog-helper-updater', Accept: accept };
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function latestSha() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers: headers('application/vnd.github.sha'), signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new Error('저장소를 찾을 수 없어요. 비공개 저장소라면 GITHUB_TOKEN이 필요해요.');
  if (res.status === 401) throw new Error('GITHUB_TOKEN이 올바르지 않아요.');
  if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`);
  return (await res.text()).trim();
}

// .tar.gz 를 풀어 [{ name, data }] 로 돌려줍니다. GitHub tarball 의 pax 헤더(긴 경로)도 처리합니다.
function untar(buf) {
  const files = [];
  let off = 0;
  let paxPath = null;
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    let name = (prefix ? prefix + '/' : '') + str(h.subarray(0, 100));
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    if (paxPath) { name = paxPath; paxPath = null; }
    if (type === '0' || type === '\0') files.push({ name, data: Buffer.from(data) });
  }
  return files;
}

async function download(sha) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/tarball/${sha}`, { headers: headers('application/vnd.github+json'), redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`내려받기 실패 (${res.status})`);
  return untar(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
}

function safeRelative(name) {
  // GitHub tarball 은 "owner-repo-sha/" 폴더 아래에 파일이 있으므로 첫 폴더를 떼어 냅니다.
  const rel = name.split('/').slice(1).join('/');
  if (!rel || rel.split('/').some((p) => p === '..' || p === '') || path.isAbsolute(rel)) return null;
  return rel;
}

function apply(files) {
  const written = [];
  for (const f of files) {
    const rel = safeRelative(f.name);
    if (!rel || KEEP.some((re) => re.test(rel))) continue;
    const dest = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
    written.push(rel);
  }
  // 지난 업데이트에는 있었는데 새 버전에서 빠진 파일은 지웁니다.
  let old = [];
  try { old = fs.readFileSync(MANIFEST_FILE, 'utf8').split('\n').filter(Boolean); } catch { /* 첫 업데이트 */ }
  const keep = new Set(written);
  for (const rel of old) {
    if (!keep.has(rel) && !KEEP.some((re) => re.test(rel))) {
      try { fs.unlinkSync(path.join(ROOT, rel)); } catch { /* 이미 없음 */ }
    }
  }
  fs.writeFileSync(MANIFEST_FILE, written.join('\n'));
  return written.length;
}

async function main() {
  if (process.env.NO_UPDATE) return;
  let current = '';
  try { current = fs.readFileSync(VERSION_FILE, 'utf8').trim(); } catch { /* 처음 */ }
  try {
    const sha = await latestSha();
    if (sha === current) {
      console.log('최신 버전이에요.');
      return;
    }
    console.log('새 버전을 받는 중이에요…');
    const n = apply(await download(sha));
    fs.writeFileSync(VERSION_FILE, sha);
    console.log(`업데이트 완료 (${n}개 파일, ${sha.slice(0, 7)})`);
  } catch (err) {
    console.log(`업데이트 확인을 건너뛰어요: ${err.message}`);
  }
}

if (require.main === module) main();

module.exports.main = main;

Object.assign(module.exports, { untar, safeRelative, apply, KEEP });
