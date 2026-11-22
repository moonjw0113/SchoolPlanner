// 로컬에서 웹앱을 띄우기 위한 정적 파일 서버.
// 데이터는 app.js가 Supabase(또는 브라우저 localStorage)에 저장하므로 서버 API는 없다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// 공개할 파일만 명시한다. (.git, CLAUDE.md, server.js 등은 내려주지 않는다)
const PUBLIC_FILES = {
  '/index.html': 'text/html; charset=utf-8',
  '/app.js': 'application/javascript; charset=utf-8',
  '/style.css': 'text/css; charset=utf-8',
  '/style-overrides.css': 'text/css; charset=utf-8'
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
  }
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return send(res, 400, 'text/plain; charset=utf-8', 'Bad request'); }
  if (pathname === '/') pathname = '/index.html';

  const type = PUBLIC_FILES[pathname];
  if (!type) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');

  fs.readFile(path.join(ROOT, pathname), (error, content) => {
    if (error) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    send(res, 200, type, req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT, () => console.log(`학교 플래너 서버: http://localhost:${PORT}`));
