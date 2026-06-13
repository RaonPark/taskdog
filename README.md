# Jira 오늘 할 일 (jira-today-todo)

매번 Jira에 들어가 필터를 클릭하지 않아도, **내 미해결 작업을 마감순으로** 항상 보여주는 데스크톱 위젯.
작업을 클릭하면 브라우저에서 해당 Jira 이슈가 바로 열린다.

대상 JQL (설정에서 변경 가능):

```
assignee = currentUser() and resolution = Unresolved ORDER BY due ASC, updated DESC
```

## 기능

- 프레임리스 위젯 창 + **📌 핀** 토글(항상 위 고정) → 위젯/디스코드형 둘 다 사용 가능
- 마감 기준 그룹핑(**지연 / 오늘 / 예정 / 마감 없음**)과 색상 강조(지연=빨강, 오늘=주황)
- 행 클릭 → 기본 브라우저에서 `…/browse/<KEY>` 열기
- **전역 단축키**(기본 `Ctrl+Alt+J`)로 어디서든 창 소환
- **시스템 트레이**: 좌클릭 표시/숨김, 메뉴(새로고침·설정·종료), 미해결 건수 툴팁
- **자동 새로고침**(기본 5분) + **마감 임박 데스크톱 알림**
- 창 위치·크기 기억(window-state), API 토큰은 **Windows 자격 증명 관리자**(keyring)에 저장

## 기술 스택

- [Tauri v2](https://v2.tauri.app) (Rust 백엔드) + Vite + Vanilla TypeScript
- Jira 호출은 Rust(`reqwest`)에서 수행 → 토큰이 웹뷰에 노출되지 않고 CORS 문제 없음
- 신규 검색 엔드포인트 `GET /rest/api/3/search/jql` 사용

## 사전 준비

1. **Rust** (`rustup`) — `winget install Rustlang.Rustup`
2. **MSVC C++ Build Tools** (Visual Studio Build Tools, "Desktop development with C++")
3. **Atlassian API 토큰** — https://id.atlassian.com/manage-profile/security/api-tokens

## 개발 / 빌드

```bash
pnpm install
pnpm tauri dev          # 개발 실행 (HMR)
pnpm tauri build        # 배포용 실행 파일/설치본 생성
```

## 최초 실행

앱을 처음 켜면 설정 화면이 뜬다. **사이트 URL · 이메일 · API 토큰 · JQL · 새로고침 주기 · 단축키**를 입력하고 저장하면 목록이 나타난다.
