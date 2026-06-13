# jira-today-todo

Jira의 "내 미해결 작업"을 마감순으로 항상 보여주고, 클릭하면 해당 이슈로 이동하는 **Tauri v2 데스크톱 위젯**.
대상 JQL: `assignee = currentUser() and resolution = Unresolved ORDER BY due ASC, updated DESC`

- 사람용 사용 설명서: `MANUAL.md`
- 구조/유지보수 규칙: 아래 import (`.claude/rules/`)

## 스택 (현재 검증 버전)
| 영역 | 사용 | 버전 |
|---|---|---|
| 런타임 | Node / pnpm | 22.x / 10.x |
| Rust | rustup stable (MSVC) | cargo 1.96+ |
| 데스크톱 | Tauri | **v2** (`@tauri-apps/cli` 2.11, `tauri` crate 2.11) |
| 프론트 | Vite / TypeScript | 6.x / 5.6 |
| 플러그인 | global-shortcut · notification · opener · store · window-state | 2.x |
| Rust crate | reqwest 0.12 · keyring 3 · serde 1 · base64 0.22 | — |

## 스택 최신 유지 정책
- **Tauri는 v2 메이저를 유지**한다. 모든 `@tauri-apps/*`와 `tauri-plugin-*`는 `^2`로 잡아 v2 내 최신 패치를 따라간다. (v1↔v2, v2↔v3는 호환 깨짐 — 메이저 점프는 마이그레이션 가이드 확인 후 의도적으로만)
- 새 의존성 추가 시 **최신 안정 버전**을 쓰고, Tauri 생태계는 위 정책대로 캐럿(`^`) 범위로 고정한다.
- 주기적 업데이트:
  - JS: `pnpm outdated` 확인 → `pnpm up`(범위 내) / 메이저는 개별 검토. `pnpm dlx @tauri-apps/cli@latest` 로 CLI 메이저 확인.
  - Rust: `cargo update`(범위 내 최신). `cargo upgrade`(cargo-edit)로 매니페스트 상향은 검토 후.
  - 툴체인: `rustup update stable`.
- 업데이트 후엔 반드시 `pnpm tauri build --debug --no-bundle`로 컴파일 + 앱 실행 점검(특히 트레이/단축키/플러그인 권한).

## 자주 쓰는 명령
```bash
pnpm install
pnpm tauri dev                       # 개발(HMR)
pnpm build                           # 프론트 타입체크+빌드(빠른 TS 검증)
pnpm tauri build                     # 배포용 exe + 설치본
pnpm tauri build --debug --no-bundle # 컴파일 검증만
```
> rustup 설치 직후엔 새 셸/IDE에서 PATH가 반영됨. `cargo` 미인식 시 IDE 재시작 또는
> `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.

@.claude/rules/architecture.md
@.claude/rules/maintenance.md
