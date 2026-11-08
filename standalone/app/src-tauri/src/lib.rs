#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_permission_request(|_, permission| match permission {
            tauri::webview::PermissionKind::Microphone => {
                tauri::webview::PermissionResponse::Allow
            }
            _ => tauri::webview::PermissionResponse::Default,
        })
        .run(tauri::generate_context!())
        .expect("error while running JARVIS");
}
