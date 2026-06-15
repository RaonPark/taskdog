use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::secrets::get_token;

// Jira "개발(Development)" 패널 정보(dev-status). GitLab-Jira 연동이 켜져 있으면,
// MR 제목/설명/브랜치/커밋에 든 이슈 키로 연동이 채워준 MR 목록을 여기서 읽는다.
// 인증은 기존 Jira 이메일+토큰(Basic) 그대로 — 칩 표시엔 GitLab 토큰이 필요 없다.
//
// 주의: dev-status는 비공식 내부 API다. applicationType이 인스턴스별 문자열
// (예: "GitLab(gitlab.syworks.net)")이라 하드코딩하지 않고 summary의 byInstanceType
// 키로 동적 발견한다. issueId는 키가 아닌 숫자 id를 요구한다.

// ---------- summary 응답(raw) ----------

#[derive(Deserialize)]
struct SummaryResp {
    summary: Option<Summary>,
}

#[derive(Deserialize)]
struct Summary {
    pullrequest: Option<PrSummary>,
}

#[derive(Deserialize)]
struct PrSummary {
    overall: Option<Overall>,
    #[serde(rename = "byInstanceType", default)]
    by_instance_type: Map<String, Value>,
}

#[derive(Deserialize)]
struct Overall {
    #[serde(default)]
    count: i64,
}

// ---------- detail 응답(raw) ----------

#[derive(Deserialize)]
struct DetailResp {
    #[serde(default)]
    detail: Vec<DetailEntry>,
}

#[derive(Deserialize)]
struct DetailEntry {
    #[serde(rename = "pullRequests", default)]
    pull_requests: Vec<RawPr>,
}

#[derive(Deserialize)]
struct RawPr {
    url: Option<String>,
    status: Option<String>,
    destination: Option<BranchRef>,
    author: Option<DevAuthor>,
}

#[derive(Deserialize)]
struct BranchRef {
    branch: Option<String>,
}

#[derive(Deserialize)]
struct DevAuthor {
    name: Option<String>,
}

// ---------- 프론트 전달용(slim, camelCase) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevMr {
    url: String,
    merged: bool,
    target_branch: String,
    author_name: Option<String>,
}

/// 한 Jira 이슈의 dev-status에서 연결된 GitLab MR들을 가져온다.
/// 흐름: summary로 PR 유무 + 인스턴스 타입(applicationType) 확인 → 있으면 타입별 detail 조회.
/// 머지 판정은 status=="MERGED", 환경 판정용 브랜치는 destination.branch(=target_branch).
/// merged_by는 dev-status에 없다 → 알림은 프론트가 별도로 GitLab API(fetch_gitlab_mr)로 확인.
#[tauri::command]
pub async fn fetch_dev_mrs(
    site: String,
    email: String,
    issue_id: String,
) -> Result<Vec<DevMr>, String> {
    let token = get_token(&email)?;
    let site = site.trim_end_matches('/').to_string();
    let auth = STANDARD.encode(format!("{email}:{token}"));
    let client = reqwest::Client::new();

    // 1) summary — PR 개수와 인스턴스 타입(applicationType 후보) 발견.
    let summary: SummaryResp = client
        .get(format!("{site}/rest/dev-status/latest/issue/summary"))
        .query(&[("issueId", issue_id.as_str())])
        .header("Authorization", format!("Basic {auth}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("dev-status 네트워크 오류: {e}"))?
        .error_for_status()
        .map_err(|e| format!("dev-status 오류: {e}"))?
        .json()
        .await
        .map_err(|e| format!("dev-status 응답 파싱 실패: {e}"))?;

    let pr = match summary.summary.and_then(|s| s.pullrequest) {
        Some(pr) => pr,
        None => return Ok(vec![]),
    };
    if pr.overall.map(|o| o.count).unwrap_or(0) == 0 {
        return Ok(vec![]);
    }
    let app_types: Vec<String> = pr.by_instance_type.keys().cloned().collect();

    // 2) 인스턴스 타입별 detail — PR 목록 수집(url 기준 dedupe).
    let mut out: Vec<DevMr> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for at in app_types {
        let detail: DetailResp = client
            .get(format!("{site}/rest/dev-status/latest/issue/detail"))
            .query(&[
                ("issueId", issue_id.as_str()),
                ("applicationType", at.as_str()),
                ("dataType", "pullrequest"),
            ])
            .header("Authorization", format!("Basic {auth}"))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("dev-status 네트워크 오류: {e}"))?
            .error_for_status()
            .map_err(|e| format!("dev-status 오류: {e}"))?
            .json()
            .await
            .map_err(|e| format!("dev-status 응답 파싱 실패: {e}"))?;

        for entry in detail.detail {
            for raw in entry.pull_requests {
                let Some(url) = raw.url else { continue };
                if !seen.insert(url.clone()) {
                    continue;
                }
                out.push(DevMr {
                    merged: raw.status.as_deref() == Some("MERGED"),
                    target_branch: raw.destination.and_then(|d| d.branch).unwrap_or_default(),
                    author_name: raw.author.and_then(|a| a.name),
                    url,
                });
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_detail_into_devmr() {
        // dev-status detail의 pullRequests를 DevMr로 매핑하는지 확인.
        let json = r#"{"errors":[],"detail":[{"pullRequests":[
            {"url":"https://gitlab.syworks.net/pfo/portfolio-cnu/-/merge_requests/322",
             "status":"MERGED","destination":{"branch":"dev"},
             "author":{"name":"박수민"}},
            {"url":"https://gitlab.syworks.net/pfo/portfolio-cnu/-/merge_requests/321",
             "status":"MERGED","destination":{"branch":"local"},
             "author":{"name":"박수민"}}
        ]}]}"#;
        let d: DetailResp = serde_json::from_str(json).unwrap();
        let prs = &d.detail[0].pull_requests;
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].status.as_deref(), Some("MERGED"));
        assert_eq!(prs[0].destination.as_ref().unwrap().branch.as_deref(), Some("dev"));
        assert_eq!(prs[1].destination.as_ref().unwrap().branch.as_deref(), Some("local"));
    }
}
