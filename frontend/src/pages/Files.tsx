import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Folder, File as FileIcon, Link2, ChevronRight, HardDrive, FolderPlus, Upload, Download,
  Pencil, Trash2, Lock, UserCog, Home, RefreshCw, Save, X, Search, CornerUpLeft,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { tt } from '../lib/i18n';
import { formatBytes } from '../lib/utils';
import type { FileEntry, FileListing, FileSearchResult } from '../lib/types';

/**
 * Dateimanager: Ordner durchsehen, anlegen, umbenennen, löschen, Rechte und
 * Eigentümer setzen, Dateien hoch- und herunterladen sowie Textdateien direkt
 * bearbeiten. Wie das Terminal arbeitet er auf dem Server – mit den Rechten,
 * die der Dienst hat, und bei Bedarf mit erhöhten.
 */

const QUICK: { label: string; path: string }[] = [
  { label: '/', path: '/' },
  { label: '/etc', path: '/etc' },
  { label: '/var/log', path: '/var/log' },
  { label: '/opt', path: '/opt' },
  { label: '/home', path: '/home' },
  { label: '/tmp', path: '/tmp' },
];

const PATH_PREF = 'filesLastPath';

function icon(e: FileEntry) {
  if (e.type === 'dir') return <Folder size={15} style={{ color: 'var(--color-accent)' }} />;
  if (e.type === 'link') return <Link2 size={15} style={{ color: 'var(--color-info)' }} />;
  return <FileIcon size={15} style={{ color: 'var(--color-faint)' }} />;
}

/** Pfad in klickbare Bestandteile zerlegen. */
function crumbs(p: string): { name: string; path: string }[] {
  const parts = p.split('/').filter(Boolean);
  const out = [{ name: '/', path: '/' }];
  let cur = '';
  for (const part of parts) {
    cur += `/${part}`;
    out.push({ name: part, path: cur });
  }
  return out;
}

type Dialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'chmod'; entry: FileEntry }
  | { kind: 'chown'; entry: FileEntry }
  | { kind: 'edit'; entry: FileEntry; content: string; loading: boolean }
  | null;

export function Files() {
  const [listing, setListing] = useState<FileListing | null>(null);
  const [path, setPath] = useState<string>(() => {
    try { return localStorage.getItem(PATH_PREF) || '/'; } catch { return '/'; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [input, setInput] = useState('');
  const [input2, setInput2] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Suche: solange ein Ergebnis vorliegt, zeigt die Tabelle die Treffer statt
  // des Ordnerinhalts. „query" ist das Eingabefeld, „search" das Ergebnis.
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<FileSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true); setError('');
    try {
      const r = await api.files.list(target);
      setListing(r);
      setSearch(null);
      setPath(r.path);
      try { localStorage.setItem(PATH_PREF, r.path); } catch { /* */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : tt('Fehler'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(path); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const reload = () => void load(path);
  const ok = (text: string) => { setMsg({ type: 'ok', text }); void load(path); };
  const fail = (err: unknown) => setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });

  const open = (e: FileEntry) => {
    if (e.type === 'dir' || (e.type === 'link' && !e.name.includes('.'))) {
      void load(`${path === '/' ? '' : path}/${e.name}`);
    }
  };

  const startEdit = async (entry: FileEntry) => {
    setDialog({ kind: 'edit', entry, content: '', loading: true });
    try {
      const r = await api.files.read(entry.path ?? `${path === '/' ? '' : path}/${entry.name}`);
      setDialog({ kind: 'edit', entry, content: r.content, loading: false });
    } catch (err) {
      setDialog(null);
      fail(err);
    }
  };

  const full = (name: string) => `${path === '/' ? '' : path}/${name}`;
  /** Voller Pfad eines Eintrags – Suchtreffer bringen ihn schon mit. */
  const pathOf = (e: FileEntry) => e.path ?? full(e.name);

  const remove = async (e: FileEntry) => {
    const isDir = e.type === 'dir';
    const question = isDir
      ? `„${e.name}" samt Inhalt löschen? Das lässt sich nicht rückgängig machen.`
      : `„${e.name}" löschen?`;
    if (!confirm(question)) return;
    setBusy(true); setMsg(null);
    try {
      await api.files.remove(pathOf(e), isDir);
      ok(`„${e.name}" ${tt('gelöscht')}.`);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const submitDialog = async () => {
    if (!dialog) return;
    setBusy(true); setMsg(null);
    try {
      if (dialog.kind === 'mkdir') {
        await api.files.mkdir(path, input);
        ok(`${tt('Ordner angelegt')}: ${input}`);
      } else if (dialog.kind === 'rename') {
        await api.files.rename(pathOf(dialog.entry), input);
        ok(`${tt('Umbenannt in')} „${input}".`);
      } else if (dialog.kind === 'chmod') {
        await api.files.chmod(pathOf(dialog.entry), input, recursive);
        ok(`${tt('Rechte gesetzt')}: ${input}`);
      } else if (dialog.kind === 'chown') {
        await api.files.chown(pathOf(dialog.entry), input, input2, recursive);
        ok(`${tt('Eigentümer gesetzt')}: ${input}${input2 ? `:${input2}` : ''}`);
      } else if (dialog.kind === 'edit') {
        await api.files.write(pathOf(dialog.entry), dialog.content);
        ok(`„${dialog.entry.name}" ${tt('gespeichert')}.`);
      }
      setDialog(null); setInput(''); setInput2(''); setRecursive(false);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) { setMsg({ type: 'err', text: tt('Bitte mindestens zwei Zeichen suchen.') }); return; }
    setSearching(true); setMsg(null); setError('');
    try {
      setSearch(await api.files.search(path, q));
    } catch (err) { fail(err); } finally { setSearching(false); }
  };

  /** Zu einem Treffer springen: Ordner öffnen, bei Dateien den Elternordner. */
  const goToHit = (e: FileEntry) => {
    const p = e.path ?? full(e.name);
    void load(e.type === 'dir' ? p : p.slice(0, p.lastIndexOf('/')) || '/');
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.files.upload(path, files);
      ok(`${tt('Hochgeladen')}: ${(r.files ?? []).join(', ')}`);
    } catch (err) { fail(err); } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  return (
    <>
      <Topbar
        title={tt('Dateimanager')}
        subtitle={path}
        onRefresh={reload}
        refreshing={loading}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--outline btn--sm" onClick={() => { setInput(''); setDialog({ kind: 'mkdir' }); }}>
              <FolderPlus size={13} /> {tt('Neuer Ordner')}
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload size={13} /> {tt('Hochladen')}
            </button>
            <input
              ref={fileInput} type="file" multiple hidden
              onChange={(e) => void upload(e.target.files)}
            />
          </div>
        }
      />
      <main className="page">
        <div style={{ display: 'grid', gap: 12 }}>
          {msg && (
            <div
              className="login-error"
              style={msg.type === 'ok'
                ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }
                : undefined}
            >
              {msg.text}
            </div>
          )}

          {/* Schnellziele und Suche */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <HardDrive size={14} style={{ color: 'var(--color-faint)' }} />
            {QUICK.map((q) => (
              <button
                key={q.path}
                className={`btn btn--sm ${path === q.path && !search ? 'btn--primary' : 'btn--outline'}`}
                onClick={() => void load(q.path)}
              >
                {q.label}
              </button>
            ))}
            {/* Schrumpft auf schmalen Schirmen mit, statt rechts hinauszulaufen. */}
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center', flex: '1 1 220px', minWidth: 0, justifyContent: 'flex-end' }}>
              <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
                <input
                  className="input input--rect"
                  placeholder={tt('Name suchen – ab hier abwärts')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
                  style={{ paddingLeft: 28, width: '100%', minWidth: 0 }}
                />
              </div>
              <button className="btn btn--outline btn--sm" onClick={runSearch} disabled={searching || query.trim().length < 2}>
                {searching ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Search size={13} />} {tt('Suchen')}
              </button>
            </div>
          </div>

          {/* Pfadleiste */}
          <div className="card">
            <div className="card-body" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Home size={13} style={{ color: 'var(--color-faint)', marginRight: 4 }} />
              {crumbs(path).map((c, i) => (
                <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {i > 0 && <ChevronRight size={12} style={{ color: 'var(--color-faint)' }} />}
                  <button
                    className="btn btn--ghost btn--sm"
                    style={{ padding: '2px 6px', fontWeight: i === crumbs(path).length - 1 ? 600 : 400 }}
                    onClick={() => void load(c.path)}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          {search && (
            <div className="card">
              <div className="card-body" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Search size={14} style={{ color: 'var(--color-accent)' }} />
                <span style={{ fontSize: 13 }}>
                  <strong>{search.entries.length}{search.truncated ? '+' : ''}</strong> {tt('Treffer für')} „{search.query}"
                  <span className="text-muted"> {tt('unterhalb von')} <code>{search.path}</code></span>
                </span>
                {search.truncated && (
                  <span className="text-muted" style={{ fontSize: 12 }}>({tt('gekürzt – bitte genauer suchen')})</span>
                )}
                <button className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }} onClick={() => { setSearch(null); setQuery(''); }}>
                  <CornerUpLeft size={13} /> {tt('Zurück zum Ordner')}
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-body" style={{ padding: 0 }}>
              {loading && !listing ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                  <span className="spinner" style={{ width: 20, height: 20 }} />
                </div>
              ) : (
                // Höher als der Standard von 460 px: ein Dateimanager lebt
                // davon, viele Einträge auf einmal zu zeigen.
                <div className="table-scroll" style={{ maxHeight: 'max(320px, calc(100vh - 340px))' }}>
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>{tt('Name')}</th>
                        <th style={{ width: 100 }}>{tt('Größe')}</th>
                        <th style={{ width: 140 }}>{tt('Geändert')}</th>
                        <th style={{ width: 120 }}>{tt('Rechte')}</th>
                        <th style={{ width: 130 }}>{tt('Eigentümer')}</th>
                        <th style={{ width: 250 }}>{tt('Aktionen')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!search && listing?.parent !== null && listing && (
                        <tr>
                          <td colSpan={6}>
                            <button className="btn btn--ghost btn--sm" onClick={() => void load(listing.parent!)}>
                              <Folder size={14} /> .. {tt('eine Ebene höher')}
                            </button>
                          </td>
                        </tr>
                      )}
                      {(search ? search.entries : listing?.entries ?? []).map((e) => (
                        <tr key={e.name}>
                          <td>
                            <button
                              className="btn btn--ghost btn--sm"
                              style={{ padding: 0, gap: 8, maxWidth: '100%', justifyContent: 'flex-start', cursor: e.type === 'dir' ? 'pointer' : 'default' }}
                              onClick={() => (search ? goToHit(e) : open(e))}
                              title={e.path ?? (e.target ? `→ ${e.target}` : e.name)}
                            >
                              {icon(e)}
                              <span style={{ wordBreak: 'break-all', textAlign: 'left' }}>{e.name}</span>
                            </button>
                            {/* Bei Treffern zeigt der Pfad, wo die Datei liegt. */}
                            {e.path && (
                              <div style={{ fontSize: 11, color: 'var(--color-faint)', wordBreak: 'break-all' }}>{e.path}</div>
                            )}
                            {e.target && <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>→ {e.target}</div>}
                          </td>
                          <td className="text-muted" style={{ fontSize: 12 }}>{e.type === 'dir' ? '—' : formatBytes(e.size)}</td>
                          <td className="text-muted" style={{ fontSize: 12 }}>{new Date(e.mtime).toLocaleString()}</td>
                          <td className="dtable__mono" style={{ fontSize: 12 }}>{e.mode} <span className="text-muted">{e.modeText}</span></td>
                          <td className="text-muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>{e.owner}:{e.group}</td>
                          <td>
                            <div className="row-actions row-actions--grid">
                              {e.type === 'file' && (
                                <button className="btn btn--outline btn--sm" title={tt('Bearbeiten')} onClick={() => void startEdit(e)}>
                                  <Pencil size={12} />
                                </button>
                              )}
                              {/* Herunterladen gibt es für beides: Dateien direkt,
                                  Ordner als tar.gz-Archiv. */}
                              {(e.type === 'file' || e.type === 'dir') && (
                                <a
                                  className="btn btn--outline btn--sm"
                                  style={{ color: 'var(--color-accent)' }}
                                  title={e.type === 'dir' ? tt('Ordner als tar.gz herunterladen') : tt('Herunterladen')}
                                  href={e.type === 'dir' ? api.files.archiveUrl(pathOf(e)) : api.files.downloadUrl(pathOf(e))}
                                >
                                  <Download size={12} />
                                </a>
                              )}
                              <button className="btn btn--outline btn--sm" title={tt('Umbenennen')} onClick={() => { setInput(e.name); setDialog({ kind: 'rename', entry: e }); }}>
                                <FileIcon size={12} />
                              </button>
                              <button className="btn btn--outline btn--sm" title={tt('Rechte ändern')} onClick={() => { setInput(e.mode); setRecursive(false); setDialog({ kind: 'chmod', entry: e }); }}>
                                <Lock size={12} />
                              </button>
                              <button className="btn btn--outline btn--sm" title={tt('Eigentümer ändern')} onClick={() => { setInput(e.owner); setInput2(e.group); setRecursive(false); setDialog({ kind: 'chown', entry: e }); }}>
                                <UserCog size={12} />
                              </button>
                              <button className="btn btn--danger btn--sm" title={tt('Löschen')} disabled={busy} onClick={() => void remove(e)}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {search && search.entries.length === 0 && (
                        <tr><td colSpan={6} className="text-muted" style={{ padding: 16 }}>{tt('Nichts gefunden.')}</td></tr>
                      )}
                      {!search && listing && listing.entries.length === 0 && (
                        <tr><td colSpan={6} className="text-muted" style={{ padding: 16 }}>{tt('Dieser Ordner ist leer.')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="form-hint">
            ⚠️ {tt('Änderungen wirken direkt auf dem Server – wie auf der Kommandozeile. Systemverzeichnisse wie /etc oder /usr lassen sich nicht als Ganzes löschen.')}
          </div>
        </div>
      </main>

      {/* ── Dialoge ── */}
      {dialog?.kind === 'mkdir' && (
        <Modal open title={tt('Neuen Ordner anlegen')} onClose={() => setDialog(null)}
          footer={<>
            <button className="btn btn--outline btn--sm" onClick={() => setDialog(null)}>{tt('Abbrechen')}</button>
            <button className="btn btn--primary btn--sm" disabled={busy || !input.trim()} onClick={submitDialog}>{tt('Anlegen')}</button>
          </>}
        >
          <div className="form-group">
            <label className="form-label">{tt('Name')}</label>
            <input className="input input--rect" autoFocus value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) void submitDialog(); }} />
            <div className="form-hint">{tt('Wird angelegt in')} <code>{path}</code></div>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'rename' && (
        <Modal open title={`${tt('Umbenennen')}: ${dialog.entry.name}`} onClose={() => setDialog(null)}
          footer={<>
            <button className="btn btn--outline btn--sm" onClick={() => setDialog(null)}>{tt('Abbrechen')}</button>
            <button className="btn btn--primary btn--sm" disabled={busy || !input.trim()} onClick={submitDialog}>{tt('Umbenennen')}</button>
          </>}
        >
          <div className="form-group">
            <label className="form-label">{tt('Neuer Name')}</label>
            <input className="input input--rect" autoFocus value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) void submitDialog(); }} />
          </div>
        </Modal>
      )}

      {dialog?.kind === 'chmod' && (
        <Modal open title={`${tt('Rechte ändern')}: ${dialog.entry.name}`} onClose={() => setDialog(null)}
          footer={<>
            <button className="btn btn--outline btn--sm" onClick={() => setDialog(null)}>{tt('Abbrechen')}</button>
            <button className="btn btn--primary btn--sm" disabled={busy || !/^[0-7]{3,4}$/.test(input)} onClick={submitDialog}>{tt('Setzen')}</button>
          </>}
        >
          <div className="form-group">
            <label className="form-label">{tt('Rechte (oktal)')}</label>
            <input className="input input--rect" autoFocus value={input} maxLength={4}
              onChange={(e) => setInput(e.target.value.replace(/[^0-7]/g, ''))} style={{ maxWidth: 120, fontFamily: 'var(--font-mono)' }} />
            <div className="form-hint">
              {tt('Üblich: 644 für Dateien, 755 für Ordner und Programme, 600 für Geheimnisse.')}
            </div>
          </div>
          {dialog.entry.type === 'dir' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 6 }}>
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
              {tt('Auf alle Unterordner und Dateien anwenden')}
            </label>
          )}
        </Modal>
      )}

      {dialog?.kind === 'chown' && (
        <Modal open title={`${tt('Eigentümer ändern')}: ${dialog.entry.name}`} onClose={() => setDialog(null)}
          footer={<>
            <button className="btn btn--outline btn--sm" onClick={() => setDialog(null)}>{tt('Abbrechen')}</button>
            <button className="btn btn--primary btn--sm" disabled={busy || !input.trim()} onClick={submitDialog}>{tt('Setzen')}</button>
          </>}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">{tt('Benutzer')}</label>
              <input className="input input--rect" autoFocus value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{tt('Gruppe')}</label>
              <input className="input input--rect" value={input2} onChange={(e) => setInput2(e.target.value)} />
            </div>
            {dialog.entry.type === 'dir' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
                {tt('Auf alle Unterordner und Dateien anwenden')}
              </label>
            )}
          </div>
        </Modal>
      )}

      {dialog?.kind === 'edit' && (
        <Modal open title={`${tt('Bearbeiten')}: ${dialog.entry.name}`} onClose={() => setDialog(null)} width={900}
          footer={<>
            <button className="btn btn--outline btn--sm" onClick={() => setDialog(null)}><X size={13} /> {tt('Abbrechen')}</button>
            <button className="btn btn--primary btn--sm" disabled={busy || dialog.loading} onClick={submitDialog}>
              <Save size={13} /> {tt('Speichern')}
            </button>
          </>}
        >
          {dialog.loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <span className="spinner" style={{ width: 20, height: 20 }} />
            </div>
          ) : (
            <textarea
              className="input input--rect"
              value={dialog.content}
              onChange={(e) => setDialog({ ...dialog, content: e.target.value })}
              spellCheck={false}
              style={{ width: '100%', minHeight: '55vh', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }}
            />
          )}
        </Modal>
      )}

      {/* Ladeanzeige beim Neuladen im Hintergrund */}
      {loading && listing && (
        <div style={{ position: 'fixed', right: 18, bottom: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-muted)' }}>
          <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> {tt('Wird geladen…')}
        </div>
      )}
    </>
  );
}
