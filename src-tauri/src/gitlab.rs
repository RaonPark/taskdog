use serde::{Deserialize, Serialize};

use crate::secrets::get_gitlab_token;

// ---------- GitLab MR API 응답(raw) ----------

#[derive(Deserialize)]
struct RawUser {
    id: Option<i64>,
    username: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawMr {
    state: Option<String>,
    merged_at: Option<String>,
    target_branch: Option<String>,
    author: Option<RawUser>,
    // GitLab 버전에 따라 merged_by(구) 또는 merge_user(신)로 내려온다. merged_by 우선.
    merged_by: Option<RawUser>,
    merge_user: Option<RawUser>,
}

// ---------- 프론트 전달용(slim, camelCase) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitlabUser {
    id: Option<i64>,
    username: Option<String>,
    name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitlabMr {
    merged: bool,
    state: String,
    target_branch: String,
    merged_at: Option<String>,
    author: Option<GitlabUser>,
    merged_by: Option<GitlabUser>,
}

fn to_user(u: RawUser) -> GitlabUser {
    GitlabUser {
        id: u.id,
        username: u.username,
        name: u.name,
    }
}

// project path는 `group/sub/project` 처럼 슬래시를 포함하므로 GitLab API에선
// `group%2Fsub%2Fproject`로 통째 URL 인코딩해야 한다. 별도 크레이트 없이 직접 인코딩.
fn urlencode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 단일 GitLab MR 상태 조회. base_url은 프론트가 "설정 base URL과 호스트가 일치할 때만"
/// 넘기며, 토큰은 해당 base_url 키로 keyring에서 읽는다(설정과 다른 호스트엔 토큰이 없어
/// 자연히 실패 → 토큰 유출 방지). 머지 여부: state=="merged" 또는 merged_at 존재.
#[tauri::command]
pub async fn fetch_gitlab_mr(
    base_url: String,
    project_path: String,
    iid: i64,
) -> Result<GitlabMr, String> {
    let token = get_gitlab_token(&base_url)?;
    let base = base_url.trim_end_matches('/');
    let encoded = urlencode_path(&project_path);
    let url = format!("{base}/api/v4/projects/{encoded}/merge_requests/{iid}");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GitLab 네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!("GitLab 인증/권한 오류 ({})", status.as_u16()),
            404 => "GitLab MR을 찾을 수 없음 (404)".to_string(),
            code => format!("GitLab 오류 ({code})"),
        });
    }

    let raw: RawMr = resp
        .json()
        .await
        .map_err(|e| format!("GitLab 응답 파싱 실패: {e}"))?;

    let state = raw.state.unwrap_or_default();
    let merged = state == "merged" || raw.merged_at.is_some();
    let merged_by = raw.merged_by.or(raw.merge_user);

    Ok(GitlabMr {
        merged,
        state,
        target_branch: raw.target_branch.unwrap_or_default(),
        merged_at: raw.merged_at,
        author: raw.author.map(to_user),
        merged_by: merged_by.map(to_user),
    })
}

// ---------- 프로젝트 MR 검색 (키 기준, 승격 MR까지 포착) ----------
//
// dev-status(개발 패널)는 MR↔이슈를 source 브랜치명/커밋으로만 연결하므로,
// `local`→`dev`→`prod` 승격 MR(브랜치명에 키 없음)을 놓친다. GitLab MR 검색은
// title/description을 인덱싱하므로(팀 MR 템플릿이 제목·설명에 이슈 키/Jira 링크를 남김)
// 승격 MR까지 모두 잡는다. 그래서 칩/알림 발견을 이 검색으로 수행한다.

#[derive(Deserialize)]
struct RawMrListItem {
    iid: i64,
    state: Option<String>,
    target_branch: Option<String>,
    web_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchedMr {
    iid: i64,
    merged: bool,
    target_branch: String,
    web_url: String,
}

/// 한 프로젝트에서 이슈 키를 title/description에 포함하는 머지된 MR을 검색한다.
/// base_url 토큰은 keyring(base URL 키)에서 읽으며, project_path는 프론트가
/// dev-status MR url에서 추출해(설정 호스트와 일치할 때만) 넘긴다(토큰 유출 방지).
/// 페이징은 단일 페이지(per_page=100). 한 이슈가 100개 초과 MR을 갖는 일은 사실상 없다.
#[tauri::command]
pub async fn search_project_mrs(
    base_url: String,
    project_path: String,
    key: String,
) -> Result<Vec<SearchedMr>, String> {
    let token = get_gitlab_token(&base_url)?;
    let base = base_url.trim_end_matches('/');
    let encoded = urlencode_path(&project_path);
    let url = format!("{base}/api/v4/projects/{encoded}/merge_requests");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .query(&[
            ("search", key.as_str()),
            ("in", "title,description"),
            ("state", "merged"),
            ("scope", "all"),
            ("per_page", "100"),
        ])
        .header("PRIVATE-TOKEN", token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GitLab 네트워크 오류: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!("GitLab 인증/권한 오류 ({})", status.as_u16()),
            404 => "GitLab 프로젝트를 찾을 수 없음 (404)".to_string(),
            code => format!("GitLab 오류 ({code})"),
        });
    }

    let raw: Vec<RawMrListItem> = resp
        .json()
        .await
        .map_err(|e| format!("GitLab 응답 파싱 실패: {e}"))?;

    Ok(raw
        .into_iter()
        .map(|m| SearchedMr {
            iid: m.iid,
            merged: m.state.as_deref() == Some("merged"),
            target_branch: m.target_branch.unwrap_or_default(),
            web_url: m.web_url.unwrap_or_default(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_path_encodes_slashes() {
        // GitLab은 project path를 통째 인코딩한 형태(group%2Fsub%2Fproject)를 요구한다.
        assert_eq!(urlencode_path("group/sub/project"), "group%2Fsub%2Fproject");
    }

    #[test]
    fn urlencode_path_keeps_unreserved() {
        assert_eq!(urlencode_path("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn urlencode_path_encodes_special() {
        assert_eq!(urlencode_path("a b"), "a%20b");
        assert_eq!(urlencode_path("x@y"), "x%40y");
    }
}
