"use strict";

const DEMO_DATE = "2099-01-14";
const DEMO_STUDENTS = Object.freeze(Array.from({ length: 12 }, (_, i) =>
  Object.freeze({ id: `가상 ${String(i + 1).padStart(2, "0")}`, group: i < 6 ? "A" : "B" })
));

function visibleStudents(date, group) {
  if (date !== DEMO_DATE) return [];
  return DEMO_STUDENTS.filter(student => group === "all" || student.group === group);
}

function selectedStudent(date, group, id) {
  return visibleStudents(date, group).find(student => student.id === id) || null;
}

function render() {
  const date = document.getElementById("lesson-date").value;
  const group = document.getElementById("group-filter").value;
  const rows = visibleStudents(date, group);
  const selection = selectedStudent(date, group, window.selectedDemoId);
  if (!selection) window.selectedDemoId = null;

  document.getElementById("metrics").innerHTML = `
    <span class="metric">화면의 가상 행 <strong>${rows.length}</strong></span>
    <span class="metric">실제 날짜·그룹·페이지 완전성 <span class="unknown">unknown</span></span>
    <span class="metric">앱 연결 <span class="unknown">unknown</span></span>
    <span class="metric">원천 시각 <span class="unknown">unknown</span></span>`;

  const body = document.getElementById("student-rows");
  body.replaceChildren();
  for (const student of rows) {
    const tr = document.createElement("tr");
    if (selection?.id === student.id) tr.className = "selected";
    const first = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "student";
    button.textContent = student.id;
    button.setAttribute("aria-label", `${student.id} 선택`);
    button.addEventListener("click", () => { window.selectedDemoId = student.id; render(); });
    first.append(button, document.createTextNode(` · ${student.group}`));
    tr.append(first);
    for (let i = 0; i < 6; i++) {
      const td = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "unknown";
      badge.textContent = "unknown";
      td.append(badge);
      tr.append(td);
    }
    const decision = document.createElement("td");
    decision.className = "hold";
    decision.textContent = "판단 보류";
    tr.append(decision);
    body.append(tr);
  }
  const empty = document.getElementById("empty-state");
  empty.hidden = rows.length > 0;
  empty.textContent = rows.length ? "" : "이 날짜에는 가상 행이 없습니다. 실제 학생이 없다는 뜻은 아닙니다.";

  const detail = document.getElementById("selected-detail");
  if (!selection) {
    detail.innerHTML = `<div class="detail-note">학생을 선택하면 해당 날짜·그룹의 판단 순서를 볼 수 있습니다. 이전 선택은 다른 날짜나 그룹으로 넘어가지 않습니다.</div>`;
    return;
  }
  detail.innerHTML = `
    <h3>${selection.id} <span class="tag">가상 ${selection.group}</span></h3>
    <div class="detail-note">수업 발생·LMS 학생·과정·앱 학생 연결은 모두 unknown입니다. 원본 증거와 확인 시각을 결합하기 전에는 준비 완료를 표시할 수 없습니다.</div>
    <div class="section-label">LMS 배정과 앱 증거</div>
    <div class="check"><strong>1. 숙제 범위</strong><span class="unknown">unknown</span><small>책·판본·단원·쪽·문제, 수업 발생과 대응 확인 필요</small></div>
    <div class="check"><strong>2. 대응 예습 영상 업로드</strong><span class="unknown">unknown</span><small>제출 ID·업로드 시각·원본 링크. 시청 및 교사 검토와 구분</small></div>
    <div class="check"><strong>3. 범위 내 문제 풀이</strong><span class="unknown">unknown</span><small>문제별 시도·제출 ID와 누락/미배정의 차이 확인</small></div>
    <div class="check"><strong>4. 앱 백엔드 채점</strong><span class="unknown">unknown</span><small>시도별 채점 결과·시각·재시도 이력 확인</small></div>
    <div class="check"><strong>5. 오답 영상 또는 수정</strong><span class="unknown">unknown</span><small>오답별 영상 경로, 수정 결과, 미해결 항목 분리</small></div>
    <div class="section-label">교사의 마지막 판단</div>
    <div class="check"><strong>6. 눈으로 확인</strong><span class="unknown">unknown</span><small>교사가 원본 오답 결과를 보고 별도로 확인할 단계</small></div>
    <div class="check"><strong>14:00 준비 판단</strong><span class="hold">판단 보류</span><small>원천 읽기와 교사 확인이 모두 갖춰져야 판단 가능</small></div>`;
}

if (typeof document !== "undefined") {
  window.selectedDemoId = null;
  document.getElementById("lesson-date").addEventListener("change", render);
  document.getElementById("group-filter").addEventListener("change", render);
  render();
}

if (typeof module !== "undefined") module.exports = { DEMO_DATE, DEMO_STUDENTS, visibleStudents, selectedStudent };
