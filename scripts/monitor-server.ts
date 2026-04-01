/**
 * LottoPilot 数据监控 - Web 界面
 * 运行: npm run monitor:ui
 * 浏览器打开 http://localhost:3333
 */
import * as http from 'http';
import { fetchLatestDates, runUpdate, LOTTERY_LABELS, type Status } from './monitor-core';

const PORT = parseInt(process.env.MONITOR_PORT || '3333', 10);

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LottoPilot 数据监控</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    h1 { font-size: 1.5rem; margin: 0 0 24px; color: #f8fafc; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid #334155;
    }
    .card.stale { border-color: #f59e0b; background: #422006; }
    .card .name { font-weight: 600; margin-bottom: 4px; }
    .card .date { font-size: 0.9rem; color: #94a3b8; }
    .card .days { font-size: 0.85rem; color: #64748b; }
    .card .exp { font-size: 0.8rem; color: #94a3b8; margin-top: 4px; }
    .card .badge { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; }
    .card .badge.ok { background: #065f46; color: #6ee7b7; }
    .card .badge.warn { background: #92400e; color: #fcd34d; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; align-items: center; }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-check { background: #3b82f6; color: white; }
    .btn-update { background: #10b981; color: white; }
    .btn-update:disabled { background: #64748b; }
    .btn-loop { background: #334155; color: #e2e8f0; }
    .btn-loop.on { background: #14532d; color: #bbf7d0; border: 1px solid #22c55e; }
    .log {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      font-family: monospace;
      font-size: 0.85rem;
      max-height: 200px;
      overflow-y: auto;
      margin-top: 16px;
    }
    .log .err { color: #f87171; }
    .log .ok { color: #6ee7b7; }
  </style>
</head>
<body>
  <h1>LottoPilot 数据监控</h1>
  <p style="font-size:13px;color:#64748b;margin:0 0 16px;">自动检查：每日 0:00；开启「自动更新」时届时先抓取再刷新</p>
  <div class="actions">
    <button class="btn-check" id="btnCheck" onclick="check()">检查状态</button>
    <button class="btn-update" id="btnUpdate" onclick="update()">更新数据库</button>
    <button type="button" class="btn-loop" id="btnLoop" onclick="toggleAutoUpdate()">自动更新：关</button>
  </div>
  <div class="grid" id="grid"></div>
  <div class="log" id="log"></div>
  <script>
    var STORAGE_AUTO = 'monitorAutoUpdateOnSchedule';
    function getAutoUpdate() {
      try { return localStorage.getItem(STORAGE_AUTO) === 'true'; } catch (e) { return false; }
    }
    function setAutoUpdate(v) {
      try { localStorage.setItem(STORAGE_AUTO, v ? 'true' : 'false'); } catch (e) {}
      var el = document.getElementById('btnLoop');
      if (el) {
        el.textContent = v ? '自动更新：开' : '自动更新：关';
        el.classList.toggle('on', v);
      }
    }
    function toggleAutoUpdate() {
      var on = !getAutoUpdate();
      setAutoUpdate(on);
      log(on ? '已开启：每日 0:00 将自动更新数据库' : '已关闭：每日 0:00 仅检查状态');
    }
    function log(msg, isErr) {
      const el = document.getElementById('log');
      const line = document.createElement('div');
      line.className = isErr ? 'err' : 'ok';
      line.textContent = new Date().toLocaleTimeString('zh-CN') + ' ' + msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
    function render(status) {
      const grid = document.getElementById('grid');
      grid.innerHTML = status.map(s => {
        const label = ${JSON.stringify(LOTTERY_LABELS)};
        const name = label[s.lottery_id] || s.lottery_id;
        const date = s.latest_date || '-';
        const days = s.days_ago != null ? s.days_ago + ' 天前' : '-';
        const exp = s.expected_latest ? '<div class="exp">应有≥ ' + s.expected_latest + '</div>' : '';
        const badge = s.stale ? '<span class="badge warn">需更新</span>' : '<span class="badge ok">正常</span>';
        return '<div class="card' + (s.stale ? ' stale' : '') + '">' +
          '<div class="name">' + name + '</div>' +
          '<div class="date">' + date + '</div>' +
          '<div class="days">' + days + '</div>' + exp + badge + '</div>';
      }).join('');
    }
    async function check() {
      try {
        const r = await fetch('/api/status');
        const data = await r.json();
        render(data.status);
        log('检查完成');
      } catch (e) {
        log('检查失败: ' + e.message, true);
      }
    }
    async function update() {
      const btn = document.getElementById('btnUpdate');
      const btnCheck = document.getElementById('btnCheck');
      btn.disabled = true;
      if (btnCheck) btnCheck.disabled = true;
      log('正在更新...');
      try {
        const r = await fetch('/api/update', { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        log('更新完成');
        await check();
      } catch (e) {
        log('更新失败: ' + e.message, true);
      }
      btn.disabled = false;
      if (btnCheck) btnCheck.disabled = false;
    }
    function scheduleNextMidnight() {
      const now = new Date();
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      const delay = Math.max(60000, next.getTime() - now.getTime());
      setTimeout(async function () {
        try {
          if (getAutoUpdate()) {
            log('定时任务：自动更新数据库...');
            const r = await fetch('/api/update', { method: 'POST' });
            if (!r.ok) throw new Error(await r.text());
            log('定时任务：更新完成');
            await check();
          } else {
            await check();
          }
        } catch (e) {
          log('定时任务失败: ' + e.message, true);
        }
        scheduleNextMidnight();
      }, delay);
    }
    setAutoUpdate(getAutoUpdate());
    check();
    scheduleNextMidnight();
  </script>
</body>
</html>`;

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (url === '/api/status') {
    fetchLatestDates()
      .then((status) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status }));
      })
      .catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message) }));
      });
    return;
  }
  if (url === '/api/update' && req.method === 'POST') {
    runUpdate()
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((e) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(e.message));
      });
    return;
  }
  res.writeHead(404);
  res.end();
}

const server = http.createServer(serve);

server.listen(PORT, () => {
  console.log(`\nLottoPilot 数据监控 Web 界面`);
  console.log(`打开浏览器访问: http://localhost:${PORT}\n`);
});
