import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SlidersHorizontal, Info } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranding, DEFAULT_APP_NAME } from '../lib/branding';
import { VersionPanel } from '../components/settings/UpdatePanels';
import { tt } from '../lib/i18n';
import { formatUptime } from '../lib/utils';

type Msg = { type: 'ok' | 'err'; text: string } | null;

/** Allgemeine, für alle Benutzer geltende Einstellungen. */
function GeneralPanel() {
  const { user } = useAuth();
  const { appName, setAppName } = useBranding();
  const isAdmin = user?.role === 'admin';
  const [name, setName] = useState(appName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => { setName(appName); }, [appName]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.settings.updateApp(name.trim());
      setAppName(r.appName);
      setMsg({ type: 'ok', text: tt('Einstellungen gespeichert.') });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : tt('Fehler') });
    } finally { setBusy(false); }
  };

  return (
    <Panel title={tt('Allgemein')} icon={<SlidersHorizontal size={15} />} subtitle={tt('Gilt für alle Benutzer')} storageKey="set-general">
      <div style={{ maxWidth: 460, marginTop: 8 }}>
        {msg && (
          <div
            className="login-error"
            style={msg.type === 'ok'
              ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', marginBottom: 10 }
              : { marginBottom: 10 }}
          >
            {msg.text}
          </div>
        )}
        <div className="form-group">
          <label className="form-label">{tt('Name der Anwendung')}</label>
          <input
            className="input input--rect"
            value={name}
            maxLength={40}
            disabled={!isAdmin}
            placeholder={DEFAULT_APP_NAME}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isAdmin) void save(); }}
          />
          <div className="form-hint">
            {tt('Erscheint in der Seitenleiste, auf der Anmeldeseite und im Browser-Titel. Leer lassen = Standardname.')}
          </div>
        </div>
        {isAdmin ? (
          <button className="btn btn--primary btn--sm" onClick={save} disabled={busy} style={{ marginTop: 10 }}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null} {tt('Speichern')}
          </button>
        ) : (
          <div className="form-hint" style={{ marginTop: 10 }}>{tt('Nur Administratoren können diese Einstellung ändern.')}</div>
        )}
      </div>
    </Panel>
  );
}

interface Info {
  version: string; hostname: string; platform: string; dataDir: string; node: string; uptime: number;
}

/** Nur-Lese-Informationen zur laufenden Installation. */
function SystemInfoPanel() {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    api.settings.info().then(setInfo).catch(() => { /* */ });
  }, []);

  if (!info) return null;
  const rows: [string, string][] = [
    [tt('Version'), info.version],
    [tt('Hostname'), info.hostname],
    [tt('Plattform'), info.platform],
    [tt('Node.js'), info.node],
    [tt('Datenverzeichnis'), info.dataDir],
    [tt('Laufzeit'), formatUptime(info.uptime)],
  ];

  return (
    <Panel title={tt('System-Informationen')} icon={<Info size={15} />} storageKey="set-info">
      <div style={{ display: 'grid', gap: 6, marginTop: 8, maxWidth: 520 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, fontSize: 12.5, borderBottom: '1px solid var(--color-border)', padding: '6px 0' }}>
            <span style={{ color: 'var(--color-muted)', minWidth: 150 }}>{k}</span>
            <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Aus der Seitenleiste kommt man über /settings#updates direkt hierher,
  // wenn ein Update bereitsteht – dann dorthin scrollen statt oben zu landen.
  const { hash } = useLocation();
  const updatesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash !== '#updates') return;
    const t = setTimeout(() => updatesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => clearTimeout(t);
  }, [hash, isAdmin]);
  return (
    <>
      <Topbar title={tt('Einstellungen')} subtitle={tt('Globale Einstellungen der Anwendung')} />
      <main className="page">
        <div style={{ display: 'grid', gap: 14 }}>
          <GeneralPanel />
          {/* Version, Updates und die Quelle, aus der sie kommen – eine Kachel,
              nur für Administratoren (die Endpunkte verlangen ohnehin Admin). */}
          {isAdmin && (
            <div id="updates" ref={updatesRef} style={{ scrollMarginTop: 12 }}>
              <VersionPanel installCmd={'cd docker-gui\ngit pull\nsudo bash install.sh'} />
            </div>
          )}
          <SystemInfoPanel />
        </div>
      </main>
    </>
  );
}
