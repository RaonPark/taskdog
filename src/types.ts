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

// GitLab MR이 머지된 환경. target_branch 매핑(gitlab.ts BRANCH_ENV)으로 결정된다.
export type MergeEnv = "DEV" | "PROD";

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
