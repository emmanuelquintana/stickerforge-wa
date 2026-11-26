#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::AsyncWriteExt,
    process::Command,
    sync::{oneshot, Semaphore},
};
use uuid::Uuid;
mod bot;
mod packs;

type Result<T> = std::result::Result<T, String>;

struct Studio {
    root: PathBuf,
    db: Mutex<Connection>,
    slots: Arc<Semaphore>,
    jobs: Mutex<HashMap<String, oneshot::Sender<()>>>,
    install: tokio::sync::Mutex<()>,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn media_path(state: &Studio, id: &str) -> Result<PathBuf> {
    let id = Uuid::parse_str(id).map_err(err)?.to_string();
    std::fs::read_dir(state.root.join("media").join(id))
        .map_err(|_| "Archivo de trabajo no disponible".to_owned())?
        .next()
        .ok_or_else(|| "Archivo de trabajo no disponible".to_owned())?
        .map(|entry| entry.path())
        .map_err(err)
}

#[tauri::command]
fn import_recording(state: State<Studio>, bytes: Vec<u8>) -> Result<Value> {
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err("La grabación está vacía o supera 8 MiB".into());
    }
    let id = Uuid::new_v4().to_string();
    let folder = state.root.join("media").join(&id);
    std::fs::create_dir(&folder).map_err(err)?;
    let path = folder.join("mic.webm");
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(json!({"id": id, "path": path, "name": "Micrófono.webm", "extension": "webm"}))
}

#[tauri::command]
async fn import_file(app: AppHandle, path: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Studio>();
        let path = std::fs::canonicalize(path).map_err(err)?;
        let metadata = path.metadata().map_err(err)?;
        if !metadata.is_file() || metadata.len() > 100 * 1024 * 1024 {
            return Err("Selecciona un archivo local de hasta 100 MiB".into());
        }
        #[cfg(windows)]
        if !path.to_string_lossy().starts_with(r"\\?\")
            || path.to_string_lossy().starts_with(r"\\?\UNC\")
        {
            return Err("Selecciona un archivo del equipo".into());
        }
        let extension = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ![
            "png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mkv", "mov", "m4a", "mp3",
            "ogg", "opus", "wav", "flac", "aac", "avi",
        ]
        .contains(&extension.as_str())
        {
            return Err("Formato de archivo no admitido".into());
        }
        let id = Uuid::new_v4().to_string();
        let folder = state.root.join("media").join(&id);
        std::fs::create_dir(&folder).map_err(err)?;
        let target = folder.join(format!("source.{extension}"));
        std::fs::copy(&path, &target).map_err(err)?;
        Ok(json!({"id": id, "path": target, "name": path.file_name(), "extension": extension}))
    })
    .await
    .map_err(err)?
}

async fn engine(app: &AppHandle, entry: &str) -> Result<Command> {
    let packaged = app.path().resource_dir().map_err(err)?.join("engine");
    let (node, script, toolkit) = if packaged.join("node.exe").is_file() {
        (
            packaged.join("node.exe"),
            packaged.join(entry),
            app.state::<Studio>().root.join("toolkit/ready"),
        )
    } else if cfg!(debug_assertions) {
        (
            PathBuf::from("node"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(entry),
            std::env::var_os("STICKERFORGE_TOOLS")
                .map(PathBuf::from)
                .unwrap_or_default(),
        )
    } else {
        return Err("No se encontró el motor multimedia incluido".into());
    };
    let mut command = Command::new(node);
    command
        .arg(script)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    if !toolkit.as_os_str().is_empty() {
        command
            .env("FFMPEG_PATH", toolkit.join("ffmpeg.exe"))
            .env("FFPROBE_PATH", toolkit.join("ffprobe.exe"));
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    Ok(command)
}

async fn worker(
    app: &AppHandle,
    request: Value,
    cancellation: Option<oneshot::Receiver<()>>,
) -> Result<Value> {
    let mut command = engine(app, "desktop/worker.mjs").await?;
    let mut child = command.spawn().map_err(err)?;
    let mut input = child.stdin.take().ok_or("Motor sin entrada")?;
    input
        .write_all(format!("{request}\n").as_bytes())
        .await
        .map_err(err)?;
    let mut output = std::pin::pin!(child.wait_with_output());
    let mut cancellation = cancellation;
    let result = tokio::select! {
        result = &mut output => result.map_err(err)?,
        _ = async {
            if let Some(receiver) = cancellation.as_mut() {
                let _ = receiver.await;
            } else {
                std::future::pending::<()>().await;
            }
        } => {
            let _ = input.write_all(b"cancel\n").await;
            let _ = tokio::time::timeout(Duration::from_secs(3), &mut output).await;
            return Err("Operación cancelada".into());
        }
    };
    let value: Value = serde_json::from_slice(&result.stdout)
        .map_err(|_| "El motor no devolvió un resultado válido".to_owned())?;
    if let Some(message) = value["error"].as_str() {
        if message.contains("FFmpeg/ffprobe") {
            return Err("No se pudo leer o convertir el archivo con FFmpeg".into());
        }
        return Err(message.into());
    }
    Ok(value)
}

#[tauri::command]
async fn inspect(app: AppHandle, id: String, waveform: bool) -> Result<Value> {
    let path = media_path(&app.state::<Studio>(), &id)?;
    worker(
        &app,
        json!({"action": "probe", "input": path, "options": {"waveform": waveform}}),
        None,
    )
    .await
}

#[tauri::command]
async fn diagnose(app: AppHandle) -> Result<Value> {
    worker(&app, json!({"action": "diagnose"}), None).await
}

#[tauri::command]
async fn install_engine(app: AppHandle) -> Result<Value> {
    let state = app.state::<Studio>();
    let _install = state
        .install
        .try_lock()
        .map_err(|_| "La instalación está en curso")?;
    if diagnose(app.clone()).await.is_ok() {
        return Ok(json!({}));
    }
    worker(
        &app,
        json!({"action": "install", "dir": state.root.join("toolkit")}),
        None,
    )
    .await
}

#[tauri::command]
async fn download_video(app: AppHandle, url: String) -> Result<Value> {
    if url.len() > 4096 {
        return Err("Enlace demasiado largo".into());
    }
    let state = app.state::<Studio>();
    let _permit = state
        .slots
        .try_acquire()
        .map_err(|_| "El motor está ocupado")?;
    let id = Uuid::new_v4().to_string();
    let dir = state.root.join("media").join(&id);
    let result = worker(
        &app,
        json!({"action":"download", "url":url,"dir":dir}),
        None,
    )
    .await;
    match result {
        Ok(mut media) => {
            media["id"] = json!(id);
            media["name"] = json!("Video HTTPS");
            media["extension"] = json!("mp4");
            Ok(media)
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(dir);
            Err(error)
        }
    }
}

#[tauri::command]
async fn render(
    app: AppHandle,
    job: String,
    id: String,
    audio: Option<String>,
    kind: String,
    options: Value,
    preview: bool,
) -> Result<Value> {
    let job = Uuid::parse_str(&job).map_err(err)?.to_string();
    if !["sticker", "audio"].contains(&kind.as_str()) {
        return Err("Formato de salida no admitido".into());
    }
    let state = app.state::<Studio>();
    let input = media_path(&state, &id)?;
    let audio = audio.map(|id| media_path(&state, &id)).transpose()?;
    let (cancel, mut receiver) = oneshot::channel();
    let pending = {
        let mut jobs = state.jobs.lock().map_err(err)?;
        if jobs.len() >= 8 || jobs.contains_key(&job) {
            return Err("Cola de trabajo llena".into());
        }
        jobs.insert(job.clone(), cancel);
        jobs.len()
    };
    let _ = app.emit("job-count", pending);
    let dir = state
        .root
        .join(if preview { "media" } else { "outputs" })
        .join(&job);
    let result = tokio::select! {
        permit = state.slots.clone().acquire_owned() => {
            let _permit = permit.map_err(err)?;
            worker(&app, json!({"action":kind,"input":input,"audio":audio,"dir":dir,"options":options}), Some(receiver)).await
        },
        _ = &mut receiver => Err("Operación cancelada".into()),
    };
    let pending = {
        let mut jobs = state.jobs.lock().map_err(err)?;
        jobs.remove(&job);
        jobs.len()
    };
    let _ = app.emit("job-count", pending);
    if !preview
        && result
            .as_ref()
            .err()
            .is_none_or(|message| message != "Operación cancelada")
    {
        let db = state.db.lock().map_err(err)?;
        let record = result
            .as_ref()
            .cloned()
            .unwrap_or_else(|message| json!({"error": message}));
        let name = input
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Archivo");
        db.execute(
            "INSERT INTO history (id, kind, name, sound, result) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                job,
                kind,
                name,
                options["sound"].as_bool() == Some(true),
                record.to_string()
            ],
        )
        .map_err(err)?;
    }
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

#[tauri::command]
fn cancel(state: State<Studio>, job: String) -> Result<()> {
    if let Some(cancel) = state.jobs.lock().map_err(err)?.remove(&job) {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
fn history(state: State<Studio>) -> Result<Vec<Value>> {
    let db = state.db.lock().map_err(err)?;
    let mut query = db.prepare("SELECT id, kind, name, sound, result, created FROM history ORDER BY rowid DESC LIMIT 1000").map_err(err)?;
    let rows = query.query_map([], |row| {
        let raw: String = row.get(4)?;
        Ok(json!({"id": row.get::<_, String>(0)?, "kind": row.get::<_, String>(1)?,
            "name": row.get::<_, String>(2)?, "sound": row.get::<_, bool>(3)?,
            "result": serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null), "created": row.get::<_, String>(5)?}))
    }).map_err(err)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)
}

#[tauri::command]
fn forget(state: State<Studio>, id: Option<String>) -> Result<()> {
    let db = state.db.lock().map_err(err)?;
    if let Some(id) = id {
        db.execute("DELETE FROM history WHERE id = ?1", [id])
            .map_err(err)?;
    } else {
        db.execute("DELETE FROM history", []).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
fn settings(state: State<Studio>, value: Option<Value>) -> Result<Value> {
    let db = state.db.lock().map_err(err)?;
    if let Some(value) = value {
        db.execute(
            "INSERT OR REPLACE INTO settings (id, value) VALUES (1, ?1)",
            [value.to_string()],
        )
        .map_err(err)?;
        return Ok(value);
    }
    let stored = db.query_row("SELECT value FROM settings WHERE id = 1", [], |row| {
        row.get::<_, String>(0)
    });
    match stored {
        Ok(raw) => serde_json::from_str(&raw).map_err(err),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(json!({})),
        Err(error) => Err(err(error)),
    }
}

#[tauri::command]
async fn save_output(app: AppHandle, source: String, destination: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = &app.state::<Studio>().root;
        let source = std::fs::canonicalize(source).map_err(err)?;
        let export = source.starts_with(std::fs::canonicalize(root.join("outputs")).map_err(err)?);
        let video = source.starts_with(std::fs::canonicalize(root.join("media")).map_err(err)?)
            && source.file_name().is_some_and(|name| name == "video.mp4");
        if !export && !video {
            return Err("Archivo de exportación no disponible".into());
        }
        std::fs::copy(source, destination).map_err(err)?;
        Ok(())
    })
    .await
    .map_err(err)?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bot::Bot::default())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            let scratch = root.join("media");
            if scratch.exists() {
                std::fs::remove_dir_all(&scratch)?;
            }
            std::fs::create_dir_all(&scratch)?;
            std::fs::create_dir_all(root.join("outputs"))?;
            let db = Connection::open(root.join("studio.sqlite"))?;
            db.execute_batch("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
                sound INTEGER NOT NULL, result TEXT NOT NULL, created TEXT NOT NULL DEFAULT (datetime('now')));
                CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, data TEXT NOT NULL)")?;
            app.manage(Studio { root, db: Mutex::new(db), slots: Arc::new(Semaphore::new(2)), jobs: Mutex::new(HashMap::new()), install: tokio::sync::Mutex::new(()) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![import_file, import_recording, inspect, diagnose, install_engine, download_video, render, cancel, history, forget, settings, save_output,
            bot::bot_status, bot::start_bot, bot::stop_bot, packs::packs, packs::save_pack,
            packs::pack_assets, packs::export_pack, packs::import_pack])
        .run(tauri::generate_context!())
        .expect("StickerForge could not start");
}
