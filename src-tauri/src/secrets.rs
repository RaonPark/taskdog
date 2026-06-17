use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "jira-today-todo";
// GitLab 토큰은 Jira 토큰과 분리된 서비스에 저장한다. account = GitLab base URL
// (이메일이 아니라 호스트 단위). 설정의 base URL이 바뀌면 토큰 재입력이 필요하다.
const GITLAB_SERVICE: &str = "jira-today-todo-gitlab";

fn entry(email: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, email).map_err(|e| e.to_string())
}

fn gitlab_entry(base_url: &str) -> Result<Entry, String> {
    Entry::new(GITLAB_SERVICE, base_url).map_err(|e| e.to_string())
}

/// 내부용: 저장된 API 토큰을 가져온다.
pub fn get_token(email: &str) -> Result<String, String> {
    entry(email)?.get_password().map_err(|e| match e {
        KeyringError::NoEntry => "API 토큰이 저장되어 있지 않습니다. 설정에서 입력하세요.".to_string(),
        other => other.to_string(),
    })
}

#[tauri::command]
pub fn save_token(email: String, token: String) -> Result<(), String> {
    entry(&email)?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_token(email: String) -> Result<bool, String> {
    match entry(&email)?.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_token(email: String) -> Result<(), String> {
    match entry(&email)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- GitLab 토큰 (base URL 단위, 별도 서비스) ----------

/// 내부용: 저장된 GitLab 토큰을 가져온다.
pub fn get_gitlab_token(base_url: &str) -> Result<String, String> {
    gitlab_entry(base_url)?.get_password().map_err(|e| match e {
        KeyringError::NoEntry => "GitLab 토큰이 저장되어 있지 않습니다. 설정에서 입력하세요.".to_string(),
        other => other.to_string(),
    })
}

#[tauri::command]
pub fn save_gitlab_token(base_url: String, token: String) -> Result<(), String> {
    gitlab_entry(&base_url)?
        .set_password(&token)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_gitlab_token(base_url: String) -> Result<bool, String> {
    match gitlab_entry(&base_url)?.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_gitlab_token(base_url: String) -> Result<(), String> {
    match gitlab_entry(&base_url)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
