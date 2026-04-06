const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DOC_FILE = path.join(DATA_DIR, 'document.txt');
const COMMITS_FILE = path.join(DATA_DIR, 'commits.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_PASSWORD = 'wnsdud5999@';
const PASSWORD_SALT = process.env.PASSWORD_SALT || 'editor-static-salt-change-me';
const configuredHash = process.env.EDITOR_PASSWORD_HASH || '';
const sessionSecret = process.env.SESSION_SECRET || 'replace-this-with-a-long-random-string';

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function derivePasswordHash(plainPassword) {
  return sha256(`${PASSWORD_SALT}:${plainPassword}`);
}

const effectivePasswordHash = configuredHash || derivePasswordHash(DEFAULT_PASSWORD);

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DOC_FILE)) {
    fs.writeFileSync(DOC_FILE, 'Welcome!\\n\\nThis is a shared document. Press "Commit changes" to publish your edits.\\n');
  }
  if (!fs.existsSync(COMMITS_FILE)) {
    fs.writeFileSync(
      COMMITS_FILE,
      JSON.stringify(
        [{ id: crypto.randomUUID(), ts: new Date().toISOString(), author: 'system', message: 'Initial document created' }],
        null,
        2
      )
    );
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    return acc;
  }, {});
}

function signSession(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function createSessionCookie() {
  const value = crypto.randomBytes(16).toString('hex');
  return `${value}.${signSession(value)}`;
}

function verifySessionCookie(cookieValue) {
  if (!cookieValue) return false;
  const [value, sig] = cookieValue.split('.');
  if (!value || !sig) return false;
  const expected = signSession(value);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isAuthorized(req) {
  const cookies = parseCookies(req);
  return verifySessionCookie(cookies.editor_session);
}

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function readDocument() {
  return fs.readFileSync(DOC_FILE, 'utf8');
}

function readCommits() {
  return JSON.parse(fs.readFileSync(COMMITS_FILE, 'utf8'));
}

function appendCommit(author, message) {
  const commits = readCommits();
  const commit = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    author: author || 'anonymous',
    message: message || 'Updated shared document'
  };
  commits.push(commit);
  fs.writeFileSync(COMMITS_FILE, JSON.stringify(commits.slice(-100), null, 2));
  return commit;
}

function mimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const absolute = path.join(PUBLIC_DIR, safePath);

  if (!absolute.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': mimeType(absolute) });
  fs.createReadStream(absolute).pipe(res);
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const supplied = typeof body.password === 'string' ? body.password : '';
      const ok = derivePasswordHash(supplied) === effectivePasswordHash;
      if (!ok) return json(res, 401, { ok: false, error: 'Wrong password' });

      const token = createSessionCookie();
      return json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': `editor_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` }
      );
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'editor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (req.method === 'GET' && pathname === '/api/document') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
      return json(res, 200, { content: readDocument(), commits: readCommits().slice(-20).reverse() });
    }

    if (req.method === 'POST' && pathname === '/api/commit') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });

      const body = await readBody(req);
      if (typeof body.content !== 'string') return json(res, 400, { error: 'content is required' });

      fs.writeFileSync(DOC_FILE, body.content, 'utf8');
      const commit = appendCommit(body.author, body.message);
      return json(res, 200, { ok: true, commit });
    }

    if (req.method === 'GET' && pathname === '/api/poll') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
      const clientHash = url.searchParams.get('hash') || '';
      const content = readDocument();
      const hash = sha256(content);
      if (clientHash === hash) return json(res, 200, { changed: false, hash });
      return json(res, 200, { changed: true, hash, content, commits: readCommits().slice(-20).reverse() });
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Shared editor running at http://localhost:${PORT}`);
});
