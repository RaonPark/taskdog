import { invoke } from "@tauri-apps/api/core";
import { Issue, MergeEnv, Settings } from "./types";
import {
  loadMrStates,
  saveMrState,
  loadBaselineDone,
  setBaselineDone,
  MrState,
} from "./mrStore";
import {
  parseMrUri,
  originOf,
  branchToEnv,
  shouldNotify,
  GitlabMrResp,
} from "./gitlabParse";

// Rust devstatus::fetch_dev_mrs 반환형(camelCase). 여기선 프로젝트 발견용 url만 쓴다.
interface DevMr {
  url: string;
  merged: boolean;
  targetBranch: string;
  authorName: string | null;
}

// Rust gitlab::search_project_mrs 반환형(camelCase).
interface SearchedMr {
  iid: number;
  merged: boolean;
  targetBranch: string;
  webUrl: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 이슈별 GitLab MR 머지 상태를 확인해, 이슈별 머지완료 환경 목록(칩용)을 돌려준다.
 *
 * **하이브리드 발견**(dev-status 단독으론 승격 MR을 못 잡는 한계 때문):
 *  1. dev-status(개발 패널)로 이슈에 연결된 MR의 **프로젝트 경로만** 발견(기존 Jira 토큰).
 *     dev-status는 MR↔이슈를 source 브랜치명/커밋으로만 연결 → `local`→`dev`→`prod`
 *     승격 MR(브랜치명에 키 없음)은 누락되지만, 적어도 프로젝트는 알 수 있다.
 *  2. 그 프로젝트에서 **GitLab MR 검색**(`search_project_mrs`, title/description 인덱스)으로
 *     이슈 키를 포함하는 머지 MR을 전수 수집 → 승격 MR(dev/prod)까지 포착.
 *  3. 칩: `status==merged` + target 브랜치(→dev/prod). 환경별(DEV/PROD) 최대 1칩.
 *  4. 알림: 머지 MR url로 GitLab API(fetch_gitlab_mr)를 1회 호출해 author≠merged_by일 때만 발송.
 *
 *  - 칩·알림 모두 GitLab base URL+토큰 설정이 **필수**다(검색에 토큰 필요). 미설정이면 빈 맵.
 *  - 호스트 일치할 때만 호출(토큰 유출 방지) — 프로젝트 경로는 설정 호스트와 일치하는
 *    dev-status MR url에서만 추출한다.
 *  - 개별 이슈/MR 실패는 console에만 남기고 건너뜀(전체를 깨지 않음 — 실패 격리).
 *  - 알림 중복 방지/merged_by 재호출 방지는 mr-state.json에 영구 저장.
 */
export async function resolveMerges(
  issues: Issue[],
  settings: Settings
): Promise<Map<string, MergeEnv[]>> {
  const result = new Map<string, MergeEnv[]>();

  // GitLab 미설정/토큰 없음이면 칩 발견 자체가 불가(검색에 토큰 필요) → 빈 맵.
  const configOrigin = originOf(settings.gitlabBaseUrl);
  const gitlabBase = settings.gitlabBaseUrl.trim();
  if (!configOrigin) return result;
  const hasToken = await invoke<boolean>("has_gitlab_token", {
    baseUrl: gitlabBase,
  }).catch(() => false);
  if (!hasToken) return result;

  const states = await loadMrStates();
  // 첫 실행(baseline 미완료)이면 기존 머지 MR을 알림 없이 시딩만 한다(알림 폭증 방지).
  const baselineDone = await loadBaselineDone();
  const ctx: NotifyCtx = { configOrigin, gitlabBase, suppressNotify: !baselineDone };

  for (const issue of issues) {
    // 1) dev-status로 이 이슈가 속한 프로젝트 경로 발견(기존 Jira 토큰만). 실패해도 격리.
    let projectPaths: string[];
    try {
      const devMrs = await invoke<DevMr[]>("fetch_dev_mrs", {
        site: settings.site,
        email: settings.email,
        issueId: issue.id,
      });
      projectPaths = discoverProjectPaths(devMrs, configOrigin);
    } catch (e) {
      console.warn(`[devstatus] ${issue.key} 프로젝트 발견 실패:`, e);
      continue;
    }
    if (projectPaths.length === 0) continue;

    // 2) 각 프로젝트에서 키로 MR 검색 → 머지 MR을 환경 칩으로.
    const envs: MergeEnv[] = [];
    const seenEnv = new Set<MergeEnv>();
    for (const projectPath of projectPaths) {
      let mrs: SearchedMr[];
      try {
        mrs = await invoke<SearchedMr[]>("search_project_mrs", {
          baseUrl: gitlabBase,
          projectPath,
          key: issue.key,
        });
      } catch (e) {
        console.warn(`[gitlab] ${issue.key} MR 검색 실패 (${projectPath}):`, e);
        continue;
      }

      for (const mr of mrs) {
        if (!mr.merged) continue;
        const env = branchToEnv(mr.targetBranch);
        if (!env) continue; // dev/prod 외 브랜치(local 등)는 칩·알림 없음

        // 칩: 환경별 1회.
        if (!seenEnv.has(env)) {
          seenEnv.add(env);
          envs.push(env);
        }

        // 알림(선택): merged_by 확인이 필요해 GitLab API를 1회만 호출.
        await maybeNotify(issue, projectPath, mr, env, states, ctx);
      }
    }

    if (envs.length) result.set(issue.key, envs);
  }

  // 이번이 baseline 패스였다면, 다음부턴 정상 알림하도록 플래그를 세운다.
  if (!baselineDone) await setBaselineDone(true);

  return result;
}

// dev-status MR url들에서 프로젝트 경로를 뽑아 중복 제거한다.
// 설정 GitLab 호스트와 origin이 일치하는 것만(다른 호스트엔 토큰이 없고, 토큰 유출도 방지).
function discoverProjectPaths(devMrs: DevMr[], configOrigin: string): string[] {
  const set = new Set<string>();
  for (const mr of devMrs) {
    const parsed = parseMrUri(mr.url);
    if (!parsed) continue;
    if (parsed.origin !== configOrigin) continue;
    set.add(parsed.projectPath);
  }
  return [...set];
}

interface NotifyCtx {
  configOrigin: string;
  gitlabBase: string;
  // 첫 실행 baseline 패스면 true → merged_by 확인/알림 없이 "확인됨"으로만 시딩한다.
  suppressNotify: boolean;
}

// 머지된 MR에 대해 "다른 사람이 머지" 알림을 한 번만 발송한다.
// 칩은 검색 결과로 이미 떴고, 여기선 알림 전용(merged_by) 처리만 한다.
async function maybeNotify(
  issue: Issue,
  projectPath: string,
  mr: SearchedMr,
  env: MergeEnv,
  states: Record<string, MrState>,
  ctx: NotifyCtx
): Promise<void> {
  const key = `${ctx.configOrigin}|${projectPath}|${mr.iid}`;
  const prev = states[key];
  if (prev?.notifiedAt || prev?.notifyChecked) return; // 이미 보냈거나 이미 판단함 → 재호출 안 함

  // 첫 실행 baseline: GitLab API 호출도 알림도 없이 "확인됨"으로만 기록(폭증·과호출 방지).
  if (ctx.suppressNotify) {
    const seeded: MrState = {
      jiraIssueKey: issue.key,
      uri: mr.webUrl,
      env,
      merged: true,
      mergedAt: null,
      notifiedAt: null,
      notifyChecked: true,
    };
    states[key] = seeded;
    await saveMrState(key, seeded);
    return;
  }

  try {
    const gmr = await invoke<GitlabMrResp>("fetch_gitlab_mr", {
      baseUrl: ctx.gitlabBase,
      projectPath,
      iid: mr.iid,
    });
    const send = shouldNotify(gmr, env, false);
    if (send) {
      await invoke("notify", {
        title: `[${env} 머지완료] ${issue.key}`,
        body: "연결된 GitLab MR이 머지되었습니다.",
      }).catch((e) => console.warn("[gitlab] 알림 발송 실패:", e));
    }
    // merged_by를 확인했으니(보냈든 안 보냈든) notifyChecked로 표시 → 다음 새로고침에 재호출 안 함.
    const next: MrState = {
      jiraIssueKey: issue.key,
      uri: mr.webUrl,
      env,
      merged: true,
      mergedAt: gmr.mergedAt,
      notifiedAt: send ? nowIso() : null,
      notifyChecked: true,
    };
    states[key] = next;
    await saveMrState(key, next);
  } catch (e) {
    // 일시적 실패면 notifyChecked를 남기지 않아 다음에 재시도된다.
    console.warn(`[gitlab] merged_by 확인 실패 (${issue.key} !${mr.iid}):`, e);
  }
}
