# 아키텍처 / 구조

## 스택
- **Tauri v2** (Rust 백엔드) + **Vite + Vanilla TypeScript** (프론트, 프레임워크 없음).
- 패키지 매니저 **pnpm**. 토큰 저장은 OS 자격 증명(`keyring`), 비밀 아닌 설정은 `tauri-plugin-store`.

## 파일 맵
```
index.html                  프레임리스 타이틀바(핀/새로고침/설정/최소화/숨기기) + #content + #statusbar
src/
  main.ts                   부트, 상태, invoke 호출, 자동 새로고침 타이머, 전역 단축키, 트레이 이벤트 수신, 마감 알림
  render.ts                 목록 렌더(지연/오늘/예정/마감없음 그룹, D-day·색상, 학교 칩 schoolLabel), 설정 폼, 로딩/에러/빈 상태
  settings.ts               tauri-plugin-store 래퍼 (loadSettings/saveSettings)
  types.ts                  Issue/Settings 타입 + DEFAULT_SETTINGS
  styles.css                다크 위젯 테마
src-tauri/
  src/lib.rs                플러그인 등록, 트레이(메뉴/좌클릭), set_badge, 커맨드 등록(run())
  src/jira.rs               reqwest로 /rest/api/3/search/jql 호출 → slim Issue 변환 (fetch_issues 커맨드). project/parent 등 중첩 필드도 받아 slim화
  src/secrets.rs            keyring 토큰 save/has/delete + 내부 get_token
  tauri.conf.json           창(380×620, decorations:false), 번들, 식별자
  capabilities/default.json 프론트에서 호출하는 플러그인/창 권한
```

## 데이터 흐름
1. 프론트 `boot()` → 설정 로드 → `has_token(email)` 확인 → 없으면 설정 화면, 있으면 목록.
2. `doRefresh()` → `invoke("fetch_issues", {site, email, jql})`.
3. Rust `fetch_issues`가 keyring에서 토큰을 읽어 Jira REST 호출 → `Vec<Issue>`(camelCase) 반환.
4. `render.ts`가 마감 기준 그룹핑/색상으로 표시. 행 클릭 → `openUrl(browseUrl)`.
   - **학교 칩**: `schoolLabel`이 `parentSummary`의 선행 `[PFO XXX]` 태그 → 프로젝트명(…대/대학교 토큰) → 프로젝트 키 순으로 학교를 추론(프론트 계산). MIMS 하위작업은 상위 제목에, SEHAN/SEWU 등 학교 전용 PFO 프로젝트는 프로젝트명에 학교가 있고, SANDBOX처럼 학교 토큰이 없으면 키(`SANDBOX`)로 표시.

## 핵심 불변식 (깨면 안 됨)
- **API 토큰은 절대 프론트(웹뷰)로 보내지 않는다.** 토큰은 Rust ↔ keyring 안에서만 다룬다. 프론트는 `site/email/jql`만 넘긴다.
- **Jira 호출은 Rust(`reqwest`)에서만.** 웹뷰에서 직접 fetch 금지(CORS·토큰 노출).
- **닫기(✕)는 종료가 아니라 hide.** 앱은 트레이에 상주한다. 완전 종료는 트레이 메뉴 "종료"(`app.exit`).
- 창 label은 **`main`**, 트레이 id는 **`main-tray`** (lib.rs 상수). 코드에서 이 식별자로 창/트레이를 찾는다.
- **표시용 파생 규칙은 프론트(`render.ts`)에 둔다.** Rust(`jira.rs`)는 Jira raw → slim Issue 데이터 계층만 담당. "학교 라벨" 같은 표시 규칙을 바꿀 땐 `render.ts`만 고치면 되고 재컴파일이 필요 없다(필드 자체를 새로 받아야 할 때만 Rust 수정).

## Rust 커맨드 (invoke 대상)
- `fetch_issues(site, email, jql) -> Vec<Issue>` — Issue엔 키/요약/마감/상태/우선순위/유형 외 `projectKey`·`projectName`·`parentSummary`도 포함(학교 칩용). 신규 검색 API는 `fields`에 `project`,`parent`를 명시해야 내려온다.
- `save_token(email, token)` / `has_token(email) -> bool` / `delete_token(email)`
- `set_badge(count)` — 트레이 툴팁에 미해결 건수 표시
- `notify(title, body)` — 마감 알림 토스트. **OS별 분기**: Windows는 자체 AUMID(`appid::show_toast`, winrt)로 직접 발송, 비-Windows(macOS/Linux)는 `tauri-plugin-notification`(`NotificationExt::notification().builder()…show()`)으로 발송. 프론트는 `invoke("notify", {title, body})`만 호출하고 `AppHandle`은 Tauri가 자동 주입하므로, 커맨드에 `AppHandle` 인자를 추가해도 프론트 호출부는 그대로다. 플러그인 import(`use tauri_plugin_notification::NotificationExt;`)는 `#[cfg(not(windows))]` 블록 안에 두어 Windows 빌드에 unused 경고가 안 나게 한다.
- 프론트→Rust 단방향 알림은 이벤트로: 트레이 메뉴가 `tray://refresh` / `tray://settings` emit, main.ts가 listen.
