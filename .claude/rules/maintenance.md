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

## 환경 메모
- **rustup/cargo PATH**: rustup 설치 후 `%USERPROFILE%\.cargo\bin`이 PATH에 추가되지만, 이미 떠 있던 셸/IDE에는 반영 안 됨 → 새 터미널 또는 IDE 재시작 필요. 임시: `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.
- **TLS**: `reqwest`는 기본 features(Windows에서 schannel/native-tls) 사용 → OpenSSL 빌드 불필요.
- **keyring**: 서비스명 `jira-today-todo`, account=email. 토큰 삭제는 `delete_credential()`(keyring v3).
- 일반 IntelliJ IDEA엔 Rust 지원이 없음(RustRover로 분리). `.rs` 자동완성이 필요하면 RustRover 사용. 빌드는 IDE와 무관하게 `pnpm tauri build`.
