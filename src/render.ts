import { Issue, Settings } from "./types";
import { ErrorKind } from "./errors";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// 마감일까지 남은 일수 (로컬 자정 기준). null이면 null.
function daysUntil(duedate: string | null): number | null {
  if (!duedate) return null;
  const [y, m, d] = duedate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d).getTime();
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

function ddayLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "D-DAY";
  if (days < 0) return `D+${-days}`;
  return `D-${days}`;
}

// 학교명 토큰: "세한대학교", "숭의여자대학교", "충남대", "한신대" 등을 끄집어낸다.
const SCHOOL_RE = /([가-힣]+(?:여자대학교|여대|대학교|대학|대))/;

// 이슈가 어느 학교/소속인지 추론한다.
//  1) 상위(부모) 제목 앞 "[PFO XXX]" 태그가 있으면 그 안의 학교명 (예: "충남대 CNU with U+" → "충남대")
//  2) 없으면 프로젝트명에서 학교명 (예: "세한대학교 …" → "세한대학교")
//  3) 둘 다 없으면 프로젝트 키 (예: SANDBOX → "SANDBOX")
function schoolLabel(issue: Issue): string {
  const parent = issue.parentSummary || "";
  const tagMatch = parent.match(/^\s*\[([^\]]+)\]/);
  if (tagMatch && /^PFO\b/i.test(tagMatch[1].trim())) {
    const tag = tagMatch[1].trim().replace(/^PFO\s*/i, "").trim();
    const school = tag.match(SCHOOL_RE);
    if (school) return school[1];
    if (tag) return tag;
  }
  const fromProject = (issue.projectName || "").match(SCHOOL_RE);
  if (fromProject) return fromProject[1];
  return issue.projectKey || "";
}

// 중요도 옆에 칩으로 노출할 검수 라벨 → CSS 변형 클래스. 표시 순서는 키 순(요청중 → 완료).
const REVIEW_LABELS: Record<string, string> = {
  검수요청중: "review-req",
  검수완료: "review-done",
};

type Bucket = "overdue" | "today" | "upcoming" | "none";

function bucketOf(days: number | null): Bucket {
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return "upcoming";
}

const GROUP_META: Record<Bucket, { title: string; cls: string }> = {
  overdue: { title: "지연", cls: "g-overdue" },
  today: { title: "오늘", cls: "g-today" },
  upcoming: { title: "예정", cls: "g-upcoming" },
  none: { title: "마감 없음", cls: "g-none" },
};

function issueRow(issue: Issue): string {
  const days = daysUntil(issue.duedate);
  const bucket = bucketOf(days);
  const done = issue.statusCategory === "done";
  const typeIcon = issue.issuetypeIconUrl
    ? `<img class="type-icon" src="${escapeHtml(issue.issuetypeIconUrl)}" alt="" />`
    : "";
  const dday = issue.duedate
    ? `<span class="dday dday-${bucket}">${ddayLabel(days)}</span>`
    : `<span class="dday dday-none">—</span>`;
  const school = schoolLabel(issue);
  const schoolChip = school
    ? `<span class="school-chip" title="${escapeHtml(issue.projectName || school)}">🏫 ${escapeHtml(school)}</span>`
    : "";
  const reviewChips = Object.keys(REVIEW_LABELS)
    .filter((l) => (issue.labels || []).includes(l))
    .map((l) => `<span class="review-chip ${REVIEW_LABELS[l]}">${escapeHtml(l)}</span>`)
    .join("");
  return `
    <div class="issue${done ? " done" : ""}" data-url="${escapeHtml(issue.browseUrl)}" title="${escapeHtml(issue.key)} · ${escapeHtml(issue.summary)}">
      <div class="issue-top">
        <div class="top-left">
          ${schoolChip}
          <span class="key">${escapeHtml(issue.key)}</span>
        </div>
        ${dday}
      </div>
      <div class="summary">${escapeHtml(issue.summary)}</div>
      <div class="issue-bot">
        ${typeIcon}
        <span class="status-chip s-${escapeHtml(issue.statusCategory || "new")}">${escapeHtml(issue.status || "")}</span>
        ${issue.priority ? `<span class="prio">${escapeHtml(issue.priority)}</span>` : ""}
        ${reviewChips}
        ${issue.duedate ? `<span class="due-text">📅 ${escapeHtml(issue.duedate)}</span>` : ""}
      </div>
    </div>`;
}

export function renderList(container: HTMLElement, issues: Issue[]): void {
  if (issues.length === 0) {
    container.innerHTML = `<div class="empty">🎉 미해결 작업이 없습니다.</div>`;
    return;
  }

  const buckets: Record<Bucket, Issue[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    none: [],
  };
  for (const issue of issues) {
    buckets[bucketOf(daysUntil(issue.duedate))].push(issue);
  }

  const order: Bucket[] = ["overdue", "today", "upcoming", "none"];
  let html = "";
  for (const b of order) {
    const list = buckets[b];
    if (list.length === 0) continue;
    const meta = GROUP_META[b];
    html += `<section class="group ${meta.cls}">
      <h2 class="group-title">${meta.title}<span class="group-count">${list.length}</span></h2>
      ${list.map(issueRow).join("")}
    </section>`;
  }
  container.innerHTML = html;
}

export function renderLoading(container: HTMLElement, message = "불러오는 중…"): void {
  container.innerHTML = `<div class="loading">${escapeHtml(message)}</div>`;
}

// 분류된 사용자 친화 메시지만 받는다(원문 에러 금지 — 그건 콘솔로). kind에 따라
// 후속 액션 버튼이 달라진다: network는 "다시 시도", 그 외(auth/jql/unknown)는 "설정 열기".
// 버튼 배선은 main.ts가 #error-retry / #error-settings 존재 여부로 처리한다.
export function renderError(
  container: HTMLElement,
  message: string,
  kind: ErrorKind = "unknown"
): void {
  const action =
    kind === "network"
      ? `<button id="error-retry" class="btn">다시 시도</button>`
      : `<button id="error-settings" class="btn">설정 열기</button>`;
  container.innerHTML = `
    <div class="error">
      <div class="error-title">⚠ 불러오지 못했습니다</div>
      <div class="error-msg">${escapeHtml(message)}</div>
      ${action}
    </div>`;
}

export function renderSettings(container: HTMLElement, settings: Settings, hasToken: boolean): void {
  container.innerHTML = `
    <form id="settings-form" class="settings">
      <label>Jira 사이트 URL
        <input name="site" type="url" required value="${escapeHtml(settings.site)}" placeholder="https://your.atlassian.net" />
      </label>
      <label>이메일 (Atlassian 계정)
        <input name="email" type="email" required value="${escapeHtml(settings.email)}" placeholder="you@example.com" />
      </label>
      <label>API 토큰 ${hasToken ? '<span class="hint">(저장됨 · 변경 시에만 입력)</span>' : ""}
        <input name="token" type="password" ${hasToken ? "" : "required"} placeholder="${hasToken ? "•••••••• (그대로 두면 유지)" : "API 토큰 붙여넣기"}" autocomplete="off" />
        <a class="hint-link" id="open-token-page" href="#">토큰 발급 페이지 열기 ↗</a>
      </label>
      <label>JQL
        <textarea name="jql" rows="3" required>${escapeHtml(settings.jql)}</textarea>
      </label>
      <div class="settings-row">
        <label class="small">새로고침(분)
          <input name="refreshMinutes" type="number" min="1" max="120" required value="${settings.refreshMinutes}" />
        </label>
        <label class="small">단축키
          <input name="shortcut" type="text" required value="${escapeHtml(settings.shortcut)}" placeholder="CommandOrControl+Alt+J" />
        </label>
      </div>
      <div class="settings-actions">
        <button type="submit" class="btn primary">저장</button>
        ${hasToken ? '<button type="button" id="cancel-settings" class="btn">취소</button>' : ""}
      </div>
      <div id="settings-error" class="settings-error"></div>
    </form>`;
}

export { todayStr, daysUntil };
