use super::{err, Result, Studio};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

const MAX_PACK: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
pub struct Pack {
    id: String,
    name: String,
    author: String,
    category: String,
    favorite: bool,
    stickers: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct PortablePack {
    version: u32,
    name: String,
    author: String,
    category: String,
    favorite: bool,
    webp: Vec<String>,
}

fn metadata_ok(name: &str, author: &str, category: &str) -> bool {
    !name.trim().is_empty()
        && [name, author, category]
            .iter()
            .all(|value| value.chars().count() <= 80)
}

fn file(state: &Studio, id: &str) -> Result<PathBuf> {
    let id = Uuid::parse_str(id).map_err(err)?.to_string();
    Ok(state.root.join("outputs").join(id).join("sticker.webp"))
}

fn validate_webp(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 20
        || bytes.len() > 512000
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
        || (u32::from_le_bytes(bytes[4..8].try_into().map_err(err)?) as usize) + 8 != bytes.len()
    {
        return Err("El paquete contiene un WebP no válido".into());
    }
    let read_le24 = |value: &[u8]| u32::from_le_bytes([value[0], value[1], value[2], 0]);
    let (width, height) = match (&bytes[12..16], bytes.len()) {
        (b"VP8X", n) if n >= 30 => (read_le24(&bytes[24..27]) + 1, read_le24(&bytes[27..30]) + 1),
        (b"VP8 ", n) if n >= 30 => (
            u16::from_le_bytes([bytes[26], bytes[27]]) as u32 & 0x3fff,
            u16::from_le_bytes([bytes[28], bytes[29]]) as u32 & 0x3fff,
        ),
        (b"VP8L", n) if n >= 25 => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().map_err(err)?);
            ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        }
        _ => (0, 0),
    };
    if width != 512 || height != 512 {
        return Err("Cada sticker debe medir 512 × 512 px".into());
    }
    Ok(())
}

fn persist(state: &Studio, pack: &Pack) -> Result<()> {
    let raw = serde_json::to_string(pack).map_err(err)?;
    state.db.lock().map_err(err)?.execute(
        "INSERT INTO packs (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        params![pack.id, raw],
    ).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn packs(state: State<Studio>) -> Result<Vec<Pack>> {
    let db = state.db.lock().map_err(err)?;
    let mut query = db
        .prepare("SELECT data FROM packs ORDER BY rowid DESC")
        .map_err(err)?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

#[tauri::command]
pub fn save_pack(state: State<Studio>, mut pack: Pack) -> Result<Pack> {
    if !metadata_ok(&pack.name, &pack.author, &pack.category) || pack.stickers.len() > 24 {
        return Err("Usa un nombre válido y hasta 24 stickers".into());
    }
    if pack.id.is_empty() {
        pack.id = Uuid::new_v4().to_string();
    } else {
        Uuid::parse_str(&pack.id).map_err(err)?;
    }
    for sticker in &pack.stickers {
        let path = file(&state, sticker)?;
        if !path.is_file() {
            return Err("Hay stickers que ya no están disponibles".into());
        }
    }
    persist(&state, &pack)?;
    Ok(pack)
}

#[tauri::command]
pub fn pack_assets(state: State<Studio>, ids: Vec<String>) -> Result<Vec<PathBuf>> {
    if ids.len() > 24 {
        return Err("El límite es de 24 stickers por paquete".into());
    }
    ids.iter().map(|id| file(&state, id)).collect()
}

#[tauri::command]
pub fn export_pack(state: State<Studio>, id: String, destination: String) -> Result<()> {
    if Path::new(&destination)
        .extension()
        .and_then(|value| value.to_str())
        != Some("sfpack")
    {
        return Err("Selecciona un archivo .sfpack".into());
    }
    let raw: String = state
        .db
        .lock()
        .map_err(err)?
        .query_row("SELECT data FROM packs WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(err)?;
    let pack: Pack = serde_json::from_str(&raw).map_err(err)?;
    let webp = pack
        .stickers
        .iter()
        .map(|id| {
            let bytes = std::fs::read(file(&state, id)?).map_err(err)?;
            validate_webp(&bytes)?;
            Ok(STANDARD.encode(bytes))
        })
        .collect::<Result<Vec<_>>>()?;
    let portable = PortablePack {
        version: 1,
        name: pack.name,
        author: pack.author,
        category: pack.category,
        favorite: pack.favorite,
        webp,
    };
    let bytes = serde_json::to_vec(&portable).map_err(err)?;
    if bytes.len() as u64 > MAX_PACK {
        return Err("El paquete supera 16 MiB".into());
    }
    std::fs::write(destination, bytes).map_err(err)
}

#[tauri::command]
pub fn import_pack(state: State<Studio>, source: String) -> Result<Pack> {
    if Path::new(&source)
        .extension()
        .and_then(|value| value.to_str())
        != Some("sfpack")
    {
        return Err("Selecciona un archivo .sfpack".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(source)
        .map_err(err)?
        .take(MAX_PACK + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_PACK {
        return Err("El paquete supera 16 MiB".into());
    }
    let portable: PortablePack = serde_json::from_slice(&bytes).map_err(err)?;
    if portable.version != 1
        || portable.webp.len() > 24
        || !metadata_ok(&portable.name, &portable.author, &portable.category)
    {
        return Err("Paquete no compatible".into());
    }
    let stickers = portable
        .webp
        .into_iter()
        .map(|value| {
            let bytes = STANDARD.decode(value).map_err(err)?;
            validate_webp(&bytes)?;
            Ok((Uuid::new_v4().to_string(), bytes))
        })
        .collect::<Result<Vec<_>>>()?;
    let pack = Pack {
        id: Uuid::new_v4().to_string(),
        name: portable.name,
        author: portable.author,
        category: portable.category,
        favorite: portable.favorite,
        stickers: stickers.iter().map(|(id, _)| id.clone()).collect(),
    };
    let mut created = Vec::new();
    let result = (|| {
        for (id, bytes) in stickers {
            let path = file(&state, &id)?;
            let parent = path.parent().ok_or("Ruta no válida")?;
            std::fs::create_dir(parent).map_err(err)?;
            created.push(parent.to_path_buf());
            std::fs::write(&path, bytes).map_err(err)?;
        }
        persist(&state, &pack)?;
        Ok(pack)
    })();
    if result.is_err() {
        for dir in created {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    result
}
