import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ArrowUpCircle, CheckCircle2, RotateCw, ShieldCheck, Trash2,
  GitBranch, Globe, Lock, Link2, History, FileText, GitCommit, AlertTriangle, Pencil,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { Modal } from '../ui/Modal';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/utils';
import { tt } from '../../lib/i18n';
import { useBranding } from '../../lib/branding';
import type { VersionInfo, UpdateSource, UpdateVersion, UpdateNotes } from '../../lib/types';

// Core-Hub-Update: Quelle (Git-Repository) und Versionsauswahl.
// Ausgelagert, damit die Panels sowohl in den Einstellungen als auch auf der
// Update-Seite („System-Updates") verwendet werden können.

/**
 * Update-Quelle: welches Git-Repository für Updates verwendet wird.
 * Änderbar (z. B. nach einem Repository-Umzug) und für private Repositories
 * mit Benutzername + Token/Passwort. Die Zugangsdaten werden serverseitig
 * verschlüsselt gespeichert und nie wieder ausgeliefert.
 *
 * Bewusst KEINE eigene Kachel: Quelle und Version gehören zusammen (aus welchem
 * Repository kommt welche Version?). Das Formular steckt deshalb im Panel
 * „Version & Updates" und wird dort über den Stift ein- und ausgeklappt.
 */
export function UpdateSourceForm({ onChanged, onClose }: { onChanged?: (src: UpdateSource) => void; onClose?: () => void }) {
  const [src, setSrc] = useState<UpdateSource | null>(null);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [authType, setAuthType] = useState<'token' | 'password'>('token');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.settings.updateSource();
      setSrc(s);
      setUrl(s.url || s.detectedUrl || '');
      setBranch(s.branch || '');
      setVisibility(s.visibility);
      setAuthType(s.authType);
      setUsername(s.username);
      setSecret('');
    } catch { /* nicht angemeldet o. ä. */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (opts: { clearSecret?: boolean } = {}) => {
    setSaving(true); setMsg(null);
    try {
      const res = await api.settings.saveUpdateSource({
        url: url.trim(),
        branch: branch.trim(),
        visibility,
        authType,
        username: username.trim(),
        // Leeres Feld = Geheimnis unverändert lassen; „entfernen" schickt bewusst ''
        ...(opts.clearSecret ? { secret: '' } : (secret ? { secret } : {})),
      });
      setSrc(res.source);
      setSecret('');
      setMsg({ kind: 'ok', text: tt('Update-Quelle gespeichert.') });
      onChanged?.(res.source);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : tt('Speichern fehlgeschlagen') });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const res = await api.settings.testUpdateSource();
      setMsg({ kind: 'ok', text: tt('Verbindung erfolgreich – {n} Branch(es) gefunden: {list}', { n: res.count, list: res.branches.slice(0, 6).join(', ') }) });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : tt('Verbindung fehlgeschlagen') });
    } finally { setTesting(false); }
  };

  const inputStyle: React.CSSProperties = { width: '100%' };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
          {tt('Legt fest, aus welchem Git-Repository Core-Hub seine Updates holt. Kann jederzeit geändert werden – z. B. wenn das Repository umgezogen ist oder ein eigener Fork verwendet werden soll.')}
        </div>

        <div>
          <label className="form-label">{tt('Repository-URL')}</label>
          <input
            className="input" style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={src?.detectedUrl || 'https://github.com/benutzer/repo.git'} spellCheck={false} autoComplete="off"
          />
          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 4 }}>
            {tt('Nur https-URLs. Leer lassen = das Repository verwenden, aus dem installiert wurde.')}
          </div>
        </div>

        <div>
          <label className="form-label">{tt('Branch')}</label>
          <input
            className="input" style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)}
            placeholder={src?.detectedBranch || 'main'} spellCheck={false} autoComplete="off"
          />
        </div>

        <div>
          <div className="form-label">{tt('Sichtbarkeit')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`btn btn--sm ${visibility === 'public' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setVisibility('public')}
            >
              <Globe size={13} /> {tt('Öffentlich')}
            </button>
            <button
              className={`btn btn--sm ${visibility === 'private' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setVisibility('private')}
            >
              <Lock size={13} /> {tt('Privat (Zugangsdaten nötig)')}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6 }}>
            {visibility === 'public'
              ? tt('Öffentliches Repository – es sind keine Zugangsdaten nötig.')
              : tt('Privates Repository – Benutzername und Token (empfohlen) oder Passwort werden verschlüsselt auf dem Server gespeichert.')}
          </div>
        </div>

        {visibility === 'private' && (
          <>
            <div>
              <div className="form-label">{tt('Anmeldeart')}</div>
              <select className="input" style={inputStyle} value={authType} onChange={(e) => setAuthType(e.target.value as 'token' | 'password')}>
                <option value="token">{tt('Zugriffstoken (empfohlen)')}</option>
                <option value="password">{tt('Passwort')}</option>
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 4 }}>
                {tt('Ein Token ist sicherer: es lässt sich einzeln widerrufen und nur auf ein Repository beschränken.')}
              </div>
            </div>

            <div>
              <label className="form-label">{tt('Benutzername')}</label>
              <input className="input" style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" />
            </div>

            <div>
              <label className="form-label">{authType === 'token' ? tt('Zugriffstoken') : tt('Passwort')}</label>
              <input
                className="input" style={inputStyle} type="password" value={secret}
                onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
                placeholder={src?.hasSecret ? tt('gespeichert – leer lassen, um es beizubehalten') : ''}
              />
              {src?.hasSecret && (
                <div style={{ fontSize: 11.5, color: 'var(--color-success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={12} /> {tt('Verschlüsselt gespeichert (wird nie angezeigt).')}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary btn--sm" disabled={saving} onClick={() => void save()}>
            {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} {tt('Speichern')}
          </button>
          <button className="btn btn--outline btn--sm" disabled={testing} onClick={() => void test()}>
            {testing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Link2 size={13} />} {tt('Verbindung testen')}
          </button>
          {onClose && (
            <button className="btn btn--outline btn--sm" onClick={onClose}>{tt('Schließen')}</button>
          )}
          {src?.hasSecret && (
            <button className="btn btn--outline btn--sm" disabled={saving} onClick={() => { if (confirm(tt('Gespeicherte Zugangsdaten entfernen?'))) void save({ clearSecret: true }); }}>
              <Trash2 size={13} /> {tt('Zugangsdaten entfernen')}
            </button>
          )}
        </div>

        {msg && (
          <div style={{ fontSize: 12.5, color: msg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
export function VersionPanel({ installCmd }: { installCmd: string }) {
  // Überschrift folgt dem in den Einstellungen vergebenen Namen
  const { appName } = useBranding();
  const [ver, setVer] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Auswählbare Stände: Standard ist die neueste Version, per Dropdown lässt sich
  // aber auch gezielt auf einen älteren Stand zurückgerollt werden.
  const [versions, setVersions] = useState<UpdateVersion[]>([]);
  const [targetRef, setTargetRef] = useState('');
  const [versionsErr, setVersionsErr] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  // Änderungsnotizen („Was bringt dieser Stand?") – als Vorschau und im Popup
  const [notes, setNotes] = useState<UpdateNotes | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesErr, setNotesErr] = useState('');
  // Update-Quelle steckt in derselben Kachel – normal nur als Zeile, zum
  // Ändern klappt der Stift das Formular auf.
  const [source, setSource] = useState<UpdateSource | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try { setVer(await api.settings.version(refresh)); } catch { /* */ }
    finally { setChecking(false); }
  }, []);

  const loadVersions = useCallback(async (refresh = false) => {
    setLoadingVersions(true);
    try {
      const res = await api.settings.updateVersions(refresh);
      setVersions(res.versions ?? []);
      setVersionsErr(res.error ?? '');
    } catch (err) {
      setVersions([]);
      setVersionsErr(err instanceof Error ? err.message : tt('Versionsliste konnte nicht geladen werden'));
    } finally { setLoadingVersions(false); }
  }, []);

  const loadSource = useCallback(async () => {
    try { setSource(await api.settings.updateSource()); } catch { /* nicht kritisch */ }
  }, []);

  // Beim Laden schnell (ohne git fetch), Button „Prüfen" holt den Remote-Stand frisch
  useEffect(() => { void check(false); void loadVersions(false); void loadSource(); }, [check, loadVersions, loadSource]);

  // Notizen zum gewählten Stand laden (auch für den Standard „neueste Version")
  const loadNotes = useCallback(async (ref: string) => {
    setNotesLoading(true); setNotesErr('');
    try {
      setNotes(await api.settings.updateNotes(ref));
    } catch (err) {
      setNotes(null);
      setNotesErr(err instanceof Error ? err.message : tt('Änderungen konnten nicht geladen werden'));
    } finally { setNotesLoading(false); }
  }, []);
  // Bei jedem Wechsel im Dropdown die passenden Notizen holen
  useEffect(() => { void loadNotes(targetRef); }, [targetRef, loadNotes]);

  const selected = versions.find((v) => v.ref === targetRef);
  const latestEntry = versions.find((v) => v.latest);
  const shown = selected ?? latestEntry;
  /** Vollständiger Text für den Hover-Tooltip (Titel + Beschreibung). */
  const hoverText = (subject: string, body: string) => [subject, body].filter(Boolean).join('\n\n');
  const dirLabel: Record<UpdateNotes['direction'], string> = {
    forward: tt('Neuer als der installierte Stand'),
    backward: tt('Älter – Rückrollen auf einen früheren Stand'),
    same: tt('Bereits installiert'),
    diverged: tt('Abweichender Verlauf'),
  };
  /** Label für einen Eintrag im Dropdown. */
  const versionLabel = (v: UpdateVersion) => {
    const date = v.date ? new Date(v.date).toLocaleDateString() : '';
    const parts = [
      v.latest ? tt('Neueste Version') : v.type === 'tag' ? `Tag ${v.ref}` : v.shortSha,
      v.version ? `v${v.version}` : '',
      date,
      v.current ? tt('(installiert)') : '',
    ].filter(Boolean);
    return `${parts.join(' · ')}${v.subject ? ` – ${v.subject.slice(0, 60)}` : ''}`;
  };
  const isRollback = !!selected && !selected.latest;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [updateLog]);

  // Nach dem Update den Dienst pollen, bis er wieder online ist (neuer Build läuft),
  // dann „fertig" melden und die laufende Version anzeigen.
  const pollForNewVersion = async (priorBuild?: string) => {
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          const h = await res.json().catch(() => null) as { version?: string } | null;
          const now = h?.version;
          if (now && priorBuild && now !== priorBuild) {
            setUpdateLog(l => [...l, `✓ Neue Version v${now} aktiv – lade Seite neu…`]);
            setTimeout(() => location.reload(), 1000);
            return;
          }
        }
      } catch { /* Dienst noch nicht erreichbar */ }
    }
  };

  const startUpdate = (ref = '') => {
    const question = ref && !versions.find((v) => v.ref === ref)?.latest
      ? tt('Wirklich auf den gewählten Stand wechseln? Der Dienst wird kurz neu gestartet.')
      : tt('Core-Hub jetzt aktualisieren? Der Dienst wird kurz neu gestartet.');
    if (!confirm(question)) return;
    setUpdating(true);
    setUpdateDone(false);
    setUpdateLog(['▶ Update gestartet…']);
    const priorBuild = ver?.current;
    let finished = false;

    /**
     * Abschluss des Update-Laufs.
     * `ok` kommt aus dem done-Ereignis des Servers; `null` heißt: die Verbindung
     * brach ab, ohne dass ein Ergebnis kam – das ist der Normalfall, wenn der
     * Dienst sich am Ende selbst neu startet.
     *
     * Wichtig: bei einem Fehlschlag darf hier NICHT „Installation abgeschlossen"
     * stehen. Vorher meldete die Oberfläche Erfolg, obwohl der Installer
     * abgebrochen hatte – die alte Version lief weiter und niemand verstand,
     * warum.
     */
    const onDone = (ok: boolean | null) => {
      if (finished) return;
      finished = true;
      setUpdating(false);
      setUpdateDone(true);
      if (ok === false) {
        setUpdateLog(l => [...l, '', tt('✗ Update fehlgeschlagen – die bisherige Version läuft weiter. Bitte das Protokoll oben lesen.')]);
        void check(false);
        void loadVersions(false);
        return;   // kein Warten auf eine neue Version – es kommt keine
      }
      setUpdateLog(l => [...l, '', ok === null
        ? tt('… Verbindung beendet – der Dienst startet vermutlich neu. Es wird geprüft, welche Version danach läuft.')
        : tt('✓ Installation abgeschlossen. Der Dienst wird neu gestartet…')]);
      void check(false);
      void loadVersions(false);
      void pollForNewVersion(priorBuild);
    };

    const es = new EventSource(`/api/settings/update/stream${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data) as { line: string };
        setUpdateLog(l => [...l, d.line]);
      } catch { /* */ }
    };
    es.addEventListener('done', (evt) => {
      let ok: boolean | null = null;
      try { ok = !!JSON.parse((evt as MessageEvent).data).ok; } catch { /* ohne Nutzdaten */ }
      es.close();
      onDone(ok);
    });
    es.onerror = () => { es.close(); onDone(null); };
  };

  return (
    <>
    <Panel title={tt('Version & Updates')} icon={<ArrowUpCircle size={15} />} subtitle={ver ? `v${ver.current}` : undefined} storageKey="set-version"
      actions={
        <button className="btn btn--outline btn--sm" disabled={checking} onClick={() => check(true)}>
          {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} {tt('Prüfen')}
        </button>
      }
    >
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{appName} v{ver?.current ?? '…'}</span>
          {ver && ver.updateAvailable && (
            <span className="badge badge--restarting" style={{ height: 26, padding: '0 12px' }}>
              <ArrowUpCircle size={13} /> Update verfügbar: {ver.latest}
            </span>
          )}
          {ver && !ver.updateAvailable && !ver.error && ver.latest && (
            <span className="badge badge--running" style={{ height: 26, padding: '0 12px' }}>
              <CheckCircle2 size={13} /> {tt('Aktuell')}
            </span>
          )}
        </div>

        {/* Woher kommen die Updates? Eine Zeile, zum Ändern der Stift oben. */}
        <div className="update-source-line">
          <GitBranch size={13} style={{ color: 'var(--color-faint)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-muted)' }}>{tt('Quelle')}:</span>
          <span className="dtable__mono" style={{ wordBreak: 'break-all' }}>
            {source?.url || source?.detectedUrl || tt('Repository des Checkouts')}
          </span>
          {(source?.branch || source?.detectedBranch) && (
            <>
              <span style={{ color: 'var(--color-faint)' }}>·</span>
              <span style={{ color: 'var(--color-muted)' }}>{tt('Branch')}:</span>
              <span className="dtable__mono">{source?.branch || source?.detectedBranch}</span>
            </>
          )}
          {source?.visibility === 'private' && (
            <span className="badge badge--paused"><span className="badge__dot" />{tt('privat')}</span>
          )}
          <button
            className="btn btn--outline btn--sm"
            style={{ marginLeft: 'auto' }}
            title={tt('Update-Quelle bearbeiten')}
            onClick={() => setSourceOpen((o) => !o)}
          >
            <Pencil size={12} /> {tt('Bearbeiten')}
          </button>
        </div>

        {sourceOpen && (
          <UpdateSourceForm
            onClose={() => setSourceOpen(false)}
            onChanged={(src) => {
              // Andere Quelle heißt andere Versionsliste – beides neu holen.
              setSource(src);
              void loadVersions(true);
              void check(true);
            }}
          />
        )}

        {ver?.error && <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 10 }}>Versionsprüfung: {ver.error}</div>}

        {ver?.updateAvailable && !updating && !updateDone && (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--color-warning)' }}>
            <div className="card-body">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Neue Version {ver.latest} verfügbar</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                Core-Hub automatisch aktualisieren: neuen Code holen, Abhängigkeiten installieren und Dienst neu starten.
                Deine Daten (Datenbank, Zertifikate) bleiben erhalten.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn--primary btn--sm" onClick={() => startUpdate()}>
                  <ArrowUpCircle size={13} /> Jetzt aktualisieren
                </button>
                {ver.releaseUrl && (
                  <a className="btn btn--outline btn--sm" href={ver.releaseUrl} target="_blank" rel="noreferrer">
                    Release-Notes ansehen
                  </a>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 8 }}>
                Manuell: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--color-surface-sunken)', padding: '1px 6px', borderRadius: 4 }}>{installCmd}</code>
              </div>
            </div>
          </div>
        )}

        {/* Versionsauswahl: standardmäßig die neueste Version, per Dropdown auch
            ein älterer Stand (Rollback auf ein vorheriges Update). */}
        {!updating && !updateDone && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <History size={14} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('Version auswählen')}</span>
                <button
                  className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }}
                  disabled={loadingVersions} onClick={() => void loadVersions(true)}
                  title={tt('Stände frisch vom Repository holen')}
                >
                  {loadingVersions ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />} {tt('Neu laden')}
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                {tt('Vorgeschlagen wird immer die neueste Version. Über die Liste lässt sich auch ein früherer Stand einspielen – etwa um ein Update zurückzurollen.')}
              </div>

              {versionsErr && (
                <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginBottom: 10 }}>{versionsErr}</div>
              )}

              {versions.length > 0 ? (
                <>
                  <select
                    className="input" style={{ width: '100%' }}
                    value={targetRef} onChange={(e) => setTargetRef(e.target.value)}
                  >
                    <option value="">
                      {latestEntry ? `${tt('Neueste Version')}${latestEntry.version ? ` (v${latestEntry.version})` : ''}` : tt('Neueste Version')}
                    </option>
                    {versions.filter((v) => !v.latest).map((v) => (
                      <option key={v.ref} value={v.ref} title={hoverText(v.subject, v.body)}>{versionLabel(v)}</option>
                    ))}
                  </select>

                  {/* Vorschau des gewählten Standes: Titel + Beschreibung.
                      Der vollständige Text steht im Tooltip (Hover) und im Popup. */}
                  {shown && (
                    <div
                      className="card" style={{ marginTop: 10, cursor: 'help' }}
                      title={hoverText(shown.subject, shown.body) || tt('Keine Beschreibung hinterlegt')}
                    >
                      <div className="card-body" style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <FileText size={13} style={{ color: 'var(--color-muted)' }} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{shown.subject || tt('Ohne Titel')}</span>
                          {shown.version && <span className="badge badge--paused" style={{ height: 20, padding: '0 8px' }}>v{shown.version}</span>}
                          <span className="dtable__mono">{shown.shortSha}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginBottom: shown.body ? 6 : 0 }}>
                          {[shown.author, shown.date ? new Date(shown.date).toLocaleString() : ''].filter(Boolean).join(' · ')}
                        </div>
                        {shown.body ? (
                          <div style={{
                            fontSize: 12.5, color: 'var(--color-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {shown.body}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>{tt('Keine ausführliche Beschreibung hinterlegt.')}</div>
                        )}
                        {notes && notes.direction !== 'same' && (
                          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 8 }}>
                            {tt('{c} Änderung(en) · {f} Datei(en) · +{a}/-{d} Zeilen', {
                              c: notes.commits.length + (notes.truncated ? '+' : ''),
                              f: notes.files.length + (notes.filesTruncated ? '+' : ''),
                              a: notes.insertions, d: notes.deletions,
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {notesErr && <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 8 }}>{notesErr}</div>}

                  {isRollback && (
                    <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 8 }}>
                      {tt('Achtung: Ein älterer Stand kann Funktionen entfernen. Deine Daten bleiben erhalten, die Datenbank wird aber nicht zurückgesetzt.')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button
                      className="btn btn--outline btn--sm"
                      disabled={notesLoading}
                      onClick={() => { setNotesOpen(true); void loadNotes(targetRef); }}
                      title={tt('Alle Änderungen dieses Standes ansehen')}
                    >
                      {notesLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <FileText size={13} />} {tt('Was ist neu?')}
                    </button>
                    <button
                      className={`btn btn--sm ${isRollback ? 'btn--outline' : 'btn--primary'}`}
                      disabled={!!selected?.current}
                      onClick={() => startUpdate(targetRef)}
                    >
                      {isRollback ? <History size={13} /> : <ArrowUpCircle size={13} />}
                      {isRollback ? tt('Auf diesen Stand wechseln') : tt('Auf neueste Version aktualisieren')}
                    </button>
                    {selected?.current && (
                      <span style={{ fontSize: 12, color: 'var(--color-muted)', alignSelf: 'center' }}>
                        {tt('Dieser Stand ist bereits installiert.')}
                      </span>
                    )}
                  </div>
                </>
              ) : !loadingVersions && !versionsErr ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>{tt('Keine Stände gefunden – „Neu laden" holt sie vom Repository.')}</div>
              ) : null}
            </div>
          </div>
        )}

        {(updating || updateDone) && updateLog.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div ref={logRef} style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>
              {updateLog.join('\n')}
              {updating && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginLeft: 6 }}>⟳</span>}
            </div>
            {updateDone && (
              <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => location.reload()}>
                <RotateCw size={13} /> Seite neu laden
              </button>
            )}
            {updating && (
              <button className="btn btn--outline btn--sm" style={{ marginTop: 10, marginLeft: 8 }} onClick={() => { setUpdating(false); setUpdateDone(true); }}>
                {tt('Abbrechen')}
              </button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 12 }}>
          Repository: {ver?.repo ?? '—'}
          {ver?.method && ver.method !== 'none' ? ` · Prüfung via ${ver.method === 'github' ? 'GitHub-Releases' : 'Git'}` : ''}
          {ver ? ` · zuletzt geprüft ${timeAgo(new Date(ver.checkedAt).getTime() / 1000)}` : ''}
        </div>
      </div>
    </Panel>

    {/* Popup „Was ist neu?": Titel, Beschreibung, alle Commits und geänderte
        Dateien des gewählten Standes – im Design der Seite (Panel-Karten,
        Badges, dtable). Der volle Text jedes Eintrags steht auch im Tooltip. */}
    <Modal
      open={notesOpen}
      title={tt('Änderungen dieser Version')}
      onClose={() => setNotesOpen(false)}
      width={780}
      footer={
        notes && notes.direction !== 'same' ? (
          <button
            className={`btn btn--sm ${notes.direction === 'backward' ? 'btn--outline' : 'btn--primary'}`}
            onClick={() => { setNotesOpen(false); startUpdate(targetRef); }}
          >
            {notes.direction === 'backward' ? <History size={13} /> : <ArrowUpCircle size={13} />}
            {notes.direction === 'backward' ? tt('Auf diesen Stand wechseln') : tt('Jetzt installieren')}
          </button>
        ) : undefined
      }
    >
      {notesLoading && !notes ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--color-muted)' }}>
          <span className="spinner" style={{ width: 14, height: 14 }} /> {tt('Lädt…')}
        </div>
      ) : notesErr ? (
        <div style={{ fontSize: 13, color: 'var(--color-warning)' }}>{notesErr}</div>
      ) : notes ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Kopf: Version, Stand, Richtung */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{notes.subject || tt('Ohne Titel')}</span>
              {notes.version && <span className="badge badge--paused" style={{ height: 22, padding: '0 9px' }}>v{notes.version}</span>}
              <span
                className={`badge badge--${notes.direction === 'backward' ? 'restarting' : notes.direction === 'same' ? 'running' : 'paused'}`}
                style={{ height: 22, padding: '0 9px' }}
              >
                {notes.direction === 'backward' ? <History size={12} /> : notes.direction === 'same' ? <CheckCircle2 size={12} /> : <ArrowUpCircle size={12} />}
                {dirLabel[notes.direction]}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6 }}>
              <span className="dtable__mono">{notes.shortSha}</span>
              {notes.author ? ` · ${notes.author}` : ''}
              {notes.date ? ` · ${new Date(notes.date).toLocaleString()}` : ''}
              {notes.currentVersion ? ` · ${tt('installiert: v{v}', { v: notes.currentVersion })}` : ''}
            </div>
          </div>

          {/* Beschreibung des Standes */}
          {notes.body && (
            <div className="card">
              <div className="card-body" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65 }}>
                {notes.body}
              </div>
            </div>
          )}

          {notes.direction === 'same' ? (
            <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
              {tt('Dieser Stand ist bereits installiert – es gibt keine Unterschiede.')}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge--stopped" style={{ height: 22, padding: '0 9px' }}>
                  <GitCommit size={12} /> {tt('{n} Änderung(en)', { n: `${notes.commits.length}${notes.truncated ? '+' : ''}` })}
                </span>
                <span className="badge badge--stopped" style={{ height: 22, padding: '0 9px' }}>
                  <FileText size={12} /> {tt('{n} Datei(en)', { n: `${notes.files.length}${notes.filesTruncated ? '+' : ''}` })}
                </span>
                <span className="badge badge--stopped" style={{ height: 22, padding: '0 9px' }}>
                  <span style={{ color: 'var(--color-success)' }}>+{notes.insertions}</span>
                  <span style={{ color: 'var(--color-error)' }}>−{notes.deletions}</span>
                </span>
              </div>

              {notes.direction === 'backward' && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--color-warning)' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{tt('Diese Änderungen werden beim Wechsel wieder entfernt.')}</span>
                </div>
              )}

              {/* Die einzelnen Änderungen mit vollem Text */}
              {notes.commits.length > 0 && (
                <div>
                  <div className="section-heading" style={{ marginBottom: 8 }}>
                    {notes.direction === 'backward' ? tt('Diese Änderungen entfallen') : tt('Diese Änderungen kommen dazu')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {notes.commits.map((c) => (
                      <div key={c.sha} className="card" title={hoverText(c.subject, c.body)}>
                        <div className="card-body" style={{ padding: '9px 12px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.subject}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 3 }}>
                            <span className="dtable__mono">{c.short}</span>
                            {c.author ? ` · ${c.author}` : ''}
                            {c.date ? ` · ${new Date(c.date).toLocaleDateString()}` : ''}
                          </div>
                          {c.body && (
                            <div style={{ fontSize: 12, color: 'var(--color-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 6, lineHeight: 1.6 }}>
                              {c.body}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {notes.truncated && (
                    <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6 }}>
                      {tt('Weitere Änderungen wurden aus Platzgründen nicht aufgelistet.')}
                    </div>
                  )}
                </div>
              )}

              {/* Geänderte Dateien */}
              {notes.files.length > 0 && (
                <div>
                  <div className="section-heading" style={{ marginBottom: 8 }}>{tt('Geänderte Dateien')}</div>
                  <div className="table-scroll">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>{tt('Datei')}</th>
                          <th className="dtable__num" style={{ width: 70 }}>+</th>
                          <th className="dtable__num" style={{ width: 70 }}>−</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notes.files.map((f) => (
                          <tr key={f.path}>
                            <td className="dtable__mono" style={{ wordBreak: 'break-all' }}>{f.path}</td>
                            <td className="dtable__num" style={{ color: 'var(--color-success)' }}>{f.added || ''}</td>
                            <td className="dtable__num" style={{ color: 'var(--color-error)' }}>{f.deleted || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {notes.filesTruncated && (
                    <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6 }}>
                      {tt('Weitere Dateien wurden aus Platzgründen nicht aufgelistet.')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </Modal>
    </>
  );
}
