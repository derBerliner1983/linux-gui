import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PackageCheck, RefreshCw, ArrowUpCircle, Search, CheckCircle2, AlertTriangle, Terminal,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { tt } from '../lib/i18n';
import { timeAgo } from '../lib/utils';
import type { SysUpdates as SysUpdatesType } from '../lib/types';

/**
 * System-Updates: welche Pakete der Distribution eine neuere Fassung haben,
 * und einspielen – einzeln, ausgewählt oder alle.
 *
 * Das ist etwas anderes als das Update von Core-Hub selbst; das steht in den
 * Einstellungen unter „Version & Updates".
 */

export function SysUpdates() {
  const [data, setData] = useState<SysUpdatesType | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (still = false) => {
    if (!still) setLoading(true);
    try { setData(await api.sysupdates.status()); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') }); }
    finally { if (!still) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Während einer Installation mitlesen.
  const läuft = data?.job.running ?? false;
  useEffect(() => {
    if (läuft && !timer.current) timer.current = setInterval(() => void load(true), 2000);
    if (!läuft && timer.current) { clearInterval(timer.current); timer.current = null; }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [läuft, load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data?.job.log.length]);

  const suchen = async () => {
    setBusy('refresh'); setMsg(null);
    try {
      const r = await api.sysupdates.refresh();
      setData(r);
      setSelected(new Set());
      setMsg({
        type: 'ok',
        text: r.count === 0
          ? tt('Alles aktuell – keine Updates verfügbar.')
          : `${r.count} ${r.count === 1 ? tt('Update verfügbar.') : tt('Updates verfügbar.')}`,
      });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });
    } finally { setBusy(''); }
  };

  const einspielen = async (pakete: string[]) => {
    const frage = pakete.length === 0
      ? tt('Alle verfügbaren Updates einspielen?')
      : `${pakete.length === 1 ? tt('Dieses Paket aktualisieren?') : tt('Ausgewählte Pakete aktualisieren?')}\n\n${pakete.join(', ')}`;
    if (!confirm(frage)) return;
    setBusy('install'); setMsg(null);
    try {
      await api.sysupdates.install(pakete);
      await load(true);
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });
    } finally { setBusy(''); }
  };

  const gezeigt = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.packages ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [data, query]);

  const umschalten = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const job = data?.job;
  const arbeitet = busy === 'install' || job?.running;

  return (
    <>
      <Topbar
        title={tt('System-Updates')}
        subtitle={data?.manager ? `${data.manager} · ${data.count} ${tt('verfügbar')}` : undefined}
        onRefresh={() => void load()}
        refreshing={loading}
      />
      <main className="page">
        <div style={{ display: 'grid', gap: 14 }}>
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

          {loading && !data ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <span className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : !data?.supported ? (
            <Panel title={tt('System-Updates')} icon={<PackageCheck size={15} />}>
              <div className="form-hint" style={{ marginTop: 8 }}>
                {data?.error || tt('Auf diesem System wurde kein unterstützter Paketmanager gefunden (apt, pacman, dnf, zypper).')}
              </div>
            </Panel>
          ) : (
            <>
              <Panel
                title={tt('Pakete mit Update')}
                icon={<PackageCheck size={15} />}
                subtitle={data.checkedAt ? `${tt('geprüft')} ${timeAgo(new Date(data.checkedAt).getTime() / 1000)}` : undefined}
                storageKey="sys-updates"
                actions={
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn btn--outline btn--sm" disabled={!!arbeitet || busy === 'refresh'} onClick={suchen}>
                      {busy === 'refresh'
                        ? <span className="spinner" style={{ width: 12, height: 12 }} />
                        : <RefreshCw size={13} />} {tt('Nach Updates suchen')}
                    </button>
                    <button
                      className="btn btn--primary btn--sm"
                      disabled={!!arbeitet || data.count === 0}
                      onClick={() => void einspielen([])}
                    >
                      <ArrowUpCircle size={13} /> {tt('Alle aktualisieren')}
                    </button>
                  </div>
                }
              >
                <div style={{ marginTop: 8, display: 'grid', gap: 12 }}>
                  {data.error && <div className="login-error">{data.error}</div>}

                  {data.partialUnsafe && data.count > 0 && (
                    <div className="form-hint" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <AlertTriangle size={14} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 1 }} />
                      <span>
                        {tt('Auf Arch-Systemen sind Teil-Updates gefährlich: einzelne Pakete werden deshalb immer zusammen mit dem vollständigen Upgrade (pacman -Syu) eingespielt.')}
                      </span>
                    </div>
                  )}

                  {data.count === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success)', fontWeight: 600 }}>
                      <CheckCircle2 size={17} /> {tt('Alles aktuell – keine Updates verfügbar.')}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: '1 1 220px' }}>
                          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
                          <input
                            className="input input--rect"
                            placeholder={tt('Paket suchen…')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            style={{ paddingLeft: 28 }}
                          />
                        </div>
                        <button
                          className="btn btn--outline btn--sm"
                          disabled={!!arbeitet || selected.size === 0}
                          onClick={() => void einspielen([...selected])}
                        >
                          <ArrowUpCircle size={13} /> {tt('Ausgewählte aktualisieren')} ({selected.size})
                        </button>
                      </div>

                      <div className="table-scroll">
                        <table className="dtable">
                          <thead>
                            <tr>
                              <th style={{ width: 32 }}>
                                <input
                                  type="checkbox"
                                  checked={gezeigt.length > 0 && gezeigt.every((p) => selected.has(p.name))}
                                  onChange={(e) => setSelected(e.target.checked ? new Set(gezeigt.map((p) => p.name)) : new Set())}
                                  aria-label={tt('Alle auswählen')}
                                />
                              </th>
                              <th>{tt('Paket')}</th>
                              <th style={{ width: 160 }}>{tt('installiert')}</th>
                              <th style={{ width: 160 }}>{tt('verfügbar')}</th>
                              <th style={{ width: 110 }}>{tt('Aktion')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gezeigt.map((p) => (
                              <tr key={p.name}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selected.has(p.name)}
                                    onChange={() => umschalten(p.name)}
                                    aria-label={p.name}
                                  />
                                </td>
                                <td>
                                  <div className="dtable__mono" style={{ wordBreak: 'break-all', color: 'var(--color-fg)' }}>{p.name}</div>
                                  {p.source && <div style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{p.source}</div>}
                                </td>
                                <td className="dtable__mono">{p.current || '—'}</td>
                                <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{p.candidate}</td>
                                <td>
                                  <button
                                    className="btn btn--outline btn--sm"
                                    disabled={!!arbeitet}
                                    onClick={() => void einspielen([p.name])}
                                  >
                                    <ArrowUpCircle size={12} /> {tt('Update')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {gezeigt.length === 0 && <div className="form-hint">{tt('Kein Paket passt zur Suche.')}</div>}
                    </>
                  )}
                </div>
              </Panel>

              {/* Protokoll des laufenden bzw. letzten Laufs */}
              {job && (job.running || job.log.length > 1) && (
                <Panel
                  title={tt('Protokoll')}
                  icon={<Terminal size={15} />}
                  subtitle={job.running
                    ? tt('läuft…')
                    : job.ok === false ? tt('fehlgeschlagen') : tt('abgeschlossen')}
                  storageKey="sys-updates-log"
                >
                  <div style={{ marginTop: 8 }}>
                    {job.running && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-accent)', fontWeight: 600, marginBottom: 8 }}>
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                        {job.packages.length ? job.packages.join(', ') : tt('alle verfügbaren Updates')}
                        {' · '}{tt('bitte nicht neu starten')}
                      </div>
                    )}
                    <div
                      ref={logRef}
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
                        background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)',
                        borderRadius: 6, padding: '10px 12px', maxHeight: 340, overflowY: 'auto',
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      }}
                    >
                      {job.log.join('\n')}
                    </div>
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
