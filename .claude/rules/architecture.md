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
  errors.ts                 Jira 요청 실패 분류 계층(network/auth/jql/unknown) + 사용자 문구 + 재시도 정책(classifyError/isRetryable)
  gitlab.ts                 MR 머지완료 칩/알림 오케스트레이션(resolveMerges: dev-status로 프로젝트 발견 → GitLab 검색으로 MR 수집 → 칩+알림). 첫 실행 baseline 시딩
  gitlabParse.ts            GitLab 순수 로직(런타임 의존 없음·단위테스트 대상): parseMrUri/originOf/branchToEnv(BRANCH_ENV)/sameUser/shouldNotify
  mrStore.ts                MR 머지/알림 상태 영구 저장(mr-state.json): notifiedAt/notifyChecked dedup + baselineDone 플래그
  styles.css                다크 위젯 테마(.merge-chip 포함)
src-tauri/
  src/lib.rs                플러그인 등록, 트레이(메뉴/좌클릭), set_badge, 커맨드 등록(run())
  src/jira.rs               reqwest로 /rest/api/3/search/jql 호출 → slim Issue 변환 (fetch_issues 커맨드). project/parent 등 중첩 필드도 받아 slim화. Issue에 숫자 id 포함(dev-status용)
  src/devstatus.rs          Jira 개발 패널(dev-status) 조회 → 이슈에 연결된 MR(fetch_dev_mrs). 인증=기존 Jira 토큰. applicationType은 byInstanceType 키로 동적 발견
  src/gitlab.rs             GitLab REST: 단일 MR 조회(fetch_gitlab_mr, 알림용 merged_by) + 프로젝트 MR 검색(search_project_mrs, 키로 승격 MR까지). PRIVATE-TOKEN(keyring, base URL 키)
  src/secrets.rs            keyring 토큰 save/has/delete + 내부 get_token. Jira(서비스 jira-today-todo, account=email)와 GitLab(서비스 jira-today-todo-gitlab, account=base URL) 분리
  tauri.conf.json           창(380×620, decorations:false), 번들, 식별자
  capabilities/default.json 프론트에서 호출하는 플러그인/창 권한
```

## 데이터 흐름
1. 프론트 `boot()` → 설정 로드 → `has_token(email)` 확인 → 없으면 설정 화면, 있으면 목록.
2. `doRefresh()` → `invoke("fetch_issues", {site, email, jql})`.
3. Rust `fetch_issues`가 keyring에서 토큰을 읽어 Jira REST 호출 → `Vec<Issue>`(camelCase) 반환.
4. `render.ts`가 마감 기준 그룹핑/색상으로 표시. 행 클릭 → `openUrl(browseUrl)`.
   - **학교 칩**: `schoolLabel`이 `parentSummary`의 선행 `[PFO XXX]` 태그 → 프로젝트명(…대/대학교 토큰) → 프로젝트 키 순으로 학교를 추론(프론트 계산). MIMS 하위작업은 상위 제목에, SEHAN/SEWU 등 학교 전용 PFO 프로젝트는 프로젝트명에 학교가 있고, SANDBOX처럼 학교 토큰이 없으면 키(`SANDBOX`)로 표시.

## GitLab MR 머지완료 칩/알림
- **흐름(하이브리드)**: `doRefresh()`가 목록을 띄운 뒤 `resolveAndRenderMerges`→`gitlab.ts resolveMerges`를 비동기로 돌린다(실패 격리: 실패해도 Jira 목록엔 영향 없음). ① `fetch_dev_mrs`로 이슈가 속한 **프로젝트 경로만** 발견(기존 Jira 토큰) → ② 그 프로젝트에서 `search_project_mrs(key)`로 키 포함 머지 MR 전수 수집 → ③ `branchToEnv`(`gitlabParse.ts BRANCH_ENV`: dev→DEV, prod→PROD)로 환경 칩(환경별 1칩) → ④ 머지 MR마다 `fetch_gitlab_mr`로 merged_by 확인해 author≠merged_by면 알림.
- **왜 하이브리드인가**: dev-status는 MR↔이슈를 **source 브랜치명/커밋**으로만 연결 → `local→dev→prod` 승격 MR(브랜치에 키 없음)을 놓친다. GitLab 검색은 title/description을 인덱싱하므로 승격 MR까지 잡는다(팀 MR 템플릿이 제목·설명에 이슈 키/Jira 링크를 남김).
- **불변식**: ⓐ **칩·알림 모두 GitLab base URL+토큰이 있어야 동작**(검색에 토큰 필요). 미설정이면 `resolveMerges`는 빈 맵 → 칩 없음. ⓑ GitLab 호출의 project_path는 **설정 호스트와 origin이 일치하는** dev-status url에서만 추출(토큰 유출 방지). ⓒ **브랜치→환경 매핑은 `gitlabParse.ts BRANCH_ENV` 한 곳**에서만 바꾼다. ⓓ 알림 중복/과호출 방지는 `mr-state.json`(`notifiedAt`/`notifyChecked`/`baselineDone`). 첫 실행 baseline 패스는 기존 머지 MR을 알림 없이 시딩(폭증 방지).

## 에러 처리 흐름 (F6)
- `fetch_issues` 실패는 `doRefresh()`(main.ts)가 잡아 **`errors.ts`의 `classifyError`로 분류**한다: `network` / `auth` / `jql` / `unknown`.
- **분류는 프론트에 둔다**(표시용 파생 규칙 불변식과 동일). Rust(`jira.rs`/`secrets.rs`)는 지금처럼 한국어 접두사 문자열 에러(`"네트워크 오류: …"`, `"인증 실패 (401)"`, `"JQL 오류 (400)"`, `"Jira 오류 (50x)"` 등)를 던지고, `errors.ts`가 그 접두사 + 범용 영어 키워드(`401/403`, `failed to fetch`, `timeout`, `5xx/429` 등)를 매칭해 분류한다.
- **사용자에겐 분류된 친화 문구만**(`USER_MESSAGES`) 노출. **원문 에러는 `console`에만** 남긴다(`[fetch_issues] 실패(kind): raw`). `renderError(container, message, kind)`는 message에 원문을 넣지 않는다.
- **자동 재시도 정책**: 일시적 실패(`isRetryable` → 현재 `network`만)일 때 **짧은 백오프(`RETRY_DELAY_MS`) 후 1회만** 재시도. 인증/JQL/기타는 재시도 실익이 없어 즉시 표시. `refreshing` 가드로 타이머·버튼·재시도가 겹쳐 중복 요청/렌더되는 것을 막는다.
- `renderError`의 후속 버튼은 kind로 갈린다: `network` → `#error-retry`(다시 시도, `doRefresh` 재호출), 그 외 → `#error-settings`(설정 열기). main.ts가 존재하는 버튼만 배선한다.
- `navigator.onLine`은 **보조 신호로만** 쓴다(분류가 unknown이고 오프라인일 때만 network로 승격). 단독 판단 기준 금지.

## 핵심 불변식 (깨면 안 됨)
- **API 토큰은 절대 프론트(웹뷰)로 보내지 않는다.** 토큰은 Rust ↔ keyring 안에서만 다룬다. 프론트는 `site/email/jql`만 넘긴다.
- **Jira 호출은 Rust(`reqwest`)에서만.** 웹뷰에서 직접 fetch 금지(CORS·토큰 노출).
- **닫기(✕)는 종료가 아니라 hide.** 앱은 트레이에 상주한다. 완전 종료는 트레이 메뉴 "종료"(`app.exit`).
- 창 label은 **`main`**, 트레이 id는 **`main-tray`** (lib.rs 상수). 코드에서 이 식별자로 창/트레이를 찾는다.
- **표시용 파생 규칙은 프론트(`render.ts`)에 둔다.** Rust(`jira.rs`)는 Jira raw → slim Issue 데이터 계층만 담당. "학교 라벨" 같은 표시 규칙을 바꿀 땐 `render.ts`만 고치면 되고 재컴파일이 필요 없다(필드 자체를 새로 받아야 할 때만 Rust 수정).

## Rust 커맨드 (invoke 대상)
- `fetch_issues(site, email, jql) -> Vec<Issue>` — Issue엔 키/요약/마감/상태/우선순위/유형 외 `projectKey`·`projectName`·`parentSummary`도 포함(학교 칩용). 신규 검색 API는 `fields`에 `project`,`parent`를 명시해야 내려온다.
- `save_token(email, token)` / `has_token(email) -> bool` / `delete_token(email)`
- `save_gitlab_token(base_url, token)` / `has_gitlab_token(base_url) -> bool` / `delete_gitlab_token(base_url)` — GitLab 토큰(서비스 `jira-today-todo-gitlab`, account=base URL)
- `fetch_dev_mrs(site, email, issue_id) -> Vec<DevMr>` — dev-status 개발 패널의 연결 MR. 인증=기존 Jira 토큰. 칩/알림 발견에서 **프로젝트 경로 발견용**으로 쓴다(승격 MR은 못 잡으므로 발견만).
- `fetch_gitlab_mr(base_url, project_path, iid) -> GitlabMr` — 단일 MR(알림용 merged_by 포함). `search_project_mrs(base_url, project_path, key) -> Vec<SearchedMr>` — 키로 머지 MR 검색(title/description 인덱스 → 승격 MR까지). 둘 다 PRIVATE-TOKEN(keyring base URL 키). **호스트 일치할 때만 프론트가 호출**(토큰 유출 방지).
- `set_badge(count)` — 트레이 툴팁에 미해결 건수 표시
- `notify(title, body)` — 마감 알림 토스트. **OS별 분기**: Windows는 자체 AUMID(`appid::show_toast`, winrt)로 직접 발송, 비-Windows(macOS/Linux)는 `tauri-plugin-notification`(`NotificationExt::notification().builder()…show()`)으로 발송. 프론트는 `invoke("notify", {title, body})`만 호출하고 `AppHandle`은 Tauri가 자동 주입하므로, 커맨드에 `AppHandle` 인자를 추가해도 프론트 호출부는 그대로다. 플러그인 import(`use tauri_plugin_notification::NotificationExt;`)는 `#[cfg(not(windows))]` 블록 안에 두어 Windows 빌드에 unused 경고가 안 나게 한다.
- 프론트→Rust 단방향 알림은 이벤트로: 트레이 메뉴가 `tray://refresh` / `tray://settings` emit, main.ts가 listen.
