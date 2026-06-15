# TaskDog 개선 백로그 (기능적 / 기술적)

## Context
서브에이전트가 프론트(`src/*`)와 Rust 백엔드(`src-tauri/src/*`)를 분석했고, 메인 에이전트가
실제 소스(`jira.rs`, `lib.rs`, `main.ts`)를 직접 읽어 검증·교정한 결과를 정리한 **개선 후보 목록**이다.
구현 지시가 아니라, 무엇을 더하거나 고칠지 우선순위와 함께 한눈에 보기 위한 문서다.

### 서브에이전트 분석 교정 (검증 결과)
- ❌ "`global-shortcut`/`store`/`set-always-on-top` 권한 미사용" → **틀림.** 프론트에서 사용 중
  (`main.ts:5,209` 단축키 / `settings.ts` 스토어 / `main.ts:38-39,220` 핀 버튼). 제거 금지.
- ❌ "zeroize로 토큰 메모리 보호 / 이메일 해시화 필요" → 단일 사용자 데스크톱 + OS keyring 환경에선
  과한 제안. **우선순위 낮음**으로 강등.
- ✅ 그 외 페이징·타임아웃·재시도·에러 무시·접근성 지적은 유효.
- ➕ **추가 발견(중요): macOS 알림 미동작.** `notify`(`lib.rs:26-37`)는 `#[cfg(windows)]`에서만 토스트를
  띄우고 그 외 OS는 no-op. 등록된 `tauri-plugin-notification`은 정작 호출되지 않음.
  사용자가 darwin이므로 **마감 알림이 본인 PC에선 전혀 안 뜬다.**

---

## 기능적 개선 (사용자가 체감하는 동작/UX)

### F1. macOS/Linux 마감 알림 활성화  ⭐ P0
- 현재: `notify`가 Windows 전용, 그 외 no-op (`lib.rs:32-36`). 사용자(darwin)는 알림을 못 받음.
- 개선: 비-Windows 분기에서 이미 등록된 `tauri-plugin-notification`(`lib.rs:63`)으로 폴백 발송.
- 파일: `src-tauri/src/lib.rs` `notify()`. capabilities는 `notification:default` 이미 존재.

### F2. 알림 중복 재발송 방지(영속화)  P1
- 현재: `notifiedKeys`가 세션 메모리 Set (`main.ts:28,121`) → 앱 재시작하면 같은 이슈 재알림.
- 개선: 마지막 알림 날짜를 `Settings`(또는 store 별도 키)에 저장해 "하루 1회" 기준으로 전환.
- 파일: `main.ts:97-122` `notifyDue`, `src/types.ts`, `src/settings.ts`.

### F3. 사전 마감 알림 옵션  P2
- 현재: `i.duedate <= today`만 알림 → 마감 당일/지난 것만. D-1·D-3 사전 경고 없음.
- 개선: 설정에 "며칠 전부터 알림" 값 추가, `notifyDue` 필터 기준 확장.
- 파일: `main.ts:99-105`, `render.ts`(설정 폼), `types.ts`.

### F4. 토큰 "연결 테스트" 버튼  P2
- 현재: 저장 시 토큰 형식 검증 없이 keyring에 그대로 저장. 잘못된 값은 다음 새로고침에서야 401로 발견.
- 개선: 설정 폼에 테스트 버튼 → `fetch_issues`를 1건으로 호출해 즉시 성공/실패 피드백.
- 파일: `render.ts`(폼), `main.ts:157-200` `wireSettingsForm`.

### F5. 100건 페이징  P2
- 현재: `maxResults=100` 단일 페이지 고정 (`jira.rs:113`). 100건 초과 시 잘림(무고지).
- 개선: `nextPageToken` 루프(CLAUDE.md에 이미 명시된 방식). 당장 불필요하면 최소한 "100건+ 일부만
  표시" 상태바 고지.
- 파일: `src-tauri/src/jira.rs` `fetch_issues`.

### F6. 오프라인/네트워크 실패 UX  P2
- 현재: 실패 시 `renderError`로 원문 에러만 노출 (`main.ts:87-94`). 종류 구분·자동 재시도 없음.
- 개선: 네트워크/인증/JQL 에러 구분 메시지, 짧은 백오프 후 1회 자동 재시도.

---

## 기술적 개선 (코드/안정성/보안)

### T1. reqwest 클라이언트 재사용 + 타임아웃  ⭐ P0
- 현재: 호출마다 `reqwest::Client::new()` (`jira.rs:104`), 타임아웃 미설정(기본 무한 대기 가능).
- 개선: `ClientBuilder`로 `timeout`/`connect_timeout` 지정, 클라이언트 1회 생성(전역 `OnceLock` 등).
- 파일: `src-tauri/src/jira.rs`.

### T2. 재시도 / 429·5xx 처리  P1
- 현재: 네트워크 오류·5xx·429에 재시도 없음 (`jira.rs:118-131`). 429는 `code =>` 일반 분기로 떨어짐.
- 개선: 지수 백오프 1~2회 재시도, 429에 `Retry-After` 존중 + 전용 메시지.

### T3. User-Agent 헤더 추가  P2
- 현재: `Authorization`/`Accept`만 설정 (`jira.rs:115-116`). Atlassian은 UA 권장.
- 개선: `User-Agent: TaskDog/<version>` 헤더 추가.

### T4. 에러 무시(`let _ =`) 정리 + 로깅  P2
- 현재: 트레이/창 조작 결과를 광범위하게 무시 (`lib.rs:19,42-46,53-55`, `set_badge`). 실패 원인 추적 불가.
- 개선: 최소한 디버그 로그(`tracing` 또는 `eprintln!`). 데스크톱 위젯이라 panic은 피하되 침묵 금지.

### T5. CSP 활성화 검토  P2
- 현재: `tauri.conf.json`의 `security.csp: null`. 웹뷰는 로컬 자산만 쓰므로 위험은 낮으나 방어선 없음.
- 개선: `default-src 'self'` 기반 최소 CSP. 인라인 스타일/이벤트 사용 여부 확인 후 적용.
- 파일: `src-tauri/tauri.conf.json`.

### T6. 프론트 상태 안전성  P2
- `statusCategory` 등 유니온 리터럴 타입화(`"new"|"indeterminate"|"done"`) — `types.ts`.
- `daysUntil` 날짜 파싱 검증 강화(0·범위 밖 거르기) — `render.ts:19-27`.
- 전역 변수 5개(`main.ts:24-28`) → 단일 상태 객체로 캡슐화(선택).

### T7. 접근성 / 크로스플랫폼 스타일  P3
- 아이콘 버튼 `aria-label` 추가(`index.html`).
- `:focus-visible` 아웃라인(`styles.css`).
- 폰트 스택에 `-apple-system` 선행(현재 `Segoe UI`/`Malgun Gothic` 우선 → macOS 비최적).
- Firefox용 `scrollbar-width`/`scrollbar-color` 폴백.

### T8. notifyDue 병렬화  P3
- 현재: `due` 최대 3건을 순차 `await` (`main.ts:108-114`).
- 개선: `Promise.all`로 병렬. (효과 미미, 선택)

---

## 우선순위 요약
| 등급 | 항목 |
|---|---|
| P0 | F1(macOS 알림), T1(클라이언트 재사용·타임아웃) |
| P1 | F2(알림 영속화), T2(재시도·429) |
| P2 | F3·F4·F5·F6, T3·T4·T5·T6 |
| P3 | T7(접근성), T8(병렬) |

> 제외/강등: zeroize 토큰 메모리 보호·이메일 해시화(과함), 미사용 권한 제거(오판 — 실제 사용 중).

## 검증 방법 (구현 단계 진입 시)
- 컴파일: `pnpm tauri build --debug --no-bundle` (CLAUDE.md 규칙).
- 알림(F1): macOS에서 `pnpm tauri dev` → 마감 지난 더미 이슈로 `notifyDue` 트리거, 시스템 알림 확인.
- 네트워크(T1/T2): 잘못된 site/오프라인 상태에서 타임아웃·재시도·에러 메시지 분기 확인.
- 회귀: 기존 트레이 토글/단축키/핀/설정 저장 흐름이 깨지지 않는지 수동 점검.

---
*본 문서는 분석/제안 백로그다. 실제 코드 변경은 사용자가 어떤 항목을 진행할지 고른 뒤 시작한다.*
