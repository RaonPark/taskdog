// GitLab 순수 로직 단위 테스트. 의존성/프레임워크 추가 없이 Node 내장 러너로 실행:
//   node --experimental-strip-types --test tests/gitlabParse.test.ts
// (Node 22.6+ 의 타입 스트리핑 사용. src/gitlabParse.ts 는 런타임 import가 없어 그대로 동작.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMrUri,
  originOf,
  branchToEnv,
  chipKindOf,
  isSafeMrUrl,
  sameUser,
  shouldNotify,
} from "../src/gitlabParse.ts";
import type { GitlabMrResp } from "../src/gitlabParse.ts";

test("parseMrUri: 기본 MR URI 파싱", () => {
  const p = parseMrUri("https://gitlab.example.com/group/project/-/merge_requests/123");
  assert.ok(p);
  assert.equal(p.origin, "https://gitlab.example.com");
  assert.equal(p.projectPath, "group/project");
  assert.equal(p.iid, 123);
});

test("parseMrUri: 서브그룹 경로/꼬리 경로/쿼리 포함", () => {
  const p = parseMrUri(
    "https://gitlab.example.com/group/sub/project/-/merge_requests/45/diffs?foo=1"
  );
  assert.ok(p);
  assert.equal(p.projectPath, "group/sub/project");
  assert.equal(p.iid, 45);
});

test("parseMrUri: MR이 아닌 URL/이상값은 null", () => {
  assert.equal(parseMrUri("https://gitlab.example.com/group/project/-/issues/7"), null);
  assert.equal(parseMrUri("https://example.com/foo"), null);
  assert.equal(parseMrUri("not a url"), null);
  assert.equal(
    parseMrUri("https://gitlab.example.com/g/p/-/merge_requests/0"),
    null
  );
});

test("originOf: 끝 슬래시/대소문자/경로 정규화", () => {
  assert.equal(originOf("https://gitlab.example.com/"), "https://gitlab.example.com");
  assert.equal(originOf("https://GitLab.Example.com"), "https://gitlab.example.com");
  assert.equal(
    originOf("https://gitlab.example.com:8443/path"),
    "https://gitlab.example.com:8443"
  );
  assert.equal(originOf(""), "");
});

test("branchToEnv: dev→DEV, prod→PROD, 그 외 null", () => {
  assert.equal(branchToEnv("dev"), "DEV");
  assert.equal(branchToEnv("prod"), "PROD");
  assert.equal(branchToEnv("main"), null);
  assert.equal(branchToEnv("develop"), null);
  assert.equal(branchToEnv(""), null);
});

test("chipKindOf: merged→merged, opened→open, 그 외(closed/locked/미상)→null", () => {
  assert.equal(chipKindOf("merged"), "merged");
  assert.equal(chipKindOf("opened"), "open");
  assert.equal(chipKindOf("closed"), null); // 사용자 확정: closed 미표시
  assert.equal(chipKindOf("locked"), null);
  assert.equal(chipKindOf(""), null);
});

test("isSafeMrUrl: http/https만 허용, 위험 scheme 차단", () => {
  assert.equal(
    isSafeMrUrl("https://gitlab.example.com/g/p/-/merge_requests/1"),
    true
  );
  assert.equal(
    isSafeMrUrl("http://gitlab.example.com/g/p/-/merge_requests/1"),
    true
  );
  assert.equal(isSafeMrUrl("javascript:alert(1)"), false);
  assert.equal(isSafeMrUrl("data:text/html,<b>x</b>"), false);
  assert.equal(isSafeMrUrl("file:///etc/passwd"), false);
  assert.equal(isSafeMrUrl(""), false);
  assert.equal(isSafeMrUrl("not a url"), false);
});

test("sameUser: id 우선, 그다음 username, 그다음 name", () => {
  assert.equal(sameUser({ id: 1, username: "a", name: "A" }, { id: 1, username: "b", name: "B" }), true); // id 동일
  assert.equal(sameUser({ id: 1, username: "a", name: "A" }, { id: 2, username: "a", name: "A" }), false); // id 다름이 우선
  assert.equal(sameUser({ id: null, username: "kim", name: "X" }, { id: null, username: "kim", name: "Y" }), true);
  assert.equal(sameUser({ id: null, username: null, name: "홍길동" }, { id: null, username: null, name: "홍길동" }), true);
  assert.equal(sameUser(null, { id: 1, username: null, name: null }), false); // 한쪽 null → 단정 불가
  assert.equal(sameUser({ id: null, username: null, name: null }, { id: null, username: null, name: null }), false);
});

function mr(over: Partial<GitlabMrResp>): GitlabMrResp {
  return {
    merged: true,
    state: "merged",
    targetBranch: "dev",
    mergedAt: "2026-06-15T00:00:00Z",
    author: { id: 1, username: "kim.dev", name: "Kim" },
    mergedBy: { id: 2, username: "lee.lead", name: "Lee" },
    ...over,
  };
}

test("shouldNotify: 머지 & author≠merged_by & 미알림 → true", () => {
  assert.equal(shouldNotify(mr({}), "DEV", false), true);
});

test("shouldNotify: author==merged_by → false (태그는 별도)", () => {
  assert.equal(
    shouldNotify(mr({ mergedBy: { id: 1, username: "kim.dev", name: "Kim" } }), "DEV", false),
    false
  );
});

test("shouldNotify: merged_by null → false", () => {
  assert.equal(shouldNotify(mr({ mergedBy: null }), "DEV", false), false);
});

test("shouldNotify: 미머지 → false", () => {
  assert.equal(shouldNotify(mr({ merged: false }), "DEV", false), false);
});

test("shouldNotify: env null(미매핑 브랜치) → false", () => {
  assert.equal(shouldNotify(mr({ targetBranch: "main" }), null, false), false);
});

test("shouldNotify: 이미 알림 보냄 → false (중복 방지)", () => {
  assert.equal(shouldNotify(mr({}), "DEV", true), false);
});
