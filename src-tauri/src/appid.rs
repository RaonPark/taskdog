//! Windows 토스트 알림: 출처 이름/아이콘을 "TaskDog"으로 표시하고,
//! 설치본뿐 아니라 개발(`pnpm tauri dev`)·`target` exe 직접 실행에서도 동작시킨다.
//!
//! 동작 원리
//! - 토스트의 표시 이름·아이콘은 토스트에 붙은 **AppUserModelID(AUMID)** 로 결정된다.
//! - 임의 AUMID로 토스트를 띄우려면 그 AUMID가 시스템에 **등록**돼 있어야 한다
//!   (PowerShell이 등록돼 있어 폴백이 되는 것). 등록은 "AUMID 속성이 박힌 시작 메뉴
//!   바로가기"로 이뤄진다.
//! - 그래서 부팅 시 (a) `HKCU\Software\Classes\AppUserModelId\{AUMID}` 에
//!   `DisplayName`/`IconUri` 기록, (b) 프로세스 AUMID 지정, (c) AUMID 바로가기 생성(없을 때)
//!   을 하고, 알림은 [`show_toast`]가 우리 AUMID로 직접 발송한다(플러그인 우회).

use std::ffi::c_void;

use tauri::{AppHandle, Manager};
use windows::core::{Interface, HSTRING};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    SetCurrentProcessExplicitAppUserModelID, SHGetKnownFolderPath, ShellLink, FOLDERID_Programs,
    IShellLinkW, KNOWN_FOLDER_FLAG,
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

/// tauri.conf.json 의 `identifier` 와 동일해야 한다.
/// (NSIS 설치본 바로가기도 이 AUMID로 등록되므로 설치/비설치가 같은 식별자를 공유)
const AUMID: &str = "com.syworks.jiratodaytodo";
/// 알림 센터/토스트·시작 메뉴에 표시될 앱 이름.
const DISPLAY_NAME: &str = "TaskDog";

/// 앱 부팅 시 1회 호출(멱등, best-effort). 각 단계는 실패해도 알림 자체엔 영향 없게 무시한다.
pub fn register(app: &AppHandle) {
    let icon_uri = ensure_icon(app);
    write_registry(icon_uri.as_deref());

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(AUMID));
        if let Ok(exe) = std::env::current_exe() {
            let _ = ensure_shortcut(&exe.to_string_lossy());
        }
    }
}

/// 마감 알림 토스트를 우리 AUMID로 직접 발송(플러그인의 dev/installed 분기 우회).
pub fn show_toast(title: &str, body: &str) -> Result<(), String> {
    use tauri_winrt_notification::Toast;
    Toast::new(AUMID)
        .title(title)
        .text1(body)
        .show()
        .map_err(|e| e.to_string())
}

/// `HKCU\Software\Classes\AppUserModelId\{AUMID}` 에 표시 이름·아이콘 등록.
fn write_registry(icon_uri: Option<&str>) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!("Software\\Classes\\AppUserModelId\\{AUMID}");
    if let Ok((key, _)) = hkcu.create_subkey(path) {
        let _ = key.set_value("DisplayName", &DISPLAY_NAME);
        if let Some(uri) = icon_uri {
            let _ = key.set_value("IconUri", &uri);
        }
    }
}

/// 토스트 아이콘으로 쓸 PNG를 디스크에 보장하고 절대경로를 돌려준다.
/// 번들 아이콘은 디스크에 없을 수 있어 컴파일 타임 임베드본을 app_local_data_dir에 1회 기록.
fn ensure_icon(app: &AppHandle) -> Option<String> {
    const PNG: &[u8] = include_bytes!("../icons/icon.png");
    let dir = app.path().app_local_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("taskdog-notify.png");
    if !path.exists() {
        std::fs::write(&path, PNG).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

/// 시작 메뉴에 AUMID 속성이 박힌 바로가기를 만든다(없을 때만). 토스트 발송 등록 요건.
/// 설치본은 NSIS가 같은 위치/AUMID로 이미 만들어 두므로 그 경우 그대로 둔다.
unsafe fn ensure_shortcut(exe_path: &str) -> windows::core::Result<()> {
    let programs_pw = SHGetKnownFolderPath(&FOLDERID_Programs, KNOWN_FOLDER_FLAG(0), None)?;
    let programs = programs_pw.to_string().unwrap_or_default();
    CoTaskMemFree(Some(programs_pw.0 as *const c_void));
    if programs.is_empty() {
        return Ok(());
    }

    let lnk = format!("{programs}\\{DISPLAY_NAME}.lnk");
    if std::path::Path::new(&lnk).exists() {
        return Ok(());
    }

    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    link.SetPath(&HSTRING::from(exe_path))?;

    let store: IPropertyStore = link.cast()?;
    let value = PROPVARIANT::from(AUMID);
    store.SetValue(&PKEY_AppUserModel_ID, &value)?;
    store.Commit()?;

    let file: IPersistFile = link.cast()?;
    file.Save(&HSTRING::from(lnk.as_str()), true)?;
    Ok(())
}
