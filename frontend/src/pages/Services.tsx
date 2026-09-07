import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Square, RotateCw, Power, PowerOff, ScrollText, Search, Gauge, ListTree, Zap,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { tt } from '../lib/i18n';
import type { ServiceInfo, ServiceAction, BootAnalysis } from '../lib/types';

/**
 * Taskmanager: Dienste starten und stoppen, Autostart ein- und ausschalten,
 * und sehen, was den Systemstart bremst.
 */

type Filter = 'running' | 'autostart' | 'failed' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'running', label: 'Laufend' },
  { key: 'autostart', label: 'Im Autostart' },
  { key: 'failed', label: 'Fehlgeschlagen' },
  { key: 'all', label: 'Alle' },
];

function stateBadge(s: ServiceInfo) {
  if (s.active === 'failed') return <span className="badge badge--stopped"><span className="badge__dot" />{tt('fehlgeschlagen')}</span>;
  if (s.active === 'active') {
    return <span className="badge badge--running"><span className="badge__dot" />{s.sub === 'exited' ? tt('erledigt') : tt('läuft')}</span>;
  }
  if (s.active === 'activating' || s.active === 'deactivating') {
    return <span className="badge badge--restarting"><span className="badge__dot" />{tt('wechselt')}</span>;
  }
  return <span className="badge badge--paused"><span className="badge__dot" />{tt('gestoppt')}</span>;
}

/** Kurzer, verständlicher Text für den Autostart-Zustand. */
function startupText(s: ServiceInfo): string {
  switch (s.startup) {
    case 'enabled': return tt('Autostart an');
    case 'disabled': return tt('Autostart aus');
    case 'static': return tt('fest eingebunden');
    case 'masked': return tt('gesperrt');
    case 'generated': return tt('automatisch erzeugt');
    default: return s.startup || '—';
  }
}

/** Rückmeldung nach einer Aktion – als ganzer Satz statt „stop ausgeführt". */
const ACTION_DONE: Record<ServiceAction, string> = {
  start: 'gestartet',
  stop: 'gestoppt',
  restart: 'neu gestartet',
  reload: 'neu geladen',
  enable: 'in den Autostart aufgenommen',
  disable: 'aus dem Autostart entfernt',
};

/** Beschriftung des Umschalters in der Startanalyse. */
function toggleLabel(u: { toggleKind?: 'self' | 'trigger'; toggleUnit?: string }, an: boolean): string {
  if (u.toggleKind !== 'trigger') return an ? tt('Autostart an') : tt('Autostart aus');
  if (u.toggleUnit?.endsWith('.timer')) return an ? tt('Zeitplan an') : tt('Zeitplan aus');
  return an ? tt('Auslöser an') : tt('Auslöser aus');
}

const secs = (n: number) => (n >= 1 ? `${n.toFixed(1)} s` : `${Math.round(n * 1000)} ms`);

export function Services() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('running');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [boot, setBoot] = useState<BootAnalysis | null>(null);
  const [logFor, setLogFor] = useState<{ name: string; log: string } | null>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.services.list();
      setAvailable(r.available);
      setServices(r.services);
      setLoadError(r.error ?? '');
      // Läuft gar nichts (etwa in einem Container ohne systemd-Init), wäre die
      // Vorauswahl „Laufend" eine leere Liste – dann lieber alles zeigen.
      if (first.current) {
        first.current = false;
        if (r.services.length > 0 && !r.services.some((x) => x.active === 'active')) setFilter('all');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : tt('Fehler'));
    } finally { setLoading(false); }
  }, []);

  const loadBoot = useCallback(async () => {
    try { setBoot(await api.services.boot()); } catch { /* nicht kritisch */ }
  }, []);

  useEffect(() => { void load(); void loadBoot(); }, [load, loadBoot]);

  const act = async (name: string, action: ServiceAction) => {
    if (action === 'stop' || action === 'disable') {
      const what = action === 'stop' ? tt('stoppen') : tt('aus dem Autostart nehmen');
      if (!confirm(`„${name}" wirklich ${what}?`)) return;
    }
    setBusy(`${name}:${action}`); setMsg(null);
    try {
      const r = await api.services.action(name, action);
      if (r.service) {
        setServices((prev) => prev.map((s) => (s.name === name ? r.service! : s)));
      } else {
        await load();
      }
      setMsg({ type: 'ok', text: `„${name}" ${tt(ACTION_DONE[action])}.` });
      // Der Autostart-Wechsel verändert auch die Startanalyse.
      if (action === 'enable' || action === 'disable') void loadBoot();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });
    } finally { setBusy(''); }
  };

  const showLog = async (name: string) => {
    setLogFor({ name, log: tt('Wird geladen…') });
    try { setLogFor(await api.services.logs(name)); }
    catch (err) { setLogFor({ name, log: err instanceof Error ? err.message : tt('Fehler') }); }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      if (filter === 'running') return s.active === 'active';
      if (filter === 'autostart') return s.startup === 'enabled';
      if (filter === 'failed') return s.active === 'failed';
      return true;
    });
  }, [services, query, filter]);

  const counts = useMemo(() => ({
    running: services.filter((s) => s.active === 'active').length,
    autostart: services.filter((s) => s.startup === 'enabled').length,
    failed: services.filter((s) => s.active === 'failed').length,
    all: services.length,
  }), [services]);

  /** Die Bremsen beim Systemstart. */
  const slowStarters = useMemo(() => {
    if (!boot?.units) return [];
    const byName = new Map(services.map((s) => [s.name, s]));
    return boot.units
      .filter((u) => u.name.endsWith('.service'))
      .map((u) => ({ ...u, service: byName.get(u.name) }))
      .filter((u) => u.seconds >= 0.5)
      .slice(0, 12);
  }, [boot, services]);

  /** Wie viele der Bremsen lassen sich überhaupt abschalten? */
  const abschaltbar = slowStarters.filter((u) => u.toggleState === 'enabled').length;

  return (
    <>
      <Topbar
        title={tt('Taskmanager')}
        subtitle={tt('Dienste, Autostart und Systemstart')}
        onRefresh={() => { void load(); void loadBoot(); }}
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

          {!available && (
            <div className="card"><div className="card-body">{loadError || tt('systemd ist auf diesem System nicht vorhanden.')}</div></div>
          )}

          {/* ── Systemstart: Dauer und Bremsen ── */}
          {available && (
            <Panel
              title={tt('Systemstart')}
              icon={<Gauge size={15} />}
              subtitle={boot?.totalSeconds ? `${boot.totalSeconds.toFixed(1)} s` : undefined}
              storageKey="svc-boot"
            >
              <div style={{ marginTop: 8 }}>
                {!boot?.available ? (
                  <div className="form-hint">
                    {tt('Für die Startanalyse liefert systemd hier keine Daten (z. B. in einem Container).')}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>{boot.summary}</div>
                    {slowStarters.length === 0 ? (
                      <div className="form-hint">{tt('Kein Dienst braucht länger als eine halbe Sekunde – da ist nichts zu holen.')}</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                          <Zap size={13} style={{ verticalAlign: -2 }} /> {tt('Diese Dienste kosten beim Start am meisten Zeit. Was du nicht brauchst, kannst du hier abschalten – der Dienst bleibt installiert und lässt sich jederzeit von Hand starten. Wirksam wird das beim nächsten Systemstart.')}
                          {abschaltbar === 0 && (
                            <> {tt('Hier ist gerade nichts dabei, was sich abschalten ließe – die Übrigen gehören fest zum System.')}</>
                          )}
                        </div>
                        <div className="boot-list">
                          {slowStarters.map((u) => (
                            <div className="boot-row" key={u.name}>
                              <span
                                className="boot-row__time"
                                style={{ color: u.seconds >= 3 ? 'var(--color-warning)' : undefined }}
                              >
                                {secs(u.seconds)}
                              </span>
                              <span className="boot-row__name dtable__mono">{u.name}</span>
                              <span className="boot-row__action">
                                {u.toggleUnit ? (
                                  <>
                                    <button
                                      className="btn btn--outline btn--sm"
                                      disabled={busy.startsWith(`${u.toggleUnit}:`)}
                                      title={u.toggleKind === 'trigger'
                                        ? `${tt('Der Dienst wird von')} „${u.toggleUnit}" ${tt('angeworfen – dieser Auslöser wird umgeschaltet.')}`
                                        : tt('Beim Systemstart mitstarten oder nicht')}
                                      onClick={() => act(u.toggleUnit!, u.toggleState === 'disabled' ? 'enable' : 'disable')}
                                    >
                                      {u.toggleState === 'disabled'
                                        ? <><Power size={12} style={{ color: 'var(--color-success)' }} /> {toggleLabel(u, true)}</>
                                        : <><PowerOff size={12} /> {toggleLabel(u, false)}</>}
                                    </button>
                                    {u.toggleKind === 'trigger' && (
                                      <div className="dtable__mono" style={{ marginTop: 3, textAlign: 'right' }}>
                                        {tt('über')} {u.toggleUnit}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: 12 }}>
                                    {u.note ? tt(u.note) : u.service ? startupText(u.service) : '—'}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </Panel>
          )}

          {/* ── Dienste ── */}
          {available && (
            <Panel
              title={tt('Dienste')}
              icon={<ListTree size={15} />}
              subtitle={`${counts.running} ${tt('laufend')} · ${counts.autostart} ${tt('im Autostart')}${counts.failed ? ` · ${counts.failed} ${tt('fehlgeschlagen')}` : ''}`}
              storageKey="svc-list"
            >
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      className={`btn btn--sm ${filter === f.key ? 'btn--primary' : 'btn--outline'}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {tt(f.label)} <span style={{ opacity: 0.7 }}>({counts[f.key]})</span>
                    </button>
                  ))}
                  <div style={{ position: 'relative', marginLeft: 'auto', minWidth: 220 }}>
                    <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
                    <input
                      className="input input--rect"
                      placeholder={tt('Dienst suchen…')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      style={{ paddingLeft: 28 }}
                    />
                  </div>
                </div>

                {loading && services.length === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <span className="spinner" style={{ width: 20, height: 20 }} />
                  </div>
                ) : shown.length === 0 ? (
                  <div className="form-hint">{tt('Kein Dienst passt zur Auswahl.')}</div>
                ) : (
                  <div className="table-scroll">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>{tt('Dienst')}</th>
                          <th style={{ width: 120 }}>{tt('Zustand')}</th>
                          <th style={{ width: 150 }}>{tt('Autostart')}</th>
                          <th style={{ width: 230 }}>{tt('Aktionen')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((s) => {
                          const isBusy = busy.startsWith(`${s.name}:`);
                          const running = s.active === 'active';
                          return (
                            <tr key={s.name}>
                              <td>
                                <div className="dtable__mono" style={{ wordBreak: 'break-all' }}>{s.name}</div>
                                {s.description && (
                                  <div style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{s.description}</div>
                                )}
                              </td>
                              <td>{stateBadge(s)}</td>
                              <td>
                                {s.canToggleStartup ? (
                                  <button
                                    className={`btn btn--sm ${s.startup === 'enabled' ? 'btn--outline' : 'btn--outline'}`}
                                    disabled={isBusy}
                                    title={s.startup === 'enabled' ? tt('Beim Systemstart nicht mehr starten') : tt('Beim Systemstart mitstarten')}
                                    onClick={() => act(s.name, s.startup === 'enabled' ? 'disable' : 'enable')}
                                  >
                                    {s.startup === 'enabled'
                                      ? <><Power size={12} style={{ color: 'var(--color-success)' }} /> {tt('an')}</>
                                      : <><PowerOff size={12} /> {tt('aus')}</>}
                                  </button>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: 12 }}>{startupText(s)}</span>
                                )}
                              </td>
                              <td>
                                <div className="row-actions">
                                  {running ? (
                                    <button className="btn btn--outline btn--sm" disabled={isBusy} onClick={() => act(s.name, 'stop')} title={tt('Stoppen')}>
                                      <Square size={12} /> {tt('Stopp')}
                                    </button>
                                  ) : (
                                    <button className="btn btn--outline btn--sm" disabled={isBusy} onClick={() => act(s.name, 'start')} title={tt('Starten')}>
                                      <Play size={12} /> {tt('Start')}
                                    </button>
                                  )}
                                  <button className="btn btn--outline btn--sm" disabled={isBusy} onClick={() => act(s.name, 'restart')} title={tt('Neu starten')}>
                                    <RotateCw size={12} />
                                  </button>
                                  <button className="btn btn--outline btn--sm" onClick={() => showLog(s.name)} title={tt('Protokoll')}>
                                    <ScrollText size={12} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      </main>

      {logFor && (
        <Modal open title={`${tt('Protokoll')}: ${logFor.name}`} onClose={() => setLogFor(null)} width={900}>
          <pre style={{
            margin: 0, padding: 12, background: 'var(--color-surface-sunken)', borderRadius: 8,
            fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: '60vh', overflow: 'auto',
          }}>
            {logFor.log || tt('(leer)')}
          </pre>
        </Modal>
      )}
    </>
  );
}
