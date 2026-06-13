# Jira 오늘 할 일 — 사용 설명서

매번 Jira에 들어가 필터를 클릭하지 않아도, **내 미해결 작업을 마감순으로** 데스크톱에 항상 띄워 두고 클릭 한 번으로 이슈로 이동하는 위젯입니다.

기본 조회 조건(JQL):
```
assignee = currentUser() and resolution = Unresolved ORDER BY due ASC, updated DESC
```

---

## 1. 처음 시작하기

### 1-1. 실행
빌드 산출물 위치·실행 방법은 OS마다 다릅니다. 빌드 방법은 → [4. 빌드](#4-빌드).

- **macOS**: 빌드하면 `src-tauri/target/release/bundle/macos/TaskDog.app` 이 생깁니다.
  - 더블클릭하거나 터미널에서 `open src-tauri/target/release/bundle/macos/TaskDog.app`
  - 평소 쓰려면 이 `TaskDog.app` 을 **`/Applications`(응용 프로그램) 폴더로 드래그**해 설치 → Launchpad/Spotlight에서 실행.
  - 함께 생기는 `…/bundle/dmg/TaskDog_*.dmg` 는 배포용 디스크 이미지(열어서 앱을 응용 프로그램으로 드래그).
  - 첫 실행 시 Gatekeeper 경고가 뜨면 → [5. 문제 해결](#5-문제-해결)의 "확인되지 않은 개발자" 항목 참고.
- **Windows**: `src-tauri/target/release/jira-today-todo.exe`(단독 실행) 또는 설치본 `_setup.exe`.

### 1-2. 최초 설정
앱을 처음 켜면 **설정 화면**이 나옵니다.

| 항목 | 입력 |
|---|---|
| **Jira 사이트 URL** | `https://syworks.atlassian.net` (기본 입력됨) |
| **이메일** | Atlassian 로그인 이메일 (`sumin9278@syworks.com`) |
| **API 토큰** | 아래 방법으로 발급해 붙여넣기 |
| **JQL** | 기본값 그대로 두거나 원하는 조건으로 변경 |
| **새로고침(분)** | 자동 갱신 주기 (기본 5분) |
| **단축키** | 창 소환 단축키 (기본 `CommandOrControl+Alt+J`) |

**API 토큰 발급:** 설정 화면의 *"토큰 발급 페이지 열기 ↗"* 클릭 → Atlassian 페이지에서 *Create API token* → 생성된 토큰 복사 → 설정의 API 토큰 칸에 붙여넣기.
(직접 링크: https://id.atlassian.com/manage-profile/security/api-tokens )

**저장**을 누르면 목록이 나타납니다. 토큰은 파일이 아니라 OS 자격 증명 저장소(**macOS = 키체인 / Windows = 자격 증명 관리자**)에 안전하게 저장되며, 이후엔 다시 입력할 필요가 없습니다.

---

## 2. 일상 사용법

| 기능 | 조작 |
|---|---|
| **창 소환** | 어디서든 단축키(`Ctrl+Alt+J`) 또는 트레이 아이콘 **좌클릭** |
| **항상 위 고정 (위젯 모드)** | 상단 **📌** — 켜면 다른 창 위에 계속 떠 있음. 다시 누르면 해제 |
| **작업 열기** | 목록의 작업 **클릭** → 기본 브라우저에서 Jira 이슈 페이지 |
| **새로고침** | 자동(기본 5분마다) + 수동 **⟳**. 창을 띄울 때도 자동 갱신 |
| **숨기기** | **✕** — 종료가 아니라 트레이로 숨김(앱은 계속 동작) |
| **최소화** | **—** |
| **설정 열기** | **⚙** |
| **완전 종료** | 트레이 아이콘 **우클릭 → 종료** |
| **이동(위치 옮기기)** | 상단 타이틀바를 잡고 드래그 |

### 목록 보는 법
작업은 마감일 기준으로 자동 그룹화됩니다.

- 🔴 **지연** — 마감일이 지난 작업 (빨간 강조)
- 🟠 **오늘** — 오늘 마감 (주황 강조)
- 🟢 **예정** — 앞으로 마감
- ⚪ **마감 없음** — 마감일 미설정

각 카드에는 **이슈 키 · D-day · 제목 · 작업 유형 · 상태 · 우선순위**가 표시됩니다.

### 알림
마감이 지났거나 오늘 마감인 미해결 작업이 있으면 **데스크톱 알림**이 뜹니다(앱 실행 세션당 작업별 1회). 처음 한 번 알림 권한 허용이 필요할 수 있습니다.
> ⚠️ **현재 마감 알림 토스트는 Windows에서만 발송됩니다.** macOS에서는 목록의 색상/D-day 표시로만 마감을 확인하세요(트레이 툴팁의 미해결 건수는 macOS에서도 동작). macOS 알림이 필요하면 알려주세요 — 알림 플러그인으로 연결할 수 있습니다.

### 트레이 / 메뉴 막대
**macOS는 화면 상단 메뉴 막대 오른쪽**, **Windows는 작업표시줄 오른쪽 트레이**에 아이콘이 상주합니다.
- **좌클릭**: 창 표시/숨김 토글
- **우클릭 메뉴**: 열기/숨기기 · 새로고침 · 설정 · 종료
- 아이콘에 마우스를 올리면 **미해결 건수**가 툴팁으로 보입니다.

---

## 3. 설정 바꾸기

상단 **⚙** 버튼으로 언제든 변경할 수 있습니다.

- **JQL**: 보고 싶은 작업 조건을 바꿀 수 있습니다.
  - 예) 특정 프로젝트만: `project = SEHAN AND assignee = currentUser() AND resolution = Unresolved ORDER BY due ASC`
  - 예) 이번 주 마감: `assignee = currentUser() AND resolution = Unresolved AND due <= endOfWeek() ORDER BY due ASC`
- **새로고침(분)**: 1~120분.
- **단축키**: `CommandOrControl` / `Alt` / `Shift` / `Super` 와 키 조합. 예) `CommandOrControl+Shift+J`. 다른 프로그램과 충돌하면 등록이 무시되니 다른 조합으로 바꾸세요.
- **API 토큰**: 비워 두면 기존 토큰 유지, 새로 입력하면 교체됩니다.

설정·창 위치·크기·핀 상태는 자동 저장되어 재시작해도 유지됩니다.

---

## 4. 빌드

### 4-0. 사전 준비(처음 한 번)
빌드에는 **Node/pnpm + Rust 툴체인**이 필요합니다.

**macOS**
1. **Xcode Command Line Tools**(컴파일러/링커):
   ```bash
   xcode-select --install        # 이미 있으면 "already installed" 라고 나옴
   ```
2. **Rust(rustup)** — 공식 설치 스크립트(권장):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   source "$HOME/.cargo/env"     # 또는 터미널 새로 열기
   rustc --version               # 설치 확인
   ```
   (Homebrew를 선호하면 `brew install rustup` → `rustup-init` 도 가능)
3. **Node 22+ / pnpm 10+** — 이미 설치돼 있으면 생략. pnpm은 `corepack enable pnpm` 또는 `brew install pnpm`.

**Windows**: `winget install Rustlang.Rustup` + Visual Studio **MSVC C++ Build Tools**("Desktop development with C++"). cargo가 인식 안 되면 새 터미널/IDE로 다시 열기.

### 4-1. 빌드 명령(공통)
```bash
pnpm install          # 최초 1회 (JS 의존성 설치)
pnpm tauri dev        # 개발 모드(코드 수정 즉시 반영, HMR)
pnpm tauri build      # 배포용 빌드(최적화 + 설치 번들)
```
> 첫 빌드는 Rust 의존성 컴파일로 **수 분** 걸립니다(이후엔 증분 빌드라 빨라짐).

### 4-2. 산출물 — `src-tauri/target/release/`
**macOS** (Apple Silicon 기준):
- `bundle/macos/TaskDog.app` — 실행하는 앱(이 파일을 `/Applications`로 드래그해 설치)
- `bundle/dmg/TaskDog_0.1.0_aarch64.dmg` — 배포용 디스크 이미지
- 컴파일만 빠르게 확인: `pnpm tauri build --no-bundle` → 원시 바이너리 `src-tauri/target/release/jira-today-todo`

**Windows**:
- `jira-today-todo.exe` — 단독 실행 파일
- `bundle/nsis/..._setup.exe` — 설치 마법사(시작 메뉴 등록)
- `bundle/msi/....msi` — MSI 설치본
- exe만: `--no-bundle` / 설치 마법사만: `--bundles nsis`

---

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| **창이 안 보임** | 트레이/메뉴 막대 아이콘 좌클릭, 또는 단축키(`Ctrl+Alt+J`, macOS도 동일 액셀러레이터). 최소화돼 있을 수 있음 |
| **(macOS) "확인되지 않은 개발자" / "손상되어 열 수 없음"** | 서명/공증 안 된 앱이라 Gatekeeper가 막는 것. **앱을 우클릭(또는 Control+클릭) → 열기 → 열기**. 또는 *시스템 설정 → 개인정보 보호 및 보안* 맨 아래 **"확인 없이 열기"**. 그래도 막히면 터미널에서 `xattr -dr com.apple.quarantine "/Applications/TaskDog.app"` |
| **"인증 실패 (401)"** | 이메일 또는 API 토큰 오류 → ⚙에서 토큰 재입력. 토큰이 만료/삭제됐을 수 있음 |
| **"JQL 오류 (400)"** | JQL 문법 확인. Jira에서 먼저 검색해 보고 동작하는 JQL을 붙여넣기 |
| **"404 / 사이트 URL 확인"** | 사이트 URL이 `https://<도메인>.atlassian.net` 형식인지 확인 |
| **단축키가 안 먹음** | 다른 프로그램과 충돌 → ⚙에서 다른 조합으로 변경. macOS는 *시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용/입력 모니터링* 권한이 필요할 수 있음 |
| **빌드 시 `cargo`/`tauri` not found** | rustup 설치 후 PATH 미반영. **macOS**: `source "$HOME/.cargo/env"` 또는 터미널 새로 열기. **Windows**: 임시 `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"` |
| **마감 알림이 안 옴** | **macOS는 현재 마감 토스트 미지원**(목록 색상/D-day로 확인). **Windows**는 설정 → 알림에서 앱 알림 허용 확인 |

---

## 6. 데이터 · 보안

- **API 토큰**: OS 자격 증명 저장소에 저장(서비스명 `jira-today-todo`). **macOS = 키체인(키체인 접근.app에서 `jira-today-todo` 검색), Windows = 자격 증명 관리자.** 코드·설정 파일에 평문 저장되지 않습니다.
- **설정**(사이트/이메일/JQL/주기/단축키): 앱 데이터 폴더의 `settings.json`(비밀 아님). macOS는 `~/Library/Application Support/com.syworks.jiratodaytodo/`.
- Jira 호출은 앱 내부(Rust)에서만 이루어지며 토큰이 화면(웹뷰)에 노출되지 않습니다.

---

## 7. 제거

- **macOS**: `/Applications`(또는 둔 위치)의 `TaskDog.app`을 휴지통으로. 설정 폴더 `~/Library/Application Support/com.syworks.jiratodaytodo/` 삭제. 토큰은 *키체인 접근.app*에서 `jira-today-todo` 항목 삭제.
- **Windows**: 설치본은 *설정 → 앱*에서 제거. 단독 exe는 파일 삭제. 토큰은 *자격 증명 관리자 → Windows 자격 증명*에서 `jira-today-todo` 삭제.
