import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";

import { Issue, Settings } from "./types";
import { loadSettings, saveSettings } from "./settings";
import { resolveMerges } from "./gitlab";
import { isSafeMrUrl } from "./gitlabParse";
import {
  renderList,
  renderLoading,
  renderError,
  renderSettings,
  todayStr,
} from "./render";
import {
  classifyError,
  isRetryable,
  RETRY_NOTICE,
  RETRY_DELAY_MS,
} from "./errors";

const TOKEN_PAGE =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

const appWindow = getCurrentWindow();
const content = document.getElementById("content") as HTMLElement;
const statusbar = document.getElementById("statusbar") as HTMLElement;

let settings: Settings;
let issues: Issue[] = [];
let mode: "list" | "settings" = "list";
let refreshTimer: number | undefined;
let refreshing = false; // 중복 요청/렌더 방지 (타이머·버튼·재시도 겹침 차단)
let resolvingMerge = false; // GitLab 머지 확인 중복 실행 방지
const notifiedKeys = new Set<string>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ---------- 공통 동작 ----------

async function showAndFocus(): Promise<void> {
  await appWindow.show();
  await appWindow.unminimize();
  await appWindow.setFocus();
}

async function applyAlwaysOnTop(on: boolean): Promise<void> {
  await appWindow.setAlwaysOnTop(on);
}

function updatePinButton(): void {
  document.getElementById("btn-pin")?.classList.toggle("active", settings.alwaysOnTop);
}

function setStatus(text: string): void {
  statusbar.textContent = text;
}

function startTimer(): void {
  stopTimer();
  const ms = Math.max(1, settings.refreshMinutes) * 60_000;
  refreshTimer = window.setInterval(() => {
    if (mode === "list") void doRefresh();
  }, ms);
}

function stopTimer(): void {
  if (refreshTimer !== undefined) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

// ---------- 데이터 새로고침 ----------

function fetchIssuesOnce(): Promise<Issue[]> {
  return invoke<Issue[]>("fetch_issues", {
    site: settings.site,
    email: settings.email,
    jql: settings.jql,
  });
}

async function doRefresh(): Promise<void> {
  if (refreshing) return; // 진행 중이면 중복 요청 무시
  refreshing = true;
  mode = "list";
  renderLoading(content);
  setStatus("불러오는 중…");
  try {
    let result: Issue[];
    try {
      result = await fetchIssuesOnce();
    } catch (firstErr) {
      // 1차 실패: 일시적(네트워크) 오류면 짧은 백오프 후 1회만 자동 재시도.
      const cls = classifyError(firstErr);
      if (!isRetryable(cls.kind)) throw firstErr;
      console.warn(
        `[fetch_issues] 1차 실패(${cls.kind}) — 재시도합니다:`,
        cls.raw
      );
      renderLoading(content, RETRY_NOTICE);
      setStatus("네트워크 오류 · 잠시 후 재시도");
      await delay(RETRY_DELAY_MS);
      result = await fetchIssuesOnce(); // 재시도 실패 시 아래 catch로
    }

    issues = result;
    renderList(content, issues);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    setStatus(
      `${issues.length}건 · ${hhmm} 갱신${settings.alwaysOnTop ? " · 📌" : ""}`
    );
    void invoke("set_badge", { count: issues.length }).catch(() => {});
    void notifyDue(issues);
    // GitLab MR 머지 확인은 목록 표시와 분리(비동기·실패 격리). 끝나면 머지완료 칩만 덧입혀 재렌더.
    void resolveAndRenderMerges(issues);
  } catch (e) {
    // 최종 실패: 분류해 사용자 친화 메시지만 표시하고, 원문은 콘솔에만 남긴다.
    const cls = classifyError(e);
    console.error(`[fetch_issues] 실패(${cls.kind}):`, cls.raw);
    renderError(content, cls.userMessage, cls.kind);
    setStatus("오류");
    document
      .getElementById("error-settings")
      ?.addEventListener("click", () => void showSettingsMode());
    document
      .getElementById("error-retry")
      ?.addEventListener("click", () => void doRefresh());
  } finally {
    refreshing = false;
  }
}

async function notifyDue(list: Issue[]): Promise<void> {
  const today = todayStr();
  const due = list.filter(
    (i) =>
      i.duedate !== null &&
      i.duedate <= today &&
      i.statusCategory !== "done" &&
      !notifiedKeys.has(i.key)
  );
  if (due.length === 0) return;

  if (due.length <= 3) {
    for (const i of due) {
      await invoke("notify", {
        title: `${i.key} · 마감 임박`,
        body: `${i.summary} (마감 ${i.duedate})`,
      });
    }
  } else {
    await invoke("notify", {
      title: "마감 임박 작업",
      body: `오늘까지(이전 포함) 처리할 작업이 ${due.length}건 있습니다.`,
    });
  }
  for (const i of due) notifiedKeys.add(i.key);
}

// GitLab MR 머지 상태를 확인해 머지완료 칩을 덧입힌다. 목록 렌더 이후 비동기로 돌며
// 실패해도(네트워크/토큰/개별 MR) Jira 목록 표시엔 영향이 없다(요구 #10 — 실패 격리).
async function resolveAndRenderMerges(list: Issue[]): Promise<void> {
  if (resolvingMerge) return;
  resolvingMerge = true;
  try {
    const map = await resolveMerges(list, settings);
    // 그 사이 설정 화면으로 갔거나 목록이 갱신됐으면 재렌더하지 않는다(동일 데이터일 때만).
    if (mode === "list" && issues === list && map.size > 0) {
      renderList(content, issues, map);
    }
  } catch (e) {
    console.warn("[gitlab] 머지 상태 확인 실패:", e);
  } finally {
    resolvingMerge = false;
  }
}

// ---------- 설정 화면 ----------

async function showSettingsMode(): Promise<void> {
  mode = "settings";
  stopTimer();
  const hasToken = settings.email
    ? await invoke<boolean>("has_token", { email: settings.email }).catch(
        () => false
      )
    : false;
  const hasGitlabToken = settings.gitlabBaseUrl
    ? await invoke<boolean>("has_gitlab_token", {
        baseUrl: settings.gitlabBaseUrl,
      }).catch(() => false)
    : false;
  renderSettings(content, settings, hasToken, hasGitlabToken);
  setStatus("설정");
  wireSettingsForm(hasToken);
}

function wireSettingsForm(hasToken: boolean): void {
  const form = document.getElementById(
    "settings-form"
  ) as HTMLFormElement | null;
  if (!form) return;
  const errBox = document.getElementById("settings-error") as HTMLElement;

  document.getElementById("open-token-page")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openUrl(TOKEN_PAGE);
  });

  document.getElementById("cancel-settings")?.addEventListener("click", () => {
    mode = "list";
    void doRefresh();
    startTimer();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.textContent = "";
    const data = new FormData(form);
    const gitlabBaseUrl = String(data.get("gitlabBaseUrl") || "")
      .trim()
      .replace(/\/+$/, "");
    const next: Settings = {
      site: String(data.get("site") || "")
        .trim()
        .replace(/\/+$/, ""),
      email: String(data.get("email") || "").trim(),
      jql: String(data.get("jql") || "").trim(),
      refreshMinutes: Math.max(1, Number(data.get("refreshMinutes")) || 5),
      shortcut: String(data.get("shortcut") || "").trim(),
      alwaysOnTop: settings.alwaysOnTop,
      gitlabBaseUrl,
    };
    const token = String(data.get("token") || "");
    const gitlabToken = String(data.get("gitlabToken") || "");

    try {
      if (token) {
        await invoke("save_token", { email: next.email, token });
      } else {
        const ok =
          hasToken &&
          next.email === settings.email &&
          (await invoke<boolean>("has_token", { email: next.email }).catch(
            () => false
          ));
        if (!ok) {
          errBox.textContent = "API 토큰을 입력하세요.";
          return;
        }
      }

      // GitLab 토큰: base URL과 토큰을 함께 입력했을 때만 keyring에 저장(base URL 키).
      // base URL이 비면 GitLab 머지 확인은 비활성이므로 토큰도 저장하지 않는다.
      if (gitlabBaseUrl && gitlabToken) {
        await invoke("save_gitlab_token", {
          baseUrl: gitlabBaseUrl,
          token: gitlabToken,
        });
      }

      await saveSettings(next);
      const shortcutChanged = next.shortcut !== settings.shortcut;
      settings = next;
      if (shortcutChanged) await registerShortcut(settings.shortcut);

      mode = "list";
      await doRefresh();
      startTimer();
    } catch (err) {
      errBox.textContent = typeof err === "string" ? err : String(err);
    }
  });
}

// ---------- 전역 단축키 ----------

async function registerShortcut(accel: string): Promise<void> {
  try {
    await unregisterAll();
    if (!accel) return;
    await register(accel, (event) => {
      if (event.state === "Pressed") void showAndFocus();
    });
  } catch (e) {
    console.error("전역 단축키 등록 실패:", e);
  }
}

// ---------- 창/트레이 배선 ----------

function wireTitlebar(): void {
  document.getElementById("btn-pin")?.addEventListener("click", async () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    await applyAlwaysOnTop(settings.alwaysOnTop);
    updatePinButton();
    await saveSettings(settings);
    const base = (statusbar.textContent || "").replace(/ · 📌$/, "");
    setStatus(base + (settings.alwaysOnTop ? " · 📌" : ""));
  });
  document
    .getElementById("btn-refresh")
    ?.addEventListener("click", () => void doRefresh());
  document
    .getElementById("btn-settings")
    ?.addEventListener("click", () => void showSettingsMode());
  document
    .getElementById("btn-min")
    ?.addEventListener("click", () => void appWindow.minimize());
  document
    .getElementById("btn-close")
    ?.addEventListener("click", () => void appWindow.hide());
}

function wireContentDelegation(): void {
  content.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    // GitLab MR 칩 클릭 → 해당 MR 열기. 이슈 카드(Jira) 열기로는 내려가지 않게 먼저 처리.
    const chip = el.closest(
      ".merge-chip[data-mr-url]"
    ) as HTMLElement | null;
    if (chip) {
      openMrFromChip(chip);
      return;
    }
    const issue = el.closest(".issue") as HTMLElement | null;
    if (!issue) return;
    const url = issue.getAttribute("data-url");
    if (url) void openUrl(url);
  });

  // 키보드 접근성: 칩에 Tab 포커스 후 Enter/Space로 MR 열기.
  content.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const chip = (e.target as HTMLElement).closest(
      ".merge-chip[data-mr-url]"
    ) as HTMLElement | null;
    if (!chip) return;
    e.preventDefault();
    openMrFromChip(chip);
  });
}

// 칩의 data-mr-url을 안전성 재검사(http/https만) 후 외부 브라우저로 연다.
// URL은 GitLab API의 web_url(권위 있는 값)이며, 위험 scheme은 여기서도 한 번 더 막는다.
function openMrFromChip(chip: HTMLElement): void {
  const mrUrl = chip.getAttribute("data-mr-url");
  if (mrUrl && isSafeMrUrl(mrUrl)) void openUrl(mrUrl);
}

async function setupWindowEvents(): Promise<void> {
  await appWindow.onCloseRequested((event) => {
    event.preventDefault();
    void appWindow.hide();
  });
}

async function setupTrayEvents(): Promise<void> {
  await listen("tray://refresh", () => void doRefresh());
  await listen("tray://settings", () => void showSettingsMode());
}

// ---------- 부트 ----------

async function boot(): Promise<void> {
  settings = await loadSettings();
  wireTitlebar();
  wireContentDelegation();
  await applyAlwaysOnTop(settings.alwaysOnTop);
  updatePinButton();
  await setupWindowEvents();
  await setupTrayEvents();
  await registerShortcut(settings.shortcut);

  const ready =
    !!settings.email &&
    !!settings.site &&
    (await invoke<boolean>("has_token", { email: settings.email }).catch(
      () => false
    ));

  if (ready) {
    mode = "list";
    await doRefresh();
    startTimer();
  } else {
    await showSettingsMode();
  }
}

void boot();
