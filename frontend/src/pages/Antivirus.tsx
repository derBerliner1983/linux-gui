import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, ShieldOff, Bug, Download, RefreshCw, Play, Square, Search,
  CheckCircle2, AlertOctagon, Clock,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { tt } from '../lib/i18n';
import type { AntivirusStatus } from '../lib/types';

/**
 * Virenschutz: Wächter und Signatur-Updates ein- und ausschalten, einen Scan
 * starten und wieder abbrechen. Solange ein Scan läuft, wird der Zustand alle
 * zwei Sekunden nachgeladen.
 */

const ZIELE = ['/home', '/root', '/opt', '/srv', '/var/www', '/tmp', '/'];

/** Sekunden zwischen zwei Zeitstempeln als „3 min 20 s". */
function dauer(von?: string, bis?: string): string {
  if (!von) return '';
  const ms = (bis ? new Date(bis).getTime() : Date.now()) - new Date(von).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function zeit(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function Antivirus() {
  const [av, setAv] = useState<AntivirusStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [ziel, setZiel] = useState('/home');
  const [ausnahmen, setAusnahmen] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (still = false) => {
    if (!still) setLoading(true);
    try { setAv(await api.antivirus.status()); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') }); }
    finally { if (!still) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Während eines Scans regelmäßig nachsehen, wie weit er ist.
  const läuft = av?.scan.running ?? false;
  useEffect(() => {
    if (läuft && !timer.current) timer.current = setInterval(() => void load(true), 2000);
    if (!läuft && timer.current) { clearInterval(timer.current); timer.current = null; }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [läuft, load]);

  const tun = async (key: string, fn: () => Promise<unknown>, erfolg?: string) => {
    setBusy(key); setMsg(null);
    try {
      await fn();
      await load(true);
      if (erfolg) setMsg({ type: 'ok', text: erfolg });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });
    } finally { setBusy(''); }
  };

  const scanStarten = () => {
    if (!ziel.startsWith('/')) { setMsg({ type: 'err', text: tt('Bitte einen absoluten Pfad angeben (z. B. /home).') }); return; }
    void tun('scan', () => api.antivirus.scan(ziel, ausnahmen.trim() || undefined));
  };

  const scanStoppen = () => {
    if (!confirm(tt('Laufenden Scan wirklich abbrechen?'))) return;
    void tun('stop', () => api.antivirus.stop());
  };

  const s = av?.scan;
  const sauber = s && !s.running && s.finishedAt && s.infectedCount === 0 && !s.error;

  return (
    <>
      <Topbar
        title={tt('Virenschutz')}
        subtitle={av?.installed ? av.version : tt('ClamAV')}
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

          {loading && !av ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <span className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : !av?.installed ? (
            /* ── Noch nichts installiert ── */
            <Panel title={tt('Virenschutz')} icon={<Bug size={15} />}>
              <div style={{ marginTop: 8, display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 13 }}>
                  {tt('ClamAV ist ein quelloffener Virenscanner für Linux. Er ist auf diesem Server noch nicht installiert.')}
                </div>
                {av?.canInstall ? (
                  <>
                    <div>
                      <button
                        className="btn btn--primary btn--sm"
                        disabled={busy === 'install'}
                        onClick={() => void tun('install', api.antivirus.install, tt('ClamAV wurde installiert.'))}
                      >
                        {busy === 'install'
                          ? <><span className="spinner" style={{ width: 12, height: 12 }} /> {tt('Wird installiert…')}</>
                          : <><Download size={13} /> {tt('ClamAV installieren')}</>}
                      </button>
                    </div>
                    <div className="form-hint">
                      {tt('Installiert wird')}: <code className="dtable__mono">{av.packages.join(' ')}</code>
                      {' '}({av.packageManager}). {tt('Das dauert je nach Verbindung einige Minuten.')}
                    </div>
                  </>
                ) : (
                  <div className="form-hint">
                    {tt('Für diese Distribution ist kein Paket hinterlegt – bitte ClamAV von Hand installieren.')}
                  </div>
                )}
              </div>
            </Panel>
          ) : (
            <>
              {/* ── Schutz an/aus ── */}
              <Panel
                title={tt('Schutz')}
                icon={av.daemonActive ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
                subtitle={av.daemonActive ? tt('Wächter läuft') : tt('Wächter aus')}
                storageKey="av-status"
                actions={
                  <button
                    className="btn btn--outline btn--sm"
                    disabled={busy === 'defs'}
                    onClick={() => void tun('defs', api.antivirus.updateDefs, tt('Signaturen aktualisiert.'))}
                  >
                    {busy === 'defs'
                      ? <span className="spinner" style={{ width: 12, height: 12 }} />
                      : <RefreshCw size={13} />} {tt('Signaturen aktualisieren')}
                  </button>
                }
              >
                <div style={{ marginTop: 8, display: 'grid', gap: 14 }}>
                  <div className="av-toggle">
                    <Switch
                      checked={av.daemonActive}
                      disabled={busy === 'daemon'}
                      label={tt('Wächter')}
                      onChange={(v) => void tun('daemon', () => api.antivirus.toggle('daemon', v))}
                    />
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{tt('Wächter (Hintergrunddienst)')}</div>
                      <div className="form-hint" style={{ margin: 0 }}>
                        {tt('Hält die Signaturen im Speicher – Scans laufen damit deutlich schneller.')}
                        {' '}<span className="dtable__mono">{av.daemonUnit}</span>
                      </div>
                    </div>
                    <span className={`badge badge--${av.daemonActive ? 'running' : 'stopped'}`}>
                      <span className="badge__dot" />{av.daemonActive ? tt('an') : tt('aus')}
                    </span>
                    {busy === 'daemon' && <span className="spinner" style={{ width: 13, height: 13 }} />}
                  </div>

                  <div className="av-toggle">
                    <Switch
                      checked={av.freshActive}
                      disabled={busy === 'fresh'}
                      label={tt('Signatur-Updates')}
                      onChange={(v) => void tun('fresh', () => api.antivirus.toggle('fresh', v))}
                    />
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{tt('Signatur-Updates (automatisch)')}</div>
                      <div className="form-hint" style={{ margin: 0 }}>
                        {tt('Holt neue Virensignaturen selbstständig.')}
                        {' '}<span className="dtable__mono">{av.freshUnit}</span>
                      </div>
                    </div>
                    <span className={`badge badge--${av.freshActive ? 'running' : 'stopped'}`}>
                      <span className="badge__dot" />{av.freshActive ? tt('an') : tt('aus')}
                    </span>
                    {busy === 'fresh' && <span className="spinner" style={{ width: 13, height: 13 }} />}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <Clock size={13} style={{ color: 'var(--color-faint)' }} />
                    {tt('Signaturen')}:{' '}
                    <span style={{
                      fontWeight: 600,
                      color: av.defsAgeDays === null ? 'var(--color-warning)'
                        : av.defsAgeDays <= 7 ? 'var(--color-success)' : 'var(--color-warning)',
                    }}>
                      {av.defsAgeDays === null ? tt('keine vorhanden')
                        : av.defsAgeDays === 0 ? tt('von heute')
                          : `${av.defsAgeDays} ${tt('Tage alt')}`}
                    </span>
                  </div>

                  {av.defsAgeDays === null && (
                    <div className="form-hint" style={{ color: 'var(--color-warning)' }}>
                      {tt('Ohne Signaturen startet der Wächter nicht – bitte zuerst „Signaturen aktualisieren".')}
                    </div>
                  )}
                </div>
              </Panel>

              {/* ── Scan ── */}
              <Panel
                title={tt('Scan')}
                icon={<Search size={15} />}
                subtitle={s?.running ? tt('läuft…') : undefined}
                storageKey="av-scan"
              >
                <div style={{ marginTop: 8, display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input input--rect"
                      value={ziel}
                      onChange={(e) => setZiel(e.target.value)}
                      placeholder="/home"
                      disabled={s?.running}
                      style={{ flex: '1 1 220px', fontFamily: 'var(--font-mono)' }}
                    />
                    {s?.running ? (
                      <button className="btn btn--danger btn--sm" disabled={busy === 'stop'} onClick={scanStoppen}>
                        {busy === 'stop'
                          ? <span className="spinner" style={{ width: 12, height: 12 }} />
                          : <Square size={13} />} {tt('Scan stoppen')}
                      </button>
                    ) : (
                      <button className="btn btn--primary btn--sm" disabled={busy === 'scan'} onClick={scanStarten}>
                        {busy === 'scan'
                          ? <span className="spinner" style={{ width: 12, height: 12 }} />
                          : <Play size={13} />} {tt('Scan starten')}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {ZIELE.map((p) => (
                      <button
                        key={p}
                        className={`btn btn--sm ${ziel === p ? 'btn--primary' : 'btn--outline'}`}
                        disabled={s?.running}
                        onClick={() => setZiel(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">{tt('Ordner ausnehmen (optional, mehrere mit Komma)')}</label>
                    <input
                      className="input input--rect"
                      value={ausnahmen}
                      onChange={(e) => setAusnahmen(e.target.value)}
                      placeholder="/var/lib/docker, /home/dirk/Downloads"
                      disabled={s?.running}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                    />
                    <div className="form-hint">
                      {tt('/proc, /sys, /dev und /run werden immer übersprungen. Mit eigenen Ausnahmen läuft der Scan ohne Wächter und damit langsamer.')}
                    </div>
                  </div>

                  {/* Laufender Scan */}
                  {s?.running && (
                    <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
                      <div className="card-body" style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-accent)', fontWeight: 600 }}>
                          <span className="spinner" style={{ width: 14, height: 14 }} />
                          {tt('Prüfe')} {s.path} · {s.scanned} {tt('Dateien')} · {dauer(s.startedAt)}
                          {s.infectedCount > 0 && ` · ${s.infectedCount} ${s.infectedCount === 1 ? tt('Fund') : tt('Funde')}`}
                        </div>
                        {s.current && (
                          <div className="dtable__mono" style={{ wordBreak: 'break-all' }}>{s.current}</div>
                        )}
                        <div className="form-hint" style={{ margin: 0 }}>
                          {tt('Läuft mit')} <span className="dtable__mono">{s.engine}</span>. {tt('Ein Abbruch ist jederzeit möglich.')}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Ergebnis */}
                  {s && !s.running && s.finishedAt && (
                    <div className="card" style={{ borderColor: s.infectedCount > 0 ? 'var(--color-error)' : undefined }}>
                      <div className="card-body" style={{ display: 'grid', gap: 8 }}>
                        {s.infectedCount > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error)', fontWeight: 700 }}>
                            <AlertOctagon size={17} /> {s.infectedCount} {s.infectedCount === 1 ? tt('Fund') : tt('Funde')}
                          </div>
                        ) : sauber ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success)', fontWeight: 600 }}>
                            <CheckCircle2 size={17} /> {tt('Nichts gefunden – sauber.')}
                          </div>
                        ) : null}

                        <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                          {s.stopped && <><strong>{tt('Abgebrochen.')}</strong>{' '}</>}
                          {s.path} · {s.scanned} {tt('Dateien')} · {dauer(s.startedAt, s.finishedAt)} · {zeit(s.finishedAt)}
                        </div>

                        {s.error && <div className="login-error" style={{ margin: 0 }}>{s.error}</div>}

                        {s.infectedCount > 0 && (
                          <div className="table-scroll">
                            <table className="dtable">
                              <thead><tr><th>{tt('Datei')}</th><th style={{ width: 220 }}>{tt('Bedrohung')}</th></tr></thead>
                              <tbody>
                                {s.infected.map((i, idx) => (
                                  <tr key={`${i.file}-${idx}`}>
                                    <td className="dtable__mono" style={{ wordBreak: 'break-all' }}>{i.file}</td>
                                    <td style={{ color: 'var(--color-error)', fontWeight: 600 }}>{i.virus}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {s.infectedCount > 0 && (
                          <div className="form-hint" style={{ margin: 0 }}>
                            {tt('Gefundene Dateien werden nicht automatisch gelöscht. Prüfe sie im Datei-Manager und entferne sie erst, wenn du sicher bist.')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </>
          )}
        </div>
      </main>
    </>
  );
}
