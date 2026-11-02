"""관점방 리플레이 — 고정 시세 파일 만들기 (02_차트_작업지시 §1-2)

data.binance.vision 현물 BTCUSDT 1분봉 아카이브(zip) → data/klines/{1m,5m,15m,1h}/YYYY-MM.bin + index.json

- 범위: 2022-01-01 00:00 KST ~ 2024-12-06 23:59 KST (관점방 내보내기 시각까지)
  → KST 시작이 UTC 2021-12-31 15:00 이라 2021-12-31 일간 파일도 받는다.
- 월 파일은 **KST 달** 기준으로 나눈다 (화면이 KST라서). 1h 봉도 KST 자정 = UTC 15시 정각이라 한 달에만 속한다.
- 형식: 봉마다 int32 little-endian 5개 = 20바이트
    t(분 단위 UTC epoch, 봉 시작) · o · h · l · c (가격 ×100 정수 — 소수 둘째 자리까지 그대로)
- 상위 간격(5m·15m·1h)은 1분봉을 UTC 기준으로 합친다(바이낸스 봉과 같은 경계).

쓰는 법 (저장소 루트에서):
    python tools/build_klines.py                 # 받기 + 만들기 (캐시: ../_cache, 없으면 ./_cache)
    python tools/build_klines.py --cache D:\\99\\BRUCE-TRADING\\관점방\\_cache
    python tools/build_klines.py --no-download   # 캐시에 있는 zip만으로
표준 라이브러리만 쓴다.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import time
import urllib.request
import zipfile
from array import array
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SYMBOL = 'BTCUSDT'
BASE = 'https://data.binance.vision/data/spot'
KST = 9 * 3600
START = int(datetime(2022, 1, 1, tzinfo=timezone(timedelta(hours=9))).timestamp())   # 포함
END = int(datetime(2024, 12, 7, tzinfo=timezone(timedelta(hours=9))).timestamp())    # 제외 (12-06 23:59 KST 봉까지)
IVS = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600}
SCALE = 100

ROOT = Path(__file__).resolve().parent.parent


def archive_list() -> list[tuple[str, str]]:
    """(종류, 이름) — 종류는 monthly/daily, 이름은 YYYY-MM 또는 YYYY-MM-DD"""
    out = [('daily', '2021-12-31')]
    y, m = 2022, 1
    while (y, m) <= (2024, 11):
        out.append(('monthly', f'{y}-{m:02d}'))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    for d in range(1, 7):
        out.append(('daily', f'2024-12-{d:02d}'))
    return out


def zip_name(name: str) -> str:
    return f'{SYMBOL}-1m-{name}.zip'


def url_of(kind: str, name: str) -> str:
    return f'{BASE}/{kind}/klines/{SYMBOL}/1m/{zip_name(name)}'


def fetch(url: str, tries: int = 4) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:  # 네트워크 오류는 몇 번 더
            if i == tries - 1:
                raise
            wait = 2 ** (i + 1)
            print(f'  ! {e} — {wait}s 뒤 다시', file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError('unreachable')


def ensure_zip(cache: Path, kind: str, name: str, download: bool) -> Path | None:
    p = cache / zip_name(name)
    if p.exists():
        return p
    if not download:
        return None
    url = url_of(kind, name)
    print(f'  받기 {url}')
    body = fetch(url)
    # 바이낸스가 같이 주는 sha256으로 확인 (못 받으면 건너뜀)
    try:
        want = fetch(url + '.CHECKSUM', tries=2).decode().split()[0].lower()
        got = hashlib.sha256(body).hexdigest()
        if want != got:
            raise SystemExit(f'체크섬 불일치: {name} ({got} != {want})')
    except SystemExit:
        raise
    except Exception as e:
        print(f'  ! 체크섬 확인 건너뜀: {e}', file=sys.stderr)
    tmp = p.with_suffix('.part')
    tmp.write_bytes(body)
    tmp.replace(p)
    return p


def to_seconds(raw: int) -> int:
    """바이낸스 시각 → 초. 2025년부터 아카이브가 마이크로초로 바뀐 적이 있어 자릿수로 판별한다."""
    if raw >= 10 ** 15:      # 마이크로초 (16자리)
        return raw // 1_000_000
    if raw >= 10 ** 12:      # 밀리초 (13자리)
        return raw // 1000
    return raw               # 초


def read_zip(p: Path):
    with zipfile.ZipFile(p) as z:
        for member in z.namelist():
            if not member.endswith('.csv'):
                continue
            with z.open(member) as f:
                for row in csv.reader(io.TextIOWrapper(f, encoding='utf-8')):
                    if not row or not row[0].strip().isdigit():
                        continue  # 머리줄
                    t = to_seconds(int(row[0]))
                    yield t, row[1], row[2], row[3], row[4]


def price(s: str) -> int:
    return round(float(s) * SCALE)


def kst_month(t: int) -> str:
    d = datetime.fromtimestamp(t + KST, tz=timezone.utc)
    return f'{d.year}-{d.month:02d}'


def aggregate(bars: list[tuple[int, int, int, int, int]], sec: int):
    out = []
    cur = None
    for t, o, h, l, c in bars:
        b = t - t % sec
        if cur and cur[0] == b:
            cur[2] = max(cur[2], h)
            cur[3] = min(cur[3], l)
            cur[4] = c
        else:
            if cur:
                out.append(tuple(cur))
            cur = [b, o, h, l, c]
    if cur:
        out.append(tuple(cur))
    return out


def write_months(out_dir: Path, iv: str, bars) -> dict:
    d = out_dir / iv
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob('*.bin'):
        old.unlink()
    groups: dict[str, array] = {}
    for t, o, h, l, c in bars:
        a = groups.setdefault(kst_month(t), array('i'))
        a.extend((t // 60, o, h, l, c))
    for ym, a in groups.items():
        if sys.byteorder != 'little':
            a.byteswap()
        (d / f'{ym}.bin').write_bytes(a.tobytes())
    return {
        'sec': IVS[iv],
        'months': sorted(groups),
        'count': len(bars),
        'first': bars[0][0] if bars else None,
        'last': bars[-1][0] if bars else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    default_cache = ROOT.parent / '_cache'
    if not default_cache.exists():
        default_cache = ROOT / '_cache'
    ap.add_argument('--cache', type=Path, default=default_cache, help=f'zip 캐시 폴더 (기본 {default_cache})')
    ap.add_argument('--out', type=Path, default=ROOT / 'data' / 'klines', help='출력 폴더 (기본 data/klines)')
    ap.add_argument('--no-download', action='store_true', help='받지 않고 캐시에 있는 zip만 쓴다')
    args = ap.parse_args()

    args.cache.mkdir(parents=True, exist_ok=True)
    print(f'캐시: {args.cache}')
    rows: dict[int, tuple[int, int, int, int, int]] = {}
    missing = []
    for kind, name in archive_list():
        p = ensure_zip(args.cache, kind, name, not args.no_download)
        if not p:
            missing.append(name)
            continue
        n = 0
        for t, o, h, l, c in read_zip(p):
            if START <= t < END and t % 60 == 0:
                rows[t] = (t, price(o), price(h), price(l), price(c))
                n += 1
        print(f'  {p.name}: {n:,}봉')
    if missing:
        print(f'! 캐시에 없는 파일 {len(missing)}개: {", ".join(missing)}', file=sys.stderr)
    if not rows:
        raise SystemExit('봉이 하나도 없습니다')

    bars = [rows[t] for t in sorted(rows)]
    # 빈 분(바이낸스 점검 등) 보고 — 채우지 않는다 (눈대중 금지)
    gaps = [(a[0], b[0]) for a, b in zip(bars, bars[1:]) if b[0] - a[0] != 60]
    lost = sum((b - a) // 60 - 1 for a, b in gaps)
    print(f'1분봉 {len(bars):,}개 · 빈 구간 {len(gaps)}곳(빠진 분 {lost:,})')
    for a, b in gaps[:20]:
        fa = datetime.fromtimestamp(a + KST, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
        fb = datetime.fromtimestamp(b + KST, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
        print(f'  KST {fa} → {fb}')

    index = {
        'symbol': SYMBOL,
        'built': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'format': {'record': 20, 'type': 'int32le', 'fields': ['t_min', 'o', 'h', 'l', 'c'], 'price_scale': SCALE,
                   'months': 'KST'},
        'start': START, 'end': END,
        'intervals': {},
    }
    for iv, sec in IVS.items():
        ivbars = bars if sec == 60 else aggregate(bars, sec)
        index['intervals'][iv] = info = write_months(args.out, iv, ivbars)
        print(f'{iv}: {info["count"]:,}봉 · {len(info["months"])}개월')
    (args.out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'→ {args.out}')


if __name__ == '__main__':
    main()
