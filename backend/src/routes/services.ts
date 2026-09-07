import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, privShell, safeExec, hasBinary, describeExecError } from '../lib/privilege';
import { auditQueries } from '../db/index';

/**
 * Taskmanager: systemd-Dienste anzeigen, starten/stoppen und den Autostart
 * ein- und ausschalten – dazu eine Auswertung, was den Systemstart bremst.
 *
 * Alle verändernden Aufrufe laufen über `systemctl`, das in der sudoers-
 * Allowlist steht. Unit-Namen werden vorher streng geprüft: sie wandern in eine
 * Kommandozeile, ein „;" darin wäre eine Befehlsinjektion mit Root-Rechten.
 */

/** Erlaubter Unit-Name (auch Vorlagen wie „getty@tty1.service"). */
const UNIT_RE = /^[A-Za-z0-9@:._\\-]{1,128}\.(service|socket|timer|target|path|mount)$/;

export interface ServiceInfo {
  name: string;
  description: string;
  /** geladen / nicht gefunden / maskiert */
  load: string;
  /** active | inactive | failed | activating … */
  active: string;
  /** running | exited | dead … */
  sub: string;
  /** enabled | disabled | static | masked | generated | '' (unbekannt) */
  startup: string;
  /** true, wenn sich Autostart für diese Unit überhaupt umschalten lässt. */
  canToggleStartup: boolean;
}

/** Zeile von `systemctl list-units --plain --no-legend` zerlegen. */
function parseUnitLine(line: string): { name: string; load: string; active: string; sub: string; description: string } | null {
  // UNIT LOAD ACTIVE SUB DESCRIPTION – Beschreibung enthält Leerzeichen
  const m = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
  if (!m) return null;
  return { name: m[1], load: m[2], active: m[3], sub: m[4], description: m[5] ?? '' };
}

/** Alle Dienste einsammeln: laufende und auf der Platte vorhandene. */
export function listServices(): ServiceInfo[] {
  const byName = new Map<string, ServiceInfo>();

  // 1) Geladene Units (liefert Zustand und Beschreibung)
  const units = safeExec('systemctl list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null', 15000);
  for (const line of units.split('\n')) {
    if (!line.trim()) continue;
    const u = parseUnitLine(line);
    if (!u || !u.name.endsWith('.service')) continue;
    byName.set(u.name, {
      name: u.name, description: u.description, load: u.load, active: u.active, sub: u.sub,
      startup: '', canToggleStartup: false,
    });
  }

  // 2) Unit-Dateien (liefert den Autostart-Zustand, auch für nie gestartete Dienste)
  const files = safeExec('systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null', 15000);
  for (const line of files.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\S+)/);
    if (!m) continue;
    const [, name, state] = m;
    if (!name.endsWith('.service')) continue;
    const existing = byName.get(name);
    // „static" und „generated" lassen sich nicht ein-/ausschalten – das würde
    // sonst als Schalter angeboten, der nichts tut.
    const canToggle = state === 'enabled' || state === 'disabled';
    if (existing) {
      existing.startup = state;
      existing.canToggleStartup = canToggle;
    } else {
      byName.set(name, {
        name, description: '', load: 'not-loaded', active: 'inactive', sub: 'dead',
        startup: state, canToggleStartup: canToggle,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Sekundenwert aus Ausgaben wie „1.234s", „2min 3.4s", „850ms". */
function parseDuration(text: string): number {
  let total = 0;
  const min = text.match(/(\d+(?:\.\d+)?)min/);
  const sec = text.match(/(\d+(?:\.\d+)?)s(?!\w)/);
  const ms = text.match(/(\d+(?:\.\d+)?)ms/);
  if (min) total += parseFloat(min[1]) * 60;
  if (sec) total += parseFloat(sec[1]);
  if (ms) total += parseFloat(ms[1]) / 1000;
  return Math.round(total * 1000) / 1000;
}

export interface BootUnit {
  name: string;
  seconds: number;
  startup: string;
  /** Unit, die abgeschaltet werden muss, damit das beim Start wegfällt. */
  toggleUnit?: string;
  /** 'self' = die Unit selbst, 'trigger' = ein Timer/Socket, der sie anwirft. */
  toggleKind?: 'self' | 'trigger';
  /** Zustand dieser Unit: 'enabled' (kann aus) oder 'disabled' (kann wieder an). */
  toggleState?: 'enabled' | 'disabled';
  /** Erklärung, wenn sich nichts abschalten lässt. */
  note?: string;
}

/** Eigenschaften mehrerer Units in einem Aufruf holen. */
function showUnits(names: string[]): Map<string, { triggeredBy: string[]; state: string }> {
  const out = new Map<string, { triggeredBy: string[]; state: string }>();
  const safe = names.filter((n) => UNIT_RE.test(n));
  if (safe.length === 0) return out;
  // In Blöcken, damit die Kommandozeile nicht zu lang wird.
  for (let i = 0; i < safe.length; i += 40) {
    const chunk = safe.slice(i, i + 40).map((n) => JSON.stringify(n)).join(' ');
    const raw = safeExec(
      `systemctl show --no-pager --property=Id --property=TriggeredBy --property=UnitFileState -- ${chunk} 2>/dev/null`,
      15000,
    );
    for (const block of raw.split(/\n\s*\n/)) {
      const id = block.match(/^Id=(.+)$/m)?.[1]?.trim();
      if (!id) continue;
      const trig = block.match(/^TriggeredBy=(.*)$/m)?.[1]?.trim() ?? '';
      out.set(id, {
        triggeredBy: trig ? trig.split(/\s+/).filter(Boolean) : [],
        state: block.match(/^UnitFileState=(.*)$/m)?.[1]?.trim() ?? '',
      });
    }
  }
  return out;
}

/** Eingeschaltete Timer/Sockets/Paths, nach Namen. Läuft auch ohne laufendes systemd. */
function triggerStates(): Map<string, string> {
  const raw = safeExec('systemctl list-unit-files --type=timer,socket,path --no-legend --no-pager 2>/dev/null', 15000);
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\S+)/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** Kurze Erklärung, warum sich der Autostart einer Unit nicht umlegen lässt. */
function stateNote(state: string): string {
  switch (state) {
    case 'static': return 'fest eingebunden – wird von anderen Units angefordert';
    case 'masked': return 'gesperrt';
    case 'generated': return 'automatisch erzeugt (z. B. aus /etc/fstab)';
    case 'indirect': return 'wird nur mittelbar aktiviert';
    case 'transient': return 'nur zur Laufzeit erzeugt';
    case '': return 'kein Autostart-Zustand hinterlegt';
    default: return state;
  }
}

/** Wie lange dauert der Systemstart, und welche Dienste bremsen ihn? */
export function bootAnalysis(services: ServiceInfo[]) {
  const summary = safeExec('systemd-analyze 2>/dev/null', 15000).trim();
  const blameRaw = safeExec('systemd-analyze blame --no-pager 2>/dev/null', 20000);
  const startupOf = new Map(services.map((s) => [s.name, s.startup]));

  const units: BootUnit[] = [];
  for (const line of blameRaw.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\S+)$/);
    if (!m) continue;
    const seconds = parseDuration(m[1]);
    const name = m[2];
    if (!name || seconds <= 0) continue;
    units.push({ name, seconds, startup: startupOf.get(name) ?? '' });
  }
  units.sort((a, b) => b.seconds - a.seconds);

  // Zu jeder Bremse die Unit suchen, die man tatsächlich abschalten kann.
  // Viele langsame Dienste sind „static" und lassen sich selbst nicht
  // abschalten – angeworfen werden sie von einem Timer oder Socket, und der
  // ist ein- und ausschaltbar (z. B. apt-daily.service ⟵ apt-daily.timer).
  const top = units.slice(0, 40);
  const info = showUnits(top.map((u) => u.name));
  const triggers = showUnits([...new Set([...info.values()].flatMap((v) => v.triggeredBy))]);
  const trigState = triggerStates();
  for (const u of top) {
    const own = info.get(u.name);
    if (!u.startup && own?.state) u.startup = own.state;
    if (u.startup === 'enabled' || u.startup === 'disabled') {
      u.toggleUnit = u.name;
      u.toggleKind = 'self';
      u.toggleState = u.startup;
      continue;
    }
    // Zustand eines Auslösers – erst aus den Laufzeitdaten, sonst von der Platte.
    const stateOf = (t: string) => triggers.get(t)?.state || trigState.get(t) || '';
    const base = u.name.replace(/\.[^.]+$/, '');
    const candidates = [
      ...(own?.triggeredBy ?? []),
      // Notnagel, wenn systemd keine Laufzeitdaten liefert: gleichnamiger Auslöser.
      ...[`${base}.timer`, `${base}.socket`, `${base}.path`].filter((t) => trigState.has(t)),
    ];
    const trigger = candidates.find((t) => stateOf(t) === 'enabled')
      ?? candidates.find((t) => stateOf(t) === 'disabled');
    if (trigger) {
      u.toggleUnit = trigger;
      u.toggleKind = 'trigger';
      u.toggleState = stateOf(trigger) as 'enabled' | 'disabled';
    } else {
      u.note = stateNote(u.startup);
    }
  }

  // Gesamtdauer aus der Zusammenfassung („Startup finished in … = 12.345s")
  const totalMatch = summary.match(/=\s*([^\n]+)$/m);
  return {
    available: summary.length > 0 || units.length > 0,
    summary,
    totalSeconds: totalMatch ? parseDuration(totalMatch[1]) : 0,
    units: top,
  };
}

export async function servicesRoutes(fastify: FastifyInstance) {
  const systemdAvailable = () => hasBinary('systemctl');

  fastify.get('/api/services', { preHandler: requireAuth }, async (_req, reply) => {
    if (!systemdAvailable()) {
      return reply.send({ available: false, services: [], error: 'systemd (systemctl) ist auf diesem System nicht vorhanden.' });
    }
    reply.send({ available: true, services: listServices() });
  });

  // Startzeit-Analyse: was bremst den Systemstart?
  fastify.get('/api/services/boot', { preHandler: requireAuth }, async (_req, reply) => {
    if (!systemdAvailable()) return reply.send({ available: false, summary: '', totalSeconds: 0, units: [] });
    reply.send(bootAnalysis(listServices()));
  });

  // Protokoll eines Dienstes (die letzten Zeilen)
  fastify.get<{ Params: { name: string }; Querystring: { lines?: string } }>(
    '/api/services/:name/logs',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const name = req.params.name;
      if (!UNIT_RE.test(name)) return reply.status(400).send({ error: 'Ungültiger Dienstname' });
      const lines = Math.min(Math.max(parseInt(req.query.lines ?? '150', 10) || 150, 10), 1000);
      try {
        // journalctl darf auch ohne Root laufen, wenn der Dienst in der Gruppe
        // systemd-journal ist – deshalb erst direkt, dann mit erhöhten Rechten.
        const direct = safeExec(`journalctl -u ${JSON.stringify(name)} -n ${lines} --no-pager 2>/dev/null`, 20000);
        const out = direct.trim() ? direct : privShell(`journalctl -u ${JSON.stringify(name)} -n ${lines} --no-pager`, { timeout: 20000 });
        reply.send({ name, log: out });
      } catch (err: unknown) {
        reply.status(500).send({ error: describeExecError(err, 'Protokoll konnte nicht gelesen werden') });
      }
    },
  );

  // Starten, stoppen, neu starten, Autostart ein/aus
  const ACTIONS = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'] as const;
  type Action = (typeof ACTIONS)[number];

  fastify.post<{ Params: { name: string; action: string } }>(
    '/api/services/:name/:action',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { name, action } = req.params;
      if (!UNIT_RE.test(name)) return reply.status(400).send({ error: 'Ungültiger Dienstname' });
      if (!ACTIONS.includes(action as Action)) return reply.status(400).send({ error: 'Unbekannte Aktion' });

      // Den eigenen Dienst nicht aus der Oberfläche heraus abschalten – das
      // würde die Sitzung mitten im Klick beenden.
      if (/^core-hub\.service$/.test(name) && (action === 'stop' || action === 'disable')) {
        return reply.status(400).send({
          error: 'Core-Hub kann sich nicht selbst stoppen oder aus dem Autostart nehmen. Auf dem Server: systemctl stop core-hub',
        });
      }

      try {
        privExec(`systemctl ${action} ${JSON.stringify(name)}`, { timeout: 30000 });
        auditQueries.log.run(req.user.id, `service.${action}`, name);
        // Zustand nach der Aktion zurückgeben, damit die Oberfläche nicht raten muss
        const after = listServices().find((s) => s.name === name) ?? null;
        reply.send({ ok: true, service: after });
      } catch (err: unknown) {
        reply.status(500).send({ error: describeExecError(err, `„systemctl ${action}" fehlgeschlagen`) });
      }
    },
  );
}
