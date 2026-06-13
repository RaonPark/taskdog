// Jira 요청 실패를 사용자 친화 메시지로 "분류"하는 계층.
//
// 불변식:
//  - 사용자에게 원문(raw) 에러를 그대로 노출하지 않는다. raw는 콘솔 로그 전용.
//  - 분류는 Rust(`jira.rs`/`secrets.rs`)가 던지는 한국어 접두사 + 범용 영어 키워드를
//    함께 매칭한다. (Rust 에러 문구가 바뀌면 여기 매칭도 함께 갱신할 것 — rules 참고)
//  - 자동 재시도 대상은 "일시적 실패"(network)뿐. 인증/JQL은 같은 입력으로 다시 보내도
//    결과가 같아 재시도 실익이 없다.

export type ErrorKind = "network" | "auth" | "jql" | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  /** 사용자에게 보여줄 안전한 문구. */
  userMessage: string;
  /** 디버깅용 원문. 콘솔에만 남기고 화면에는 노출하지 않는다. */
  raw: string;
}

const USER_MESSAGES: Record<ErrorKind, string> = {
  network:
    "네트워크 연결에 실패했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  auth: "Jira 인증이 만료되었거나 권한이 없습니다. 설정에서 인증 정보를 확인해 주세요.",
  jql: "JQL 쿼리에 문제가 있어 Jira 검색을 완료하지 못했습니다. 필터 조건을 확인해 주세요.",
  unknown: "요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

/** 자동 재시도 직전 사용자에게 알리는 문구. */
export const RETRY_NOTICE = "네트워크 오류가 발생해 잠시 후 한 번 더 시도합니다…";

/** 자동 재시도 백오프(ms). 무한 재시도 금지 — 호출부에서 1회만 사용. */
export const RETRY_DELAY_MS = 1000;

/** invoke 거부값(보통 string), Error, 기타 무엇이 와도 원문 문자열로 정규화. */
export function rawErrorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    try {
      return JSON.stringify(e);
    } catch {
      /* fallthrough */
    }
  }
  return String(e);
}

function classifyKind(raw: string): ErrorKind {
  const s = raw.toLowerCase();

  // 1) 인증/권한 — 재시도 실익 없음. (Rust: "인증 실패 (401)", "권한 없음 (403)",
  //    "API 토큰이 저장되어 있지 않습니다…")
  if (
    raw.includes("인증 실패") ||
    raw.includes("권한 없음") ||
    raw.includes("토큰") ||
    /\b(401|403)\b/.test(s) ||
    /unauthorized|forbidden|invalid token|authentication/.test(s)
  ) {
    return "auth";
  }

  // 2) JQL — 재시도 실익 없음. (Rust: "JQL 오류 (400)") 신규 search/jql API의 400은
  //    사실상 쿼리 오류다.
  if (raw.includes("JQL 오류") || /\bjql\b/.test(s) || /\b400\b/.test(s)) {
    return "jql";
  }

  // 3) 네트워크/오프라인/일시 서버 오류 — 재시도 가치 있음. (Rust: "네트워크 오류: …",
  //    "Jira 오류 (502)" 등 5xx/429)
  if (
    raw.includes("네트워크 오류") ||
    /offline|fetch failed|failed to fetch|network error|time(d)? ?out|timeout|connection (refused|reset|closed|aborted)|dns|name resolution|unreachable|econn|enotfound|etimedout/.test(
      s
    ) ||
    /\b(429|500|502|503|504)\b/.test(s)
  ) {
    return "network";
  }

  return "unknown";
}

/**
 * 원문 에러를 사용자 친화 분류로 변환한다.
 * `navigator.onLine`은 보조 신호로만 사용한다(절대 단독 판단 기준 아님):
 * 분류가 불명(unknown)이고 브라우저가 오프라인이면 network로 본다.
 */
export function classifyError(e: unknown): ClassifiedError {
  const raw = rawErrorText(e);
  let kind = classifyKind(raw);
  if (
    kind === "unknown" &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    kind = "network";
  }
  return { kind, userMessage: USER_MESSAGES[kind], raw };
}

/** 자동 재시도 대상인가? 현재 정책: 네트워크/일시 실패만. */
export function isRetryable(kind: ErrorKind): boolean {
  return kind === "network";
}
