# -*- coding: utf-8 -*-
"""
학생 배정과 무관하게 수집 가능한 자료 카탈로그.

신규 온보딩 강사에게 가장 먼저 쓸모 있는 영역입니다. 학생그룹이 0개여도
아래는 전부 지금 당장 동작합니다.

  · 교재 정답지 / Daily / 정오표 / 샘플 PDF 인덱스 (초·중·고 367건)
  · 문제지 풀 (지점 전체 강사 제작물)
  · 형성평가 / 수시평가 / 학력인증평가 추천 시험지 목록
  · 지점 학생 명단 (reader.read_roster)

정답지 PDF 는 `<button onclick="MODULE.Commons.fullUrlDownloadFile('...')">` 안에
들어 있어 일반 링크 추출로는 잡히지 않습니다.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .endpoints import STUDY, exam_endpoints
from .session import LmsSession

#: 다운로드 버튼에 박힌 PDF URL
_DL = re.compile(r"fullUrlDownloadFile\(['\"](https?://[^'\"]+)['\"]\)")

#: 버튼 라벨 → 자료 종류
LABEL_MEANING = {
    "답": "정답지",
    "무": "무료본",
    "오": "정오표",
    "샘": "샘플교재",
    "D": "데일리테스트",
    "대": "대비교재",
}

GRADE_TABS = {"elementary": "초등부", "middle": "중등부", "high": "고등부"}


@dataclass
class AnswerSheet:
    """교재 자료 PDF 1건."""

    tab: str            # 초등부 / 중등부 / 고등부
    grade: str          # 초2, 중1, 고1 …
    level: str          # 기본 / 발전 / 심화 / 가우스 / 시그마 …
    column: str         # 합본 / 1학기 1권 …
    kind: str           # 정답지 / 정오표 / 샘플교재 …
    label: str          # 원본 버튼 글자
    url: str

    @property
    def filename(self) -> str:
        return self.url.rsplit("/", 1)[-1]

    def matches(self, q: str) -> bool:
        q = q.strip().lower()
        return q in " ".join(
            (self.tab, self.grade, self.level, self.column, self.kind, self.filename)
        ).lower()


@dataclass
class Catalog:
    sheets: list[AnswerSheet] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.sheets)

    def search(self, q: str) -> list[AnswerSheet]:
        return [s for s in self.sheets if s.matches(q)]

    def by_kind(self, kind: str) -> list[AnswerSheet]:
        return [s for s in self.sheets if s.kind == kind]

    def summary(self) -> str:
        tabs = Counter(s.tab for s in self.sheets)
        kinds = Counter(s.kind for s in self.sheets)
        return (
            f"총 {len(self.sheets)}건 | "
            + ", ".join(f"{k} {v}" for k, v in tabs.items())
            + " | "
            + ", ".join(f"{k} {v}" for k, v in kinds.most_common())
        )

    def save_json(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps([asdict(s) for s in self.sheets], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return p


def _header_columns(table) -> list[str]:
    """2단 헤더(합본 / 1학기 1·2·3권 / 2학기 1·2·3권)를 평탄한 열 이름으로."""
    rows = table.css("thead tr")
    if len(rows) < 2:
        return [c.get_all_text(strip=True) for c in table.css("thead th")]

    top, bottom = rows[0], rows[1]
    cols: list[str] = []
    sub = [c.get_all_text(strip=True) for c in bottom.css("th")]
    si = 0
    for th in top.css("th"):
        text = th.get_all_text(strip=True)
        span = int(th.attrib.get("colspan", "1"))
        if span == 1:
            cols.append(text)
        else:
            for _ in range(span):
                cols.append(f"{text} {sub[si]}" if si < len(sub) else text)
                si += 1
    return cols


def _parse_answer_table(table, tab_label: str) -> list[AnswerSheet]:
    """표를 훑어 다운로드 버튼을 전부 수집합니다.

    rowspan 산술 대신 **셀의 성격**으로 판단합니다. 앞쪽의 버튼 없는 셀이
    라벨(학년/레벨)이고 나머지가 자료 열입니다. rowspan 카운터를 직접 세면
    빈 `<tr>` 하나에 계산이 어긋나 행 전체를 놓칩니다 — 실제로 초4 기본
    20건이 그렇게 누락됐습니다.
    """
    cols = _header_columns(table)
    out: list[AnswerSheet] = []
    grade = level = ""

    for tr in table.css("tbody tr"):
        tds = tr.css("td")
        if not tds:
            continue

        # 선행 라벨 셀(버튼 없음)과 자료 셀(버튼 있음)을 가른다
        first_data = len(tds)
        for i, td in enumerate(tds):
            if td.css("button"):
                first_data = i
                break
        labels = [td.get_all_text(strip=True) for td in tds[:first_data]]

        # 라벨 2개면 (학년, 레벨), 1개면 레벨만 — 학년은 위 행에서 상속
        if len(labels) >= 2:
            grade, level = labels[0], labels[1]
        elif len(labels) == 1:
            level = labels[0]

        data_cells = tds[first_data:]
        # 자료 셀은 표 오른쪽 끝에 정렬되므로 뒤에서부터 열 이름을 맞춘다
        base = len(cols) - len(data_cells)
        for offset, td in enumerate(data_cells):
            ci = base + offset
            column = cols[ci] if 0 <= ci < len(cols) else f"열{offset + 1}"
            for btn in td.css("button"):
                m = _DL.search(btn.attrib.get("onclick", "") or "")
                if not m:
                    continue
                label = btn.get_all_text(strip=True)
                out.append(AnswerSheet(
                    tab=tab_label, grade=grade, level=level, column=column,
                    kind=LABEL_MEANING.get(label, label or "기타"),
                    label=label, url=m.group(1),
                ))
    return out


def fetch_answer_catalog(lms: LmsSession) -> Catalog:
    """초·중·고 3개 탭의 교재 자료 PDF 를 전부 수집합니다.

    ⚠️ 수집 결과에는 저작물 다운로드 링크가 들어 있습니다.
    공개 저장소나 GitHub Pages 에 올리지 마세요.
    """
    cat = Catalog()
    for key, label in GRADE_TABS.items():
        page = lms.get(f"{STUDY['answers'].url}&grade={key}")

        # 안전장치: grade 파라미터가 실제로 먹었는지 확인
        active = page.css("div.tab.tab-on")
        active_label = active[0].get_all_text(strip=True) if active else ""
        if active_label and active_label != label:
            cat.warnings.append(
                f"grade={key} 요청했으나 활성 탭이 '{active_label}' 입니다 — 수집 누락 가능"
            )

        tab_sheets: list[AnswerSheet] = []
        for table in page.css("table.content-table"):
            tab_sheets.extend(_parse_answer_table(table, label))

        # 대조: 원문에 있는 URL 이 하나도 빠지지 않았는지 확인합니다.
        #
        # ⚠️ 서버 HTML 이 일부 깨져 있습니다. 초등부 초4 '기본' 행은
        #    `</tr>` 다음에 `<tr>` 없이 `<td>기본</td>` 로 시작해서,
        #    표준 HTML 파서가 이 고아 셀들을 표 밖으로 밀어냅니다.
        #    (dc.gang-a.kr JSP 쪽 버그이며 브라우저에서도 동일)
        #    → 파일명 규칙으로 메타데이터를 복원해 담습니다. 조용한 손실 금지.
        raw = set(_DL.findall(page.html_content))
        got = {s.url for s in tab_sheets}
        orphans = sorted(raw - got)
        for url in orphans:
            tab_sheets.append(_infer_from_filename(url, label))
        if orphans:
            cat.warnings.append(
                f"{label}: 서버 HTML 의 표 구조가 깨진 행에서 {len(orphans)}건 발견 "
                f"(파일명으로 메타데이터 복원): "
                + ", ".join(u.rsplit('/', 1)[-1] for u in orphans[:3])
                + (" …" if len(orphans) > 3 else "")
            )

        cat.sheets.extend(tab_sheets)
    return cat


#: 파일명 규칙 (docs/LMS_SITEMAP.md §4.2 참고)
#:   g{학년}_{레벨}_{종류}[_{학기}_{권}].pdf
_FNAME = re.compile(
    r"g(?P<g>\d+)_(?P<level>[a-z]+)_(?P<kind>answer|daily|repair|sample|havruta)"
    r"(?:_(?P<term>\d+)_(?P<vol>\d+))?", re.I
)

_LEVEL_KO = {
    "basic": "기본", "develop": "발전", "ability": "심화", "highest": "최상위",
    "sigma": "시그마", "gauss": "가우스", "davinci": "다빈치",
    "euler": "오일러", "pascal": "파스칼",
}
_KIND_KO = {
    "answer": "정답지", "daily": "데일리테스트", "repair": "정오표",
    "sample": "샘플교재", "havruta": "하부르타",
}


def _infer_from_filename(url: str, tab_label: str) -> AnswerSheet:
    """표에서 못 건진 PDF 의 메타데이터를 파일명 규칙으로 복원합니다."""
    fn = url.rsplit("/", 1)[-1]
    m = _FNAME.search(fn)
    if not m:
        return AnswerSheet(tab=tab_label, grade="(미상)", level="(미상)",
                           column="(미상)", kind="기타", label="", url=url)

    prefix = {"초등부": "초", "중등부": "중", "고등부": "고"}.get(tab_label, "")
    num = int(m.group("g"))
    if tab_label == "중등부" and num > 6:
        num -= 6          # g7 = 중1
    grade = f"{prefix}{num}"

    kind = _KIND_KO.get((m.group("kind") or "").lower(), "기타")
    column = "합본"
    if m.group("term") and m.group("vol"):
        column = f"{m.group('term')}학기 {m.group('vol')}권"

    return AnswerSheet(
        tab=tab_label, grade=grade,
        level=_LEVEL_KO.get((m.group("level") or "").lower(), m.group("level") or ""),
        column=column, kind=kind, label="(복원)", url=url,
    )


# ─────────────────────────────────────────────────────────────
# 시험지 풀 (추천 시험지)
# ─────────────────────────────────────────────────────────────
@dataclass
class ExamPaper:
    kind: str        # fa / na / da
    kind_label: str  # 형성평가 / 수시평가 / 학력인증평가
    scope: str       # 출제 학년-단원
    title: str
    item_count: str


def fetch_exam_papers(lms: LmsSession, kinds=("fa", "na", "da")) -> list[ExamPaper]:
    """평가 3종의 시험지 목록을 수집합니다. 학생 배정과 무관하게 동작합니다.

    다른 선생님이 만든 시험지를 '시험복사'로 재활용할 수 있으므로,
    신규 강사에게는 이 목록 자체가 자산입니다.
    """
    labels = {"fa": "형성평가", "na": "수시평가", "da": "학력인증평가"}
    out: list[ExamPaper] = []
    for kind in kinds:
        ep = exam_endpoints(kind)["list"]
        try:
            page = lms.get(ep.url)
        except Exception:  # noqa: BLE001
            continue
        for row in page.css("table.content-table tbody tr"):
            cells = [td.get_all_text(strip=True) for td in row.css("td")]
            if len(cells) < 3:
                continue
            parts = [p.strip() for p in cells[1].split("\n") if p.strip()] if len(cells) > 1 else []
            out.append(ExamPaper(
                kind=kind, kind_label=labels[kind],
                scope=parts[0] if parts else cells[0],
                title=parts[1] if len(parts) > 1 else "",
                item_count=cells[2] if len(cells) > 2 else "",
            ))
    return out


def onboarding_report(lms: LmsSession) -> str:
    """학생 배정 전에 지금 당장 쓸 수 있는 것들을 한 번에 점검합니다."""
    from .reader import read_roster
    from .writer import preflight

    lines = [f"강사: {lms.teacher.name} ({lms.teacher.pri_no}) / 지점 {lms.teacher.fran_no}", ""]

    cat = fetch_answer_catalog(lms)
    lines.append(f"■ 교재 자료 PDF  {cat.summary()}")
    for w in cat.warnings:
        lines.append(f"    ⚠ {w}")

    papers = fetch_exam_papers(lms)
    by_kind = Counter(p.kind_label for p in papers)
    lines.append(f"■ 시험지 풀       총 {len(papers)}건 | "
                 + ", ".join(f"{k} {v}" for k, v in by_kind.items()))

    roster = read_roster(lms)
    lines.append(f"■ 지점 학생 명단   {len(roster)}명 "
                 f"({'완전' if roster.is_complete else '불완전'} 수집)")

    lines.append("")
    lines.append("■ 아직 막혀 있는 것")
    for b in preflight(lms, date="2026-08-19"):
        lines.append(f"    ✗ {b}")
    return "\n".join(lines)
