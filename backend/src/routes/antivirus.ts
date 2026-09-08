import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcess } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  safeExec, privExec, privShell, hasBinary, isRoot, describeExecError,
} from '../lib/privilege';
import { installLogical, detectPM, packageNames } from '../lib/pkgmgr';
import { auditQueries, appSettingsQueries } from '../db/index';

/**
 * Virenschutz auf Basis von ClamAV.
 *
 * Drei Dinge, die man erwartet und die es hier gibt:
 *  – der Wächter (clamav-daemon) und die Signatur-Updates (clamav-freshclam)
 *    lassen sich ein- und ausschalten,
 *  – ein Scan lässt sich starten UND wieder abbrechen,
 *  – während er läuft, sieht man, wo er gerade steht.
 *
 * Der Scan läuft als eigener Prozess im Hintergrund (nicht execSync – der
 * würde den Server für Stunden blockieren). Damit er sich auch abbrechen
 * lässt, bekommt er eine eigene Prozessgruppe: gestoppt wird die ganze Gruppe,
 * sonst überlebt clamscan das Beenden von „sudo“.
 */

export interface Infected { file: string; virus: string }

interface ScanState {
  running: boolean;
  /** Geprüfter Pfad. */
  path: string;
  /** clamscan (eigenständig) oder clamdscan (über den Wächter). */
  engine: string;
  startedAt?: string;
  finishedAt?: string;
  /** Anzahl bereits geprüfter Dateien. */
  scanned: number;
  /** Datei, die gerade geprüft wird. */
  current: string;
  infected: Infected[];
  /** true, wenn der Benutzer abgebrochen hat. */
  stopped: boolean;
  error?: string;
}

/** Frischer Ausgangszustand. Bewusst eine Funktion: `{ ...KONSTANTE }` kopiert
 *  nur flach – das Funde-Array wäre über alle Scans hinweg dasselbe und würde
 *  sich immer weiter füllen. */
function empty(): ScanState {
  return { running: false, path: '', engine: '', scanned: 0, current: '', infected: [], stopped: false };
}

let scan: ScanState = empty();
let child: ChildProcess | null = null;

/** Letztes Ergebnis überdauert einen Neustart des Dienstes. */
const LAST_KEY = 'antivirus.lastScan';

function rememberScan() {
  try {
    appSettingsQueries.set.run(LAST_KEY, JSON.stringify({ ...scan, running: false }));
  } catch { /* nicht kritisch */ }
}

function restoreScan() {
  try {
    const row = appSettingsQueries.get.get(LAST_KEY);
    if (row?.value) scan = { ...empty(), ...(JSON.parse(row.value) as ScanState), running: false };
  } catch { /* nicht kritisch */ }
}
restoreScan();

// ── Dienstnamen: je nach Distribution anders ────────────────────────────────
// Debian/Ubuntu: clamav-daemon + clamav-freshclam, Fedora: clamd@scan,
// Arch: clamav-daemon. Deshalb wird gesucht, statt zu raten.
const DAEMON_UNITS = ['clamav-daemon', 'clamd@scan', 'clamd', 'clamav-clamonacc'];
const FRESH_UNITS = ['clamav-freshclam', 'freshclam'];

let unitCache: { daemon: string; fresh: string } | null = null;

function findUnits(): { daemon: string; fresh: string } {
  if (unitCache) return unitCache;
  const files = safeExec('systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null', 15000);
  const known = new Set(
    files.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean).map((n) => n.replace(/\.service$/, '')),
  );
  unitCache = {
    daemon: DAEMON_UNITS.find((u) => known.has(u)) ?? DAEMON_UNITS[0],
    fresh: FRESH_UNITS.find((u) => known.has(u)) ?? FRESH_UNITS[0],
  };
  return unitCache;
}

function unitState(unit: string) {
  return {
    active: safeExec(`systemctl is-active ${JSON.stringify(unit)} 2>/dev/null`).trim() === 'active',
    enabled: safeExec(`systemctl is-enabled ${JSON.stringify(unit)} 2>/dev/null`).trim() === 'enabled',
  };
}

/** Alter der Signaturen in Tagen (null = keine gefunden). */
function defsAgeDays(): number | null {
  const ts = safeExec(
    'stat -c %Y /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld 2>/dev/null | sort -n | tail -1',
  ).trim();
  if (!ts) return null;
  return Math.floor((Date.now() / 1000 - parseInt(ts, 10)) / 86400);
}

function status() {
  const installed = hasBinary('clamscan') || hasBinary('clamdscan');
  const units = findUnits();
  const daemon = installed ? unitState(units.daemon) : { active: false, enabled: false };
  const fresh = installed ? unitState(units.fresh) : { active: false, enabled: false };
  const version = installed
    ? (safeExec('clamscan --version 2>/dev/null').trim().split('/')[0] || 'ClamAV')
    : '';
  return {
    installed,
    version,
    daemonUnit: units.daemon,
    freshUnit: units.fresh,
    daemonActive: daemon.active,
    daemonEnabled: daemon.enabled,
    freshActive: fresh.active,
    freshEnabled: fresh.enabled,
    defsAgeDays: defsAgeDays(),
    packages: packageNames('clamav'),
    packageManager: detectPM(),
    canInstall: packageNames('clamav').length > 0,
  };
}

/** Nur absolute Pfade ohne Zeilenumbrüche – sie landen in einer Kommandozeile. */
function cleanPath(p: string): string | null {
  const s = (p ?? '').trim();
  if (!s.startsWith('/') || /[\n\r\0]/.test(s)) return null;
  return s;
}

/** Ordner, die nie gescannt werden – Kernel-Dateisysteme haben keine Dateien. */
const NEVER = ['/proc', '/sys', '/dev', '/run'];

function startProcess(bin: string, args: string[]): ChildProcess {
  // detached: eigene Prozessgruppe, damit „Stopp“ die ganze Kette erwischt.
  return isRoot
    ? spawn(bin, args, { detached: true })
    : spawn('sudo', ['-n', bin, ...args], { detached: true });
}

/** Laufenden Scan beenden – erst freundlich, nach 5 s hart. */
function stopScan(): boolean {
  if (!child?.pid) return false;
  const pid = child.pid;
  // Achtung: process.kill will „SIGTERM", die Shell dagegen „-TERM" – wer hier
  // dasselbe Wort für beides nimmt, bekommt ein stilles ERR_UNKNOWN_SIGNAL und
  // der Scan läuft munter weiter.
  const kill = (sig: 'TERM' | 'KILL') => {
    try {
      if (isRoot) process.kill(-pid, `SIG${sig}`);
      else privShell(`kill -${sig} -- -${pid} 2>/dev/null || true`, { timeout: 8000 });
    } catch { /* Prozess schon weg */ }
  };
  scan.stopped = true;
  kill('TERM');
  setTimeout(() => { if (scan.running) kill('KILL'); }, 5000);
  return true;
}

// Beim Beenden des Dienstes keinen verwaisten Scan zurücklassen.
process.on('exit', () => { if (child?.pid) stopScan(); });

export async function antivirusRoutes(fastify: FastifyInstance) {
  // ── Status ──
  fastify.get('/api/antivirus', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({
      ...status(),
      scan: { ...scan, infected: scan.infected.slice(0, 200), infectedCount: scan.infected.length },
    });
  });

  // ── ClamAV nachinstallieren ──
  fastify.post('/api/antivirus/install', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      installLogical('clamav', 600000);
      unitCache = null;
      auditQueries.log.run(req.user.id, 'antivirus.install', null);
      reply.send({ ok: true, ...status() });
    } catch (err: unknown) {
      reply.status(500).send({ error: describeExecError(err, 'Installation fehlgeschlagen') });
    }
  });

  // ── Wächter bzw. Signatur-Updates ein-/ausschalten ──
  fastify.post<{ Body: { service: 'daemon' | 'fresh'; enable: boolean } }>(
    '/api/antivirus/toggle',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const which = req.body?.service;
      if (which !== 'daemon' && which !== 'fresh') {
        return reply.status(400).send({ error: 'Unbekannter Dienst' });
      }
      const units = findUnits();
      const unit = which === 'daemon' ? units.daemon : units.fresh;
      const enable = !!req.body?.enable;
      try {
        // Der Wächter startet nicht ohne Signaturen – die also vorher holen.
        if (enable && which === 'daemon' && defsAgeDays() === null && hasBinary('freshclam')) {
          try { privExec('freshclam', { timeout: 600000 }); } catch { /* trotzdem versuchen */ }
        }
        privExec(`systemctl ${enable ? 'enable --now' : 'disable --now'} ${JSON.stringify(unit)}`, { timeout: 60000 });
        auditQueries.log.run(req.user.id, `antivirus.${which}`, enable ? 'an' : 'aus');
        reply.send({ ok: true, ...status() });
      } catch (err: unknown) {
        const detail = describeExecError(err, `„${unit}" ließ sich nicht umschalten`);
        reply.status(500).send({
          error: enable && defsAgeDays() === null
            ? `${detail}\nWahrscheinlich fehlen die Signaturen – erst „Signaturen aktualisieren".`
            : detail,
        });
      }
    },
  );

  // ── Signaturen aktualisieren (freshclam) ──
  fastify.post('/api/antivirus/update-defs', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('freshclam')) return reply.status(503).send({ error: 'freshclam ist nicht installiert.' });
    const unit = findUnits().fresh;
    const wasActive = unitState(unit).active;
    try {
      // Der Auto-Updater sperrt die Datenbank – für den Handlauf kurz anhalten.
      if (wasActive) { try { privExec(`systemctl stop ${JSON.stringify(unit)}`, { timeout: 20000 }); } catch { /* egal */ } }
      try {
        privExec('freshclam', { timeout: 900000 });
      } finally {
        if (wasActive) { try { privExec(`systemctl start ${JSON.stringify(unit)}`, { timeout: 20000 }); } catch { /* egal */ } }
      }
      auditQueries.log.run(req.user.id, 'antivirus.update-defs', null);
      reply.send({ ok: true, defsAgeDays: defsAgeDays() });
    } catch (err: unknown) {
      // freshclam meldet „up to date" als Fehlercode 1 – das ist kein Fehler.
      const out = describeExecError(err, 'Aktualisierung fehlgeschlagen');
      if (/up[- ]to[- ]date/i.test(out)) return reply.send({ ok: true, defsAgeDays: defsAgeDays(), note: out });
      reply.status(500).send({ error: out });
    }
  });

  // ── Scan starten ──
  fastify.post<{ Body: { path: string; exclude?: string } }>(
    '/api/antivirus/scan',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('clamscan') && !hasBinary('clamdscan')) {
        return reply.status(503).send({ error: 'ClamAV ist nicht installiert.' });
      }
      if (scan.running) return reply.status(409).send({ error: 'Es läuft bereits ein Scan.' });

      const target = cleanPath(req.body?.path ?? '');
      if (!target) return reply.status(400).send({ error: 'Bitte einen absoluten Pfad angeben (z. B. /home).' });

      const excludes = [
        ...NEVER,
        ...(req.body?.exclude ?? '').split(',').map((s) => cleanPath(s)).filter((s): s is string => !!s),
      ];

      // Der Wächter (clamdscan) ist deutlich schneller, kann aber keine Ordner
      // ausschließen – sobald der Benutzer welche angibt, also clamscan.
      const extra = excludes.length > NEVER.length;
      const useDaemon = hasBinary('clamdscan') && unitState(findUnits().daemon).active && !extra;
      const bin = useDaemon ? 'clamdscan' : 'clamscan';
      const args = useDaemon
        ? ['-m', '--fdpass', target]
        : ['-r', ...excludes.map((d) => `--exclude-dir=^${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), target];

      scan = {
        ...empty(),
        running: true,
        path: target,
        engine: bin,
        startedAt: new Date().toISOString(),
      };

      try {
        child = startProcess(bin, args);
      } catch (err: unknown) {
        scan = { ...scan, running: false, finishedAt: new Date().toISOString(), error: describeExecError(err) };
        return reply.status(500).send({ error: scan.error });
      }

      let rest = '';
      const onData = (data: Buffer) => {
        const lines = (rest + data.toString()).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          const found = line.match(/^(.*):\s+(.+)\s+FOUND$/);
          if (found) {
            if (scan.infected.length < 500) scan.infected.push({ file: found[1], virus: found[2] });
            scan.scanned++;
            scan.current = found[1];
            continue;
          }
          // „/pfad/datei: OK“ bzw. „: Empty file“ – daran hängt der Fortschritt.
          const done = line.match(/^(\/.*):\s+(OK|Empty file|Excluded|Symbolic link|Access denied.*|Can't open.*)$/);
          if (done) { scan.scanned++; scan.current = done[1]; continue; }
          const sum = line.match(/^Scanned files:\s+(\d+)/);
          if (sum) scan.scanned = Math.max(scan.scanned, parseInt(sum[1], 10));
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (e) => {
        scan.running = false;
        scan.finishedAt = new Date().toISOString();
        scan.error = e.message;
        child = null;
        rememberScan();
      });
      child.on('close', (code) => {
        scan.running = false;
        scan.current = '';
        scan.finishedAt = new Date().toISOString();
        // 0 = sauber, 1 = Funde, 2 = Fehler; nach Abbruch ist der Code egal.
        if (!scan.stopped && code === 2 && scan.infected.length === 0 && scan.scanned === 0) {
          scan.error = 'Der Scan wurde mit einem Fehler beendet (Exit-Code 2). Läuft der Wächter und sind Signaturen vorhanden?';
        }
        child = null;
        auditQueries.log.run(
          req.user.id,
          'antivirus.scan',
          `${scan.path}: ${scan.scanned} Dateien, ${scan.infected.length} Funde${scan.stopped ? ' (abgebrochen)' : ''}`,
        );
        rememberScan();
      });

      reply.send({ ok: true, scan: { ...scan, infectedCount: scan.infected.length } });
    },
  );

  // ── Scan abbrechen ──
  fastify.post('/api/antivirus/scan/stop', { preHandler: requireAdmin }, async (req, reply) => {
    if (!scan.running || !child) return reply.status(409).send({ error: 'Es läuft gerade kein Scan.' });
    const ok = stopScan();
    auditQueries.log.run(req.user.id, 'antivirus.scan.stop', scan.path);
    reply.send({ ok });
  });
}
