import { load, Store } from "@tauri-apps/plugin-store";
import { MergeEnv } from "./types";

// GitLab MR 머지/알림 상태를 앱 재시작 후에도 유지하기 위한 영구 저장.
// 기존 settings.json과 분리해 mr-state.json을 쓴다(store 플러그인 재사용, 권한은 store:default 동일).
//
// 용도 두 가지:
//  1) 캐시 — 이미 머지로 확정된 MR은 다시 GitLab을 조회하지 않는다(레이트리밋·중복 호출 회피).
//  2) 알림 dedup — notifiedAt이 있으면 같은 MR로 다시 알림하지 않는다(재시작 후에도).
//
// 키: `${origin}|${projectPath}|${iid}` (요구사항의 projectPath+mrIid 동일성 기준 + 호스트).
export interface MrState {
  jiraIssueKey: string;
  uri: string;
  env: MergeEnv | null;
  merged: boolean;
  mergedAt: string | null;
  notifiedAt: string | null;
  // merged_by를 GitLab API로 한 번 확인했는지(보냈든 안 보냈든). true면 재호출 안 함 — 중복 호출 방지.
  notifyChecked: boolean;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("mr-state.json", { autoSave: true, defaults: {} });
  }
  return store;
}

export async function loadMrStates(): Promise<Record<string, MrState>> {
  const s = await getStore();
  return (await s.get<Record<string, MrState>>("states")) ?? {};
}

export async function saveMrState(key: string, state: MrState): Promise<void> {
  const s = await getStore();
  const all = (await s.get<Record<string, MrState>>("states")) ?? {};
  all[key] = state;
  await s.set("states", all);
  await s.save();
}

// 첫 실행 baseline 완료 플래그. GitLab 설정 후 첫 resolveMerges 패스는 기존 머지 MR을
// "확인됨"으로만 시딩하고 알림하지 않는다(과거 머지 다수가 한꺼번에 알림되는 폭증 방지).
// 이 플래그가 서면 이후 패스부터 새 머지에 정상 알림한다.
export async function loadBaselineDone(): Promise<boolean> {
  const s = await getStore();
  return (await s.get<boolean>("baselineDone")) ?? false;
}

export async function setBaselineDone(done: boolean): Promise<void> {
  const s = await getStore();
  await s.set("baselineDone", done);
  await s.save();
}
