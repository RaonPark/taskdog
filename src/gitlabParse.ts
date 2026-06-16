// GitLab 관련 순수 로직(파싱·판정). Tauri/스토어 등 런타임 의존이 없어 단위 테스트가 쉽다.
// (오케스트레이션/IPC/저장은 gitlab.ts가 담당.) MergeEnv는 타입만 가져온다(런타임 import 없음).
import type { MergeEnv, MergeChipKind } from "./types";

// target_branch → 머지 환경 매핑. 사용자 확정값: dev→DEV, prod→PROD.
// 둘 중 어느 것도 아니면 null(머지완료/머지오픈 칩도, 알림도 표시하지 않음 — 안전 기본값).
// 매핑 규칙을 바꾸려면 이 표만 수정하면 된다(브랜치 매핑을 코드 곳곳에 박지 않는다).
export const BRANCH_ENV: Record<string, MergeEnv> = {
  dev: "DEV",
  prod: "PROD",
};

export function branchToEnv(targetBranch: string): MergeEnv | null {
  return BRANCH_ENV[targetBranch] ?? null;
}

// GitLab MR state → 칩 종류. GitLab state 값: opened | merged | closed | locked.
//   merged → "머지완료" 칩, opened → "머지오픈" 칩, 그 외(closed/locked/미상) → null(칩 없음).
// closed 미표시는 사용자 확정값(요구 §2/§4 안전 기본값).
export function chipKindOf(state: string): MergeChipKind | null {
  if (state === "merged") return "merged";
  if (state === "opened") return "open";
  return null;
}

// 칩 클릭으로 열어도 되는 URL인가: http/https만 허용한다.
// javascript:/data:/file: 등 위험 scheme과 파싱 불가 문자열은 모두 거부(요구 — URL 안전성).
export function isSafeMrUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

export interface ParsedMr {
  uri: string;
  origin: string; // scheme + host (+port), 소문자
  projectPath: string; // group/sub/project (인코딩 전)
  iid: number;
}

export interface GitlabUserResp {
  id: number | null;
  username: string | null;
  name: string | null;
}

export interface GitlabMrResp {
  merged: boolean;
  state: string;
  targetBranch: string;
  mergedAt: string | null;
  author: GitlabUserResp | null;
  mergedBy: GitlabUserResp | null;
}

// GitLab MR URI 파싱. `/-/merge_requests/` 구분자로 project path와 iid를 안전하게 가른다
// (project path엔 서브그룹 슬래시가 포함될 수 있다).
export function parseMrUri(uri: string): ParsedMr | null {
  const m = uri.match(/^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) return null;
  const iid = Number(m[3]);
  if (!Number.isFinite(iid) || iid <= 0) return null;
  return {
    uri,
    origin: m[1].toLowerCase(),
    projectPath: m[2],
    iid,
  };
}

// base URL/URI에서 origin(scheme+host[:port])만 소문자로 뽑아 비교용으로 정규화.
export function originOf(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    // URL 파싱 실패 시 끝 슬래시만 제거한 소문자 문자열로 대체.
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

// author와 merged_by가 "같은 사람"인지 판정. 비교 우선순위: id → username → name.
// 한쪽이라도 비교 가능한 식별자가 없으면 같다고 단정하지 않는다(false 반환 = 다름으로 취급).
export function sameUser(
  a: GitlabUserResp | null,
  b: GitlabUserResp | null
): boolean {
  if (!a || !b) return false;
  if (a.id != null && b.id != null) return a.id === b.id;
  if (a.username && b.username) return a.username === b.username;
  if (a.name && b.name) return a.name === b.name;
  return false;
}

// 알림을 띄워야 하는가: 머지됨 AND 환경 매핑됨 AND merged_by 존재 AND author≠merged_by AND 미알림.
// (merged_by가 null이면 알림 대상 아님 — 태그는 별도로 표시 가능.)
export function shouldNotify(
  mr: GitlabMrResp,
  env: MergeEnv | null,
  alreadyNotified: boolean
): boolean {
  if (!mr.merged || !env || alreadyNotified) return false;
  if (!mr.mergedBy) return false;
  return !sameUser(mr.author, mr.mergedBy);
}
