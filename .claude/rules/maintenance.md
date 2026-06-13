# 유지보수 / 빌드 규칙

## 빌드 · 실행
```bash
pnpm install                  # JS 의존성
pnpm tauri dev                # 개발(HMR). 프론트 1420 포트(vite.config.ts, strictPort)
pnpm build                    # 프론트만 타입체크+빌드(tsc && vite build) — TS 오류 빠른 확인용
pnpm tauri build              # release exe + 설치본(nsis/msi) → src-tauri/target/release/
pnpm tauri build --bundles nsis        # ⭐ 배포본은 이걸 쓴다(설치본은 NSIS). 전체 번들은 MSI에서 깨질 수 있음(아래 오류 3종)
pnpm tauri build --debug --no-bundle   # 컴파일만 빠르게 검증
```
> tauri 명령은 내부적으로 cargo를 호출하므로, cargo가 PATH에 없는 셸에선 앞에
> `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path";` 를 붙여 실행한다(아래 오류 3종 ①).

## ⚠️ 빌드 실패 3종 (실경험) — 증상 → 원인 → 해결
1. **`cargo metadata ... program not found`** (또는 `cargo not found`): 새로 뜬 셸·백그라운드 셸엔 cargo PATH가 없다. → 빌드 명령 앞에 `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path";` 선행. (IDE/터미널을 껐다 켜면 영구 반영.)
2. **`failed to remove file ...release\jira-today-todo.exe` / `os error 5 (액세스가 거부되었습니다)`**: 그 exe가 **실행 중**이라 재빌드가 산출물을 덮어쓰지 못함. ✕(닫기)는 **트레이로 숨김일 뿐 프로세스는 살아 exe를 잠근다**(불변식 close=hide). → 재빌드 전 **트레이 → 종료**로 완전 종료하거나 `Stop-Process -Name jira-today-todo -Force`. 특히 `target\release\…exe`를 직접 띄워 테스트했을 때 자주 발생.
3. **MSI 번들 `light.exe` 실패 (`failed to run ...WixTools314\light.exe`)**: 전체 번들(`tauri.conf.json`의 bundle targets `"all"`)이 WiX MSI 단계에서 깨질 때가 있다. release exe 자체는 이미 빌드 완료된 상태다. → 배포는 NSIS만 쓰므로 **`pnpm tauri build --bundles nsis`** 로 우회. exe만 필요하면 `--no-bundle`. (MSI를 영구히 안 쓰려면 bundle targets를 `["nsis"]`로 좁혀도 됨.)

## ⚠️ 플러그인 추가 시 4곳을 반드시 동기화
Tauri v2에서 플러그인 하나를 쓰려면 **네 곳**을 모두 맞춰야 한다. 하나라도 빠지면 빌드 실패하거나 런타임에서 권한 거부된다. (개발 중 `store`를 Cargo.toml에만 빠뜨려 `Permission store:default not found`로 빌드가 깨진 전례가 있음.)
1. `src-tauri/Cargo.toml` — Rust 크레이트 의존성 (`tauri-plugin-X = "2"`)
2. `package.json` — JS 바인딩 (`@tauri-apps/plugin-X`)
3. `src-tauri/src/lib.rs` — `.plugin(tauri_plugin_X::Builder::new().build())` (또는 `::init()`)
4. `src-tauri/capabilities/default.json` — `"X:default"` 등 필요한 권한 (빌드 시 유효 권한 목록을 에러로 출력하므로 거기서 정확한 이름 확인)

## 자주 하는 변경
- **표시 필드 추가** (예: assignee, labels): `jira.rs`의 `Fields`/`Issue` 구조 + `fetch_issues`의 `("fields", "...")` 목록 + `types.ts`의 `Issue` + `render.ts`의 `issueRow`. 네 곳을 함께 수정.
  - 중첩 필드(상위/프로젝트 등)는 raw 구조를 추가로 deserialize: `project`(→`project_key`/`project_name`), `parent`(→`parent_summary`)가 예시. **학교 칩**(`render.ts`의 `schoolLabel`)이 `parentSummary`의 `[PFO XXX]` 태그 → 프로젝트명 → 프로젝트 키 순으로 학교를 추론한다(파싱은 프론트에서). 신규 검색 API는 `fields`에 `parent`를 명시해야 상위 제목이 내려온다.
- **기본 JQL·새로고침 주기·단축키 기본값 변경**: `src/types.ts`의 `DEFAULT_SETTINGS`. (실행 중 값은 설정 화면/`settings.json`이 우선)
- **창 크기·프레임·always-on-top 초기값**: `src-tauri/tauri.conf.json`의 `app.windows[0]`.
- **단축키 형식**: Tauri 액셀러레이터 — `CommandOrControl` / `Alt` / `Shift` / `Super` + 키. 예 `CommandOrControl+Alt+J`.

## Jira API 제약 (중요)
- 엔드포인트는 **`GET /rest/api/3/search/jql`** 만 쓴다. 구 `/rest/api/3/search`는 2025-10 제거됨.
- 신규 API는 기본적으로 `id/key`만 반환 → **`fields`를 반드시 명시**.
- `currentUser()`는 인증 토큰 소유자로 해석된다 (계정 ID 불필요).
- 페이징은 `nextPageToken` 방식. 현재는 `maxResults=100` 단일 페이지만 처리(내 미해결 작업은 보통 수십 건 이하). 100건 초과를 다뤄야 하면 `jira.rs`에 토큰 루프 추가.
- 인증: `Authorization: Basic base64(email:token)`. 401=토큰/이메일 오류, 400=JQL 오류로 사용자 메시지 분기되어 있음.

## ⚠️ 에러 처리 / 실패 UX 규칙 (F6 — 깨면 UX·디버깅 다 손해)
요청 실패 UX는 `src/errors.ts`(분류·문구·재시도 정책) + `doRefresh()`(main.ts) + `renderError`(render.ts)에 모여 있다. 손댈 땐 아래를 지킨다.
1. **원문 에러를 사용자에게 그대로 노출하지 말 것.** 화면엔 분류된 친화 문구만, 원문은 `console`에만.
2. **network / auth / jql / unknown 4종으로 구분해 표시할 것.** 분류 키워드는 `errors.ts`의 `classifyKind`에 모아둔다.
3. **자동 재시도는 명시적 횟수 제한.** 현재 정책 = 일시적 실패 1회만(무한 재시도 금지). 백오프는 `RETRY_DELAY_MS`.
4. **재시도 실익이 낮은 오류(auth/JQL)는 재시도 대상에서 제외**가 현재 정책(`isRetryable` → network만). 정책 변경은 UX·중복요청 영향 검토 후 사용자 확인.
5. **Rust↔프론트 에러 포맷을 바꿀 땐 호출부 영향 범위를 먼저 확인할 것.** 분류는 Rust 에러 문자열(한국어 접두사)에 의존한다 → `jira.rs`/`secrets.rs`의 에러 문구를 바꾸면 `errors.ts`의 매칭도 **반드시 함께** 갱신(특히 `"네트워크 오류"`, `"인증 실패"`, `"JQL 오류"`, 상태코드 표기).
6. **UX 개선이라도 기존 데이터 흐름·상태(`issues`/`mode`/`refreshing`/타이머)·Jira 요청 로직을 크게 바꾸지 말 것.** `refreshing` 가드는 중복 요청/렌더 방지용이니 우회하지 말 것.
7. **큰 구조 변경(예: 구조화 에러 도입)은 사용자에게 먼저 물을 것.** ↓ 아래 권장안 참고.
8. **사용자용 메시지와 개발자용 로그를 분리할 것.** `USER_MESSAGES`(사용자) vs `console`(raw)로 이미 분리돼 있다.
9. 재시도 횟수/백오프를 늘리려면 중복 요청·과도한 Jira 호출(레이트리밋) 위험을 함께 검토.

### 권장: 장기적으로는 Rust 구조화 에러 고려 (지금은 보류)
현재는 **Rust가 문자열 에러를 던지고 프론트가 문자열 매칭으로 분류**한다. 영향 범위가 작아 F6에선 이 방식이 적절(오버엔지니어링 회피). 다만 한계가 있다:
- 분류가 Rust 문구·상태코드 표기에 **암묵적으로 결합** → 문구를 바꾸면 프론트 매칭이 조용히 깨질 수 있다(테스트로 방어 중).
- 다국어/문구 변경에 취약.

장기적으로 실패 종류가 늘거나 분류가 더 정밀해져야 하면 `fetch_issues`를 **`Result<Vec<Issue>, JiraError>`** 로 바꾸고 `#[derive(Serialize)] struct JiraError { kind: "network"|"auth"|"jql"|..., message, detail }` 형태로 던지는 편이 견고하다. 이때 `kind`는 Rust가 권위 있게 정하고 프론트는 매칭 대신 `kind`만 읽는다. **단 영향 범위가 커지므로**(커맨드 반환 타입 변경, invoke catch가 string이 아닌 객체를 받게 됨, 모든 에러 경로 수정) **사용자 확인 후 별도 작업으로** 진행한다.

## 환경 메모
- **rustup/cargo PATH**: rustup 설치 후 `%USERPROFILE%\.cargo\bin`이 PATH에 추가되지만, 이미 떠 있던 셸/IDE에는 반영 안 됨 → 새 터미널 또는 IDE 재시작 필요. 임시: `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.
- **TLS**: `reqwest`는 기본 features(Windows에서 schannel/native-tls) 사용 → OpenSSL 빌드 불필요.
- **keyring**: 서비스명 `jira-today-todo`, account=email. 토큰 삭제는 `delete_credential()`(keyring v3).
- 일반 IntelliJ IDEA엔 Rust 지원이 없음(RustRover로 분리). `.rs` 자동완성이 필요하면 RustRover 사용. 빌드는 IDE와 무관하게 `pnpm tauri build`.
