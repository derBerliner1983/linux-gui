import crypto from 'node:crypto';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import './types';
import { auditQueries } from './db/index';
import { APP_VERSION } from './routes/settings';
import { authRoutes } from './routes/auth';
import { systemRoutes } from './routes/system';
import { settingsRoutes } from './routes/settings';
import { terminalRoutes } from './routes/terminal';
import { prefsRoutes } from './routes/prefs';
import { servicesRoutes } from './routes/services';
import { filesRoutes } from './routes/files';
import { antivirusRoutes } from './routes/antivirus';
import { sysUpdatesRoutes } from './routes/sysupdates';

// JWT_SECRET kommt im Produktivbetrieb aus der Env-Datei (install.sh erzeugt
// einen dauerhaften, starken Schlüssel). Fällt der weg, wird ein kryptografisch
// starker Zufallswert genutzt (statt des früheren schwachen Math.random).
const JWT_SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(48).toString('hex');
const PORT = parseInt(process.env.PORT ?? '4200');
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_DEV = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  // Hinter einem Reverse-Proxy (Caddy, Pangolin, nginx …) stehen die echte
  // Client-Adresse und das Protokoll in den X-Forwarded-*-Kopfzeilen.
  // Ohne trustProxy sieht der Server nur die Adresse des Proxys.
  trustProxy: true,
  logger: IS_DEV
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
});

async function main() {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
  await fastify.register(fastifyWebsocket);

  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  await fastify.register(fastifyCors, {
    origin: IS_DEV ? ['http://localhost:5173'] : false,
    credentials: true,
  });

  // Health check endpoint (no auth required – for monitoring tools)
  fastify.get('/health', async (_req, reply) => {
    reply.send({ ok: true, version: APP_VERSION, uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
  });

  await fastify.register(authRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(terminalRoutes);
  await fastify.register(prefsRoutes);
  await fastify.register(servicesRoutes);
  await fastify.register(filesRoutes);
  await fastify.register(antivirusRoutes);
  await fastify.register(sysUpdatesRoutes);

  const frontendDist = path.join(__dirname, '../../frontend/dist');
  const hasFrontend = fs.existsSync(path.join(frontendDist, 'index.html'));
  if (hasFrontend) {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    // SPA-Fallback NUR für echte Navigationsanfragen (HTML). Fehlende Assets
    // (/assets/*, *.js, *.css, /api/*) dürfen NICHT index.html zurückgeben –
    // sonst bekommt der Browser HTML als JS-Modul ("MIME type text/html") und
    // die Seite bleibt weiß. Stattdessen ein ehrlicher 404.
    fastify.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      const accepts = (req.headers['accept'] || '').includes('text/html');
      const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(url);

      // @fastify/static registriert mit wildcard:false beim Start eine Route je
      // vorhandener Datei. Wird die Oberfläche danach neu gebaut, haben die
      // Dateien neue Namen (Hash) und liefen bislang ins Leere – die Seite
      // blieb weiß, bis der Dienst neu startete. Deshalb hier noch einmal auf
      // der Platte nachsehen, bevor 404 gemeldet wird.
      if (req.method === 'GET' && !url.startsWith('/api/') && looksLikeFile) {
        const rel = decodeURIComponent(url.replace(/^\/+/, ''));
        const target = path.resolve(frontendDist, rel);
        // Kein Ausbruch aus dem dist-Verzeichnis (…/../../etc/passwd)
        if (target.startsWith(frontendDist + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) {
          reply.sendFile(rel);
          return;
        }
      }

      if (req.method !== 'GET' || url.startsWith('/api/') || url.startsWith('/assets/') || looksLikeFile || !accepts) {
        reply.status(404).send({ error: 'Not found', path: url });
        return;
      }
      reply.type('text/html').sendFile('index.html');
    });
  } else {
    // Ohne gebaute Oberfläche lieferte Fastify bisher nur ein 404-JSON – im
    // Browser sah das nach einer kaputten (schwarzen/leeren) Seite aus. Jetzt
    // sagt die Seite klar, was fehlt und wie es zu beheben ist.
    console.warn(`\n[!] Kein Frontend-Build gefunden (${path.join(frontendDist, 'index.html')}).`);
    console.warn('    Die Oberfläche kann nicht ausgeliefert werden – bitte install.sh erneut ausführen');
    console.warn('    oder im Ordner frontend/ "npm ci && npm run build" starten.\n');
    fastify.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/') || !(req.headers['accept'] || '').includes('text/html')) {
        reply.status(503).send({ error: 'Frontend-Build fehlt', path: url });
        return;
      }
      reply.status(503).type('text/html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Core-Hub – Oberfläche fehlt</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;
display:flex;align-items:center;justify-content:center;min-height:100vh}
main{max-width:36rem;padding:2rem;line-height:1.55}h1{font-size:1.25rem;margin:0 0 .75rem}
code{background:#222;padding:.15rem .4rem;border-radius:4px}
pre{background:#222;padding:.8rem;border-radius:6px;overflow:auto}</style></head>
<body><main>
<h1>Die Oberfläche wurde nicht gebaut</h1>
<p>Der Dienst läuft, aber es gibt keinen Frontend-Build unter
<code>${frontendDist}</code>. Deshalb bleibt die Seite leer.</p>
<p>So beheben:</p>
<pre>sudo bash install.sh --update

# oder von Hand:
cd ${path.join(frontendDist, '..')}
npm ci &amp;&amp; npm run build
sudo systemctl restart core-hub</pre>
<p>Bleibt es dabei, zeigt <code>journalctl -u core-hub -n 50</code> den Grund.</p>
</main></body></html>`);
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`\n⬡ Core-Hub läuft auf http://localhost:${PORT}${hasFrontend ? '' : '  (ohne Oberfläche – Frontend-Build fehlt)'}\n`);


  // Audit-log rotation – delete entries older than 90 days, runs daily
  const pruneAuditLog = () => {
    try {
      auditQueries.pruneOld.run();
    } catch { /* non-critical */ }
  };
  pruneAuditLog();
  setInterval(pruneAuditLog, 24 * 60 * 60 * 1000);




}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
