use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::secrets::get_token;

// ---------- Jira 응답(raw) ----------

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    issues: Vec<RawIssue>,
}

#[derive(Deserialize)]
struct RawIssue {
    // 숫자 issueId (예: "59689"). Jira dev-status(개발 패널) API가 키가 아닌 이 id를 요구한다.
    id: String,
    key: String,
    fields: Fields,
}

#[derive(Deserialize)]
struct Fields {
    summary: Option<String>,
    duedate: Option<String>,
    updated: Option<String>,
    status: Option<Status>,
    priority: Option<NamedIcon>,
    issuetype: Option<NamedIcon>,
    project: Option<Project>,
    parent: Option<Parent>,
    #[serde(default)]
    labels: Vec<String>,
}

#[derive(Deserialize)]
struct Project {
    key: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Parent {
    #[serde(default)]
    fields: ParentFields,
}

#[derive(Deserialize, Default)]
struct ParentFields {
    summary: Option<String>,
}

#[derive(Deserialize)]
struct Status {
    name: Option<String>,
    #[serde(rename = "statusCategory")]
    status_category: Option<StatusCategory>,
}

#[derive(Deserialize)]
struct StatusCategory {
    key: Option<String>,
}

#[derive(Deserialize)]
struct NamedIcon {
    name: Option<String>,
    #[serde(rename = "iconUrl")]
    icon_url: Option<String>,
}

// ---------- 프론트 전달용(slim, camelCase) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    id: String,
    key: String,
    summary: String,
    duedate: Option<String>,
    status: String,
    status_category: String,
    priority: Option<String>,
    priority_icon_url: Option<String>,
    issuetype: Option<String>,
    issuetype_icon_url: Option<String>,
    updated: Option<String>,
    browse_url: String,
    project_key: String,
    project_name: String,
    parent_summary: Option<String>,
    labels: Vec<String>,
}

#[tauri::command]
pub async fn fetch_issues(
    site: String,
    email: String,
    jql: String,
) -> Result<Vec<Issue>, String> {
    let token = get_token(&email)?;
    let site = site.trim_end_matches('/').to_string();
    let url = format!("{site}/rest/api/3/search/jql");

    let auth = STANDARD.encode(format!("{email}:{token}"));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .query(&[
            ("jql", jql.as_str()),
            (
                "fields",
                "summary,duedate,status,priority,updated,issuetype,project,parent,labels",
            ),
            ("maxResults", "100"),
        ])
        .header("Authorization", format!("Basic {auth}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let body = body.chars().take(400).collect::<String>();
        return Err(match status.as_u16() {
            401 => "인증 실패 (401): 이메일 또는 API 토큰을 확인하세요.".to_string(),
            403 => "권한 없음 (403): 계정 권한을 확인하세요.".to_string(),
            400 => format!("JQL 오류 (400): {body}"),
            404 => "엔드포인트를 찾을 수 없음 (404): 사이트 URL을 확인하세요.".to_string(),
            code => format!("Jira 오류 ({code}): {body}"),
        });
    }

    let data: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("응답 파싱 실패: {e}"))?;

    let issues = data
        .issues
        .into_iter()
        .map(|ri| {
            let f = ri.fields;
            let (status_name, status_cat) = match f.status {
                Some(s) => (
                    s.name.unwrap_or_default(),
                    s.status_category.and_then(|c| c.key).unwrap_or_default(),
                ),
                None => (String::new(), String::new()),
            };
            let (prio, prio_icon) = match f.priority {
                Some(p) => (p.name, p.icon_url),
                None => (None, None),
            };
            let (itype, itype_icon) = match f.issuetype {
                Some(t) => (t.name, t.icon_url),
                None => (None, None),
            };
            let (project_key, project_name) = match f.project {
                Some(p) => (p.key.unwrap_or_default(), p.name.unwrap_or_default()),
                None => (String::new(), String::new()),
            };
            let parent_summary = f.parent.and_then(|p| p.fields.summary);
            Issue {
                browse_url: format!("{site}/browse/{}", ri.key),
                id: ri.id,
                key: ri.key,
                summary: f.summary.unwrap_or_default(),
                duedate: f.duedate,
                status: status_name,
                status_category: status_cat,
                priority: prio,
                priority_icon_url: prio_icon,
                issuetype: itype,
                issuetype_icon_url: itype_icon,
                updated: f.updated,
                project_key,
                project_name,
                parent_summary,
                labels: f.labels,
            }
        })
        .collect();

    Ok(issues)
}
