// 프론트/백엔드(serde camelCase) 공유 형태

export interface Issue {
  id: string; // 숫자 issueId (Jira dev-status 호출용)
  key: string;
  summary: string;
  duedate: string | null; // "YYYY-MM-DD"
  status: string;
  statusCategory: string; // "new" | "indeterminate" | "done"
  priority: string | null;
  priorityIconUrl: string | null;
  issuetype: string | null;
  issuetypeIconUrl: string | null;
  updated: string | null;
  browseUrl: string;
  projectKey: string;
  projectName: string;
  parentSummary: string | null;
  labels: string[];
}

// GitLab MR이 머지/오픈된 환경. target_branch 매핑(gitlabParse.ts BRANCH_ENV)으로 결정된다.
export type MergeEnv = "DEV" | "PROD";

// MR 칩 종류. merged → "머지완료", open → "머지오픈"(아직 안 머지된 opened 상태).
// closed/locked 등 그 외 상태는 칩을 만들지 않는다(사용자 확정 — closed 미표시).
export type MergeChipKind = "merged" | "open";

// 한 이슈에 붙는 GitLab MR 칩 1개. 환경·상태별로 1개씩 집계되며(최신 iid의 MR),
// 클릭하면 url(GitLab MR web_url)을 외부 브라우저로 연다. url이 없거나 안전하지
// 않으면(http/https 아님) 칩은 비클릭으로 렌더된다.
export interface MergeChip {
  env: MergeEnv; // DEV | PROD (open·merged 모두 환경별 — 사용자 확정)
  kind: MergeChipKind;
  url: string; // GitLab MR web_url
}

export interface Settings {
  site: string;
  email: string;
  jql: string;
  refreshMinutes: number;
  shortcut: string;
  alwaysOnTop: boolean;
  // GitLab base URL (예: https://gitlab.example.com). 비어 있으면 MR 머지 확인을 건너뛴다.
  // 토큰은 keyring(secrets.rs, base URL 키)에 저장되어 프론트로 내려오지 않는다.
  gitlabBaseUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  site: "https://syworks.atlassian.net",
  email: "",
  jql: "assignee = currentUser() and resolution = Unresolved ORDER BY due ASC, updated DESC",
  refreshMinutes: 5,
  shortcut: "CommandOrControl+Alt+J",
  alwaysOnTop: false,
  gitlabBaseUrl: "",
};
