import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";

import { Issue, Settings } from "./types";
import { loadSettings, saveSettings } from "./settings";
import {
  renderList,
  renderLoading,
  renderError,
  renderSettings,
  todayStr,
} from "./render";

const TOKEN_PAGE =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

const appWindow = getCurrentWindow();
const content = document.getElementById("content") as HTMLElement;
const statusbar = document.getElementById("statusbar") as HTMLElement;

let settings: Settings;
let issues: Issue[] = [];
let mode: "list" | "settings" = "list";
let refreshTimer: number | undefined;
const notifiedKeys = new Set<string>();

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

async function doRefresh(): Promise<void> {
  mode = "list";
  renderLoading(content);
  setStatus("불러오는 중…");
  try {
    issues = await invoke<Issue[]>("fetch_issues", {
      site: settings.site,
      email: settings.email,
      jql: settings.jql,
    });
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
  } catch (e) {
    const msg = typeof e === "string" ? e : String(e);
    renderError(content, msg);
    setStatus("오류");
    document
      .getElementById("error-settings")
      ?.addEventListener("click", () => void showSettingsMode());
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

// ---------- 설정 화면 ----------

async function showSettingsMode(): Promise<void> {
  mode = "settings";
  stopTimer();
  const hasToken = settings.email
    ? await invoke<boolean>("has_token", { email: settings.email }).catch(
        () => false
      )
    : false;
  renderSettings(content, settings, hasToken);
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
    const next: Settings = {
      site: String(data.get("site") || "")
        .trim()
        .replace(/\/+$/, ""),
      email: String(data.get("email") || "").trim(),
      jql: String(data.get("jql") || "").trim(),
      refreshMinutes: Math.max(1, Number(data.get("refreshMinutes")) || 5),
      shortcut: String(data.get("shortcut") || "").trim(),
      alwaysOnTop: settings.alwaysOnTop,
    };
    const token = String(data.get("token") || "");

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
    const target = (e.target as HTMLElement).closest(
      ".issue"
    ) as HTMLElement | null;
    if (!target) return;
    const url = target.getAttribute("data-url");
    if (url) void openUrl(url);
  });
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
