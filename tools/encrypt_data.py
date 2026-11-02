"""관점방 리플레이 — 글·장부 암호화 (공통설계 §6 A안 · 02_차트_작업지시 §1-7)

data/posts.json · data/trades.json (평문, .gitignore) → data/posts.enc · data/trades.enc (올리는 것)

- PBKDF2-HMAC-SHA256(반복 310,000) → AES-256-GCM. 브라우저(app.js)가 WebCrypto로 같은 방식으로 푼다.
- 두 파일은 같은 salt·반복 수를 쓴다 → 브라우저가 키를 한 번만 만든다(폰에서 빠름), 「이 기기에서 기억」도 가능.
  iv(nonce)는 파일마다 새로 뽑는다.
- **비밀번호는 실행할 때 입력만 한다.** 저장소·코드·문서·명령줄 어디에도 남기지 않는다.

쓰는 법 (저장소 루트에서):
    pip install cryptography
    python tools/encrypt_data.py                       # data/posts.json · data/trades.json
    python tools/encrypt_data.py --src ..\\장부          # 다른 폴더의 평문을 읽어 data/*.enc 로
    python tools/encrypt_data.py --check               # 만든 .enc가 다시 풀리는지만 확인
"""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.hashes import SHA256
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    raise SystemExit('cryptography 패키지가 필요합니다: pip install cryptography')

ROOT = Path(__file__).resolve().parent.parent
ITER = 310_000
NAMES = ('posts', 'trades')


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode('ascii')


def derive(pw: str, salt: bytes, iters: int) -> bytes:
    return PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=iters).derive(pw.encode('utf-8'))


def seal(key: bytes, salt: bytes, iters: int, plain: bytes) -> dict:
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, plain, None)  # 암호문 + 16바이트 태그 (WebCrypto와 같은 배치)
    return {'v': 1, 'alg': 'AES-256-GCM', 'kdf': 'PBKDF2-SHA256', 'iter': iters,
            'salt': b64(salt), 'iv': b64(iv), 'ct': b64(ct)}


def unseal(pw: str, env: dict) -> bytes:
    key = derive(pw, base64.b64decode(env['salt']), env['iter'])
    return AESGCM(key).decrypt(base64.b64decode(env['iv']), base64.b64decode(env['ct']), None)


def ask(confirm: bool) -> str:
    pw = os.environ.get('NINE9_PW')  # 자동화용 (셸 기록에 남지 않게 환경변수로만)
    if pw:
        return pw
    pw = getpass.getpass('비밀번호: ')
    if not pw:
        raise SystemExit('비밀번호가 비었습니다')
    if confirm and getpass.getpass('한 번 더: ') != pw:
        raise SystemExit('두 번 입력이 다릅니다')
    return pw


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', type=Path, default=ROOT / 'data', help='평문 posts.json·trades.json 폴더 (기본 data/)')
    ap.add_argument('--out', type=Path, default=ROOT / 'data', help='.enc 출력 폴더 (기본 data/)')
    ap.add_argument('--check', action='store_true', help='만든 .enc가 풀리는지만 확인')
    args = ap.parse_args()

    if args.check:
        pw = ask(False)
        for n in NAMES:
            env = json.loads((args.out / f'{n}.enc').read_text(encoding='utf-8'))
            data = json.loads(unseal(pw, env))
            print(f'{n}.enc: 풀림 — {len(data)}개')
        return

    plains = {}
    for n in NAMES:
        p = args.src / f'{n}.json'
        if not p.exists():
            raise SystemExit(f'없음: {p}')
        data = json.loads(p.read_bytes())
        if not isinstance(data, list):
            raise SystemExit(f'{p.name}: 배열이 아닙니다 (공통설계 §4)')
        # 공백만 줄여 다시 쓴다 (원문 text 값은 그대로)
        plains[n] = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        print(f'{p.name}: {len(data)}개')

    pw = ask(True)
    salt = os.urandom(16)
    key = derive(pw, salt, ITER)
    args.out.mkdir(parents=True, exist_ok=True)
    for n, plain in plains.items():
        env = seal(key, salt, ITER, plain)
        assert unseal(pw, env) == plain
        (args.out / f'{n}.enc').write_text(json.dumps(env), encoding='utf-8')
        print(f'→ {args.out / (n + ".enc")}')
    print('평문 posts.json·trades.json은 .gitignore 대상입니다 — git status로 올라가지 않는지 확인하세요.')


if __name__ == '__main__':
    main()
