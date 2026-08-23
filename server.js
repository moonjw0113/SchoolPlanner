const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'assessments.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readItems() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveItems(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('사진을 포함한 항목은 5MB 이하여야 합니다.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('잘못된 요청입니다.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/assessments' && req.method === 'GET') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(readItems()));
  }
  if (url.pathname === '/api/assessments' && req.method === 'POST') {
    try {
      const item = await parseBody(req);
      if (!item.title?.trim() || !item.date) throw new Error('제목과 날짜를 입력해 주세요.');
      const items = readItems();
      const record = {
        id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: item.title.trim(), date: item.date, period: item.period || '',
        subject: item.subject?.trim() || '기타', type: item.type || '과제',
        description: item.description?.trim() || '', image: item.image || '',
        completed: Boolean(item.completed), createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const index = items.findIndex(value => value.id === record.id);
      if (index === -1) items.push(record); else items[index] = record;
      saveItems(items);
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(record));
    } catch (error) { return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: error.message })); }
  }
  if (url.pathname.startsWith('/api/assessments/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    saveItems(readItems().filter(item => item.id !== id));
    return send(res, 204, 'text/plain; charset=utf-8', '');
  }
  if (req.method === 'GET') {
    const filePath = url.pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, url.pathname);
    if (!filePath.startsWith(ROOT)) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    const extension = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    fs.readFile(filePath, (error, content) => error ? send(res, 404, 'text/plain; charset=utf-8', 'Not found') : send(res, 200, types[extension] || 'application/octet-stream', content));
    return;
  }
  send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
});

server.listen(PORT, () => console.log(`학교 플래너 서버: http://localhost:${PORT}`));
