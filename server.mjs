import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(APP_DIR, 'public'));
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
const APPS_SCRIPT_ENDPOINT = String(process.env.APPS_SCRIPT_ENDPOINT || '').trim();
const MAX_REQUEST_BYTES = 1024 * 1024;

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

const NO_CACHE_FILES = new Set([
  'index.html',
  'service-worker.js',
  'manifest.webmanifest',
  'config.js'
]);

const COMPRESSIBLE_TYPES = [
  'text/',
  'application/json',
  'application/manifest+json',
  'application/xml',
  'image/svg+xml'
];

function isAllowedAppsScriptEndpoint(endpoint) {
  if (/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(endpoint)) return true;
  return process.env.NODE_ENV !== 'production'
    && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(endpoint);
}

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function safeResolve(requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const normalized = path.posix.normalize(decodedPath).replace(/^\/+/, '');
  const candidate = path.resolve(PUBLIC_DIR, normalized || 'index.html');

  if (candidate !== PUBLIC_DIR && !candidate.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return null;
  }

  return candidate;
}

async function findStaticFile(pathname, acceptsHtml) {
  let requestedPath = pathname;
  if (requestedPath.endsWith('/')) requestedPath += 'index.html';

  const resolved = safeResolve(requestedPath);
  if (!resolved) return null;

  try {
    const fileStat = await stat(resolved);
    if (fileStat.isFile()) return { filePath: resolved, fileStat };
  } catch {
    // Fallback para a aplicação de página única.
  }

  if (!acceptsHtml) return null;

  const fallback = path.join(PUBLIC_DIR, 'index.html');
  try {
    const fileStat = await stat(fallback);
    return fileStat.isFile() ? { filePath: fallback, fileStat } : null;
  } catch {
    return null;
  }
}

function getCacheControl(fileName) {
  if (NO_CACHE_FILES.has(fileName)) {
    return 'no-cache, no-store, must-revalidate';
  }

  if (/\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(fileName)) {
    return 'public, max-age=86400';
  }

  return 'public, max-age=3600, must-revalidate';
}

function canCompress(contentType, request, size) {
  const acceptsGzip = String(request.headers['accept-encoding'] || '').includes('gzip');
  return acceptsGzip
    && size >= 1024
    && COMPRESSIBLE_TYPES.some((prefix) => contentType.startsWith(prefix));
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      const error = new Error('A requisição excedeu o limite permitido.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function proxyCalculation(request, response) {
  if (!APPS_SCRIPT_ENDPOINT || !isAllowedAppsScriptEndpoint(APPS_SCRIPT_ENDPOINT)) {
    sendJson(response, 503, {
      success: false,
      message: 'A variável APPS_SCRIPT_ENDPOINT ainda não foi configurada no Cloud Run.'
    });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      sendJson(response, 400, { success: false, message: 'JSON inválido.' });
      return;
    }

    if (parsed?.action !== 'saveCalculation' || !parsed?.payload) {
      sendJson(response, 400, { success: false, message: 'Dados do cálculo inválidos.' });
      return;
    }

    const upstream = await fetch(APPS_SCRIPT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'User-Agent': 'AmazonBioEco-CloudRun/1.1'
      },
      body: JSON.stringify(parsed),
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });

    const upstreamText = await upstream.text();
    let upstreamData;
    try {
      upstreamData = JSON.parse(upstreamText);
    } catch {
      sendJson(response, 502, {
        success: false,
        message: 'O Apps Script retornou uma resposta inválida.'
      });
      return;
    }

    sendJson(response, upstream.ok && upstreamData?.success ? 200 : 502, upstreamData);
  } catch (error) {
    console.error('Falha na integração com Apps Script:', error);
    sendJson(response, Number(error?.statusCode) || 502, {
      success: false,
      message: error?.name === 'TimeoutError'
        ? 'O Google Apps Script demorou mais que o esperado para responder.'
        : String(error?.message || 'Falha ao acessar o Google Apps Script.').slice(0, 300)
    });
  }
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response);

  let url;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendJson(response, 400, { status: 'error', message: 'Requisição inválida.' });
    return;
  }

  if (url.pathname === '/healthz') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'calculadora-carbono-amazonbioeco',
      googleSheetsBackendConfigured: Boolean(APPS_SCRIPT_ENDPOINT)
    });
    return;
  }

  if (url.pathname === '/api/calculations') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { success: false, message: 'Método não permitido.' });
      return;
    }
    await proxyCalculation(request, response);
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    sendJson(response, 405, { status: 'error', message: 'Método não permitido.' });
    return;
  }

  const acceptsHtml = String(request.headers.accept || '').includes('text/html');
  const staticFile = await findStaticFile(url.pathname, acceptsHtml);

  if (!staticFile) {
    sendJson(response, 404, { status: 'error', message: 'Arquivo não encontrado.' });
    return;
  }

  const { filePath, fileStat } = staticFile;
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  const etag = `W/\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}\"`;

  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', getCacheControl(fileName));
  response.setHeader('ETag', etag);

  if (fileName === 'service-worker.js') {
    response.setHeader('Service-Worker-Allowed', '/');
  }

  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304);
    response.end();
    return;
  }

  if (request.method === 'HEAD') {
    response.setHeader('Content-Length', fileStat.size);
    response.writeHead(200);
    response.end();
    return;
  }

  try {
    let body = await readFile(filePath);

    if (canCompress(contentType, request, body.length)) {
      body = await gzipAsync(body, { level: 6 });
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Vary', 'Accept-Encoding');
    }

    response.setHeader('Content-Length', body.length);
    response.writeHead(200);
    response.end(body);
  } catch (error) {
    console.error('Falha ao servir arquivo estático:', error);
    if (!response.headersSent) {
      sendJson(response, 500, { status: 'error', message: 'Erro interno do servidor.' });
    } else {
      response.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Calculadora AmazonBioEco disponível em http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando servidor...`);
  server.close((error) => {
    if (error) {
      console.error('Falha ao encerrar servidor:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
