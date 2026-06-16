import { invoke } from "@tauri-apps/api/core";
import { Issue, MergeEnv, MergeChip, MergeChipKind, Settings } from "./types";
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
  chipKindOf,
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

// Rust gitlab::search_project_mrs 반환형(camelCase). state=all로 모든 상태가 내려온다.
interface SearchedMr {
  iid: number;
  state: string; // opened | merged | closed | locked
  merged: boolean;
  targetBranch: string;
  webUrl: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

// 칩 표시 순서: 머지완료 먼저, 그 안에서 DEV→PROD. (화면에 항상 같은 순서로 나오게)
const ENV_ORDER: Record<MergeEnv, number> = { DEV: 0, PROD: 1 };
const KIND_ORDER: Record<MergeChipKind, number> = { merged: 0, open: 1 };

function sortChips(chips: MergeChip[]): MergeChip[] {
  return chips.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      ENV_ORDER[a.env] - ENV_ORDER[b.env]
  );
}

/**
 * 이슈별 GitLab MR 상태를 확인해, 이슈별 칩 목록(머지완료/머지오픈)을 돌려준다.
 *
 * **하이브리드 발견**(dev-status 단독으론 승격 MR을 못 잡는 한계 때문):
 *  1. dev-status(개발 패널)로 이슈에 연결된 MR의 **프로젝트 경로만** 발견(기존 Jira 토큰).
 *     dev-status는 MR↔이슈를 source 브랜치명/커밋으로만 연결 → `local`→`dev`→`prod`
 *     승격 MR(브랜치명에 키 없음)은 누락되지만, 적어도 프로젝트는 알 수 있다.
 *  2. 그 프로젝트에서 **GitLab MR 검색**(`search_project_mrs`, title/description 인덱스, state=all)으로
 *     이슈 키를 포함하는 MR을 전수 수집 → 승격 MR(dev/prod)까지 포착.
 *  3. 칩: target 브랜치(→dev/prod) × 상태(merged→머지완료 / opened→머지오픈). 환경·상태별 1칩
 *     (가장 최근 iid의 MR url을 칩이 들고 가서 클릭 시 연다). closed/locked 등은 칩 없음.
 *  4. 알림: **merged MR만** url로 GitLab API(fetch_gitlab_mr)를 1회 호출해 author≠merged_by일 때만 발송.
 *     open MR은 칩만 표시하고 절대 알림하지 않는다(불변식).
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
): Promise<Map<string, MergeChip[]>> {
  const result = new Map<string, MergeChip[]>();

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

    // 2) 각 프로젝트에서 키로 MR 검색 → 환경·상태별 1칩으로 집계.
    //    같은 (환경,상태) 조합이 여러 MR이면 가장 최근(max iid) MR의 url을 칩이 들고 간다.
    const best = new Map<string, { chip: MergeChip; iid: number }>(); // key `${env}|${kind}`
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
        const env = branchToEnv(mr.targetBranch);
        if (!env) continue; // dev/prod 외 브랜치(local 등)는 칩·알림 없음
        const kind = chipKindOf(mr.state);
        if (!kind) continue; // closed/locked 등은 칩 없음(사용자 확정)

        // 칩: 환경·상태별 1개, 가장 최근 MR url을 보관.
        const k = `${env}|${kind}`;
        const prev = best.get(k);
        if (!prev || mr.iid > prev.iid) {
          best.set(k, { chip: { env, kind, url: mr.webUrl }, iid: mr.iid });
        }

        // 알림은 merged MR만(open은 알림 없음 — 불변식). merged_by 확인에 GitLab API 1회.
        if (kind === "merged") {
          await maybeNotify(issue, projectPath, mr, env, states, ctx);
        }
      }
    }

    if (best.size) {
      result.set(
        issue.key,
        sortChips([...best.values()].map((b) => b.chip))
      );
    }
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
