// 관점방 리플레이 — BTC 심리차트(고정 과거 시세 2022-01 ~ 2024-12-06) 위에 관점방 글 읽기 + 매매 리플레이 (빌드 없음)
// 원본: smoothcrush808-cmd/BTC 의 app.js — 그리기·북마크·와이드는 그대로, 시세는 data/klines/ 월 파일로 바꿨다
(() => {
'use strict';

const LWC = window.LightweightCharts;

// ───────────────────────── 와이드 (화면 90° 회전)
// iPhone 사파리는 화면 방향 고정 API가 없어서 CSS로 돌린다. 돌린 화면에선 터치 좌표가 어긋나므로
// 와이드일 때만 clientX/Y·pageX/Y·getBoundingClientRect를 '돌린 화면 기준'으로 바꿔 돌려준다.
// 화면 (sx, sy) ↔ 돌린 화면 (ux, uy):  ux = sy,  uy = W − sx   (W = 실제 화면 폭)
const wide = (() => {
  const html = document.documentElement;
  const root = document.getElementById('root');
  let on = false;
  const W = () => window.innerWidth;
  const active = () => on;

  for (const proto of [window.MouseEvent && MouseEvent.prototype, window.Touch && Touch.prototype]) {
    if (!proto) continue;
    const d = name => {
      for (let o = proto; o; o = Object.getPrototypeOf(o)) {
        const desc = Object.getOwnPropertyDescriptor(o, name);
        if (desc && desc.get) return desc.get;
      }
      return null;
    };
    const g = { cx: d('clientX'), cy: d('clientY'), px: d('pageX'), py: d('pageY') };
    if (!g.cx || !g.cy || !g.px || !g.py) continue;
    Object.defineProperties(proto, {
      clientX: { configurable: true, get() { return active() ? g.cy.call(this) : g.cx.call(this); } },
      clientY: { configurable: true, get() { return active() ? W() - g.cx.call(this) : g.cy.call(this); } },
      pageX: { configurable: true, get() { return active() ? g.py.call(this) : g.px.call(this); } },
      pageY: { configurable: true, get() { return active() ? W() - g.px.call(this) : g.py.call(this); } },
    });
  }
  const origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = origRect.call(this);
    if (!active() || !root || !root.contains(this)) return r;
    return new DOMRect(r.top, W() - r.right, r.height, r.width);
  };
  // 사파리는 캔버스 해상도를 getClientRects로 정한다 → 돌린 화면에선 폭·높이가 뒤바뀌어 축 글씨가 뭉개짐
  const origRects = Element.prototype.getClientRects;
  Element.prototype.getClientRects = function () {
    const list = origRects.call(this);
    if (!active() || !root || !root.contains(this)) return list;
    return Array.from(list, r => new DOMRect(r.top, W() - r.right, r.height, r.width));
  };

  function apply(want) {
    // 폰을 실제로 가로로 돌렸으면 이중 회전이 되므로 끈다 (옛 index.html이면 #root가 없어 못 켬)
    on = !!want && !!root && window.innerWidth < window.innerHeight && window.innerWidth <= 720;
    html.style.setProperty('--vw', window.innerWidth + 'px');
    html.style.setProperty('--vh', window.innerHeight + 'px');
    html.classList.toggle('wide', on);
    const b = document.getElementById('wideBtn');
    if (b) b.classList.toggle('on', !!want);
  }
  return { apply, isOn: () => on };
})();
const SYMBOL = 'BTCUSDT';
const KST = 9 * 3600;            // 차트 시각은 KST로 밀어서 넣는다 (눈금이 KST 자정에 맞도록)
const EDGE = 150;                // 가장자리에서 이 정도 봉 남으면 옆 달 파일을 붙인다
// 원본(BTC 심리차트)과 같은 github.io 주소라 localStorage를 같이 쓴다 → 키 이름을 달리해 서로 덮어쓰지 않게
const STORE_KEY = 'nine9Replay.drawings.v1';
const PREF_KEY = 'nine9Replay.prefs.v1';
const BM_KEY = 'nine9Replay.bookmarks.v1';
const ANS_KEY = 'nine9Replay.answers.v1';   // 리플레이 답 (02_차트_작업지시 §1-6)
const KEY_KEY = 'nine9Replay.key.v1';       // 「이 기기에서 기억」을 고른 경우의 복호화 키
const LOCAL_KEY = 'nine9Replay.vault.v1';   // B안: 가져오기로 넣은 posts·trades

const IVS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };
const IV_LABEL = { '1m': '1분', '5m': '5분', '15m': '15분', '1h': '1시간' };
const WIN = { '1m': 3, '5m': 12, '15m': 40, '1h': 40 }; // 메모리에 둘 달 수 (1분봉은 보이는 달 ±1)
const KDIR = 'data/klines/';

const C = {
  bg: '#0a0e14', grid: 'rgba(36,52,71,0.45)', border: '#243447', text: '#8a9ab0',
  up: '#26e0a5', down: '#ff5572', btc: '#f7931a',
  hline: '#f7931a', ray: '#33d4ff', dot: '#ffcc33',
  box: '#7a93ad', boxFill: 'rgba(122,147,173,0.14)',
  erase: '#ff5572', jump: 'rgba(247,147,26,0.7)',
  stop: '#ff8a3d', risk0: '#33d4ff', reduce: '#ffcc33', exit: '#e6edf3', mine: '#c77dff', now: '#f7931a',
};

const $ = id => document.getElementById(id);

// ───────────────────────── 저장소 (localStorage는 실패할 수 있음)
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

// ───────────────────────── 시각 표시 (차트 시각은 이미 +9h 되어 있어 UTC 게터로 읽는다)
const pad = n => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function fmtChartTime(t, withWeekday = true) {
  const d = new Date(t * 1000);
  const s = `${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  return `${s}${withWeekday ? `(${WD[d.getUTCDay()]})` : ''} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function tickFmt(t, type) {
  const d = new Date(t * 1000);
  switch (type) {
    case 0: return String(d.getUTCFullYear());
    case 1: return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}`;
    case 2: return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
    default: return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}
const fmtPrice = p => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// 가격축은 소수점 없이 (축 폭을 줄인다)
const fmtAxis = p => Math.round(p).toLocaleString('en-US');
const msToChart = ms => Math.floor(ms / 1000) + KST;
const chartToMs = t => (t - KST) * 1000;
const fmtUtc = (t, wd = true) => fmtChartTime(t + KST, wd);   // 데이터 파일의 UTC 초 → KST 표시
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDur(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.round(sec / 60), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return (d ? `${d}일 ` : '') + (d || h ? `${h}시간 ` : '') + `${mm}분`;
}
const fmtPct = (v, sign = true) => (Number.isFinite(v) ? `${sign && v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—');

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timeout(${timeoutMs / 1000}s)` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── 시세 — 고정 월 파일 (tools/build_klines.py가 만든 data/klines/)
// 봉마다 int32 LE 5개(20바이트): t(분 단위 UTC epoch) · o·h·l·c(×price_scale). 파일은 KST 달 단위.
const klines = (() => {
  let index = null;
  const memo = new Map(); // 'iv/YYYY-MM' → Promise<bars> (간격별로 최근 WIN+1 달만)

  async function init() {
    index = await fetchJson(KDIR + 'index.json');
    if (!index || !index.intervals) throw new Error('index.json 형식이 다릅니다');
    return index;
  }
  const months = iv => (index && index.intervals[iv] && index.intervals[iv].months) || [];

  function parse(buf) {
    const dv = new DataView(buf), n = Math.floor(buf.byteLength / 20);
    const sc = (index.format && index.format.price_scale) || 100;
    const out = new Array(n);
    for (let i = 0, o = 0; i < n; i++, o += 20) {
      out[i] = {
        time: dv.getInt32(o, true) * 60 + KST,
        open: dv.getInt32(o + 4, true) / sc, high: dv.getInt32(o + 8, true) / sc,
        low: dv.getInt32(o + 12, true) / sc, close: dv.getInt32(o + 16, true) / sc,
      };
    }
    return out;
  }

  function load(iv, ym) {
    const k = `${iv}/${ym}`;
    if (memo.has(k)) { const p = memo.get(k); memo.delete(k); memo.set(k, p); return p; }
    const p = fetch(`${KDIR}${iv}/${ym}.bin?b=${encodeURIComponent(index.built || '')}`).then(async r => {
      if (!r.ok) throw new Error(`${iv}/${ym}.bin HTTP ${r.status}`);
      return parse(await r.arrayBuffer());
    });
    memo.set(k, p);
    p.catch(() => memo.delete(k));
    const same = [...memo.keys()].filter(x => x.startsWith(iv + '/'));
    while (same.length > WIN[iv] + 1) memo.delete(same.shift());
    return p;
  }

  return {
    init, months, load,
    ready: () => !!index,
    startMs: () => (index ? index.start * 1000 : Date.UTC(2021, 11, 31, 15)),
    endMs: () => (index ? index.end * 1000 - 60000 : Date.UTC(2024, 11, 6, 14, 59)),
  };
})();
const ymOf = chartT => { const d = new Date(chartT * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const monthStart = ym => Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1) / 1000; // 차트 시각(KST로 민 값)
const clampMs = ms => Math.min(klines.endMs(), Math.max(klines.startMs(), ms));
async function loadMonths(iv, list) {
  const arrs = await Promise.all(list.map(m => klines.load(iv, m)));
  return [].concat(...arrs);
}

// ───────────────────────── 화면 요소
const ui = {
  legend: $('legend'), hint: $('hint'), hintText: $('hintText'), toast: $('toast'),
};

let toastTimer = 0;
function toast(msg, { error = false, detail = '', retry = null, ms = 3500 } = {}) {
  clearTimeout(toastTimer);
  const el = ui.toast;
  el.className = 'toast show' + (error ? ' err' : '');
  el.innerHTML = '';
  const m = document.createElement('div'); m.textContent = msg; el.appendChild(m);
  if (detail) { const d = document.createElement('div'); d.className = 'detail'; d.textContent = detail; el.appendChild(d); }
  if (retry) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = '다시 시도';
    b.onclick = () => { el.className = 'toast'; retry(); };
    el.appendChild(b);
  }
  if (!retry) toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// ───────────────────────── 차트
const chart = LWC.createChart($('chart'), {
  autoSize: true,
  layout: {
    background: { type: 'solid', color: C.bg }, textColor: C.text,
    fontFamily: "'IBM Plex Mono', Menlo, Consolas, monospace", fontSize: 11,
    attributionLogo: false,
  },
  grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
  rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
  timeScale: {
    borderColor: C.border, timeVisible: true, secondsVisible: false,
    rightOffset: 8, barSpacing: window.innerWidth < 720 ? 4.5 : 7, tickMarkFormatter: tickFmt,
    // 실시간이 없으니 봉이 늘어날 때 화면을 오른쪽 끝으로 끌고 가지 않는다 (블라인드를 풀거나 다음 달을 붙일 때)
    shiftVisibleRangeOnNewBar: false,
  },
  localization: { locale: 'ko-KR', timeFormatter: t => fmtChartTime(t), priceFormatter: fmtAxis },
  crosshair: {
    mode: LWC.CrosshairMode.Normal,
    vertLine: { color: 'rgba(138,154,176,0.5)', labelBackgroundColor: '#243447' },
    horzLine: { color: 'rgba(138,154,176,0.5)', labelBackgroundColor: '#243447' },
  },
});

const series = chart.addSeries(LWC.CandlestickSeries, {
  upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
  wickUpColor: C.up, wickDownColor: C.down,
  priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  priceLineColor: 'rgba(247,147,26,0.8)',
});
const ts = chart.timeScale();

// ───────────────────────── 봉 데이터 상태 (봉 간격별로 메모리에 둔다)
// bars: 이어 붙인 달 파일들(ms = 그 달 목록, 연속). atLatest: 마지막 달(2024-12)까지 붙었나
const cache = {};
const S = {
  iv: '5m', bars: [], ms: [], atLatest: false, noMoreLeft: false,
  loadingLeft: false, loadingRight: false, gen: 0, jumpT: null,
};
const sec = () => IVS[S.iv];

// 리플레이 상태 (블라인드면 now까지 닫힌 봉만 그린다) — 아래 리플레이 절에서 쓴다
const R = { trade: null, now: 0, step: 0, shownT: -Infinity, blind: true, timer: 0, draft: null, pick: false };
const blindOn = () => !!(R.trade && R.blind);

// 실제로 그리는 봉 수: 블라인드면 now 전에 닫힌 봉까지
let shownLen = 0, shownSrc = null;
function cutLen() {
  if (!blindOn()) return S.bars.length;
  return indexAtOrBefore(R.now + KST - sec()) + 1;
}
// 화면 범위 정하기: setData로 봉 수가 바뀐 직후엔 차트가 바로 준 범위를 버리고 오른쪽 끝에 붙는다
// (lightweight-charts 5.1) → 다음 프레임에 한 번 더 넣고, 그 사이엔 옆 달 읽기를 멈춘다(끝에 붙은 순간을 보고 읽지 않게)
let rangeTok = 0, settling = false, pendingRange = null;
// 지금 범위 (프레임을 기다리는 범위가 있으면 그것)
const curRange = () => (settling && pendingRange ? { ...pendingRange } : ts.getVisibleLogicalRange());
function setRange(r) {
  const tok = ++rangeTok;
  settling = true; pendingRange = r;
  ts.setVisibleLogicalRange(r);
  requestAnimationFrame(() => {
    if (tok !== rangeTok) return;
    ts.setVisibleLogicalRange(r);
    requestAnimationFrame(() => { if (tok === rangeTok) { settling = false; pendingRange = null; checkEdges(); } });
  });
}

// 몇 봉만 늘어난 경우는 update로 (리플레이 넘기기가 가볍도록)
// keep: 같은 봉 묶음을 자르는 선만 바뀔 때(블라인드 켜기/끄기·리플레이 시작/끝) 보던 자리를 그대로 둔다.
// 새 달을 읽어 바꿀 때는 부르는 쪽이 자리를 정하므로 keep을 쓰지 않는다 (옛 자리가 이동을 덮어씀)
function pushSeries(force = false, keep = false) {
  const n = cutLen();
  if (!force && shownSrc === S.bars && shownLen > 0 && n >= shownLen && n - shownLen <= 60) {
    for (let i = shownLen; i < n; i++) series.update(S.bars[i]);
  } else {
    const r = keep ? curRange() : null;
    series.setData(n === S.bars.length ? S.bars : S.bars.slice(0, n));
    if (r) setRange(r);
  }
  shownLen = n; shownSrc = S.bars;
}

function setEdges() {
  const all = klines.months(S.iv);
  S.noMoreLeft = !S.ms.length || S.ms[0] === all[0];
  S.atLatest = !S.ms.length || S.ms[S.ms.length - 1] === all[all.length - 1];
}

// 데이터를 바꾸되 보던 자리를 유지한다 (shift = 왼쪽에 새로 붙은 봉 수)
function applyBars(newBars, shift = 0) {
  const r = curRange();
  S.bars = newBars;
  setEdges();
  pushSeries(true);
  if (r && S.bars.length) setRange({ from: r.from + shift, to: r.to + shift });
  saveCache();
  refreshAll();
  updateLegend();
}

function saveCache() {
  cache[S.iv] = { bars: S.bars, ms: S.ms };
}

function setBusy(on) {
  S.busy = on;
  updateLegend();
}

function noData() {
  toast('시세 파일이 없습니다 — tools/build_klines.py 로 data/klines/ 를 만들어 주세요', { error: true, ms: 8000 });
}

async function loadLatest() {
  const all = klines.months(S.iv);
  if (!all.length) { noData(); return; }
  const gen = ++S.gen;
  setBusy(true);
  try {
    const want = all.slice(-Math.min(2, all.length)); // 12월은 6일뿐이라 앞 달까지
    const bars = await loadMonths(S.iv, want);
    if (gen !== S.gen) return;
    S.ms = want; S.bars = bars;
    setEdges();
    pushSeries(true);
    ts.scrollToRealTime();
    saveCache();
    refreshAll();
    updateLegend();
    setTimeout(checkEdges, 0);
  } catch (e) {
    if (gen !== S.gen) return;
    toast('시세 파일을 읽지 못했습니다', { error: true, detail: e.message, retry: loadLatest });
  } finally {
    if (gen === S.gen) setBusy(false);
  }
}

async function loadLeft() {
  if (S.loadingLeft || S.noMoreLeft || !S.bars.length) return;
  const all = klines.months(S.iv), i = all.indexOf(S.ms[0]);
  if (i <= 0) { S.noMoreLeft = true; return; }
  S.loadingLeft = true; setBusy(true);
  const gen = S.gen, iv = S.iv, ym = all[i - 1];
  try {
    const got = await klines.load(iv, ym);
    if (gen !== S.gen || iv !== S.iv) return;
    let ms = [ym, ...S.ms], bars = got.concat(S.bars);
    // 너무 많으면 오른쪽 달을 덜어 낸다 (왼쪽 번호는 그대로)
    while (ms.length > WIN[iv]) {
      const cut = monthStart(ms.pop());
      bars = bars.slice(0, lowerBound(bars, cut));
    }
    S.ms = ms;
    applyBars(bars, got.length);
  } catch (e) {
    toast('이전 달 시세를 읽지 못했습니다', { error: true, detail: e.message, ms: 5000 });
  } finally {
    S.loadingLeft = false; setBusy(S.loadingRight);
    setTimeout(checkEdges, 300);
  }
}

async function loadRight() {
  if (S.loadingRight || S.atLatest || !S.bars.length) return;
  const all = klines.months(S.iv), i = all.indexOf(S.ms[S.ms.length - 1]);
  if (i < 0 || i >= all.length - 1) { S.atLatest = true; return; }
  S.loadingRight = true; setBusy(true);
  const gen = S.gen, iv = S.iv, ym = all[i + 1];
  try {
    const got = await klines.load(iv, ym);
    if (gen !== S.gen || iv !== S.iv) return;
    let ms = [...S.ms, ym], bars = S.bars.concat(got), dropped = 0;
    // 너무 많으면 왼쪽 달을 덜어 낸다 (그만큼 번호가 당겨짐)
    while (ms.length > WIN[iv]) {
      ms.shift();
      const n = lowerBound(bars, monthStart(ms[0]));
      bars = bars.slice(n); dropped += n;
    }
    S.ms = ms;
    applyBars(bars, -dropped);
  } catch (e) {
    toast('다음 달 시세를 읽지 못했습니다', { error: true, detail: e.message, ms: 5000 });
  } finally {
    S.loadingRight = false; setBusy(S.loadingLeft);
    setTimeout(checkEdges, 300);
  }
}

function checkEdges() {
  if (settling) return; // 범위를 다시 넣는 중 — 끝난 뒤 setRange가 부른다
  const r = ts.getVisibleLogicalRange();
  if (!r || !S.bars.length) return;
  if (r.from < EDGE) loadLeft();
  if (!S.atLatest && r.to > S.bars.length - 1 - EDGE) loadRight();
}
ts.subscribeVisibleLogicalRangeChange(() => {
  checkEdges();
  refreshAll();
  panel.follow();
  if (hoverT == null) updateLegend();
});

// 특정 시각(실제 ms)으로 이동. pos = 그 봉을 화면 폭의 어디에 둘지 (0.5 = 가운데)
async function jumpTo(ms, { mark = true, width: w = null, pos = 0.5 } = {}) {
  if (!klines.months(S.iv).length) { noData(); return; }
  ms = clampMs(ms);
  const s = sec();
  const t = Math.floor(msToChart(ms) / s) * s; // 봉 시작 시각으로 내림 (KST로 민 값 기준이라 1h도 정각)
  if (mark) S.jumpT = t;
  const width = w || (() => { const r = curRange(); return r ? Math.max(40, r.to - r.from) : 160; })();

  const inRange = S.bars.length && t >= S.bars[0].time && t <= S.bars[S.bars.length - 1].time;
  if (!inRange) {
    const gen = ++S.gen;
    S.loadingLeft = S.loadingRight = false;
    setBusy(true);
    try {
      const all = klines.months(S.iv);
      let i = all.indexOf(ymOf(t));
      if (i < 0) { i = all.findIndex(m => m > ymOf(t)); if (i < 0) i = all.length - 1; }
      const want = [all[i]];
      const bars = await loadMonths(S.iv, want);
      if (gen !== S.gen) return;
      if (!bars.length) { toast('그 시각의 봉이 없습니다', { error: true }); return; }
      S.ms = want; S.bars = bars;
      setEdges();
      pushSeries(true);
      saveCache();
    } catch (e) {
      if (gen !== S.gen) return;
      toast('그 시각의 시세를 읽지 못했습니다', { error: true, detail: e.message, retry: () => jumpTo(ms, { mark, width: w, pos }) });
      return;
    } finally {
      if (gen === S.gen) setBusy(false);
    }
  }
  const idx = indexAtOrBefore(t);
  setRange({ from: idx - width * pos, to: idx + width * (1 - pos) });
  refreshAll();
  updateLegend();
  setTimeout(checkEdges, 0);
}

// 이분 탐색: time <= t 인 마지막 봉 번호 (없으면 -1)
function indexAtOrBefore(t) {
  const b = S.bars;
  let lo = 0, hi = b.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
// time >= t 인 첫 봉 번호
function lowerBound(b, t) {
  let lo = 0, hi = b.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b[mid].time < t) lo = mid + 1; else hi = mid; }
  return lo;
}

// 차트 시각(초, KST로 민 값) → 논리 봉 번호 (소수 가능, 받은 구간 밖은 봉 간격으로 연장)
function timeToLogical(t) {
  const b = S.bars, s = sec();
  if (!b.length) return null;
  if (t < b[0].time) return (t - b[0].time) / s;
  const i = indexAtOrBefore(t);
  if (i === b.length - 1) return i + (t - b[i].time) / s;
  const span = b[i + 1].time - b[i].time;
  return i + Math.min(1, (t - b[i].time) / span);
}
function logicalToTime(l) {
  const b = S.bars, s = sec();
  const i = Math.round(l);
  if (i < 0) return b[0].time + i * s;
  if (i >= b.length) return b[b.length - 1].time + (i - b.length + 1) * s;
  return b[i].time;
}
// logicalToCoordinate는 정수 번호만 제대로 받는다 → 이웃 두 봉 사이를 직접 보간
function timeToX(t) {
  const l = timeToLogical(t);
  if (l == null) return null;
  const f = Math.floor(l);
  const a = ts.logicalToCoordinate(f);
  if (a == null || l === f) return a;
  const b = ts.logicalToCoordinate(f + 1);
  return b == null ? a : a + (l - f) * (b - a);
}
// 데이터의 UTC 초 → 그 시각을 담은 봉의 x
const barX = utc => timeToX(Math.floor((utc + KST) / sec()) * sec());

// 간격을 바꿔도 같은 시각을 보도록
// centerMs를 주면 그 시각으로 (북마크), 아니면 지금 보던 시각을 유지
function switchInterval(iv, { centerMs = null, width = null } = {}) {
  if (iv === S.iv || !IVS[iv]) return;
  const r = curRange();
  const wasLatest = S.atLatest && r && r.to >= shownLen - 3;
  const centerT = r && S.bars.length ? logicalToTime((r.from + r.to) / 2) : null;

  saveCache();
  S.gen++;
  S.loadingLeft = S.loadingRight = false;
  S.iv = iv;
  store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), iv });
  document.querySelectorAll('#ivSeg button').forEach(b => b.classList.toggle('on', b.dataset.iv === iv));

  const c = cache[iv];
  S.bars = c ? c.bars : [];
  S.ms = c ? c.ms : [];
  setEdges();
  pushSeries(true);

  if (centerMs != null) {
    jumpTo(centerMs, { mark: false, width });
  } else if (blindOn()) {
    jumpTo(R.now * 1000, { mark: false, pos: 0.75 });
  } else if (wasLatest || centerT == null) {
    if (c && S.atLatest) { ts.scrollToRealTime(); refreshAll(); updateLegend(); }
    else loadLatest();
  } else {
    jumpTo(chartToMs(centerT), { mark: false });
  }
}

// ───────────────────────── 범례 (마우스·탭 위치의 봉 OHLC)
let hoverT = null;
function updateLegend() {
  const b = S.bars;
  let bar = null;
  if (hoverT != null) { const i = indexAtOrBefore(hoverT); if (i >= 0 && i < shownLen && b[i].time === hoverT) bar = b[i]; }
  if (!bar) {
    // 마우스가 없으면 화면 오른쪽 끝에 보이는 봉 (실시간이 없으니 「마지막 봉」은 의미가 없다)
    const r = ts.getVisibleLogicalRange();
    bar = b[Math.max(0, Math.min(shownLen - 1, r ? Math.floor(r.to) : shownLen - 1))];
  }
  if (!bar) { ui.legend.innerHTML = S.busy ? '<span class="busy">불러오는 중…</span>' : ''; return; }
  const chg = (bar.close - bar.open) / bar.open * 100;
  const cls = bar.close >= bar.open ? 'u' : 'd';
  ui.legend.innerHTML =
    `<span class="t">${fmtChartTime(bar.time)}</span>` +
    `<span>O <b class="${cls}">${fmtPrice(bar.open)}</b></span>` +
    `<span>H <b class="${cls}">${fmtPrice(bar.high)}</b></span>` +
    `<span>L <b class="${cls}">${fmtPrice(bar.low)}</b></span>` +
    `<span>C <b class="${cls}">${fmtPrice(bar.close)}</b></span>` +
    `<span class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>` +
    (S.busy ? '<span class="busy">불러오는 중…</span>' : '');
}

// ───────────────────────── 관점방 데이터 (posts·trades — 공통설계 §4, 읽기만)
const vault = {
  posts: [], trades: [], post: new Map(), trade: new Map(),
  source: null,  // 'enc'(A안 암호 풀림) | 'file'(B안 가져오기) | 'sample'(가짜 샘플)
  enc: null,     // A안 암호 봉투 {posts, trades} — 아직 안 풀렸으면 잠김
};
const EV_ACT = { entry: 'enter', add: 'add', reduce: 'reduce', stop: 'stop', tp: 'tp', exit: 'exit' };
const EV_LABEL = { entry: '진입', add: '추가(불타기)', reduce: '분할 정리', stop: '스탑', tp: '익절 예약', exit: '종료' };
const SIDE_LABEL = { long: '롱', short: '숏' };
const KIND_LABEL = { signal: '신호', risk: '리스크', view: '관점', routine: '루틴', chat: '기타' };

function setVault(posts, trades, source) {
  const num = v => typeof v === 'number' && isFinite(v);
  const ps = (Array.isArray(posts) ? posts : [])
    .filter(p => p && typeof p.id === 'string' && num(p.t))
    .map((p, i) => ({ ...p, text: typeof p.text === 'string' ? p.text : '', _i: i }))
    .sort((a, b) => a.t - b.t || a._i - b._i);
  const trs = (Array.isArray(trades) ? trades : [])
    .filter(tr => tr && typeof tr.id === 'string' && Array.isArray(tr.events))
    .map(tr => ({
      ...tr,
      events: tr.events.filter(e => e && num(e.t) && EV_LABEL[e.type])
        .map((e, i) => ({ ...e, _i: i })).sort((a, b) => a.t - b.t || a._i - b._i),
      flags: Array.isArray(tr.flags) ? tr.flags : [],
    }))
    .filter(tr => tr.events.length)
    .sort((a, b) => a.events[0].t - b.events[0].t);
  vault.posts = ps; vault.trades = trs; vault.source = source;
  vault.post = new Map(ps.map(p => [p.id, p]));
  vault.trade = new Map(trs.map(tr => [tr.id, tr]));
  panel.build();
  refreshAll();
}

// 매매 요약 (가격이 있는 사건만으로 — 비율 가중 같은 가정은 넣지 않는다)
// 매매 데이터는 setVault 뒤로 바뀌지 않으니 매매마다 한 번만 계산 (그릴 때마다 부른다)
const basicsMemo = new WeakMap();
function tradeBasics(tr) {
  if (!basicsMemo.has(tr)) basicsMemo.set(tr, calcBasics(tr));
  return basicsMemo.get(tr);
}
function calcBasics(tr) {
  const entry = tr.events.find(e => e.type === 'entry');
  const exits = tr.events.filter(e => e.type === 'exit');
  const exit = exits[exits.length - 1] || null;
  const dir = tr.side === 'short' ? -1 : 1;
  const ep = entry && Number.isFinite(entry.price) ? entry.price : null;
  const firstStop = tr.events.find(e => e.type === 'stop' && Number.isFinite(e.stop) && (!entry || e.t >= entry.t));
  const pos = positionPath(tr);
  return {
    entry, exit, dir, ep, pos,
    result: ep && exit && Number.isFinite(exit.price) ? dir * (exit.price - ep) / ep * 100 : null,
    // 비중 반영 결과가 계산되면 그것을 대표값으로 (없으면 첫 진입가 → 종료가)
    wresult: pos && pos.ok && pos.result != null ? pos.result : null,
    firstStop,
    stopDist: ep && firstStop ? Math.abs(firstStop.stop - ep) : null,
    hold: entry && exit ? exit.t - entry.t : null,
  };
}
const mainResult = B => (B.wresult != null ? B.wresult : B.result);

// 비중 반영: 그가 적은 「누적 N%」(cum)로 포지션 크기를 따라가며 평단과 청산분의 가격 변화를 계산한다.
// 크기를 바꾸는 사건(진입·추가·정리)에 cum·price가 모두 있어야 계산한다 — 하나라도 없으면 이유만 돌려준다(추정하지 않음).
// 정리 사건의 cum은 정리 뒤 남은 누적, 종료는 0. 정정된 사건(corrected_by)은 뒤 사건이 덮어쓰므로 건너뛴다.
// result = Σ(청산 크기 × 가격 변화 %) / Σ 청산 크기 — 레버리지는 넣지 않는다(계좌 수익 아님, 01 작업지시)
function positionPath(tr) {
  const evs = tr.events.filter(e => !e.corrected_by);
  if (!evs.some(e => Number.isFinite(e.cum))) return null;
  const dir = tr.side === 'short' ? -1 : 1;
  let qty = 0, avg = null, pnl = 0, closed = 0, maxQty = 0;
  const path = [];
  for (const e of evs) {
    if (!['entry', 'add', 'reduce', 'exit'].includes(e.type)) continue;
    const to = e.type === 'exit' ? 0 : e.cum;
    const at = `${fmtUtc(e.t, false)} ${EV_LABEL[e.type]}`;
    if (!Number.isFinite(to)) return { ok: false, why: `${at}에 누적 % 없음` };
    if (!Number.isFinite(e.price)) return { ok: false, why: `${at}에 가격 없음` };
    const d = to - qty;
    if (d > 0) avg = qty > 0 ? (avg * qty + e.price * d) / to : e.price;
    else if (d < 0) {
      if (avg == null) return { ok: false, why: `${at}: 진입 전 정리` };
      pnl += -d * dir * (e.price - avg) / avg * 100;
      closed += -d;
    }
    qty = to; maxQty = Math.max(maxQty, qty);
    path.push({ t: e.t, qty, avg });
  }
  return { ok: true, result: closed ? pnl / closed : null, closed, open: qty, maxQty, path, avg };
}
// t 시각의 평단 기준: 그가 적은 평단(avg) → 누적으로 계산한 평단 → 첫 진입가
function basisAt(tr, t, B) {
  let b = null;
  for (const e of tr.events) { if (e.t > t) break; if (Number.isFinite(e.avg) && !e.corrected_by) b = e.avg; }
  if (b == null && B.pos && B.pos.ok) for (const s of B.pos.path) { if (s.t > t) break; if (s.avg != null) b = s.avg; }
  return b ?? B.ep;
}
// 「리스크 0%」 칸: 메모에 적혀 있거나, 스탑이 평단 기준(위 basisAt)을 넘어 수익 쪽으로 간 경우
function isRisk0(tr, e, basis) {
  if (/리스크\s*0/.test(e.note || '')) return true;
  if (basis == null) return false;
  return tr.side === 'short' ? e.stop <= basis : e.stop >= basis;
}
// BTC가 아닌 매매(PEPE 등, price 없음)는 BTC 차트에 그리지 않는다
const onChart = tr => !tr.asset || /^BTC/i.test(tr.asset);
// 보이는 사건인가 (블라인드 중인 매매는 연 사건까지만, 다른 매매는 now 전 사건만)
function evShown(tr, e) {
  if (!blindOn()) return true;
  if (tr === R.trade) return tr.events.indexOf(e) < R.step;
  return e.t < R.now;
}
function nextTradeOpen(tr) {
  const n = vault.trades.find(x => x !== tr && onChart(x) && x.events[0].t > tr.events[0].t);
  return n ? n.events[0].t : null;
}
// 스탑 계단: 설정·이동 시각부터 다음 이동(또는 종료)까지
function stopSegs(tr) {
  const evs = tr.events.filter(e => evShown(tr, e));
  const stops = evs.filter(e => e.type === 'stop' && Number.isFinite(e.stop));
  if (!stops.length) return [];
  const B = tradeBasics(tr), { exit } = B;
  const closed = exit && evShown(tr, exit);
  const last = tr.events[tr.events.length - 1].t;
  let end = closed ? exit.t : (tr.status === 'closed' && exit ? exit.t : (nextTradeOpen(tr) ?? last + 4 * 3600));
  if (blindOn()) end = Math.min(end, R.now);
  let r0 = false;
  return stops.map((e, i) => {
    if (isRisk0(tr, e, basisAt(tr, e.t, B))) r0 = true;
    const t1 = i + 1 < stops.length ? stops[i + 1].t : end;
    return { t0: e.t, t1: Math.max(e.t, t1), stop: e.stop, risk0: r0, tail: i + 1 === stops.length && !closed };
  });
}

// ───────────────────────── 매매 마커 · 스탑 계단 · 「여기까지」 선 (그림보다 아래 층)
const marks = (() => {
  let on = store.get(PREF_KEY, {}).marks !== false;
  let hits = [];
  let hl = null; // 강조할 사건 {tr, e}
  let requestUpdate = () => {};
  const FONT = "600 10.5px 'IBM Plex Mono', Menlo, monospace";

  function vline(ctx, x, h, color, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.2; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke(); ctx.restore();
  }
  function tag(ctx, x, y, text, bg, fg) {
    ctx.font = FONT; const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg; ctx.fillRect(Math.round(x), Math.round(y), w, 15);
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, Math.round(x) + 4, Math.round(y) + 8);
    return w;
  }

  function drawTrade(ctx, tr, w) {
    const sideC = tr.side === 'short' ? C.down : C.up;
    // 스탑 계단
    let prevY = null;
    for (const s of stopSegs(tr)) {
      const x0 = barX(s.t0), x1 = barX(s.t1), y = series.priceToCoordinate(s.stop);
      if (x0 == null || x1 == null || y == null) { prevY = null; continue; }
      const col = s.risk0 ? C.risk0 : C.stop;
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      if (s.tail) ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(Math.max(x0 + 2, x1), Math.round(y) + 0.5); ctx.stroke();
      if (prevY != null) {
        ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, prevY); ctx.lineTo(Math.round(x0) + 0.5, y); ctx.stroke();
      }
      ctx.restore();
      if (x1 - x0 > 70 && x1 > 0 && x0 < w) tag(ctx, Math.max(x0, 0) + 2, y - 17, (s.risk0 ? '리스크0 ' : 'S ') + fmtAxis(s.stop), 'rgba(10,14,20,0.75)', col);
      prevY = y;
    }
    if (!on) return;
    const coarse = sec() >= 3600; // 1시간봉 이상은 진입·청산만
    for (const e of tr.events) {
      if (!evShown(tr, e) || e.type === 'stop') continue;
      if (coarse && e.type !== 'entry' && e.type !== 'exit') continue;
      const price = Number.isFinite(e.price) ? e.price : Number.isFinite(e.quoted) ? e.quoted : null;
      if (price == null) continue;
      const x = barX(e.t), y = series.priceToCoordinate(price);
      if (x == null || y == null || x < -20 || x > w + 20) continue;
      ctx.save();
      ctx.lineJoin = 'round';
      if (e.type === 'entry') {
        const d = tr.side === 'short' ? 1 : -1; // 숏 ▼ / 롱 ▲
        ctx.fillStyle = sideC; ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y + d * 6); ctx.lineTo(x - 7, y - d * 6); ctx.lineTo(x + 7, y - d * 6); ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if (e.type === 'add') {
        ctx.strokeStyle = C.bg; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
        ctx.strokeStyle = sideC; ctx.lineWidth = 2.5; ctx.stroke();
        if (Number.isFinite(e.cum)) tag(ctx, x + 8, y - 7, `→누적 ${e.cum}%`, 'rgba(10,14,20,0.75)', sideC);
      } else if (e.type === 'reduce' || e.type === 'tp') {
        if (e.corrected_by) ctx.globalAlpha = 0.45;
        ctx.fillStyle = C.reduce; ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const lab = e.type === 'tp' ? 'TP'
          : `${e.pct != null ? `${e.pct}%` : Number.isFinite(e.cum) ? `→누적 ${e.cum}%` : '?'}${e.corrected_by ? ' 정정됨' : ''}`;
        tag(ctx, x + 7, y - 7, lab, 'rgba(10,14,20,0.75)', C.reduce);
      } else if (e.type === 'exit') {
        ctx.strokeStyle = C.bg; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
        ctx.strokeStyle = C.exit; ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (hl && hl.e === e) {
        ctx.globalAlpha = 1; ctx.strokeStyle = C.btc; ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      hits.push({ x, y, tr, e });
    }
  }

  // 내 스탑(리플레이 답): 적은 시각부터 다음 답까지 보라 점선
  function drawMine(ctx, w) {
    if (!R.trade) return;
    const steps = answers.steps(R.trade.id);
    const list = Object.keys(steps).map(Number).sort((a, b) => a - b).map(i => steps[i]).filter(a => Number.isFinite(a.now));
    if (R.draft && Number.isFinite(R.draft.stop)) list.push({ ...R.draft, now: R.now });
    let cur = null;
    const flush = until => {
      if (!cur) return;
      const x0 = barX(cur.now), x1 = until == null ? w : barX(until), y = series.priceToCoordinate(cur.stop);
      if (x0 == null || y == null) return;
      ctx.save(); ctx.strokeStyle = C.mine; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1 ?? w, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
      tag(ctx, Math.max(0, x0) + 2, y + 3, '내 스탑 ' + fmtAxis(cur.stop), 'rgba(10,14,20,0.75)', C.mine);
    };
    for (const a of list) {
      if (!Number.isFinite(a.stop)) continue;
      flush(a.now); cur = a;
    }
    flush(null);
  }

  function draw(ctx, w, h) {
    hits = [];
    // 고른 글의 시각
    if (panel.selT() != null) { const x = barX(panel.selT()); if (x != null && x >= 0 && x <= w) vline(ctx, x, h, 'rgba(51,212,255,0.55)', [3, 4]); }
    const r = ts.getVisibleLogicalRange();
    if (vault.trades.length && r && S.bars.length) {
      const lo = logicalToTime(Math.floor(r.from)) - KST - 86400, hi = logicalToTime(Math.ceil(r.to)) - KST + 86400;
      for (const tr of vault.trades) {
        if (!onChart(tr)) continue;
        const a = tr.events[0].t, b = Math.max(tr.events[tr.events.length - 1].t, nextTradeOpen(tr) ?? 0);
        if (b < lo || a > hi) continue;
        if (blindOn() && a >= R.now && tr !== R.trade) continue;
        drawTrade(ctx, tr, w);
      }
    }
    drawMine(ctx, w);
    // 리플레이 「여기까지」
    if (R.trade) {
      const x = timeToX(R.now + KST - (R.now + KST) % sec());
      if (x != null && x >= -2 && x <= w + 2) {
        vline(ctx, x, h, R.blind ? C.now : 'rgba(247,147,26,0.45)', R.blind ? null : [6, 4]);
        tag(ctx, Math.min(x + 3, w - 80), h - 19, R.blind ? '여기까지' : '리플레이 위치', C.now, C.bg);
      }
    }
  }

  const views = [{ zOrder: () => 'top', renderer: () => ({ draw: tg => tg.useMediaCoordinateSpace(({ context, mediaSize }) => draw(context, mediaSize.width, mediaSize.height)) }) }];
  series.attachPrimitive({
    attached: p => { requestUpdate = p.requestUpdate; },
    detached: () => { requestUpdate = () => {}; },
    updateAllViews: () => {},
    paneViews: () => views,
    // 보이는 구간의 스탑 계단이 화면 밖으로 나가지 않게 가격축 범위에 넣는다
    autoscaleInfo: (from, to) => {
      if (!vault.trades.length || !S.bars.length) return null;
      const lo = logicalToTime(Math.floor(from)) - KST, hi = logicalToTime(Math.ceil(to)) - KST;
      let mn = Infinity, mx = -Infinity;
      for (const tr of vault.trades) {
        if (!onChart(tr) || tr.events[0].t > hi) continue;
        if (blindOn() && tr !== R.trade && tr.events[0].t >= R.now) continue;
        for (const s of stopSegs(tr)) if (s.t1 >= lo && s.t0 <= hi) { mn = Math.min(mn, s.stop); mx = Math.max(mx, s.stop); }
      }
      return Number.isFinite(mn) ? { priceRange: { minValue: mn, maxValue: mx } } : null;
    },
  });

  return {
    refresh: () => requestUpdate(),
    isOn: () => on,
    toggle() {
      on = !on;
      store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), marks: on });
      $('markBtn').classList.toggle('on', on);
      requestUpdate();
    },
    hitTest(px, py, tol = 14) {
      let best = null, bd = tol;
      for (const hh of hits) { const d = Math.hypot(px - hh.x, py - hh.y); if (d < bd) { bd = d; best = hh; } }
      return best;
    },
    highlight(tr, e) { hl = tr && e ? { tr, e } : null; requestUpdate(); },
  };
})();

// ───────────────────────── 색 (트레이딩뷰 기본 10색에서 남보라를 빼고 흰색을 넣음)
const PALETTE = ['#ffffff', '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0', '#e91e63'];
const DEFAULT_COLOR = { hline: C.hline, vline: C.hline, ray: C.ray, dot: C.dot, box: C.box, text: '#ffffff' };
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const colorOf = d => (isHex(d.c) ? d.c : DEFAULT_COLOR[d.type]);
// 밝은 바탕(흰·노랑 등)엔 어두운 글씨
function labelTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? C.bg : '#ffffff';
}
// 도구별 마지막에 쓴 색
const toolColors = { ...DEFAULT_COLOR };
for (const [k, v] of Object.entries(store.get(PREF_KEY, {}).colors || {})) if (k in toolColors && isHex(v)) toolColors[k] = v;
function saveToolColors() { store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), colors: toolColors }); }

// ───────────────────────── 그림 (시각·가격으로 저장 → 확대·스크롤·간격 변경에도 따라온다)
// 저장 형식: { id, type: 'hline'|'vline'|'ray'|'dot'|'box'|'text', p?, t?, p2?, t2?, c?, text? }  (t = 실제 UTC ms, c = 색 #rrggbb)
const TEXT_FONT = "600 13px 'Pretendard Variable', -apple-system, sans-serif";
const TEXT_MAX = 60;
const drawings = (() => {
  let list = (store.get(STORE_KEY, { drawings: [] }).drawings || []).filter(valid);
  let pending = null;   // 박스 첫 꼭짓점 {t, p}
  let preview = null;   // 박스 미리보기 둘째 꼭짓점 {t, p}
  let hot = null;       // 지우기 후보 id
  let sel = null;       // 수정 중인 그림 id
  let requestUpdate = () => {};
  // 되돌리기: 바꾸기 직전 목록을 쌓아 둔다 (최대 50단계, 새로고침하면 비워짐)
  let history = [];
  let onHistory = () => {};
  function snapshot() {
    history.push(JSON.stringify(list));
    if (history.length > 50) history.shift();
    onHistory(history.length);
  }
  const measure = document.createElement('canvas').getContext('2d');
  function textWidth(t) { measure.font = TEXT_FONT; return measure.measureText(t).width; }
  let axisViews = [];

  function valid(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string') return false;
    const num = v => typeof v === 'number' && isFinite(v);
    switch (d.type) {
      case 'hline': return num(d.p);
      case 'vline': return num(d.t);
      case 'ray': case 'dot': return num(d.p) && num(d.t);
      case 'box': return num(d.p) && num(d.t) && num(d.p2) && num(d.t2);
      case 'text': return num(d.p) && num(d.t) && typeof d.text === 'string' && d.text.trim().length > 0 && d.text.length <= 200;
      default: return false;
    }
  }
  function persist() {
    if (!store.set(STORE_KEY, { version: 1, drawings: list })) {
      toast('이 브라우저에 저장하지 못했습니다 (개인정보 보호 모드?) — 내보내기로 백업하세요', { error: true, ms: 6000 });
    }
    rebuildAxis();
    requestUpdate();
    $('drawCount').textContent = list.length;
  }

  // 가격축 라벨: 수평선·레이 / 시간축 라벨: 수직선
  let timeViews = [];
  function rebuildAxis() {
    timeViews = list.filter(d => d.type === 'vline').map(d => ({
      coordinate: () => cx(d) ?? -100,
      text: () => fmtChartTime(msToChart(d.t)),
      textColor: () => (hot === d.id ? '#ffffff' : labelTextColor(colorOf(d))),
      backColor: () => (hot === d.id ? C.erase : colorOf(d)),
    }));
    axisViews = list.filter(d => d.type === 'hline' || d.type === 'ray').map(d => {
      return {
        coordinate: () => series.priceToCoordinate(d.p) ?? -100,
        text: () => fmtAxis(d.p),
        textColor: () => (hot === d.id ? '#ffffff' : labelTextColor(colorOf(d))),
        backColor: () => (hot === d.id ? C.erase : colorOf(d)),
      };
    });
  }

  const cx = d => timeToX(msToChart(d.t));
  const cy = p => series.priceToCoordinate(p);

  function draw(ctx, w, h) {
    // 날짜 이동 표시
    if (S.jumpT != null) {
      const x = timeToX(S.jumpT);
      if (x != null && x >= 0 && x <= w) {
        ctx.save(); ctx.strokeStyle = C.jump; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
        ctx.restore();
      }
    }
    for (const d of list) drawOne(ctx, d, w, h, hot === d.id);
    const sd = sel && list.find(d => d.id === sel);
    if (sd) drawHandles(ctx, sd, w, h);
    if (pending) {
      const c = toolColors.box;
      const a = { type: 'dot', t: pending.t, p: pending.p, c };
      if (preview) drawOne(ctx, { type: 'box', t: pending.t, p: pending.p, t2: preview.t, p2: preview.p, c }, w, h, false, true);
      drawOne(ctx, a, w, h, false);
    }
  }

  function drawOne(ctx, d, w, h, isHot, ghost = false) {
    if (d.type === 'vline') {
      const x = cx(d); if (x == null) return;
      ctx.save();
      ctx.lineWidth = isHot ? 2.5 : 1.5;
      ctx.strokeStyle = isHot ? C.erase : colorOf(d);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke();
      ctx.restore();
      return;
    }
    const y = cy(d.p);
    if (y == null) return;
    ctx.save();
    ctx.lineWidth = isHot ? 2.5 : 1.5;
    const color = colorOf(d);
    switch (d.type) {
      case 'hline': {
        ctx.strokeStyle = isHot ? C.erase : color;
        ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke();
        break;
      }
      case 'ray': {
        const x = cx(d); if (x == null) break;
        const col = isHot ? C.erase : color;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        const yy = Math.round(y) + 0.5;
        ctx.beginPath(); ctx.moveTo(Math.max(x, -10), yy); ctx.lineTo(w, yy); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'dot': {
        const x = cx(d); if (x == null) break;
        ctx.fillStyle = isHot ? C.erase : color;
        ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, isHot ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'box': {
        const x1 = cx(d), x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
        if (x1 == null || x2 == null || y2 == null) break;
        const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y, y2), b = Math.max(y, y2);
        ctx.strokeStyle = isHot ? C.erase : color;
        if (ghost) ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.round(l) + 0.5, Math.round(t) + 0.5, Math.round(r - l), Math.round(b - t));
        break;
      }
      case 'text': {
        const x = cx(d); if (x == null) break;
        ctx.font = TEXT_FONT; ctx.textBaseline = 'middle';
        // 캔들 위에서도 읽히게 옅은 어두운 바탕
        const tw = textWidth(d.text);
        ctx.fillStyle = 'rgba(10,14,20,0.6)';
        ctx.fillRect(x + 1, y - 10, tw + 6, 20);
        ctx.fillStyle = isHot ? C.erase : color;
        ctx.fillText(d.text, x + 4, y);
        break;
      }
    }
    ctx.restore();
  }

  // 수정 손잡이: 박스는 네 꼭짓점, 레이·점·글은 시작점, 수평선·수직선은 화면 가운데 한 점
  function handlesOf(d, w, h) {
    if (d.type === 'vline') { const x = cx(d); return x == null ? [] : [{ x, y: h / 2, tk: 't', pk: null }]; }
    const y = cy(d.p); if (y == null) return [];
    if (d.type === 'hline') return [{ x: w / 2, y, tk: null, pk: 'p' }];
    const x = cx(d); if (x == null) return [];
    if (d.type !== 'box') return [{ x, y, tk: 't', pk: 'p' }];
    const x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
    if (x2 == null || y2 == null) return [];
    return [
      { x, y, tk: 't', pk: 'p' }, { x: x2, y, tk: 't2', pk: 'p' },
      { x, y: y2, tk: 't', pk: 'p2' }, { x: x2, y: y2, tk: 't2', pk: 'p2' },
    ];
  }
  function drawHandles(ctx, d, w, h) {
    ctx.save();
    ctx.fillStyle = C.bg; ctx.strokeStyle = C.btc; ctx.lineWidth = 2;
    for (const hd of handlesOf(d, w, h)) {
      ctx.beginPath(); ctx.arc(hd.x, hd.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // 지우기용: 탭 위치에서 가장 가까운 그림 (px 거리)
  function hitTest(px, py, tol = 16, only = null) {
    let best = null, bestD = tol;
    for (const d of only ? list.filter(x => x.id === only) : list) {
      if (d.type === 'vline') {
        const x = cx(d);
        if (x != null && Math.abs(px - x) < bestD) { bestD = Math.abs(px - x); best = d; }
        continue;
      }
      const y = cy(d.p); if (y == null) continue;
      let dist = Infinity;
      if (d.type === 'hline') dist = Math.abs(py - y);
      else if (d.type === 'dot') { const x = cx(d); if (x != null) dist = Math.hypot(px - x, py - y); }
      else if (d.type === 'ray') {
        const x = cx(d); if (x == null) continue;
        dist = px >= x ? Math.abs(py - y) : Math.hypot(px - x, py - y);
      } else if (d.type === 'text') {
        const x = cx(d); if (x == null) continue;
        const l = x, r = x + 4 + textWidth(d.text), t = y - 9, b = y + 9;
        dist = Math.hypot(Math.max(l - px, 0, px - r), Math.max(t - py, 0, py - b));
      } else if (d.type === 'box') {
        const x1 = cx(d), x2 = timeToX(msToChart(d.t2)), y2 = cy(d.p2);
        if (x1 == null || x2 == null || y2 == null) continue;
        const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y, y2), b = Math.max(y, y2);
        const inside = px >= l && px <= r && py >= t && py <= b;
        const edge = Math.min(
          px >= l - tol && px <= r + tol ? Math.min(Math.abs(py - t), Math.abs(py - b)) : Infinity,
          py >= t - tol && py <= b + tol ? Math.min(Math.abs(px - l), Math.abs(px - r)) : Infinity,
        );
        dist = inside ? Math.min(edge, tol - 1) : edge; // 안쪽 탭도 지울 수 있게, 선은 우선
      }
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => draw(context, mediaSize.width, mediaSize.height)),
    }),
  };
  const paneViews = [paneView];
  const primitive = {
    attached: p => { requestUpdate = p.requestUpdate; },
    detached: () => { requestUpdate = () => {}; },
    updateAllViews: () => {},
    paneViews: () => paneViews,
    priceAxisViews: () => axisViews,
    timeAxisViews: () => timeViews,
  };
  series.attachPrimitive(primitive);
  rebuildAxis();
  $('drawCount').textContent = list.length;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  return {
    refresh: () => requestUpdate(),
    all: () => list.slice(),
    count: () => list.length,
    add(d) { snapshot(); list.push({ id: newId(), ...d }); persist(); },
    remove(id) { snapshot(); list = list.filter(d => d.id !== id); hot = null; if (sel === id) sel = null; persist(); },
    snapshot,
    undo() {
      if (!history.length) return false;
      list = JSON.parse(history.pop()).filter(valid);
      hot = null;
      persist();
      onHistory(history.length);
      return true;
    },
    onHistory(cb) { onHistory = cb; cb(history.length); },
    get: id => list.find(d => d.id === id) || null,
    // 끄는 동안은 그리기만 다시 하고, 손을 뗄 때 save()로 저장
    patch(id, fields) { const d = list.find(x => x.id === id); if (d) { Object.assign(d, fields); requestUpdate(); } },
    save: () => persist(),
    setSel(id) { sel = id; requestUpdate(); },
    getSel: () => sel,
    handleAt(px, py, w, h, tol) {
      const d = sel && list.find(x => x.id === sel); if (!d) return null;
      let best = null, bestD = tol;
      for (const hd of handlesOf(d, w, h)) { const dist = Math.hypot(px - hd.x, py - hd.y); if (dist < bestD) { bestD = dist; best = hd; } }
      return best;
    },
    clear() { snapshot(); list = []; sel = null; persist(); },
    importMany(arr) {
      snapshot();
      const have = new Set(list.map(d => d.id));
      let added = 0, bad = 0;
      for (const d of arr) {
        if (!valid(d)) { bad++; continue; }
        if (have.has(d.id)) continue;
        const clean = { id: d.id, type: d.type };
        if (d.p != null) clean.p = d.p;
        if (d.t != null) clean.t = d.t;
        if (d.type === 'box') { clean.p2 = d.p2; clean.t2 = d.t2; }
        if (isHex(d.c)) clean.c = d.c;
        if (d.type === 'text') clean.text = d.text;
        list.push(clean); have.add(d.id); added++;
      }
      if (!added) { history.pop(); onHistory(history.length); }
      persist();
      return { added, bad };
    },
    hitTest,
    setPending(p) { pending = p; preview = null; requestUpdate(); },
    getPending: () => pending,
    setPreview(p) { preview = p; requestUpdate(); },
    setHot(id) { if (hot !== id) { hot = id; rebuildAxis(); requestUpdate(); } },
  };
})();

// ───────────────────────── 도구 (버튼 → 탭 1번 / 박스는 2번 → 다시 커서로)
let tool = null;
const HINTS = {
  hline: '수평선 — 가격 위치를 탭하세요',
  vline: '수직선 — 시각(봉) 위치를 탭하세요',
  dot: '점 — 찍을 위치를 탭하세요',
  ray: '레이 — 시작점을 탭하세요 (오른쪽으로 뻗음)',
  box: '박스 — 첫 꼭짓점을 탭하세요',
  box2: '박스 — 반대쪽 꼭짓점을 탭하세요',
  erase: '지우기 — 지울 그림을 탭하세요',
  text: '텍스트 — 넣을 위치를 탭하세요',
  edit: '끌어서 이동 · ○로 크기 조절',
  editText: '끌어서 이동',
};

function setTool(t) {
  if (t) select(null);
  tool = t;
  drawings.setPending(null);
  drawings.setHot(null);
  document.querySelectorAll('#tools .tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  showHint(t ? HINTS[t] : null);
}
function showHint(text) {
  ui.hint.classList.toggle('show', !!text);
  ui.hint.classList.toggle('erase', tool === 'erase');
  ui.hintText.textContent = text || '';
  $('hintDelete').hidden = !drawings.getSel();
  const sd0 = drawings.getSel() && drawings.get(drawings.getSel());
  $('hintEditText').hidden = !(sd0 && sd0.type === 'text');
  $('hintCancel').textContent = drawings.getSel() ? '완료' : '취소';
  renderSwatches();
}

// 색 고르기: 도구를 고른 상태면 새로 그릴 색, 그림을 선택한 상태면 그 그림의 색
function renderSwatches() {
  const box = $('swatches');
  const sd = drawings.getSel() && drawings.get(drawings.getSel());
  const type = sd ? sd.type : (tool && tool !== 'erase' ? tool : null);
  box.hidden = !type;
  if (!type) return;
  const cur = sd ? colorOf(sd) : toolColors[type];
  box.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'sw' + (c.toLowerCase() === cur.toLowerCase() ? ' on' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      toolColors[type] = c; saveToolColors();
      const id = drawings.getSel();
      if (id) { drawings.snapshot(); drawings.patch(id, { c }); drawings.save(); }
      drawings.refresh();
      renderSwatches();
    });
    box.appendChild(b);
  }
}

// 그림 선택(수정 모드): 선택 중엔 차트 끌기·확대를 잠가서 손가락이 그림만 움직이게 한다
function select(id) {
  if (id === drawings.getSel()) return;
  drawings.setSel(id);
  chart.applyOptions({ handleScroll: !id, handleScale: !id });
  if (id) { tool = null; document.querySelectorAll('#tools .tool').forEach(b => b.classList.remove('on')); }
  showHint(id ? editHint() : null);
}
function editHint() {
  const d = drawings.getSel() && drawings.get(drawings.getSel());
  return d && d.type === 'box' ? HINTS.edit : HINTS.editText; // 크기 조절은 박스만
}

document.querySelectorAll('#tools .tool[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(tool === b.dataset.tool ? null : b.dataset.tool));
});

// 되돌리기
function undo() {
  const sid = drawings.getSel();
  if (!drawings.undo()) { toast('되돌릴 것이 없습니다', { ms: 1500 }); return; }
  if (sid && !drawings.get(sid)) select(null);
  else if (sid) showHint(editHint());
}
$('undoBtn').addEventListener('click', undo);
drawings.onHistory(n => { $('undoBtn').disabled = !n; });

// 텍스트 입력창 (새로 넣기 / 고치기)
let textCtx = null; // { mode: 'new', pt, c } | { mode: 'edit', id }
function openTextModal(ctx, value) {
  textCtx = ctx;
  $('textInput').value = value || '';
  openModal('textModal');
  setTimeout(() => $('textInput').focus(), 0);
}
function commitText() {
  const v = $('textInput').value.trim().slice(0, TEXT_MAX);
  closeModal($('textModal'));
  const ctx = textCtx; textCtx = null;
  if (!ctx || !v) return;
  if (ctx.mode === 'new') drawings.add({ type: 'text', t: ctx.pt.t, p: ctx.pt.p, c: ctx.c, text: v });
  else if (drawings.get(ctx.id) && drawings.get(ctx.id).text !== v) {
    drawings.snapshot(); drawings.patch(ctx.id, { text: v }); drawings.save();
  }
}
$('textOk').addEventListener('click', commitText);
$('textInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } });
$('hintEditText').addEventListener('click', () => {
  const d = drawings.get(drawings.getSel());
  if (d && d.type === 'text') openTextModal({ mode: 'edit', id: d.id }, d.text);
});
$('hintCancel').addEventListener('click', () => { R.pick = false; select(null); setTool(null); });
$('hintDelete').addEventListener('click', () => { const id = drawings.getSel(); select(null); if (id) drawings.remove(id); });

function pointAt(x, y) {
  if (!S.bars.length) return null;
  const p = series.coordinateToPrice(y);
  const l = ts.coordinateToLogical(x);
  if (p == null || l == null) return null;
  return { t: chartToMs(logicalToTime(l)), p: Math.round(p * 100) / 100 };
}

// 탭 처리는 직접 한다: 차트 자체 click은 0.5초 안의 두 번째 클릭을 더블클릭 대기로 삼켜서
// 박스 두 꼭짓점을 빨리 찍으면 빠진다.
const chartEl = $('chart');
const taps = new Map(); // pointerId → {x, y, t}
let multiTouch = false;
let drag = null; // {id, pointerId, handle|null, start:{l,p}, orig}
function localXY(e) {
  const r = chartEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width - chart.priceScale('right').width(), h: r.height - ts.height() };
}
chartEl.addEventListener('pointerdown', e => {
  taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (taps.size > 1) { multiTouch = true; drag = null; return; }
  const sid = drawings.getSel();
  if (!sid || tool) return;
  const { x, y, w, h } = localXY(e);
  const tol = e.pointerType === 'mouse' ? 10 : 22;
  const handle = drawings.handleAt(x, y, w, h, tol);
  if (!handle && !drawings.hitTest(x, y, tol, sid)) return;
  const l = ts.coordinateToLogical(x), p = series.coordinateToPrice(y);
  if (l == null || p == null) return;
  drag = { id: sid, pointerId: e.pointerId, handle, start: { l, p }, orig: { ...drawings.get(sid) }, moved: false };
  try { chartEl.setPointerCapture(e.pointerId); } catch {}
}, true);
chartEl.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { x, y } = localXY(e);
  const l = ts.coordinateToLogical(x), p = series.coordinateToPrice(y);
  if (l == null || p == null) return;
  if (!drag.moved) drawings.snapshot(); // 끌기 한 번 = 되돌리기 한 단계
  drag.moved = true;
  const o = drag.orig, round = v => Math.round(v * 100) / 100;
  if (drag.handle) {
    // 손잡이: 그 꼭짓점만 손가락 위치로
    const f = drag.handle.pk ? { [drag.handle.pk]: round(p) } : {};
    if (drag.handle.tk) f[drag.handle.tk] = chartToMs(logicalToTime(l));
    drawings.patch(drag.id, f);
  } else {
    // 몸통: 가격·봉 개수만큼 통째로 이동
    const dp = p - drag.start.p, dl = Math.round(l - drag.start.l);
    const shiftT = t => chartToMs(logicalToTime(timeToLogical(msToChart(t)) + dl));
    const f = o.p != null ? { p: round(o.p + dp) } : {};
    if (o.t != null) f.t = shiftT(o.t);
    if (o.type === 'box') { f.p2 = round(o.p2 + dp); f.t2 = shiftT(o.t2); }
    drawings.patch(drag.id, f);
  }
}, true);
const endTap = e => {
  if (drag && e.pointerId === drag.pointerId) {
    const moved = drag.moved;
    drag = null;
    if (moved) { drawings.save(); taps.delete(e.pointerId); return; }
  }
  const d = taps.get(e.pointerId);
  taps.delete(e.pointerId);
  if (!d) return;
  const wasMulti = multiTouch;
  if (!taps.size) multiTouch = false;
  if (e.type !== 'pointerup' || wasMulti || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return; // 끌기·길게 누르기는 탭 아님
  const r = chartEl.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const paneW = r.width - chart.priceScale('right').width(), paneH = r.height - ts.height();
  if (x < 0 || y < 0 || x > paneW || y > paneH) return; // 축 위 탭은 무시
  onTap(x, y);
};
chartEl.addEventListener('pointerup', endTap, true);
chartEl.addEventListener('pointercancel', endTap, true);

function onTap(x, y) {
  if (R.pick) { replay.pickAt(y); return; } // 리플레이: 내 스탑 자리 찍기
  if (!tool) {
    // 도구 없이 탭: 그림을 고르면 수정 모드, 매매 마커면 원문 카드, 빈 곳이면 해제
    const sid = drawings.getSel();
    if (sid && drawings.hitTest(x, y, 22, sid)) return;
    const hit = drawings.hitTest(x, y, 18);
    if (!hit && !sid) { const m = marks.hitTest(x, y); if (m) { openCard(m.tr, m.e); return; } }
    select(hit ? hit.id : null);
    return;
  }
  if (tool === 'erase') {
    const hit = drawings.hitTest(x, y);
    if (hit) { drawings.remove(hit.id); setTool(null); }
    else toast('여기엔 지울 그림이 없습니다', { ms: 1500 });
    return;
  }
  const pt = pointAt(x, y);
  if (!pt) return;
  const c = toolColors[tool];
  if (tool === 'hline') drawings.add({ type: 'hline', p: pt.p, c });
  else if (tool === 'vline') drawings.add({ type: 'vline', t: pt.t, c });
  else if (tool === 'dot') drawings.add({ type: 'dot', t: pt.t, p: pt.p, c });
  else if (tool === 'ray') drawings.add({ type: 'ray', t: pt.t, p: pt.p, c });
  else if (tool === 'text') { setTool(null); openTextModal({ mode: 'new', pt, c }, ''); return; }
  else if (tool === 'box') {
    const first = drawings.getPending();
    if (!first) { drawings.setPending(pt); showHint(HINTS.box2); return; }
    if (first.t === pt.t && first.p === pt.p) return;
    drawings.add({ type: 'box', t: first.t, p: first.p, t2: pt.t, p2: pt.p, c });
  }
  setTool(null);
}

function refreshAll() { drawings.refresh(); marks.refresh(); }

// ───────────────────────── A안: 암호화된 글·장부 풀기 (PBKDF2-SHA256 → AES-GCM, tools/encrypt_data.py와 짝)
// 봉투: { v:1, alg:'AES-256-GCM', kdf:'PBKDF2-SHA256', iter, salt, iv, ct }  (base64, ct는 암호문+태그)
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64e = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };

async function loadEnvelopes() {
  const get = async name => {
    const r = await fetch(`data/${name}.enc`, { cache: 'no-cache' });
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  };
  const [posts, trades] = await Promise.all([get('posts'), get('trades')]);
  const ok = e => e && e.v === 1 && e.salt && e.iv && e.ct && Number.isFinite(e.iter);
  return ok(posts) && ok(trades) ? { posts, trades } : null;
}
async function deriveKey(pw, env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64d(env.salt), iterations: env.iter },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function openEnvelope(key, env) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
const sameKdf = E => E.posts.salt === E.trades.salt && E.posts.iter === E.trades.iter;

async function unlockWithPassword(pw, remember) {
  const E = vault.enc;
  if (!window.crypto || !crypto.subtle) throw new Error('이 주소에서는 브라우저 암호 기능을 쓸 수 없습니다 (https 또는 localhost 필요)');
  const k1 = await deriveKey(pw, E.posts);
  const k2 = sameKdf(E) ? k1 : await deriveKey(pw, E.trades);
  const posts = await openEnvelope(k1, E.posts);
  const trades = await openEnvelope(k2, E.trades);
  if (remember && k1 === k2) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k1));
    store.set(KEY_KEY, { salt: E.posts.salt, key: b64e(raw) });
  }
  setVault(posts, trades, 'enc');
}
async function unlockWithSaved() {
  const E = vault.enc, saved = store.get(KEY_KEY, null);
  if (!saved || saved.salt !== E.posts.salt || !sameKdf(E) || !window.crypto || !crypto.subtle) return false;
  try {
    const key = await crypto.subtle.importKey('raw', b64d(saved.key), { name: 'AES-GCM' }, false, ['decrypt']);
    setVault(await openEnvelope(key, E.posts), await openEnvelope(key, E.trades), 'enc');
    return true;
  } catch {
    store.del(KEY_KEY); // 파일이 새 비번으로 바뀌었으면 기억한 키는 버린다
    return false;
  }
}

async function initVault() {
  if (new URLSearchParams(location.search).has('sample')) {
    try {
      const [p, t] = await Promise.all([fetchJson('docs/sample_posts.json'), fetchJson('docs/sample_trades.json')]);
      setVault(p, t, 'sample');
    } catch (e) { toast('샘플을 읽지 못했습니다', { error: true, detail: e.message }); }
    return;
  }
  let env = null;
  try { env = await loadEnvelopes(); } catch { env = null; }
  if (env) {
    vault.enc = env;
    if (!(await unlockWithSaved())) panel.build();
    return;
  }
  const local = store.get(LOCAL_KEY, null);
  if (local && Array.isArray(local.posts)) { setVault(local.posts, local.trades, 'file'); return; }
  panel.build();
}

// B안: 파일 가져오기 (posts.json · trades.json, 한 번에 둘 다 골라도 됨)
$('vaultFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  let posts = vault.source === 'file' ? vault.posts : null, trades = vault.source === 'file' ? vault.trades : null;
  try {
    for (const f of files) {
      const d = JSON.parse(await f.text());
      if (d && !Array.isArray(d) && (d.posts || d.trades)) { posts = d.posts || posts; trades = d.trades || trades; continue; }
      if (!Array.isArray(d)) throw new Error(`${f.name}: 배열이 아닙니다`);
      if (d.length && Array.isArray(d[0].events)) trades = d; else posts = d;
    }
  } catch (err) { toast('파일을 읽지 못했습니다', { error: true, detail: err.message }); return; }
  setVault(posts || [], trades || [], 'file');
  const saved = store.set(LOCAL_KEY, { posts: posts || [], trades: trades || [] });
  toast(`글 ${vault.posts.length}개 · 매매 ${vault.trades.length}개를 가져왔습니다${saved ? '' : ' (이 기기에 저장은 못 함 — 새로 열면 다시 가져오기)'}`, { ms: 5000 });
});

function openLock() {
  $('lockPw').value = '';
  openModal('lockModal');
  setTimeout(() => $('lockPw').focus(), 0);
}
async function doUnlock() {
  const pw = $('lockPw').value;
  if (!pw) return;
  $('lockOk').disabled = true; $('lockOk').textContent = '여는 중…';
  try {
    await unlockWithPassword(pw, $('lockRemember').checked);
    closeModal($('lockModal'));
    toast(`글 ${vault.posts.length}개 · 매매 ${vault.trades.length}개를 열었습니다`);
  } catch (e) {
    toast(e.name === 'OperationError' ? '비밀번호가 맞지 않습니다' : '열지 못했습니다', { error: true, detail: e.name === 'OperationError' ? '' : e.message });
  } finally {
    $('lockOk').disabled = false; $('lockOk').textContent = '열기';
    $('lockPw').value = '';
  }
}
$('lockOk').addEventListener('click', doUnlock);
$('lockPw').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doUnlock(); } });

// ───────────────────────── 관점 패널 (posts 타임라인 — 원문 그대로, 줄바꿈 유지)
const panel = (() => {
  const body = $('postList'), empty = $('sideEmpty');
  const prefs0 = store.get(PREF_KEY, {});
  let filter = ['all', 'view', 'signal'].includes(prefs0.filter) ? prefs0.filter : 'all';
  let q = '';
  let items = [];      // {p, el} — 시간순
  let sel = null;      // 고른 글 id
  let near = null;
  let follow = prefs0.follow !== false;
  let holdUntil = 0;   // 손으로 목록을 움직인 직후엔 따라가기를 잠깐 멈춘다
  let followQueued = false;

  $('followChk').checked = follow;
  document.querySelectorAll('#kindChips button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));

  const matchKind = p => filter === 'all' || (filter === 'view' ? p.kind === 'view' : p.kind === 'signal' || p.kind === 'risk');
  const shown = p => !blindOn() || p.t < R.now || p.t <= R.shownT;

  function emptyState() {
    empty.innerHTML = '';
    let html;
    if (vault.enc && !vault.posts.length) {
      html = `<b>🔒 글·장부가 잠겨 있습니다.</b><br>비밀번호를 넣으면 이 브라우저 안에서만 풀립니다. 차트는 비밀번호 없이도 그대로 볼 수 있습니다.
        <div class="row"><button class="btn accent" data-act="lock">비밀번호 입력</button></div>`;
    } else if (!vault.posts.length) {
      html = `<b>관점방 글·장부 파일이 아직 없습니다.</b><br>
        장부 세션이 암호화 파일(<code>data/posts.enc</code>·<code>data/trades.enc</code>)을 올리면 비밀번호로 열립니다.
        지금은 기기에 있는 <code>posts.json</code>·<code>trades.json</code>을 직접 넣거나(B안), 가짜 샘플로 화면을 볼 수 있습니다.
        <div class="row"><button class="btn accent" data-act="file">파일 가져오기</button><button class="btn" data-act="sample">샘플로 보기</button></div>`;
    } else return false;
    empty.innerHTML = html;
    empty.querySelector('[data-act=lock]')?.addEventListener('click', openLock);
    empty.querySelector('[data-act=file]')?.addEventListener('click', () => $('vaultFile').click());
    empty.querySelector('[data-act=sample]')?.addEventListener('click', () => { location.search = '?sample=1'; });
    return true;
  }

  function el(p) {
    const d = document.createElement('div');
    const kind = KIND_LABEL[p.kind] ? p.kind : 'chat';
    d.className = `post k-${kind}`;
    d.style.setProperty('--k', `var(--k-${kind})`);
    d.dataset.id = p.id;
    const tr = p.trade && vault.trade.get(p.trade);
    d.innerHTML = `<div class="ph"><span>${fmtUtc(p.t)}</span><span class="kd">${KIND_LABEL[kind]}</span>${tr ? `<button class="tr" title="이 매매 보기">${esc(tr.id)}</button>` : ''}</div>`;
    const tx = document.createElement('div');
    tx.className = 'tx' + (p.photo ? ' photo' : '');
    tx.textContent = p.photo ? '📷 사진(내보내기에 없음)' : p.text; // 원문 그대로 — 고치거나 줄이지 않는다
    d.appendChild(tx);
    return d;
  }

  function build() {
    const has = vault.posts.length > 0;
    body.hidden = !has;
    empty.hidden = !emptyState();
    $('sampleBadge').innerHTML = vault.source === 'sample' ? ' <span class="badge-sample">샘플</span>' : '';
    body.innerHTML = '';
    items = [];
    if (!has) { $('sideCount').textContent = ''; return; }
    const ql = q.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    for (const p of vault.posts) {
      if (!matchKind(p)) continue;
      if (ql && !p.text.toLowerCase().includes(ql)) continue;
      const e = el(p);
      if (p.id === sel) e.classList.add('sel');
      items.push({ p, el: e });
      frag.appendChild(e);
    }
    body.appendChild(frag);
    applyBlind();
  }

  function applyBlind() {
    let n = 0;
    for (const it of items) { const s = shown(it.p); it.el.hidden = !s; if (s) n++; }
    $('sideCount').textContent = items.length ? `${n}${n !== vault.posts.length ? ` / ${vault.posts.length}` : ''}` : '';
    near = null;
    doFollow(true);
  }

  // 목록 안에서만 스크롤 (페이지·폰 화면이 같이 움직이지 않게)
  function scrollToEl(e, force) {
    const top = e.offsetTop - body.offsetTop, bot = top + e.offsetHeight;
    if (!force && top >= body.scrollTop && bot <= body.scrollTop + body.clientHeight) return;
    body.scrollTop = top - body.clientHeight / 2 + e.offsetHeight / 2;
  }

  // 차트 가운데 시각에 가장 가까운(그 시각 이전의 마지막) 글로 따라간다
  function doFollow(force = false) {
    if (!items.length || !S.bars.length) return;
    if (!force && (!follow || performance.now() < holdUntil)) return;
    if (force && !follow) return;
    const r = ts.getVisibleLogicalRange(); if (!r) return;
    const center = logicalToTime((r.from + r.to) / 2) - KST;
    let best = null;
    for (const it of items) { if (it.el.hidden) continue; if (it.p.t <= center) best = it; else { if (!best) best = it; break; } }
    if (!best || best === near) return;
    near?.el.classList.remove('near');
    near = best; near.el.classList.add('near');
    scrollToEl(near.el, false);
  }
  function followSoon() {
    if (followQueued) return;
    followQueued = true;
    requestAnimationFrame(() => { followQueued = false; doFollow(); });
  }

  function select(id, { jump = true, scroll = true } = {}) {
    sel = id;
    for (const it of items) it.el.classList.toggle('sel', it.p.id === id);
    const p = vault.post.get(id);
    marks.refresh();
    if (!p) return;
    const it = items.find(x => x.p.id === id);
    if (it && scroll) scrollToEl(it.el, true);
    if (jump) {
      holdUntil = performance.now() + 1500;
      jumpTo(p.t * 1000, { mark: false });
    }
  }

  body.addEventListener('click', e => {
    const d = e.target.closest('.post'); if (!d) return;
    const p = vault.post.get(d.dataset.id); if (!p) return;
    if (e.target.closest('.tr')) { const tr = vault.trade.get(p.trade); if (tr) openCard(tr, tr.events.find(x => x.post === p.id)); return; }
    select(p.id);
  });
  for (const ev of ['wheel', 'touchstart', 'pointerdown']) body.addEventListener(ev, () => { holdUntil = performance.now() + 2500; }, { passive: true });

  document.querySelectorAll('#kindChips button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.f;
    document.querySelectorAll('#kindChips button').forEach(x => x.classList.toggle('on', x === b));
    store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), filter });
    build();
  }));
  let qTimer = 0;
  $('postSearch').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { q = e.target.value; build(); }, 200); });
  $('followChk').addEventListener('change', e => {
    follow = e.target.checked;
    store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), follow });
    if (follow) { holdUntil = 0; doFollow(); }
  });

  return {
    build, applyBlind, select,
    follow: followSoon,
    refollow() { near?.el.classList.remove('near'); near = null; doFollow(true); }, // 숨어 있던 서랍을 열 때
    selT: () => (sel && vault.post.get(sel) ? vault.post.get(sel).t : null),
  };
})();

// 패널 켜기/끄기 (PC) · 서랍 열기/닫기 (폰 세로)
const appEl = document.querySelector('.app');
function setSide(on) {
  appEl.classList.toggle('noside', !on);
  $('sideBtn').classList.toggle('on', on);
  store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), side: on });
}
$('sideBtn').addEventListener('click', () => setSide(appEl.classList.contains('noside')));
$('drawerGrip').addEventListener('click', () => {
  const open = $('side').classList.toggle('open');
  $('gripArrow').textContent = open ? '▾' : '▴';
  if (open) panel.refollow();
});
$('markBtn').addEventListener('click', () => marks.toggle());

// ───────────────────────── 매매 카드 (마커·매매 칩 탭 → 원문 + 요약)
// MFE/MAE: 진입~종료 사이 1분봉 고가·저가 (첫 진입가 대비)
async function excursion(tr) {
  const { entry, exit, dir, ep } = tradeBasics(tr);
  if (!onChart(tr) || !entry || !exit || ep == null) return null;
  const a = entry.t, b = exit.t;
  const months = new Set([ymOf(a + KST), ymOf(b + KST)]);
  const all = klines.months('1m');
  const bars = await loadMonths('1m', [...months].filter(m => all.includes(m)));
  let hi = -Infinity, lo = Infinity;
  for (const x of bars) {
    const u = x.time - KST;
    if (u < a || u >= b + 60) continue; // 종료 분의 봉까지
    if (x.high > hi) hi = x.high; if (x.low < lo) lo = x.low;
  }
  if (!Number.isFinite(hi)) return null;
  const up = (hi - ep) / ep * 100, down = (lo - ep) / ep * 100;
  return dir > 0 ? { mfe: up, mae: down } : { mfe: -down, mae: -up };
}

function evDetail(e) {
  const bits = [];
  if (Number.isFinite(e.price)) bits.push(`@ ${fmtPrice(e.price)}`);
  if (e.type === 'reduce' && e.pct != null) bits.push(`${e.pct}%`);
  if (e.type === 'stop' && Number.isFinite(e.stop)) bits.push(`→ ${fmtPrice(e.stop)}`);
  if (Number.isFinite(e.cum)) bits.push(`누적 ${e.cum}%`);
  if (Number.isFinite(e.quoted)) bits.push(`(글의 숫자 ${e.quoted})`);
  if (Number.isFinite(e.avg)) bits.push(`(글의 평단 ${e.avg})`);
  return bits.join(' ');
}
function postText(id) {
  const p = id && vault.post.get(id);
  if (!p) return '';
  return p.photo ? '📷 사진(내보내기에 없음)' : p.text;
}

// 결과 줄: 누적(cum)이 다 있으면 비중 반영 값이 대표, 첫 진입가 → 종료가는 참고로
const resCls = v => (v == null ? 'n' : v >= 0 ? 'u' : 'd');
const subNote = t => `<span style="color:var(--text-sub);font-size:11px">${t}</span>`;
function resultRows(tr, B) {
  if (!onChart(tr)) return `<dt>종목</dt><dd>${esc(tr.asset)} ${subNote('BTC 차트에 그리지 않음 · 가격 없음')}</dd>`;
  const simple = `<dd><span class="res ${resCls(B.result)}">${fmtPct(B.result)}</span> ${subNote('첫 진입가 → 종료가')}</dd>`;
  const P = B.pos;
  if (!P) return `<dt>결과</dt>${simple}`;
  if (!P.ok) return `<dt>결과</dt>${simple}<dt>비중 반영</dt><dd>— ${subNote(esc(P.why))}</dd>`;
  const left = P.open > 0 ? ` · 남은 누적 ${P.open}% 종료 기록 없음` : '';
  return `<dt>결과 (비중 반영)</dt><dd><span class="res ${resCls(P.result)}">${fmtPct(P.result)}</span> ${subNote(`청산분 누적 크기로 가중 · 레버 미반영`)}</dd>
    <dt>누적</dt><dd>최대 ${P.maxQty}% · 평단 ${P.avg != null ? fmtPrice(P.avg) : '—'}${left}</dd>
    <dt>참고</dt>${simple}`;
}

let cardTrade = null;
async function openCard(tr, hitEv = null) {
  cardTrade = tr;
  marks.highlight(tr, hitEv);
  const live = blindOn() && tr === R.trade && R.step < tr.events.length; // 리플레이 중이면 앞날은 숨김
  const evs = tr.events.filter(e => evShown(tr, e));
  const B = tradeBasics(tr);
  const head = `<h3><span class="side-chip ${tr.side}">${SIDE_LABEL[tr.side] || tr.side}</span> ${esc(tr.id)} · ${fmtUtc(B.entry ? B.entry.t : tr.events[0].t)}</h3>
    <div class="row" style="margin-top:4px">${tr.flags.map(f => `<span class="flag">${esc(f)}</span>`).join('')}
    ${tr.confidence === 'low' ? '<span class="flag low">확인 필요(confidence: low)</span>' : ''}
    ${tr.status && tr.status !== 'closed' ? `<span class="flag">${esc(tr.status)}</span>` : ''}</div>`;
  const kv = live ? '<p class="sub" style="margin-top:10px">리플레이 중 — 요약은 끝나면 보입니다.</p>' : `<dl class="kv">
    <dt>진입가</dt><dd>${B.ep != null ? fmtPrice(B.ep) : '—'}</dd>
    <dt>첫 스탑 거리</dt><dd>${B.stopDist != null ? `${fmtPrice(B.stopDist)} (${(B.stopDist / B.ep * 100).toFixed(2)}%)` : '—'}</dd>
    <dt>보유 시간</dt><dd>${B.hold != null ? fmtDur(B.hold) : '종료 기록 없음'}</dd>
    <dt>MFE / MAE</dt><dd id="cardExc">${B.exit ? '계산 중…' : '—'}</dd>
    ${resultRows(tr, B)}
  </dl>`;
  const list = evs.map(e => `<li class="${e === hitEv ? 'hit' : ''} ${e.corrected_by ? 'corr' : ''}">
      <div class="eh"><span>${fmtUtc(e.t)}</span><b>${EV_LABEL[e.type]}</b><span>${esc(evDetail(e))}</span>
      ${e.corrected_by ? `<span class="note">정정됨 → ${esc(e.corrected_by)}</span>` : ''}</div>
      ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      ${e.post ? `<div class="tx">${esc(postText(e.post))}</div>` : ''}</li>`).join('');
  // 계획·레버리지 변경 메시지 (사건 아님 — 시각순)
  const side = [...(tr.plans || []).map(x => ({ ...x, k: '계획' })), ...(Array.isArray(tr.size) ? tr.size : []).map(x => ({ ...x, k: '레버·규모' }))]
    .filter(x => Number.isFinite(x.t) && (!blindOn() || x.t < R.now || x.t <= R.shownT)).sort((a, b) => a.t - b.t);
  const plans = side.map(pl => `<li><div class="eh"><span>${fmtUtc(pl.t)}</span><b>${pl.k}</b><span>(사건 아님)</span>${pl.note ? `<span class="note">${esc(pl.note)}</span>` : ''}</div>${pl.post ? `<div class="tx">${esc(postText(pl.post))}</div>` : ''}</li>`).join('');
  $('cardBody').innerHTML = `${head}${kv}<div class="label">사건 ${evs.length}${live ? ` / ${tr.events.length}` : ''}</div><ul class="evs">${list}</ul>
    ${plans ? `<div class="label">계획 · 레버리지 메시지</div><ul class="evs">${plans}</ul>` : ''}
    <div class="row end">
      ${R.trade || !onChart(tr) ? '' : '<button class="btn" id="cardGo">차트에서 보기</button><button class="btn accent" id="cardReplay">이 매매 리플레이</button>'}
      <button class="btn" data-close>닫기</button>
    </div>`;
  $('cardGo')?.addEventListener('click', () => { closeModal($('cardModal')); showTrade(tr); });
  $('cardReplay')?.addEventListener('click', () => { closeModal($('cardModal')); replay.start(tr); });
  openModal('cardModal');
  if (!live && B.exit) {
    try {
      const x = await excursion(tr);
      if (cardTrade === tr && $('cardExc')) $('cardExc').textContent = x ? `${fmtPct(x.mfe)} / ${fmtPct(x.mae)}` : '— (그 달 1분봉 없음)';
    } catch (e) { if ($('cardExc')) $('cardExc').textContent = '— (1분봉을 읽지 못함)'; }
  }
}
// 매매 전체가 보이게 이동
function showTrade(tr) {
  const a = tr.events[0].t, b = tr.events[tr.events.length - 1].t;
  const span = Math.max(60, (b - a) / sec());
  jumpTo((a + (b - a) / 2) * 1000, { mark: false, width: Math.max(80, span * 1.6) });
}

// ───────────────────────── 리플레이 답 (브라우저 저장 — 내보내기에 포함)
// { [매매 id]: { trade, side, open, updatedAt, steps: { [사건 번호]: { act, side?, stop?, memo?, now, iv, at } } } }
// 사건 번호 i = 그의 i번째 사건(0 = 진입)을 열기 직전에 적은 내 판단
const answers = (() => {
  const okStep = a => a && typeof a.act === 'string';
  let all = store.get(ANS_KEY, {}) || {};
  if (typeof all !== 'object' || Array.isArray(all)) all = {};
  const persist = () => { if (!store.set(ANS_KEY, all)) toast('이 브라우저에 저장하지 못했습니다 — 내보내기로 백업하세요', { error: true, ms: 6000 }); };
  return {
    all: () => JSON.parse(JSON.stringify(all)),
    count: () => Object.keys(all).filter(k => Object.keys(all[k].steps || {}).length).length,
    steps: id => (all[id] && all[id].steps) || {},
    set(tr, i, a) {
      const rec = all[tr.id] || (all[tr.id] = { trade: tr.id, side: tr.side, open: tr.events[0].t, steps: {} });
      rec.steps[i] = { ...a, at: new Date().toISOString() };
      rec.updatedAt = rec.steps[i].at;
      persist();
    },
    clear(id) { delete all[id]; persist(); },
    // 합치기: 없는 답은 더하고, 같은 자리는 나중에 적은 것(at)을 남긴다
    importMany(obj) {
      if (!obj || typeof obj !== 'object') return 0;
      let n = 0;
      for (const [id, rec] of Object.entries(obj)) {
        if (!rec || typeof rec.steps !== 'object') continue;
        const mine = all[id] || (all[id] = { trade: id, side: rec.side, open: rec.open, steps: {} });
        for (const [i, a] of Object.entries(rec.steps)) {
          if (!okStep(a)) continue;
          const cur = mine.steps[i];
          if (!cur || String(a.at || '') > String(cur.at || '')) { mine.steps[i] = a; n++; }
        }
        mine.updatedAt = Object.values(mine.steps).map(a => a.at || '').sort().pop();
      }
      persist();
      return n;
    },
  };
})();

const ACTS0 = [['enter', '들어간다'], ['skip', '안 들어간다']];
const ACTS = [['hold', '유지'], ['stop', '스탑 이동'], ['reduce', '일부 정리'], ['add', '추가(불타기)'], ['tp', '익절 예약'], ['exit', '종료']];
const ACT_LABEL = Object.fromEntries([...ACTS0, ...ACTS]);

// ───────────────────────── 리플레이 (블라인드 → 나라면? → 다음 사건 → … → 나란히 보기)
const replay = (() => {
  const bar = $('rbar'), wrap = document.querySelector('.chart-wrap');
  const evs = () => R.trade.events;

  function start(tr) {
    stopPlay();
    closeModal($('tradeModal'));
    R.trade = tr; R.step = 0; R.shownT = -Infinity; R.blind = true; R.draft = null;
    R.now = tr.events[0].t; // 진입 시각 직전 봉까지만
    marks.highlight(null);
    bar.hidden = false; wrap.classList.add('replaying');
    pushSeries(true);
    panel.applyBlind();
    update();
    jumpTo(R.now * 1000, { mark: false, pos: 0.75, width: 160 });
    setTimeout(openMine, 350);
  }

  function end() {
    stopPlay();
    R.trade = null; R.draft = null; R.pick = false;
    bar.hidden = true; wrap.classList.remove('replaying');
    pushSeries(true, true);
    panel.applyBlind();
    refreshAll(); updateLegend();
  }

  // 지금 칸이 화면 오른쪽 안에 보이도록
  function keepInView() {
    const r = ts.getVisibleLogicalRange(); if (!r) return;
    const idx = shownLen - 1, width = r.to - r.from;
    if (idx > r.to - 6 || idx < r.from) ts.setVisibleLogicalRange({ from: idx - width * 0.75, to: idx + width * 0.25 });
  }
  async function ensureBars() {
    for (let k = 0; k < 3; k++) {
      const last = S.bars[S.bars.length - 1];
      if (!last || last.time - KST + sec() >= R.now || S.atLatest) return;
      await loadRight();
    }
  }
  async function moved() {
    await ensureBars();
    pushSeries();
    keepInView();
    panel.applyBlind();
    update();
    refreshAll(); updateLegend();
  }

  // ▶ 1봉 — 다음 사건 시각에서 멈춘다 (그 전에 「나라면?」을 적을 수 있게)
  async function step() {
    if (!R.trade) return false;
    const s = sec(), nx = R.step < evs().length ? evs()[R.step].t : Infinity;
    let t = Math.floor(R.now / s) * s + s;
    if (t > nx) {
      if (R.now < nx) t = nx;
      else { stopPlay(); toast('그의 다음 사건 시각입니다 — 「나라면?」을 적고 「다음 사건」을 여세요', { ms: 3000 }); return false; }
    }
    if (t * 1000 > klines.endMs() + 60000) { stopPlay(); toast('데이터 끝입니다 (2024-12-06)'); return false; }
    R.now = t;
    await moved();
    return true;
  }

  // ▶▶ 다음 사건 — 그의 실제 행동 하나를 원문과 함께 연다
  async function next() {
    if (!R.trade) return;
    stopPlay();
    if (R.step >= evs().length) { finish(); return; }
    const e = evs()[R.step];
    R.now = Math.max(R.now, e.t);
    R.step++; R.shownT = e.t; R.draft = null;
    await moved();
    if (e.post) panel.select(e.post, { jump: false });
    marks.highlight(R.trade, e);
    if (R.step >= evs().length) toast(R.trade.status === 'closed' ? '마지막 사건입니다 — 「끝 · 나란히 보기」' : '기록된 사건은 여기까지입니다 (종료 기록 없음)', { ms: 3500 });
  }

  function play() {
    if (R.timer) { stopPlay(); return; }
    const sp = +$('rbSpeed').value || 3;
    let busy = false;
    R.timer = setInterval(async () => {
      if (busy) return; busy = true;
      try { if (!(await step())) stopPlay(); } finally { busy = false; }
    }, 1000 / sp);
    $('rbPlay').classList.add('on');
  }
  function stopPlay() {
    clearInterval(R.timer); R.timer = 0;
    $('rbPlay').classList.remove('on');
  }

  function toggleBlind() {
    R.blind = !R.blind;
    pushSeries(true, true);
    panel.applyBlind();
    update(); refreshAll(); updateLegend();
  }

  function update() {
    if (!R.trade) return;
    const tr = R.trade, n = evs().length;
    $('rbTitle').textContent = `${tr.id} ${SIDE_LABEL[tr.side] || ''}`;
    const mine = answers.steps(tr.id)[R.step];
    $('rbInfo').textContent = `${fmtUtc(R.now)} · 사건 ${R.step}/${n}${R.blind ? '' : ' · 전체 보기'}${mine ? ' · ✍ 적음' : ''}`;
    const last = R.step > 0 ? evs()[R.step - 1] : null;
    $('rbEvent').innerHTML = last
      ? `<span class="who">${fmtUtc(last.t, false)} ${EV_LABEL[last.type]} ${esc(evDetail(last))}</span>${esc(postText(last.post))}`
      : '';
    $('rbNext').innerHTML = R.step >= n ? '끝<span class="lbl2">&nbsp;· 나란히 보기</span>' : '▶▶<span class="lbl2">&nbsp;다음 사건</span>';
    $('rbBlind').classList.toggle('on', R.blind);
    $('rbBlind').textContent = R.blind ? '블라인드' : '전체 보기';
  }

  // 나라면? — 지금 칸(R.step)에 대한 내 판단
  function openMine() {
    if (!R.trade) return;
    const first = R.step === 0;
    const cur = R.draft || { ...(answers.steps(R.trade.id)[R.step] || {}) };
    R.draft = cur;
    $('mineTitle').textContent = first ? '나라면? — 진입 전' : `나라면? — 사건 ${R.step + 1}/${evs().length} 전`;
    const acts = first ? ACTS0 : ACTS;
    const box = $('mineActs'); box.innerHTML = '';
    for (const [k, label] of acts) {
      const b = document.createElement('button'); b.className = 'btn' + (cur.act === k ? ' on' : ''); b.textContent = label;
      b.addEventListener('click', () => { cur.act = k; [...box.children].forEach(x => x.classList.toggle('on', x === b)); syncMine(); });
      box.appendChild(b);
    }
    $('mineMemo').value = cur.memo || '';
    syncMine();
    openModal('mineModal');
  }
  function syncMine() {
    const cur = R.draft || {};
    const first = R.step === 0;
    $('mineSideRow').hidden = !(first && cur.act === 'enter');
    document.querySelectorAll('#mineSides button').forEach(b => b.classList.toggle('on', b.dataset.side === cur.side));
    $('mineStop').textContent = Number.isFinite(cur.stop) ? fmtPrice(cur.stop) : '—';
    marks.refresh();
  }
  document.querySelectorAll('#mineSides button').forEach(b => b.addEventListener('click', () => { if (R.draft) { R.draft.side = b.dataset.side; syncMine(); } }));
  $('minePick').addEventListener('click', () => {
    if (!R.draft) return;
    R.draft.memo = $('mineMemo').value;
    closeModal($('mineModal'));
    setTool(null); select(null);
    R.pick = true;
    showHint('스탑 자리 — 차트에서 가격을 탭하세요');
  });
  $('mineStopClear').addEventListener('click', () => { if (R.draft) { delete R.draft.stop; syncMine(); } });
  $('mineSave').addEventListener('click', () => {
    const d = R.draft; if (!d || !R.trade) return;
    d.memo = $('mineMemo').value.trim();
    if (!d.act) { toast('행동을 하나 고르세요', { error: true, ms: 2000 }); return; }
    if (R.step === 0 && d.act === 'enter' && !d.side) { toast('방향(롱/숏)을 고르세요', { error: true, ms: 2000 }); return; }
    const a = { act: d.act, now: R.now, iv: S.iv };
    if (R.step === 0 && d.act === 'enter') a.side = d.side;
    if (Number.isFinite(d.stop)) a.stop = d.stop;
    if (d.memo) a.memo = d.memo;
    answers.set(R.trade, R.step, a);
    R.draft = null;
    closeModal($('mineModal'));
    update(); marks.refresh();
    toast('적었습니다 — 「다음 사건」으로 그의 행동을 여세요', { ms: 2200 });
  });
  // 차트 탭으로 스탑 찍기 (onTap에서 부른다)
  function pickAt(y) {
    const p = series.coordinateToPrice(y);
    R.pick = false; showHint(null);
    if (p == null || !R.draft) return;
    R.draft.stop = Math.round(p * 100) / 100;
    openModal('mineModal');
    syncMine();
  }
  $('mineModal').addEventListener('click', e => {
    // 닫기·바깥 탭으로 닫으면 적던 것은 버린다 (저장한 답은 그대로)
    if (e.target === $('mineModal') || e.target.hasAttribute('data-close')) { R.draft = null; marks.refresh(); }
  });

  // 끝: 그의 전 과정과 내 판단을 나란히 (같은 행동인가만 — 잘잘못 판정 없음)
  function finish() {
    const tr = R.trade; if (!tr) return;
    const steps = answers.steps(tr.id);
    let same = 0, diff = 0, none = 0;
    const rows = tr.events.map((e, i) => {
      const a = steps[i];
      let m = 'none';
      if (a) {
        const ok = e.type === 'entry' ? a.act === 'enter' && a.side === tr.side : a.act === EV_ACT[e.type];
        m = ok ? 'same' : 'diff';
      }
      if (m === 'same') same++; else if (m === 'diff') diff++; else none++;
      const mine = a ? `${ACT_LABEL[a.act] || a.act}${a.side ? ` ${SIDE_LABEL[a.side]}` : ''}${Number.isFinite(a.stop) ? ` · 스탑 ${fmtPrice(a.stop)}` : ''}${a.memo ? `<div class="src">${esc(a.memo)}</div>` : ''}` : '—';
      return `<tr><td class="t">${fmtUtc(e.t, false)}</td>
        <td><b>${EV_LABEL[e.type]}</b> ${esc(evDetail(e))}${e.corrected_by ? ' <span class="note">정정됨</span>' : ''}${e.post ? `<div class="src">${esc(postText(e.post))}</div>` : ''}</td>
        <td>${mine}</td>
        <td class="${m}">${{ same: '같음', diff: '다름', none: '—' }[m]}</td></tr>`;
    }).join('');
    const extra = Object.keys(steps).filter(i => +i >= tr.events.length).length;
    $('cmpBody').innerHTML = `<h3>나란히 보기 — ${esc(tr.id)} ${SIDE_LABEL[tr.side] || ''}</h3>
      <p class="sub">왼쪽은 그의 실제 사건(원문), 오른쪽은 그 사건을 열기 직전에 내가 적은 판단입니다. 「같음」은 <b>같은 행동인가</b>만 뜻합니다 — 잘잘못 판정이 아닙니다.
      같음 ${same} · 다름 ${diff} · 안 적음 ${none}${extra ? ` · 마지막 사건 뒤에 적은 답 ${extra}개(표에 없음)` : ''}</p>
      <div style="overflow:auto"><table class="cmp"><thead><tr><th>시각</th><th>그</th><th>나</th><th>같은 행동?</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row end">
        <button class="btn danger" id="cmpClear">이 매매 답 지우기</button>
        <button class="btn" id="cmpAll">전체 보기로</button>
        <button class="btn" id="cmpEnd">리플레이 끝내기</button>
        <button class="btn accent" data-close>닫기</button>
      </div>`;
    $('cmpClear').addEventListener('click', () => {
      if (!confirm(`${tr.id}에 적은 답을 모두 지울까요?`)) return;
      answers.clear(tr.id); closeModal($('cmpModal')); update(); marks.refresh();
    });
    $('cmpAll').addEventListener('click', () => { closeModal($('cmpModal')); if (R.blind) toggleBlind(); showTrade(tr); });
    $('cmpEnd').addEventListener('click', () => { closeModal($('cmpModal')); end(); });
    openModal('cmpModal');
  }

  $('rbMine').addEventListener('click', openMine);
  $('rbStep').addEventListener('click', () => { stopPlay(); step(); });
  $('rbNext').addEventListener('click', next);
  $('rbPlay').addEventListener('click', play);
  $('rbSpeed').addEventListener('change', () => { if (R.timer) { stopPlay(); play(); } });
  $('rbBlind').addEventListener('click', toggleBlind);
  $('rbEnd').addEventListener('click', end);

  return { start, end, step, next, play, stopPlay, openMine, pickAt, finish };
})();

// 매매 목록
function renderTradeList() {
  const ul = $('tradeList'); ul.innerHTML = '';
  $('tradeCount').textContent = vault.trades.length;
  if (!vault.trades.length) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="side-empty" style="padding:6px 2px">${vault.enc && !vault.posts.length ? '🔒 글·장부가 잠겨 있습니다 — 관점 패널에서 비밀번호를 넣으세요.' : '매매 데이터가 없습니다.'}</div>`;
    ul.appendChild(li); return;
  }
  for (const tr of vault.trades) {
    const B = tradeBasics(tr);
    const n = Object.keys(answers.steps(tr.id)).length;
    const li = document.createElement('li');
    const go = document.createElement('button'); go.className = 'trow';
    go.innerHTML = `<span class="d">${fmtUtc(tr.events[0].t)}</span><span class="side-chip ${tr.side}">${SIDE_LABEL[tr.side] || esc(tr.side)}</span>
      <span class="res ${resCls(mainResult(B))}" title="${B.wresult != null ? '비중 반영(누적 %)' : '첫 진입가 → 종료가'}">${mainResult(B) == null ? (tr.status === 'closed' ? '—' : '종료 없음') : fmtPct(mainResult(B)) + (B.wresult != null ? '<sup>w</sup>' : '')}</span>
      ${onChart(tr) ? '' : `<span class="flag">${esc(tr.asset)}</span>`}
      <span class="d">${esc(tr.id)}</span>
      ${tr.flags.map(f => `<span class="flag">${esc(f)}</span>`).join('')}
      ${tr.confidence === 'low' ? '<span class="flag low">확인 필요</span>' : ''}
      ${n ? `<span class="flag mine">✍ ${n}</span>` : ''}`;
    go.title = '블라인드 리플레이 시작';
    go.addEventListener('click', () => {
      if (!onChart(tr)) { closeModal($('tradeModal')); openCard(tr); toast(`${tr.asset} 매매는 BTC 차트로 리플레이할 수 없습니다 — 원문만 봅니다`, { ms: 3500 }); return; }
      replay.start(tr);
    });
    const see = document.createElement('button'); see.className = 'tbtn'; see.textContent = '보기'; see.title = '원문·요약 보기';
    see.addEventListener('click', () => { closeModal($('tradeModal')); showTrade(tr); openCard(tr); });
    li.append(go, see);
    ul.appendChild(li);
  }
}
$('replayBtn').addEventListener('click', () => {
  if (R.trade) { replay.finish(); return; }
  renderTradeList(); openModal('tradeModal');
});

// ───────────────────────── 시점 북마크 (보던 시각·봉 간격·확대 정도를 저장 → 누르면 그대로 돌아감)
// 저장 형식: { id, name, t (화면 가운데 실제 ms), iv, w (보이는 봉 수) }
const bookmarks = (() => {
  const ok = b => b && typeof b.id === 'string' && typeof b.name === 'string'
    && Number.isFinite(b.t) && IVS[b.iv] && Number.isFinite(b.w);
  let list = (store.get(BM_KEY, []) || []).filter(ok);
  const persist = () => {
    if (!store.set(BM_KEY, list)) toast('이 브라우저에 저장하지 못했습니다', { error: true });
    render();
  };

  function render() {
    const ul = $('bmList');
    ul.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li'); li.className = 'bm-empty';
      li.textContent = '아직 없음 — 공부하던 자리에서 저장해 두면 여기서 바로 돌아갑니다';
      ul.appendChild(li);
    }
    for (const b of list) {
      const li = document.createElement('li');
      const go = document.createElement('button'); go.className = 'bm-go';
      const nm = document.createElement('span'); nm.className = 'bm-name'; nm.textContent = b.name;
      const sub = document.createElement('span'); sub.className = 'bm-sub';
      sub.textContent = `${fmtChartTime(msToChart(b.t))} · ${IV_LABEL[b.iv]}`;
      go.append(nm, sub);
      go.addEventListener('click', () => { closeModal($('gotoModal')); goTo(b); });
      const del = document.createElement('button'); del.className = 'bm-del'; del.textContent = '✕'; del.title = '삭제';
      del.addEventListener('click', () => {
        if (!confirm(`'${b.name}' 북마크를 지울까요?`)) return;
        list = list.filter(x => x.id !== b.id); persist();
      });
      li.append(go, del);
      ul.appendChild(li);
    }
    $('bmCount').textContent = list.length;
  }

  function goTo(b) {
    if (b.iv !== S.iv) switchInterval(b.iv, { centerMs: b.t, width: b.w });
    else jumpTo(b.t, { mark: false, width: b.w });
  }

  function saveCurrent(name) {
    const r = ts.getVisibleLogicalRange();
    if (!r || !S.bars.length) { toast('차트가 아직 안 떴습니다', { error: true }); return; }
    const t = chartToMs(logicalToTime((r.from + r.to) / 2));
    const b = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: (name || '').trim() || fmtChartTime(msToChart(t)),
      t, iv: S.iv, w: Math.round(r.to - r.from),
    };
    list.unshift(b); persist();
    toast(`📌 '${b.name}' 저장했습니다`);
  }

  function importMany(arr) {
    if (!Array.isArray(arr)) return 0;
    const have = new Set(list.map(b => b.id));
    let added = 0;
    for (const b of arr) {
      if (!ok(b) || have.has(b.id)) continue;
      list.push({ id: b.id, name: b.name, t: b.t, iv: b.iv, w: b.w }); have.add(b.id); added++;
    }
    list.sort((a, b) => b.id.localeCompare(a.id)); // 최근 저장한 것이 위로 (id가 저장 시각 기반)
    persist();
    return added;
  }

  render();
  return { all: () => list.slice(), count: () => list.length, saveCurrent, importMany, goTo };
})();

$('bmSave').addEventListener('click', () => { bookmarks.saveCurrent($('bmName').value); $('bmName').value = ''; });
$('bmName').addEventListener('keydown', e => { if (e.key === 'Enter') $('bmSave').click(); });

// ───────────────────────── 팝업
function openModal(id) { $(id).classList.add('show'); }
function closeModal(el) {
  el.classList.remove('show');
  if (el.contains(document.activeElement)) document.activeElement.blur(); // 숨은 입력칸이 단축키를 막지 않게
}
document.querySelectorAll('.backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd || e.target.hasAttribute('data-close')) closeModal(bd); });
});

// 날짜 이동 (입력은 KST)
function kstInputValue(ms) {
  const d = new Date(ms + KST * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function parseKstInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST * 1000;
}
$('gotoBtn').addEventListener('click', () => {
  const inp = $('gotoInput');
  inp.min = kstInputValue(klines.startMs());
  inp.max = kstInputValue(klines.endMs());
  if (!inp.value) {
    const r = ts.getVisibleLogicalRange();
    inp.value = kstInputValue(r && S.bars.length ? chartToMs(logicalToTime((r.from + r.to) / 2)) : klines.endMs());
  }
  openModal('gotoModal');
});
function doGoto(ms) {
  if (ms == null || isNaN(ms)) { toast('날짜·시각을 입력하세요', { error: true }); return; }
  ms = clampMs(ms);
  if (blindOn() && ms > R.now * 1000) { ms = R.now * 1000; toast('블라인드 중이라 「여기까지」보다 뒤로는 못 갑니다', { ms: 2500 }); }
  closeModal($('gotoModal'));
  jumpTo(ms);
}
$('gotoGo').addEventListener('click', () => doGoto(parseKstInput($('gotoInput').value)));
$('gotoInput').addEventListener('keydown', e => { if (e.key === 'Enter') doGoto(parseKstInput(e.target.value)); });
document.querySelectorAll('#gotoModal [data-date]').forEach(b => b.addEventListener('click', () => {
  $('gotoInput').value = b.dataset.date;
  doGoto(parseKstInput(b.dataset.date));
}));

// 최신으로 = 2024-12-06 마지막 봉 (리플레이 중이면 「여기까지」)
$('latestBtn').addEventListener('click', () => {
  S.jumpT = null;
  if (blindOn()) { ts.scrollToRealTime(); refreshAll(); }
  else if (S.atLatest) { ts.scrollToRealTime(); refreshAll(); }
  else loadLatest();
});

// 내보내기 / 가져오기 (그림 · 북마크 · 리플레이 답을 한 JSON으로 — 형식은 README)
function exportPayload() {
  return JSON.stringify({
    app: '99-replay', version: 1, symbol: SYMBOL,
    exportedAt: new Date().toISOString(), drawings: drawings.all(), bookmarks: bookmarks.all(),
    replay: { key: ANS_KEY, answers: answers.all() },
  }, null, 1);
}
function countsText() { return `그림 ${drawings.count()}개 · 북마크 ${bookmarks.count()}개 · 리플레이 답 ${answers.count()}매매`; }
$('dataBtn').addEventListener('click', () => {
  $('drawCount').textContent = drawings.count();
  $('bmCount2').textContent = bookmarks.count();
  $('ansCount').textContent = answers.count();
  openModal('dataModal');
});
$('exportFile').addEventListener('click', () => {
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `99-replay-${kstInputValue(Date.now()).replace(/[-:]/g, '').replace('T', '-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('exportCopy').addEventListener('click', async () => {
  const text = exportPayload();
  try { await navigator.clipboard.writeText(text); toast(`${countsText()}를 복사했습니다`); }
  catch { $('importText').value = text; $('importText').select(); toast('자동 복사가 막혀 있어요 — 아래 칸의 텍스트를 직접 복사하세요', { ms: 5000 }); }
});
function importText(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast('JSON 형식이 아닙니다', { error: true }); return; }
  const arr = Array.isArray(data) ? data : data && data.drawings;
  const ans = data && data.replay && data.replay.answers;
  if (!Array.isArray(arr) && !ans) { toast('그림·리플레이 답을 찾지 못했습니다', { error: true }); return; }
  const { added, bad } = Array.isArray(arr) ? drawings.importMany(arr) : { added: 0, bad: 0 };
  const bmAdded = bookmarks.importMany(data && data.bookmarks);
  const ansAdded = answers.importMany(ans);
  $('drawCount').textContent = drawings.count();
  $('bmCount2').textContent = bookmarks.count();
  $('ansCount').textContent = answers.count();
  marks.refresh();
  toast(`그림 ${added}개${bmAdded ? ` · 북마크 ${bmAdded}개` : ''}${ansAdded ? ` · 리플레이 답 ${ansAdded}칸` : ''} 가져왔습니다${bad ? ` (잘못된 항목 ${bad}개 건너뜀)` : ''}`);
}
$('importFileBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  importText(await f.text());
  e.target.value = '';
});
$('importPaste').addEventListener('click', () => {
  const v = $('importText').value.trim();
  if (!v) { toast('붙여넣은 내용이 없습니다', { error: true }); return; }
  importText(v);
  $('importText').value = '';
});
$('clearAll').addEventListener('click', () => {
  if (!drawings.count()) return;
  if (!confirm(`그림 ${drawings.count()}개를 모두 지울까요? (먼저 내보내기로 백업 권장)`)) return;
  drawings.clear();
  $('drawCount').textContent = 0;
});

// 봉 간격 버튼
document.querySelectorAll('#ivSeg button').forEach(b => b.addEventListener('click', () => switchInterval(b.dataset.iv)));

// 단축키 (PC)
document.addEventListener('keydown', e => {
  const inField = e.target.matches('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault(); undo(); return;
  }
  if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    const open = document.querySelector('.backdrop.show');
    if (open) closeModal(open);
    else { R.pick = false; select(null); setTool(null); }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && drawings.getSel()) { $('hintDelete').click(); return; }
  if (document.querySelector('.backdrop.show')) return;
  // 리플레이: → 1봉 · Shift+→ 다음 사건 · Space 자동재생
  if (R.trade) {
    if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) replay.next(); else { replay.stopPlay(); replay.step(); } return; }
    if (e.key === ' ') { e.preventDefault(); replay.play(); return; }
  }
  const map = { h: 'hline', v: 'vline', b: 'box', d: 'dot', r: 'ray', t: 'text', e: 'erase' };
  const k = e.key.toLowerCase();
  if (map[k]) setTool(tool === map[k] ? null : map[k]);
  else if (k === 'g') $('gotoBtn').click();
  else if (k === 'l') $('latestBtn').click();
  else if (k === 'p') $('replayBtn').click();
  else if (k === 'o') $('sideBtn').click();
  else if (k === 'm') marks.toggle();
  else if (k === 'n' && R.trade) replay.next();
  else if (k === '1') switchInterval('1m');
  else if (k === '2') switchInterval('5m');
  else if (k === '3') switchInterval('15m');
  else if (k === '4') switchInterval('1h');
});

// 와이드 버튼
let wantWide = false;
$('wideBtn')?.addEventListener('click', () => {
  wantWide = !wantWide;
  store.set(PREF_KEY, { ...store.get(PREF_KEY, {}), wide: wantWide });
  wide.apply(wantWide);
});
window.addEventListener('resize', () => wide.apply(wantWide));

// ───────────────────────── 시작
const prefs = store.get(PREF_KEY, {});
wantWide = !!prefs.wide;
wide.apply(wantWide);
S.iv = IVS[prefs.iv] ? prefs.iv : '5m';
document.querySelectorAll('#ivSeg button').forEach(b => b.classList.toggle('on', b.dataset.iv === S.iv));
if (prefs.side === false) setSide(false);
$('markBtn').classList.toggle('on', marks.isOn());
updateLegend();
klines.init()
  .then(() => loadLatest())
  .catch(e => toast('시세 목록(data/klines/index.json)을 읽지 못했습니다 — tools/build_klines.py 로 만들어 주세요', { error: true, detail: e.message, ms: 10000 }));
initVault();

// 디버그·테스트용
window.__replay = { S, R, vault, stopSegs, tradeBasics, chart, series, drawings, bookmarks, answers, replay, panel, jumpTo, switchInterval, wide, klines };
})();
