use super::{engine, err, Result, Studio};
use serde_json::{json, Value};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot},
};

type Stop = (bool, oneshot::Sender<Result<()>>);

pub struct Bot {
    status: Mutex<Value>,
    sender: tokio::sync::Mutex<Option<mpsc::Sender<Stop>>>,
}

impl Default for Bot {
    fn default() -> Self {
        Self {
            status: Mutex::new(json!({"status": "stopped"})),
            sender: tokio::sync::Mutex::new(None),
        }
    }
}

fn publish(app: &AppHandle, value: Value) {
    let bot = app.state::<Bot>();
    if let Ok(mut status) = bot.status.lock() {
        *status = value.clone();
    }
    let _ = app.emit("bot-status", value);
}

#[cfg(windows)]
fn dpapi(input: &mut [u8], encrypt: bool) -> Result<Vec<u8>> {
    use std::{ptr::null_mut, slice::from_raw_parts};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("Windows no pudo proteger la sesión de WhatsApp".into());
        }
        let bytes = from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(bytes)
    }
}

fn session_key(folder: &Path) -> Result<String> {
    #[cfg(not(windows))]
    {
        let _ = folder;
        Err("La protección de la sesión requiere Windows".into())
    }
    #[cfg(windows)]
    {
        let path = folder.join("key.dpapi");
        let bytes = match std::fs::read(&path) {
            Ok(mut protected) => dpapi(&mut protected, false)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut key = vec![0; 32];
                getrandom::fill(&mut key).map_err(err)?;
                std::fs::write(path, dpapi(&mut key, true)?).map_err(err)?;
                key
            }
            Err(error) => return Err(err(error)),
        };
        if bytes.len() != 32 {
            return Err("Clave de sesión no válida".into());
        }
        Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

#[tauri::command]
pub fn bot_status(bot: State<Bot>) -> Result<Value> {
    bot.status.lock().map(|value| value.clone()).map_err(err)
}

#[tauri::command]
pub async fn start_bot(app: AppHandle, allowed: Vec<String>) -> Result<()> {
    if allowed.len() > 50
        || allowed.iter().any(|number| {
            !(7..=15).contains(&number.len()) || !number.bytes().all(|ch| ch.is_ascii_digit())
        })
    {
        return Err("Usa números de teléfono internacionales de 7 a 15 dígitos".into());
    }
    let bot = app.state::<Bot>();
    let mut sender = bot.sender.lock().await;
    if sender.as_ref().is_some_and(|tx| !tx.is_closed()) {
        return Err("El bot ya está en ejecución".into());
    }
    let session = app.state::<Studio>().root.join("whatsapp");
    std::fs::create_dir_all(&session).map_err(err)?;
    let key = session_key(&session)?;
    let mut command = engine(&app, "src/bot.mjs").await?;
    command.arg("--desktop");
    let mut child = command.spawn().map_err(err)?;
    let mut input = child
        .stdin
        .take()
        .ok_or("No se pudo abrir la entrada del bot")?;
    let output = child
        .stdout
        .take()
        .ok_or("No se pudo abrir la salida del bot")?;
    let allowed = allowed
        .iter()
        .map(|number| format!("{number}@s.whatsapp.net"))
        .collect::<Vec<_>>();
    input
        .write_all(
            format!(
                "{}\n",
                json!({"session":session,"key":key,"allowed":allowed})
            )
            .as_bytes(),
        )
        .await
        .map_err(err)?;
    let (tx, mut rx) = mpsc::channel::<Stop>(1);
    *sender = Some(tx);
    publish(&app, json!({"status": "connecting"}));
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(output).lines();
        loop {
            tokio::select! {
                status = child.wait() => {
                    let success = status.is_ok_and(|value| value.success());
                    publish(&handle, json!({"status": if success { "stopped" } else { "error" }}));
                    break;
                }
                Ok(Some(line)) = lines.next_line() => {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        publish(&handle, value);
                    }
                }
                request = rx.recv() => {
                    let (unlink, done) = match request {
                        Some(request) => request,
                        None => break,
                    };
                    let action = if unlink { b"unlink\n".as_slice() } else { b"stop\n".as_slice() };
                    let _ = input.write_all(action).await;
                    let stopped = tokio::time::timeout(Duration::from_secs(9), child.wait())
                        .await.is_ok_and(|result| result.is_ok_and(|status| status.success()));
                    if !stopped {
                        let _ = child.kill().await;
                    }
                    rx.close();
                    publish(&handle, json!({"status": "stopped"}));
                    let _ = done.send(if !unlink || stopped { Ok(()) } else { Err("No se pudo desvincular la cuenta en WhatsApp".into()) });
                    break;
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_bot(state: State<'_, Bot>, unlink: bool) -> Result<()> {
    let lock = state.sender.lock().await;
    if let Some(tx) = lock.as_ref().filter(|tx| !tx.is_closed()) {
        let (done, acknowledgment) = oneshot::channel();
        tx.send((unlink, done)).await.map_err(err)?;
        acknowledgment.await.map_err(err)??;
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip() {
        let mut key = [42u8; 32];
        let mut encrypted = super::dpapi(&mut key, true).expect("protect test key");
        assert_ne!(encrypted.as_slice(), key);
        let original = super::dpapi(&mut encrypted, false).expect("unprotect test key");
        assert_eq!(original, key);
    }
}
