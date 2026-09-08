import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcess } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { safeExec, hasBinary, isRoot, describeExecError } from '../lib/privilege';
import { detectPM, type PkgManager } from '../lib/pkgmgr';
import { auditQueries } from '../db/index';

/**
 * System-Updates: welche installierten Programme des Servers haben eine neuere
 * Fassung, und wie spielt man sie ein – einzeln oder alle auf einmal.
 *
 * Das ist bewusst getrennt vom Update von Core-Hub selbst (Einstellungen →
 * Version & Updates): hier geht es um die Pakete der Distribution.
 *
 * Die Installation läuft als Hintergrundprozess mit mitlaufendem Protokoll.
 * Ein „Abbrechen" gibt es nicht: einen Paketmanager mitten im Schreiben zu
 * killen ist der zuverlässigste Weg, ein System zu zerlegen.
 */

export interface Upgradable {
  name: string;
  /** Installierte Fassung (leer, wenn der Paketmanager sie nicht nennt). */
  current: string;
  /** Verfügbare Fassung. */
  candidate: string;
  /** Paketquelle bzw. Repository, soweit bekannt. */
  source: string;
}

interface Job {
  running: boolean;
  /** Pakete des Laufs; leer = alles aktualisieren. */
  packages: string[];
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  /** null solange er läuft. */
  ok: boolean | null;
}

function emptyJob(): Job {
  return { running: false, packages: [], log: [], ok: null };
}

let job: Job = emptyJob();
let child: ChildProcess | null = null;

/** Zwischengespeicherte Liste, damit nicht jeder Seitenaufruf den PM bemüht. */
let cache: { list: Upgradable[]; at: string; error: string } | null = null;

/** Paketnamen wandern in eine Kommandozeile – nur harmlose Zeichen zulassen. */
const PKG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;

/**
 * Auf Arch ist `pacman -Qu` nur so gut wie die zuletzt gesyncte Datenbank.
 * `checkupdates` (pacman-contrib) prüft über eine Kopie und braucht kein Root –
 * deshalb wird es bevorzugt, wenn es da ist.
 */
function archCheckCmd(): string {
  return hasBinary('checkupdates')
    ? 'checkupdates 2>/dev/null'
    : 'pacman -Qu 2>/dev/null';
}

/** Liste der aktualisierbaren Pakete für den erkannten Paketmanager. */
export function listUpgradable(pm: PkgManager): { list: Upgradable[]; error: string } {
  const list: Upgradable[] = [];
  try {
    switch (pm) {
      case 'apt': {
        // „name/repo 1.2.3 amd64 [upgradable from: 1.2.2]"
        const out = safeExec('apt list --upgradable 2>/dev/null', 60000);
        for (const line of out.split('\n')) {
          const m = line.match(/^([^/\s]+)\/(\S+)\s+(\S+)\s+\S+\s*\[upgradable from:\s*([^\]]+)\]/);
          if (m) list.push({ name: m[1], source: m[2], candidate: m[3], current: m[4].trim() });
        }
        break;
      }
      case 'pacman': {
        // „name 1.2.3-1 -> 1.2.4-1"
        const out = safeExec(archCheckCmd(), 60000);
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\S+)\s+(\S+)\s+->\s+(\S+)$/);
          if (m) list.push({ name: m[1], current: m[2], candidate: m[3], source: '' });
        }
        break;
      }
      case 'dnf': {
        // check-update endet mit Code 100, wenn es Updates gibt – „|| true",
        // sonst schluckt safeExec die komplette Ausgabe.
        const out = safeExec('dnf -q check-update 2>/dev/null || true', 120000);
        for (const line of out.split('\n')) {
          const m = line.trim().match(/^(\S+)\.(\S+)\s+(\S+)\s+(\S+)$/);
          if (m && !/^(Obsoleting|Last metadata)/.test(line)) {
            list.push({ name: m[1], current: '', candidate: m[3], source: m[4] });
          }
        }
        break;
      }
      case 'zypper': {
        // „v | Repo | Name | aktuell | verfügbar | arch"
        const out = safeExec('zypper --quiet list-updates 2>/dev/null || true', 120000);
        for (const line of out.split('\n')) {
          const cols = line.split('|').map((c) => c.trim());
          if (cols.length >= 6 && cols[0] === 'v') {
            list.push({ name: cols[2], current: cols[3], candidate: cols[4], source: cols[1] });
          }
        }
        break;
      }
    }
  } catch (err: unknown) {
    return { list, error: describeExecError(err, 'Paketliste konnte nicht gelesen werden') };
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { list, error: '' };
}

/** Befehl, um die Paketquellen neu einzulesen. */
function refreshCmd(pm: PkgManager): string {
  switch (pm) {
    case 'apt': return 'apt-get update';
    // checkupdates synchronisiert selbst in eine eigene Datenbank; ohne das
    // Werkzeug bleibt nur -Sy (und danach sollte man auch wirklich -Su machen).
    case 'pacman': return hasBinary('checkupdates') ? '' : 'pacman -Sy';
    case 'dnf': return 'dnf -q check-update || true';
    case 'zypper': return 'zypper --non-interactive refresh';
  }
}

/** Befehl zum Einspielen – ohne Paketnamen heißt „alles aktualisieren". */
export function upgradeCmd(pm: PkgManager, pkgs: string[]): { bin: string; args: string[] } {
  const all = pkgs.length === 0;
  switch (pm) {
    case 'apt':
      return {
        bin: 'bash',
        args: ['-c', `DEBIAN_FRONTEND=noninteractive apt-get ${all ? 'upgrade -y' : `install -y --only-upgrade ${pkgs.join(' ')}`}`],
      };
    case 'pacman':
      // Immer -Syu: ein einzelnes -S nach einem -Sy ist auf Arch der klassische
      // Weg in ein kaputtes System (Teil-Upgrade). Einzelne Pakete werden
      // deshalb zusammen mit dem vollen Upgrade eingespielt.
      return { bin: 'pacman', args: ['-Syu', '--noconfirm', ...pkgs] };
    case 'dnf':
      return { bin: 'dnf', args: ['upgrade', '-y', ...pkgs] };
    case 'zypper':
      return { bin: 'zypper', args: ['--non-interactive', 'update', ...pkgs] };
  }
}

function startProcess(bin: string, args: string[]): ChildProcess {
  return isRoot ? spawn(bin, args) : spawn('sudo', ['-n', bin, ...args]);
}

export async function sysUpdatesRoutes(fastify: FastifyInstance) {
  const state = (pm: PkgManager | null) => ({
    manager: pm,
    supported: !!pm,
    packages: cache?.list ?? [],
    count: cache?.list.length ?? 0,
    checkedAt: cache?.at ?? '',
    error: cache?.error ?? '',
    // Auf Arch werden einzelne Pakete immer im vollen Upgrade mitgezogen.
    partialUnsafe: pm === 'pacman',
    job: { ...job, log: job.log.slice(-400) },
  });

  // ── Liste (aus dem Zwischenspeicher, sonst frisch) ──
  fastify.get('/api/sysupdates', { preHandler: requireAuth }, async (_req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.send({ ...state(null), error: 'Kein unterstützter Paketmanager gefunden.' });
    if (!cache) {
      const r = listUpgradable(pm);
      cache = { list: r.list, at: new Date().toISOString(), error: r.error };
    }
    reply.send(state(pm));
  });

  // ── Paketquellen neu einlesen und Liste erneuern ──
  fastify.post('/api/sysupdates/refresh', { preHandler: requireAdmin }, async (req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.status(503).send({ error: 'Kein unterstützter Paketmanager gefunden.' });
    if (job.running) return reply.status(409).send({ error: 'Es läuft gerade eine Installation.' });
    try {
      const cmd = refreshCmd(pm);
      if (cmd) {
        const { bin, args } = { bin: 'bash', args: ['-c', cmd] };
        const p = startProcess(bin, args);
        await new Promise<void>((resolve, reject) => {
          let err = '';
          p.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
          p.on('error', reject);
          p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `Exit-Code ${code}`))));
        });
      }
      const r = listUpgradable(pm);
      cache = { list: r.list, at: new Date().toISOString(), error: r.error };
      auditQueries.log.run(req.user.id, 'sysupdates.refresh', `${r.list.length} Updates`);
      reply.send(state(pm));
    } catch (err: unknown) {
      reply.status(500).send({ error: describeExecError(err, 'Aktualisieren der Paketquellen fehlgeschlagen') });
    }
  });

  // ── Updates einspielen (leere Liste = alles) ──
  fastify.post<{ Body: { packages?: string[] } }>(
    '/api/sysupdates/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.status(503).send({ error: 'Kein unterstützter Paketmanager gefunden.' });
      if (job.running) return reply.status(409).send({ error: 'Es läuft bereits eine Installation.' });

      const pkgs = (req.body?.packages ?? []).map((p) => String(p).trim()).filter(Boolean);
      const bad = pkgs.find((p) => !PKG_RE.test(p));
      if (bad) return reply.status(400).send({ error: `Ungültiger Paketname: ${bad}` });

      const { bin, args } = upgradeCmd(pm, pkgs);
      job = {
        running: true,
        packages: pkgs,
        log: [pkgs.length ? `→ ${pkgs.join(' ')}` : '→ alle verfügbaren Updates'],
        startedAt: new Date().toISOString(),
        ok: null,
      };

      try {
        child = startProcess(bin, args);
      } catch (err: unknown) {
        job = { ...job, running: false, ok: false, finishedAt: new Date().toISOString() };
        job.log.push(describeExecError(err));
        return reply.status(500).send({ error: job.log[job.log.length - 1] });
      }

      let rest = '';
      const onData = (data: Buffer) => {
        const lines = (rest + data.toString()).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          if (job.log.length < 4000) job.log.push(line.replace(/\r/g, ''));
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (e) => {
        job.running = false; job.ok = false; job.finishedAt = new Date().toISOString();
        job.log.push(e.message);
        child = null;
      });
      child.on('close', (code) => {
        job.running = false;
        job.ok = code === 0;
        job.finishedAt = new Date().toISOString();
        job.log.push('', code === 0 ? '✓ Fertig.' : `✗ Abgebrochen mit Exit-Code ${code}.`);
        child = null;
        // Nach dem Einspielen ist die alte Liste hinfällig.
        const r = listUpgradable(pm);
        cache = { list: r.list, at: new Date().toISOString(), error: r.error };
        auditQueries.log.run(
          req.user.id,
          'sysupdates.install',
          `${pkgs.length ? pkgs.join(' ') : 'alle'} → ${code === 0 ? 'ok' : `Exit ${code}`}`,
        );
      });

      reply.send({ ok: true, job: { ...job, log: job.log.slice(-400) } });
    },
  );
}
