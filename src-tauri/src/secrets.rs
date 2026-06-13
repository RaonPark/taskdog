use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "jira-today-todo";

fn entry(email: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, email).map_err(|e| e.to_string())
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
