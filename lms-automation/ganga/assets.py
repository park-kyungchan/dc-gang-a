# -*- coding: utf-8 -*-
"""
교재 PDF 로컬 에셋 저장소.

비용에 대한 사실 정리 (자주 헷갈리는 부분)
    · **PDF 다운로드는 무료입니다.** `storage.studyq.net` 은 정적 스토리지라
      토큰도, API 비용도 없습니다. 드는 것은 대역폭과 시간뿐입니다.
      그래도 한 번만 받아 두는 게 맞습니다 — 300쪽 PDF 를 매번 받으면 느리고,
      교실 와이파이가 끊기면 아예 못 봅니다.
    · **강의영상 URL 의 토큰은 '요금'이 아니라 '만료 시각'입니다.**
      KT CDN HLS 주소에 박힌 JWT 는 시간이 지나면 죽습니다. 그래서 URL 을
      저장해 두면 안 되고, 볼 때마다 LMS 에서 새로 받아야 합니다.
      재발급 자체는 페이지 1회 조회라 사실상 공짜입니다.
    · **돈이 드는 것은 LLM 호출뿐입니다.** 수업일지 문장을 만들 때만
      발생하고, 조회·검색·PDF 열람에는 한 푼도 들지 않습니다.

즉 캐시의 목적은 비용 절감이 아니라 **속도와 오프라인 가용성**입니다.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import ASSET_DIR, ROOT

#: 기존에 수동으로 받아 둔 PDF 들이 있는 곳
LEGACY_DIR = ROOT / "data" / "answers"

MANIFEST = ASSET_DIR / "_manifest.json"


@dataclass
class Asset:
    filename: str
    url: str
    size: int
    sha256: str
    pages: int | None = None

    @property
    def path(self) -> Path:
        return ASSET_DIR / self.filename

    @property
    def size_mb(self) -> float:
        return round(self.size / 1_000_000, 1)


def _sha256(p: Path, limit: int = 8 << 20) -> str:
    """앞 8MB 만 해싱합니다. 무결성 확인 용도이고 전체 해싱은 느립니다."""
    h = hashlib.sha256()
    with p.open("rb") as f:
        h.update(f.read(limit))
    return h.hexdigest()[:16]


def _page_count(p: Path) -> int | None:
    try:
        import pymupdf  # type: ignore[import-not-found]
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore[import-not-found, no-redef]
        except ImportError:
            return None
    try:
        with pymupdf.open(p) as doc:
            return len(doc)
    except Exception:  # noqa: BLE001
        return None


def load_manifest() -> dict[str, Asset]:
    if not MANIFEST.exists():
        return {}
    try:
        raw = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: Asset(**v) for k, v in raw.items()}


def save_manifest(m: dict[str, Asset]) -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps({k: asdict(v) for k, v in m.items()}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _register(path: Path, url: str, manifest: dict[str, Asset]) -> Asset:
    a = Asset(
        filename=path.name, url=url, size=path.stat().st_size,
        sha256=_sha256(path), pages=_page_count(path),
    )
    manifest[path.name] = a
    return a


def adopt_legacy(manifest: dict[str, Asset] | None = None) -> list[Asset]:
    """`data/answers/` 에 이미 받아 둔 PDF 를 에셋 저장소로 편입합니다.

    다시 내려받을 이유가 없으니 복사만 합니다.
    """
    m = manifest if manifest is not None else load_manifest()
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    adopted: list[Asset] = []
    if not LEGACY_DIR.exists():
        return adopted

    for src in sorted(LEGACY_DIR.glob("*.pdf")):
        # 한글 임시 파일명(기본.pdf 등)은 규칙에 안 맞아 건너뜁니다.
        if not src.name.startswith("g") or "_" not in src.name:
            continue
        dst = ASSET_DIR / src.name
        if dst.exists() and src.name in m:
            continue
        if not dst.exists():
            shutil.copy2(src, dst)
        adopted.append(_register(dst, url="(local)", manifest=m))

    if manifest is None:
        save_manifest(m)
    return adopted


def is_cached(filename: str) -> bool:
    return (ASSET_DIR / filename).exists()


def fetch(url: str, *, force: bool = False, timeout: int = 180) -> Asset:
    """PDF 를 한 번만 내려받아 로컬에 보관합니다.

    이미 있으면 네트워크를 아예 건드리지 않습니다.
    """
    filename = url.rsplit("/", 1)[-1]
    dst = ASSET_DIR / filename
    m = load_manifest()

    if dst.exists() and not force:
        if filename not in m:
            _register(dst, url, m)
            save_manifest(m)
        return m[filename]

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    import urllib.request

    tmp = dst.with_suffix(dst.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r, tmp.open("wb") as f:
        shutil.copyfileobj(r, f)

    head = tmp.open("rb").read(5)
    if not head.startswith(b"%PDF"):
        tmp.unlink(missing_ok=True)
        raise ValueError(f"PDF 가 아닙니다: {filename} (앞 5바이트 {head!r})")

    tmp.replace(dst)
    a = _register(dst, url, m)
    save_manifest(m)
    return a


def ensure(filenames: list[str], catalog_path: Path | None = None) -> dict[str, str]:
    """카탈로그에서 URL 을 찾아 없는 것만 내려받습니다.

    반환: {filename: 상태문자열}
    """
    from .config import CATALOG_DIR

    cat_file = catalog_path or (CATALOG_DIR / "answer_sheets.json")
    if not cat_file.exists():
        return {f: "카탈로그 없음 — fetch_answer_catalog 를 먼저 실행하세요" for f in filenames}

    entries = json.loads(cat_file.read_text(encoding="utf-8"))
    by_name = {e["url"].rsplit("/", 1)[-1]: e["url"] for e in entries}

    out: dict[str, str] = {}
    for fn in filenames:
        if is_cached(fn):
            out[fn] = "이미 보유"
            continue
        url = by_name.get(fn)
        if not url:
            out[fn] = "카탈로그에 없음"
            continue
        try:
            a = fetch(url)
            out[fn] = f"내려받음 ({a.size_mb}MB, {a.pages}쪽)"
        except Exception as exc:  # noqa: BLE001
            out[fn] = f"실패: {exc}"
    return out


def summary() -> dict[str, object]:
    m = load_manifest()
    total = sum(a.size for a in m.values())
    return {
        "count": len(m),
        "total_mb": round(total / 1_000_000, 1),
        "pages": sum(a.pages or 0 for a in m.values()),
        "files": sorted(m),
    }
