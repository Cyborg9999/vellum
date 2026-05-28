use tauri_plugin_sql::{Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_workflow_text_fields_to_projects",
            sql: include_str!("../migrations/002_workflow_fields.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "soft_delete_ref_images",
            sql: include_str!("../migrations/003_soft_delete.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_prompt_entries",
            sql: include_str!("../migrations/004_prompt_entries.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "rename_prompt_entries_to_segments",
            sql: include_str!("../migrations/005_rename_prompt_entries.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:vellum.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
