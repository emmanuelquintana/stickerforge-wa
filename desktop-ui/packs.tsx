import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen, Plus, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

type Pack = { id: string; name: string; author: string; category: string; favorite: boolean; stickers: string[] };
type Choice = { id: string; label: string };
const empty: Pack = { id: '', name: '', author: '', category: '', favorite: false, stickers: [] };

export function Packs({ choices, t, notice, error }: {
  choices: Choice[]; t: (es: string, en: string) => string;
  notice: (message: string) => void; error: (message: string) => void;
}) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [editing, setEditing] = useState<Pack | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => invoke<Pack[]>('packs').then(setPacks);
  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) void refresh().catch(e => error(String(e)));
  }, []);
  useEffect(() => {
    if (editing?.stickers.length) {
      void invoke<string[]>('pack_assets', { ids: editing.stickers }).then(setPaths).catch(e => error(String(e)));
    } else setPaths([]);
  }, [editing?.stickers]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    error('');
    try {
      await action();
    } catch (e) {
      error(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function loadPack() {
    const source = await open({ filters: [{ name: 'StickerForge Pack', extensions: ['sfpack'] }] });
    if (source) {
      setEditing(await invoke<Pack>('import_pack', { source }));
      await refresh();
      notice(t('Paquete importado.', 'Pack imported.'));
    }
  }
  async function storePack() {
    if (!editing) return;
    setEditing(await invoke<Pack>('save_pack', { pack: editing }));
    await refresh();
    notice(t('Paquete guardado.', 'Pack saved.'));
  }
  async function copyPack() {
    if (!editing?.id) return;
    const destination = await save({ defaultPath: 'StickerForge.sfpack', filters: [{ name: 'StickerForge Pack', extensions: ['sfpack'] }] });
    if (destination) {
      await invoke('export_pack', { id: editing.id, destination });
      notice(t('Paquete exportado.', 'Pack exported.'));
    }
  }
  const available = choices.filter(record => !editing?.stickers.includes(record.id));
  return <section className="surface">
    <div className="section-title"><h2>{t('Colecciones locales', 'Local collections')}</h2>
      <div className="button-row">
        <button className="secondary" disabled={busy} onClick={() => void perform(loadPack)}><FolderOpen size={16} />{t('Importar', 'Import')}</button>
        <button className="primary" disabled={busy} onClick={() => setEditing({ ...empty })}><Plus size={16} />{t('Nuevo paquete', 'New pack')}</button>
      </div>
    </div>
    <div className="rows">{packs.map(pack => <div key={pack.id}>
      <button className="secondary" onClick={() => setEditing(pack)}>{pack.favorite && <Star size={15} />}{pack.name}</button>
      <span>{pack.stickers.length} stickers{pack.category ? ` · ${pack.category}` : ''}</span>
    </div>)}</div>
    {!packs.length && !editing && <div className="empty"><p>{t('Crea un paquete y añade stickers del historial.', 'Create a pack and add stickers from your history.')}</p></div>}
    {editing && <form className="controls pack-form" onSubmit={event => { event.preventDefault(); void perform(storePack); }}>
      <label>{t('Nombre', 'Name')}<input required maxLength={80} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
      <label>{t('Autor', 'Author')}<input maxLength={80} value={editing.author} onChange={event => setEditing({ ...editing, author: event.target.value })} /></label>
      <label>{t('Categoría', 'Category')}<input maxLength={80} value={editing.category} onChange={event => setEditing({ ...editing, category: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={editing.favorite} onChange={event => setEditing({ ...editing, favorite: event.target.checked })} />{t('Favorito', 'Favorite')}</label>
      {paths.length > 0 && <div className="pack-assets">{paths.map((path, index) => <div key={path}>
        <img src={convertFileSrc(path)} alt={index === 0 ? t('Portada', 'Cover') : `Sticker ${index + 1}`} />
        <button type="button" className="secondary" onClick={() => setEditing({ ...editing, stickers: editing.stickers.filter((_, i) => i !== index) })}>{t('Quitar', 'Remove')}</button>
        {index > 0 && <button type="button" className="secondary" onClick={() => setEditing({ ...editing, stickers: [editing.stickers[index], ...editing.stickers.filter((_, i) => i !== index)] })}>{t('Usar de portada', 'Use as cover')}</button>}
      </div>)}</div>}
      {available.length > 0 && <div className="button-row">
        <label>{t('Sticker del historial', 'Sticker from history')}<select value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="">{t('Selecciona un sticker', 'Select a sticker')}</option>
          {available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={!available.some(item => item.id === choice) || editing.stickers.length >= 24} onClick={() => {
          setEditing({ ...editing, stickers: [...editing.stickers, choice] });
          setChoice('');
        }}><Plus size={16} />{t('Añadir', 'Add')}</button>
      </div>}
      <div className="button-row">
        <button className="primary" disabled={busy}>{t('Guardar paquete', 'Save pack')}</button>
        <button type="button" className="secondary" disabled={busy || !editing.id} onClick={() => void perform(copyPack)}><Download size={16} />{t('Exportar .sfpack', 'Export .sfpack')}</button>
      </div>
      <p>{t('Los archivos .sfpack se abren en StickerForge. Incluyen los stickers WebP.', '.sfpack files open in StickerForge and contain WebP stickers.')}</p>
    </form>}
  </section>;
}
