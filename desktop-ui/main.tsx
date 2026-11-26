import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Activity, AudioLines, Check, ChevronDown, CircleHelp, Download, FolderOpen, History, ImagePlus, LayoutDashboard, MessageCircle, Mic, Package, RotateCw, Scissors, Settings, Sticker, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import { Packs } from './packs';
import logo from '../src-tauri/icons/icon.png';

type Page = 'home' | 'sticker' | 'audio' | 'download' | 'bot' | 'history' | 'packs' | 'settings';
type Theme = 'system' | 'dark' | 'light';
type Preferences = { theme: Theme; language: 'es' | 'en'; fps: number; quality: number; duration: number; volume: number; allowed: string; welcomed: boolean };
type Media = { id: string; name: string; path: string; extension: string; duration: number | null; width?: number; height?: number; hasAudio: boolean; still: boolean; bytes?: number; peaks?: number[] };
type Options = {
  start: number; duration: number; fps: number; quality: number; volume: number; speed: number; x: number; y: number;
  zoom: number; rotation: number; flip: boolean; brightness: number; contrast: number; saturation: number; mode: string;
  color: string; sound: boolean; format: string; fadeIn: number; fadeOut: number; normalize: boolean;
  caption: string; outline: number; pitch: number; effect: string; removeSilence: boolean;
};
type Result = { files: string[]; bytes: number; preview?: boolean };
type Entry = { id: string; kind: 'sticker' | 'audio'; name: string; sound: boolean; result: Result | { error: string }; created: string };
const defaults: Preferences = { theme: 'system', language: 'es', fps: 15, quality: 75, duration: 5, volume: 100, allowed: '', welcomed: false };
const settingsToOptions = ({ fps, quality, duration, volume }: Preferences): Options => ({
  start: 0, duration, fps, quality, volume, speed: 1, x: 50, y: 50, zoom: 1, rotation: 0,
  flip: false, brightness: 0, contrast: 1, saturation: 1, mode: 'corte',
  color: '#131916', sound: false, format: 'opus', fadeIn: 0, fadeOut: 0, normalize: false,
  caption: '', outline: 3, pitch: 0, effect: '', removeSilence: false,
});
const images = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
const videos = ['mp4', 'webm', 'mkv', 'mov', 'avi'];
const audioFiles = ['m4a', 'mp3', 'ogg', 'opus', 'wav', 'flac', 'aac', ...videos];
const native = '__TAURI_INTERNALS__' in window;

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  return <label className="slider"><span>{label}<output>{Number(value.toFixed(2))}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
  </label>;
}

function Disclosure({ title, children, initial = false }: { title: string; children: ReactNode; initial?: boolean }) {
  return <details open={initial || undefined}><summary>{title}<ChevronDown size={15} /></summary><div className="controls">{children}</div></details>;
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [prefs, setPrefs] = useState(defaults);
  const [options, setOptions] = useState(settingsToOptions(defaults));
  const [media, setMedia] = useState<Media>();
  const [audio, setAudio] = useState<Media>();
  const [result, setResult] = useState<Result>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [job, setJob] = useState('');
  const [pending, setPending] = useState(0);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState<Entry>();
  const [url, setUrl] = useState('');
  const [downloaded, setDownloaded] = useState<Media>();
  const [bot, setBot] = useState<{ status: string; qr?: string }>({ status: 'stopped' });
  const [botBusy, setBotBusy] = useState(false);
  const [allowed, setAllowed] = useState('');
  const [installing, setInstalling] = useState(false);
  const [loaded, setLoaded] = useState(!native);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const t = (es: string, en: string) => prefs.language === 'en' ? en : es;
  const refresh = () => invoke<Entry[]>('history').then(setEntries);
  const edit = <K extends keyof Options,>(key: K, value: Options[K]) => {
    setOptions(previous => ({ ...previous, [key]: value }));
    setResult(undefined);
  };
  useEffect(() => {
    if (!native) return;
    void refresh().catch(e => setError(String(e)));
    void invoke<Partial<Preferences>>('settings').then(stored => {
      const next = { ...defaults, ...stored };
      setPrefs(next);
      setAllowed(next.allowed);
      setOptions(settingsToOptions(next));
    }).catch(e => setError(String(e))).finally(() => setLoaded(true));
    const unlisten = listen<number>('job-count', event => setPending(event.payload));
    const unlistenBot = listen<typeof bot>('bot-status', event => setBot(event.payload));
    void invoke<typeof bot>('bot_status').then(setBot).catch(e => setError(String(e)));
    return () => { void unlisten.then(dispose => dispose()); void unlistenBot.then(dispose => dispose()); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.lang = prefs.language;
  }, [prefs.theme, prefs.language]);
  useEffect(() => {
    document.querySelector('nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [page]);

  async function ingest(path: string, asAudio = false) {
    if (job || importing) return;
    setError('');
    setNotice('');
    setImporting(true);
    try {
      const imported = await invoke<Media>('import_file', { path });
      const info = await invoke<Partial<Media>>('inspect', { id: imported.id, waveform: page === 'audio' });
      const next = { ...imported, ...info };
      if (asAudio && !next.hasAudio) throw new Error(t('El archivo no contiene audio.', 'The file has no audio.'));
      if (!asAudio && page !== 'audio' && !next.width) throw new Error(t('Selecciona una imagen, un GIF o un video.', 'Choose an image, GIF or video.'));
      if (page === 'audio' && !next.hasAudio) throw new Error(t('El archivo no contiene audio.', 'The file has no audio.'));
      if (asAudio) {
        setAudio(next);
        setOptions(previous => ({ ...previous, sound: true }));
      } else {
        setMedia(next);
        setAudio(undefined);
        setOptions({ ...settingsToOptions(prefs), duration: Math.min(next.duration || prefs.duration, prefs.duration) });
      }
      setResult(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }
  useEffect(() => {
    if (!native || (page !== 'sticker' && page !== 'audio')) return;
    const listener = getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'drop' && event.payload.paths[0]) void ingest(event.payload.paths[0]);
    });
    return () => { void listener.then(dispose => dispose()); };
  });
  async function choose(asAudio = false) {
    try {
      if (!native) throw new Error(t('Abre StickerForge Desktop para importar archivos.', 'Open StickerForge Desktop to import files.'));
      const path = await open({ filters: [{ name: t('Archivos multimedia', 'Media files'), extensions: asAudio || page === 'audio' ? audioFiles : [...images, ...videos] }] });
      if (path) await ingest(path, asAudio);
    } catch (e) {
      setError(String(e));
    }
  }

  async function record() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      return;
    }
    setError('');
    setImporting(true);
    let stream: MediaStream | undefined;
    try {
      if (!native || !navigator.mediaDevices?.getUserMedia || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        throw new Error(t('Este entorno no admite grabación Opus.', 'This environment does not support Opus recording.'));
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const tracks = stream.getTracks();
      const parts: Blob[] = [];
      recorder.current = mediaRecorder;
      const limit = setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 25_000);
      mediaRecorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      mediaRecorder.onstop = () => {
        clearTimeout(limit);
        recorder.current = null;
        tracks.forEach(track => track.stop());
        setRecording(false);
        void (async () => {
          try {
            const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
            const imported = await invoke<Media>('import_recording', { bytes: Array.from(bytes) });
            const info = await invoke<Partial<Media>>('inspect', { id: imported.id, waveform: page === 'audio' });
            const source = { ...imported, ...info };
            if (page === 'audio') {
              setMedia(source);
              setOptions(settingsToOptions(prefs));
            } else {
              setAudio(source);
              setOptions(previous => ({ ...previous, sound: true }));
            }
            setResult(undefined);
          } catch (e) {
            setError(String(e));
          } finally {
            setImporting(false);
          }
        })();
      };
      mediaRecorder.start();
      setRecording(true);
    } catch (e) {
      stream?.getTracks().forEach(track => track.stop());
      setError(String(e));
      setImporting(false);
    }
  }

  async function render(preview: boolean) {
    if (!media || job) return;
    const id = crypto.randomUUID();
    setJob(id);
    setError('');
    setNotice('');
    setResult(undefined);
    try {
      const output = await invoke<Result>('render', {
        job: id, id: media.id, audio: audio?.id || null, kind: page, options, preview,
      });
      setResult({ ...output, preview });
      if (!preview) setNotice(t('Exportación guardada en el historial.', 'Export saved to history.'));
    } catch (e) {
      setError(String(e));
    } finally {
      setJob('');
      if (!preview) void refresh().catch(e => setError(String(e)));
    }
  }
  async function exportFile(source: string) {
    try {
      const destination = await save({ defaultPath: source.split(/[\\/]/).at(-1) });
      if (destination) {
        await invoke('save_output', { source, destination });
        setNotice(t('Copia guardada.', 'Copy saved.'));
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function forget(id: string | null) {
    if (!id && !confirm(t('¿Eliminar todos los registros del historial?', 'Clear all history records?'))) return;
    try {
      await invoke('forget', { id });
      setSelected(undefined);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  async function persist(next: Preferences) {
    try {
      if (native) await invoke('settings', { value: next });
      setPrefs(next);
    } catch (e) {
      setError(String(e));
    }
  }
  async function downloadVideo() {
    if (importing) return;
    setImporting(true);
    setDownloaded(undefined);
    setNotice('');
    setError('');
    try {
      const video = await invoke<Media>('download_video', { url: url.trim() });
      setDownloaded(video);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }
  async function installEngine() {
    setInstalling(true);
    setError('');
    setNotice('');
    try {
      await invoke('install_engine');
      await invoke('diagnose');
      setNotice(t('Motor multimedia disponible.', 'Media engine is ready.'));
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }
  async function openDownloaded(target: 'audio' | 'sticker') {
    if (!downloaded) return;
    navigate(target);
    setMedia(downloaded);
    if (target === 'audio') {
      try {
        const info = await invoke<Partial<Media>>('inspect', { id: downloaded.id, waveform: true });
        setMedia(current => current?.id === downloaded.id ? { ...current, ...info } : current);
      } catch (e) {
        setError(String(e));
      }
    }
  }
  async function changeBot(action: 'start' | 'stop' | 'restart' | 'unlink') {
    if (action === 'unlink' && !confirm(t('¿Desvincular este dispositivo de WhatsApp?', 'Unlink this device from WhatsApp?'))) return;
    setBotBusy(true);
    setError('');
    try {
      if (action !== 'start') await invoke('stop_bot', { unlink: action === 'unlink' });
      if (action === 'start' || action === 'restart') {
        const list = allowed.split(/[\s,]+/).filter(Boolean).map(value => value.replace(/^\+/, ''));
        await invoke('start_bot', { allowed: list });
        await persist({ ...prefs, allowed });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBotBusy(false);
    }
  }
  function navigate(target: Page) {
    if (job || importing) return;
    if (target !== page && (target === 'audio' || target === 'sticker')) {
      setMedia(undefined);
      setAudio(undefined);
      setResult(undefined);
      setOptions(settingsToOptions(prefs));
    }
    setPage(target);
    setNotice('');
    setError('');
  }

  const items = [
    ['home', LayoutDashboard, t('Resumen', 'Overview')],
    ['sticker', Sticker, 'Sticker Studio'],
    ['audio', AudioLines, 'Audio Studio'],
    ['download', Download, t('Descargador', 'Downloads')],
    ['bot', MessageCircle, 'WhatsApp'],
    ['history', History, t('Historial', 'History')],
    ['packs', Package, t('Paquetes', 'Packs')],
    ['settings', Settings, t('Configuración', 'Settings')],
  ] as const;
  const heading = items.find(([key]) => page === key)?.[2];
  const successful = entries.filter(entry => !('error' in entry.result));
  const formatSize = (bytes: number) => (bytes / 1024).toLocaleString(prefs.language, { maximumFractionDigits: 1 }) + ' KiB';
  const contents = (output: Result) => <div className="proof">
    {output.files.some(path => path.endsWith('.webp')) && <img key={output.files[0]} src={convertFileSrc(output.files[0])} alt={t('Sticker renderizado', 'Rendered sticker')} />}
    {output.files.filter(path => /\.(ogg|mp3)$/.test(path)).map(path => <audio key={path} controls src={convertFileSrc(path)} />)}
  </div>;
  const editor = page === 'sticker' || page === 'audio';
  const botActive = ['qr', 'connecting', 'connected', 'ended'].includes(bot.status);
  const botLabel = ({
    stopped: t('Detenido', 'Stopped'), connecting: t('Conectando', 'Connecting'),
    qr: t('Esperando vinculación', 'Waiting for pairing'), connected: t('Conectado', 'Connected'),
    ended: t('Sesión finalizada', 'Session ended'), error: t('Error de conexión o de motor', 'Connection or engine error'),
  } as Record<string, string>)[bot.status];
  const timelineLimit = Math.max(0.1, Math.min(media?.duration || 25, 3600));
  const end = Math.min(options.start + options.duration, timelineLimit);
  return <div className="app-shell">
    <a className="skip" href="#workspace">{t('Ir al contenido', 'Skip to workspace')}</a>
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src={logo} alt="" /><span>StickerForge</span></div>
      <nav aria-label={t('Espacio de trabajo', 'Workspace')}>{items.map(([key, Icon, label]) => <button key={key} onClick={() => navigate(key)} aria-current={page === key ? 'page' : undefined}>
        <Icon size={17} />{label}
      </button>)}</nav>
      <div className="sidebar-foot"><span className="dot" />{t('Procesamiento local', 'Local processing')}<small>0.4.0</small></div>
    </aside>
    <main id="workspace">
      <header className="header"><div><h1>{heading}</h1>{editor && <p>{page === 'sticker' ? t('Edita y exporta stickers cuadrados de 512 × 512.', 'Edit and export 512 × 512 stickers.') : t('Recorta, mezcla niveles y exporta audio.', 'Trim, adjust levels and export audio.')}</p>}</div>
        {page === 'home' && <button className="primary" onClick={() => navigate('sticker')}><Sticker size={17} />{t('Crear sticker', 'Create sticker')}</button>}
        {editor && <button className="primary" disabled={!media || !!job} onClick={() => void render(false)}><Download size={17} />{t('Exportar', 'Export')}</button>}
      </header>
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message" role="status"><Check size={16} />{notice}</p>}
      {page === 'home' && <>
        {native && loaded && !prefs.welcomed && <section className="surface welcome">
          <div className="section-title"><h2><Sticker size={18} />{t('Bienvenido a StickerForge', 'Welcome to StickerForge')}</h2></div>
          <div className="controls">
            <p>{t('Instala el motor multimedia verificado para convertir archivos en este equipo. Puedes usar el editor sin vincular WhatsApp.', 'Install the verified media engine to convert files on this computer. You can use the editor without linking WhatsApp.')}</p>
            <label>{t('Idioma', 'Language')}<select value={prefs.language} onChange={event => void persist({ ...prefs, language: event.target.value as Preferences['language'] })}><option value="es">Español</option><option value="en">English</option></select></label>
            <label>{t('Tema', 'Theme')}<select value={prefs.theme} onChange={event => void persist({ ...prefs, theme: event.target.value as Theme })}><option value="system">{t('Automático', 'System')}</option><option value="light">{t('Claro', 'Light')}</option><option value="dark">{t('Oscuro', 'Dark')}</option></select></label>
            <div className="button-row"><button className="primary" disabled={installing} onClick={() => void installEngine()}><Download size={16} />{installing ? t('Verificando descarga…', 'Verifying download…') : t('Preparar motor', 'Set up engine')}</button>
              <button className="secondary" onClick={() => void persist({ ...prefs, welcomed: true })}>{t('Continuar', 'Continue')}</button></div>
          </div>
        </section>}
        <section className="summary" aria-label={t('Estadísticas locales', 'Local statistics')}>
          {[[t('Exportaciones', 'Exports'), successful.length], [t('Stickers con audio', 'Stickers with sound'), successful.filter(entry => entry.kind === 'sticker' && entry.sound).length],
            [t('Fallidas', 'Failed'), entries.length - successful.length], [t('En curso', 'In progress'), pending]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}
        </section>
        <section className="surface bot-summary"><div className="section-title"><h2><MessageCircle size={18} />WhatsApp</h2><span role="status">{botLabel}</span></div>
          <div className="actions controls"><button className="secondary" onClick={() => navigate('bot')}>{t('Administrar bot', 'Manage bot')}</button>
            <button className="secondary" disabled={botBusy} onClick={() => void changeBot(botActive ? 'stop' : 'start')}>{botActive ? t('Detener', 'Stop') : t('Iniciar', 'Start')}</button>
            {botActive && <button className="secondary" disabled={botBusy} onClick={() => void changeBot('restart')}>{t('Reiniciar', 'Restart')}</button>}</div>
        </section>
        <section className="surface activity"><div className="section-title"><h2><Activity size={18} />{t('Actividad reciente', 'Recent activity')}</h2>
          <button className="secondary" onClick={() => navigate('history')}>{t('Ver historial', 'View history')}</button></div>
          {entries.length ? <div className="rows">{entries.slice(0, 6).map(entry => <div key={entry.id}><span>{entry.kind === 'audio' ? 'Audio' : 'Sticker'} · {entry.created}</span>
            <span>{'error' in entry.result ? t('Falló', 'Failed') : formatSize(entry.result.bytes)}</span></div>)}</div> :
            <div className="empty"><History size={26} /><strong>{t('Aún no hay conversiones', 'No conversions yet')}</strong><p>{t('Las exportaciones aparecerán aquí.', 'Exports will appear here.')}</p></div>}
        </section>
      </>}
      {page === 'download' && <section className="surface settings">
        <div className="section-title"><h2>{t('Enlace público de video', 'Public video link')}</h2></div>
        <form className="controls" onSubmit={event => { event.preventDefault(); void downloadVideo(); }}>
          <label>{t('Enlace directo HTTPS', 'Direct HTTPS link')}<input required type="url" maxLength={4096} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/video.mp4" /></label>
          <p>{t('MP4, WebM o MOV. Límite de 20 MiB y 3 minutos. Usa contenido que tengas derecho a descargar.', 'MP4, WebM or MOV. Limit 20 MiB and 3 minutes. Use content you have permission to download.')}</p>
          <button className="primary" disabled={importing}><Download size={16} />{importing ? t('Descargando…', 'Downloading…') : t('Descargar', 'Download')}</button>
        </form>
        {downloaded && <div className="controls actions">
          <span>{downloaded.duration?.toFixed(1)} s · {downloaded.bytes ? formatSize(downloaded.bytes) : ''}</span>
          <button className="secondary" onClick={() => void openDownloaded('sticker')}>{t('Abrir en Sticker Studio', 'Open in Sticker Studio')}</button>
          <button className="secondary" onClick={() => void exportFile(downloaded.path)}>{t('Guardar MP4', 'Save MP4')}</button>
          {downloaded.hasAudio && <button className="secondary" onClick={() => void openDownloaded('audio')}>{t('Abrir en Audio Studio', 'Open in Audio Studio')}</button>}
        </div>}
      </section>}
      {page === 'bot' && <section className="surface settings">
        <div className="section-title"><h2><MessageCircle size={18} />{t('Sesión de WhatsApp', 'WhatsApp session')}</h2><span role="status">{botLabel}</span></div>
        {bot.qr && <div className="controls qr"><img src={bot.qr} alt={t('Código QR de vinculación', 'Pairing QR code')} width={260} height={260} />
          <p>{t('En el teléfono, abre WhatsApp → Dispositivos vinculados y escanea el código.', 'On your phone, open WhatsApp → Linked devices and scan this code.')}</p></div>}
        <div className="controls">
          <label>{t('Números autorizados', 'Authorized numbers')}<input disabled={botBusy} value={allowed} onChange={event => setAllowed(event.target.value)} placeholder="+525512345678, +525587654321" /></label>
          <p>{t('Usa números internacionales separados por comas. Si dejas el campo vacío, solo responde al chat contigo mismo. Reinicia para aplicar cambios.', 'Enter international numbers separated by commas. Leave this field empty to serve your self-chat only. Restart to apply changes.')}</p>
          <p>{t('Baileys es una integración no oficial. Usa una cuenta secundaria por el riesgo de suspensión.', 'Baileys is an unofficial integration. Use a secondary account because of the risk of suspension.')}</p>
        </div>
        <div className="controls actions">
          <button className="primary" disabled={botBusy} onClick={() => void changeBot(botActive ? 'stop' : 'start')}>{botActive ? t('Detener', 'Stop') : t('Iniciar', 'Start')}</button>
          {botActive && <button className="secondary" disabled={botBusy} onClick={() => void changeBot('restart')}>{bot.status === 'qr' ? t('Regenerar QR', 'Refresh QR') : t('Reiniciar', 'Restart')}</button>}
          {bot.status === 'connected' && <button className="secondary" disabled={botBusy} onClick={() => void changeBot('unlink')}>{t('Desvincular', 'Unlink')}</button>}
        </div>
      </section>}
      {editor && <div className="editor">
        <section className="workbench surface" aria-label={t('Área de edición', 'Editing area')}>
          <div className="section-title"><h2>{media?.name || t('Archivo de origen', 'Source file')}</h2>
            <div className="button-row">
              {page === 'audio' && <button className="secondary" disabled={!!job || (importing && !recording)} onClick={() => void record()}><Mic size={16} />{recording ? t('Detener grabación', 'Stop recording') : t('Grabar', 'Record')}</button>}
              <button className="secondary" disabled={!!job || importing} onClick={() => void choose()}><FolderOpen size={16} />{t('Importar', 'Import')}</button>
            </div></div>
          <div className="stage">
            {result ? contents(result) : media ? <div className="proof">
              {page === 'audio' ? <audio controls src={convertFileSrc(media.path)} /> : images.includes(media.extension) ? <img src={convertFileSrc(media.path)} alt={media.name} /> :
                <video controls preload="metadata" src={convertFileSrc(media.path)} />}
            </div> : <div className="empty drop"><span className="empty-mark">{page === 'audio' ? <AudioLines size={28} /> : <ImagePlus size={28} />}</span>
              <strong>{importing ? t('Leyendo archivo…', 'Reading file…') : t('Arrastra un archivo aquí', 'Drop a file here')}</strong>
              <p>{page === 'sticker' ? t('Imagen, GIF o video', 'Image, GIF or video') : t('Audio o video', 'Audio or video')}</p>
              <button className="secondary" disabled={importing} onClick={() => void choose()}>{t('Seleccionar archivo', 'Choose file')}</button></div>}
          </div>
          <div className="timeline">
            <div className="section-title"><h2><Scissors size={16} />{t('Fragmento', 'Clip')}</h2><span>{media ? end.toFixed(2) + ' s' : '—'}</span></div>
            <fieldset disabled={!media || !!job || (media?.still && page === 'sticker')}>
              <Slider label={t('Inicio', 'Start')} min={0} max={Math.max(0, timelineLimit - 0.1)} step={0.1} value={options.start} unit=" s" onChange={n => edit('start', n)} />
              <Slider label={t('Final', 'End')} min={Math.min(timelineLimit, options.start + 0.1)} max={Math.min(timelineLimit, options.start + 25)} step={0.1} value={end} unit=" s" onChange={n => edit('duration', n - options.start)} />
            </fieldset>
            {media?.peaks?.length && page === 'audio' ? <div className="wave" role="img" aria-label={t('Forma de onda del audio de origen', 'Source audio waveform')}>
              {media.peaks.map((peak, index) => <i key={index} style={{ height: Math.max(4, Math.min(100, peak * 175)) + '%' }} />)}
            </div> : null}
          </div>
          <footer className="editor-foot">
            <span role="status">{job ? t('Procesando…', 'Processing…') : result ? formatSize(result.bytes) : t('Tamaño disponible al renderizar', 'Size available after rendering')}</span>
            {job ? <button className="secondary" onClick={() => void invoke('cancel', { job }).catch(e => setError(String(e)))}><X size={16} />{t('Cancelar', 'Cancel')}</button> :
              <button className="secondary" disabled={!media} onClick={() => void render(true)}>{t('Renderizar vista previa', 'Render preview')}</button>}
          </footer>
          {result && !result.preview && <div className="copy-links">{result.files.map(path => <button className="secondary" key={path} onClick={() => void exportFile(path)}><Download size={16} />{t('Guardar copia', 'Save copy')} · {path.split('.').at(-1)?.toUpperCase()}</button>)}</div>}
        </section>
        <section className="inspector surface" aria-label={t('Propiedades', 'Properties')}>
          <div className="section-title"><h2>{t('Propiedades', 'Properties')}</h2>
            <button className="icon-button" aria-label={t('Restablecer ajustes', 'Reset adjustments')} disabled={!!job} onClick={() => { setOptions(settingsToOptions(prefs)); setResult(undefined); }}><RotateCw size={16} /></button></div>
          <fieldset disabled={!!job}>
            {page === 'sticker' && <>
              <Disclosure title={t('Encuadre', 'Framing')} initial>
                <label>{t('Modo', 'Mode')}<select value={options.mode} onChange={event => edit('mode', event.target.value)}>
                  <option value="corte">{t('Recorte 1:1', 'Square crop')}</option><option value="transparente">{t('Transparente', 'Transparent')}</option>
                  <option value="negro">{t('Fondo negro', 'Black background')}</option><option value="blanco">{t('Fondo blanco', 'White background')}</option><option value="color">{t('Color de fondo', 'Background color')}</option><option value="blur">{t('Fondo desenfocado', 'Blurred background')}</option>
                </select></label>
                {options.mode === 'color' && <label>Color<input type="color" value={options.color} onChange={event => edit('color', event.target.value)} /></label>}
                {options.mode === 'corte' && <>
                  <Slider label="Zoom" min={1} max={3} step={0.05} value={options.zoom} unit="×" onChange={n => edit('zoom', n)} />
                  <Slider label={t('Horizontal', 'Horizontal')} min={0} max={100} value={options.x} unit="%" onChange={n => edit('x', n)} />
                  <Slider label={t('Vertical', 'Vertical')} min={0} max={100} value={options.y} unit="%" onChange={n => edit('y', n)} />
                </>}
                <label>{t('Rotación', 'Rotation')}<select value={options.rotation} onChange={event => edit('rotation', Number(event.target.value))}>{[0, 90, 180, 270].map(degrees => <option key={degrees} value={degrees}>{degrees}°</option>)}</select></label>
                <label className="check"><input type="checkbox" checked={options.flip} onChange={event => edit('flip', event.target.checked)} />{t('Voltear horizontalmente', 'Flip horizontally')}</label>
              </Disclosure>
              <Disclosure title={t('Texto', 'Text')}>
                <label>{t('Texto sobre el sticker', 'Sticker caption')}<input maxLength={64} value={options.caption} onChange={event => edit('caption', event.target.value)} /></label>
                <Slider label={t('Contorno del texto', 'Text outline')} min={0} max={8} value={options.outline} onChange={n => edit('outline', n)} />
              </Disclosure>
              <Disclosure title={t('Color y compresión', 'Color and compression')}>
                <Slider label={t('Brillo', 'Brightness')} min={-0.5} max={0.5} step={0.05} value={options.brightness} onChange={n => edit('brightness', n)} />
                <Slider label={t('Contraste', 'Contrast')} min={0.5} max={2} step={0.05} value={options.contrast} onChange={n => edit('contrast', n)} />
                <Slider label={t('Saturación', 'Saturation')} min={0} max={2} step={0.05} value={options.saturation} onChange={n => edit('saturation', n)} />
                <Slider label="FPS" min={5} max={30} value={options.fps} onChange={n => edit('fps', n)} />
                <Slider label={t('Calidad', 'Quality')} min={5} max={95} value={options.quality} unit="%" onChange={n => edit('quality', n)} />
              </Disclosure>
            </>}
            <Disclosure title="Audio" initial={page === 'audio'}>
              {page === 'sticker' ? <>
                <button className="secondary" disabled={!media || importing} onClick={() => void choose(true)}><AudioLines size={16} />{audio?.name || t('Añadir pista', 'Add track')}</button>
                <button className="secondary" disabled={!media || (importing && !recording)} onClick={() => void record()}><Mic size={16} />{recording ? t('Detener grabación', 'Stop recording') : t('Grabar pista', 'Record track')}</button>
                <label className="check"><input type="checkbox" disabled={!audio && !media?.hasAudio} checked={options.sound} onChange={event => edit('sound', event.target.checked)} />{t('Exportar pista Opus', 'Export Opus track')}</label>
              </> : <label>{t('Formato', 'Format')}<select value={options.format} onChange={event => edit('format', event.target.value)}><option value="opus">OGG / Opus</option><option value="mp3">MP3</option></select></label>}
              <Slider label={t('Velocidad', 'Speed')} min={0.5} max={2} step={0.05} value={options.speed} unit="×" onChange={n => edit('speed', n)} />
              <Slider label={t('Tono', 'Pitch')} min={-12} max={12} value={options.pitch} onChange={n => edit('pitch', n)} />
              <label>{t('Efecto', 'Effect')}<select value={options.effect} onChange={event => edit('effect', event.target.value)}><option value="">{t('Ninguno', 'None')}</option><option value="radio">Radio</option><option value="echo">{t('Eco', 'Echo')}</option></select></label>
              {page === 'audio' && <label className="check"><input type="checkbox" checked={options.removeSilence} onChange={event => edit('removeSilence', event.target.checked)} />{t('Eliminar silencios', 'Remove silence')}</label>}
              <Slider label={t('Volumen', 'Volume')} min={0} max={200} value={options.volume} unit="%" onChange={n => edit('volume', n)} />
              <Slider label="Fade in" min={0} max={10} step={0.1} value={options.fadeIn} unit=" s" onChange={n => edit('fadeIn', n)} />
              <Slider label="Fade out" min={0} max={10} step={0.1} value={options.fadeOut} unit=" s" onChange={n => edit('fadeOut', n)} />
              <label className="check"><input type="checkbox" checked={options.normalize} onChange={event => edit('normalize', event.target.checked)} />{t('Normalizar volumen', 'Normalize volume')}</label>
            </Disclosure>
          </fieldset>
        </section>
      </div>}
      {page === 'history' && <section className="surface activity">
        <div className="history-tools">
          <label>{t('Buscar', 'Search')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>{t('Tipo', 'Type')}<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">{t('Todos', 'All')}</option><option value="sticker">Sticker</option><option value="audio">Audio</option></select></label>
          <label>{t('Fecha', 'Date')}<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <button className="secondary" disabled={!entries.length} onClick={() => void forget(null)}>{t('Limpiar historial', 'Clear history')}</button>
        </div>
        <div className="rows">{entries.filter(entry => (!filter || entry.kind === filter) && (!date || entry.created.startsWith(date)) &&
          (entry.name + ' ' + entry.kind + ' ' + entry.created).toLowerCase().includes(query.toLowerCase())).map(entry =>
          <div key={entry.id}><button className="secondary" onClick={() => setSelected(entry)}>{entry.kind === 'audio' ? 'Audio' : 'Sticker'} · {entry.created}</button>
            <span>{'error' in entry.result ? t('Falló', 'Failed') : formatSize(entry.result.bytes)}</span>
            <button className="icon-button" aria-label={t('Eliminar registro', 'Delete record')} onClick={() => void forget(entry.id)}><X size={16} /></button></div>)}</div>
        {!entries.length && <div className="empty"><History size={26} /><strong>{t('Historial vacío', 'No history yet')}</strong></div>}
        {selected && <div className="history-proof">{'error' in selected.result ? <p>{selected.result.error}</p> : <>
          {contents(selected.result)}
          {selected.result.files.map(path => <button className="secondary" key={path} onClick={() => void exportFile(path)}>{t('Guardar copia', 'Save copy')} · {path.split('.').at(-1)?.toUpperCase()}</button>)}
        </>}</div>}
      </section>}
      {page === 'packs' && <Packs t={t} error={setError} notice={setNotice} choices={successful.filter(entry => entry.kind === 'sticker').map(entry => ({ id: entry.id, label: `${entry.name} · ${entry.created}` }))} />}
      {page === 'settings' && <section className="surface settings">
        <Disclosure title={t('Apariencia', 'Appearance')} initial>
          <label>{t('Idioma', 'Language')}<select value={prefs.language} onChange={event => void persist({ ...prefs, language: event.target.value as Preferences['language'] })}><option value="es">Español</option><option value="en">English</option></select></label>
          <label>{t('Tema', 'Theme')}<select value={prefs.theme} onChange={event => void persist({ ...prefs, theme: event.target.value as Theme })}><option value="system">{t('Automático', 'System')}</option><option value="light">{t('Claro', 'Light')}</option><option value="dark">{t('Oscuro', 'Dark')}</option></select></label>
        </Disclosure>
        <Disclosure title={t('Ajustes de exportación', 'Export defaults')} initial>
          <Slider label="FPS" min={5} max={30} value={prefs.fps} onChange={fps => void persist({ ...prefs, fps })} />
          <Slider label={t('Duración', 'Duration')} min={1} max={25} value={prefs.duration} unit=" s" onChange={duration => void persist({ ...prefs, duration })} />
          <Slider label={t('Calidad', 'Quality')} min={5} max={95} value={prefs.quality} unit="%" onChange={quality => void persist({ ...prefs, quality })} />
          <Slider label={t('Volumen', 'Volume')} min={0} max={200} value={prefs.volume} unit="%" onChange={volume => void persist({ ...prefs, volume })} />
        </Disclosure>
        <div className="controls actions"><button className="secondary" onClick={() => void invoke('diagnose').then(() => { setError(''); setNotice(t('FFmpeg y FFprobe respondieron.', 'FFmpeg and FFprobe responded.')); }).catch(e => setError(String(e)))}><CircleHelp size={16} />{t('Comprobar motor', 'Check engine')}</button>
          <button className="secondary" disabled={installing} onClick={() => void installEngine()}><Download size={16} />{installing ? t('Instalando…', 'Installing…') : t('Instalar motor', 'Install engine')}</button>
          <button className="secondary" onClick={() => { setAllowed(''); void persist(defaults); }}><RotateCw size={16} />{t('Restablecer', 'Reset')}</button></div>
      </section>}
    </main>
  </div>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
