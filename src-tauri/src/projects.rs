//! M1: locally stored, bounded project metadata. No arbitrary filesystem or remote IPC.
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

const PROJECTS_FILE: &str = "workbench-projects-v1.json";
const MAX_PROJECTS: usize = 100;
const MAX_INSTRUCTIONS_BYTES: usize = 16_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    id: String,
    name: String,
    instructions: String,
    created_at: u64,
    updated_at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectStore {
    schema_version: u8,
    active_project_id: Option<String>,
    projects: Vec<Project>,
}
impl Default for ProjectStore {
    fn default() -> Self {
        Self { schema_version: 1, active_project_id: None, projects: vec![] }
    }
}
fn validate(store: &ProjectStore) -> Result<(), String> {
    if store.schema_version != 1 { return Err("Unsupported project store version".into()); }
    if store.projects.len() > MAX_PROJECTS { return Err("Too many projects (maximum 100)".into()); }
    let mut ids = HashSet::new();
    for project in &store.projects {
        let valid_id = !project.id.is_empty()
            && project.id.len() <= 80
            && project.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
        if !valid_id || !ids.insert(project.id.as_str()) {
            return Err("Invalid or duplicate project identifier".into());
        }
        if project.name.trim().is_empty() || project.name.chars().count() > 100 {
            return Err("Project names must contain 1 to 100 characters".into());
        }
        if project.instructions.len() > MAX_INSTRUCTIONS_BYTES {
            return Err("Project instructions exceed 16 KB".into());
        }
        if project.created_at == 0 || project.updated_at < project.created_at {
            return Err("Invalid project timestamps".into());
        }
    }
    if let Some(active) = &store.active_project_id {
        if !ids.contains(active.as_str()) { return Err("Active project does not exist".into()); }
    }
    Ok(())
}
fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(PROJECTS_FILE))
}
fn load_from_path(path: &Path) -> Result<ProjectStore, String> {
    let value: ProjectStore = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ProjectStore::default()),
        Err(e) => return Err(e.to_string()),
    };
    validate(&value)?;
    Ok(value)
}
fn save_to_path(path: &Path, store: &ProjectStore) -> Result<(), String> {
    validate(store)?;
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(path, &json)
}
#[tauri::command]
pub async fn projects_load(app: AppHandle, webview: Webview) -> Result<ProjectStore, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    load_from_path(&projects_path(&app)?)
}
#[tauri::command]
pub async fn projects_save(app: AppHandle, webview: Webview, store: ProjectStore) -> Result<(), String> {
    crate::webviews::ensure_control_webview(&webview)?;
    save_to_path(&projects_path(&app)?, &store)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_roundtrips_project_store() {
        let file = std::env::temp_dir().join(format!("workbench-m1-{}-projects.json", std::process::id()));
        let store = ProjectStore {
            schema_version: 1, active_project_id: Some("project-test".into()),
            projects: vec![Project {
                id: "project-test".into(), name: "Test".into(),
                instructions: "Primary sources only".into(), created_at: 1, updated_at: 2,
            }],
        };
        save_to_path(&file, &store).expect("save project");
        let loaded = load_from_path(&file).expect("load project");
        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.active_project_id.as_deref(), Some("project-test"));
        let _ = std::fs::remove_file(file);
    }
    #[test]
    fn rejects_missing_active_project() {
        let store = ProjectStore {
            active_project_id: Some("not-found".into()),
            ..ProjectStore::default()
        };
        assert!(validate(&store).is_err());
    }
}
