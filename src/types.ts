// 프론트/백엔드(serde camelCase) 공유 형태

export interface Issue {
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

export interface Settings {
  site: string;
  email: string;
  jql: string;
  refreshMinutes: number;
  shortcut: string;
  alwaysOnTop: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  site: "https://syworks.atlassian.net",
  email: "",
  jql: "assignee = currentUser() and resolution = Unresolved ORDER BY due ASC, updated DESC",
  refreshMinutes: 5,
  shortcut: "CommandOrControl+Alt+J",
  alwaysOnTop: false,
};
