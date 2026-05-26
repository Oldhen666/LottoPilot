/**
 * LottoPilot 数据监控 - Web 界面
 * 运行: npm run monitor:ui
 * 浏览器打开 http://localhost:3333
 */
import * as http from 'http';
import { fetchLatestDates, runUpdate, LOTTERY_LABELS, type Status } from './monitor-core';

const PORT = parseInt(process.env.MONITOR_PORT || '3333', 10);

/** Background scrape state for Web UI (HTTP cannot block for 10+ min while npm run scrape runs). */
let scrapeBusy = false;
let scrapeLastError: string | null = null;
let scrapeLastFinishedAt: number | null = null;

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
    .card.addon-warn { border-color: #ea580c; background: #431407; }
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
  <p style="font-size:13px;color:#64748b;margin:0 0 16px;">「需更新」= 库中最新开奖日早于推算的<strong>应有</strong>日期（数据落后），不是程序坏了。点「更新数据库」会后台运行 <code>npm run scrape</code>，通常需<strong>数分钟</strong>，请看你运行本监控的<strong>终端窗口</strong>里的日志。自动检查：每日 0:00；开启「自动更新」时届时先抓取再刷新。</p>
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
        var bits = [];
        if (s.extra_ok !== null && s.extra_ok !== undefined) bits.push('EXTRA:' + (s.extra_ok ? '✓' : '缺'));
        if (s.encore_ok !== null && s.encore_ok !== undefined) bits.push('ENCORE:' + (s.encore_ok ? '✓' : '缺'));
        if (s.power_play_ok !== null && s.power_play_ok !== undefined) bits.push('PowerPlay:' + (s.power_play_ok ? '✓' : '缺'));
        if (s.mega_multiplier_ok !== null && s.mega_multiplier_ok !== undefined) bits.push('MegaMult:' + (s.mega_multiplier_ok ? '✓' : '缺'));
        const addon = bits.length ? '<div class="exp">' + bits.join(' · ') + '</div>' : '';
        const addonWarn = s.extra_ok === false || s.encore_ok === false || s.power_play_ok === false || s.mega_multiplier_ok === false;
        const badge = s.stale ? '<span class="badge warn">需更新</span>' : '<span class="badge ok">正常</span>';
        var cardCls = 'card' + (s.stale ? ' stale' : '') + (addonWarn ? ' addon-warn' : '');
        return '<div class="' + cardCls + '">' +
          '<div class="name">' + name + '</div>' +
          '<div class="date">' + date + '</div>' +
          '<div class="days">' + days + '</div>' + exp + addon + badge + '</div>';
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
    function pollScrapeUntilDone() {
      return new Promise(function (resolve, reject) {
        var n = 0;
        var maxN = 450;
        function tick() {
          n++;
          fetch('/api/scrape-status')
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!d.busy) resolve(d);
              else if (n >= maxN) resolve({ busy: false, lastError: null, timeout: true });
              else setTimeout(tick, 2000);
            })
            .catch(reject);
        }
        tick();
      });
    }
    async function update() {
      const btn = document.getElementById('btnUpdate');
      const btnCheck = document.getElementById('btnCheck');
      btn.disabled = true;
      if (btnCheck) btnCheck.disabled = true;
      log('正在请求更新…');
      function releaseBtns() {
        btn.disabled = false;
        if (btnCheck) btnCheck.disabled = false;
      }
      try {
        const r = await fetch('/api/update', { method: 'POST' });
        const text = await r.text();
        var j = {};
        try { j = JSON.parse(text); } catch (e) {}
        if (r.status === 409) {
          log(j.message || '已有抓取在运行，请稍候');
          releaseBtns();
          return;
        }
        if (r.status === 202 && j.started) {
          log('抓取已在后台运行（常需 1～10 分钟）。请看运行 monitor:ui 的终端里的 scrape 输出。');
          try {
            var d = await pollScrapeUntilDone();
            if (d.timeout) log('等待超时（15 分钟）。若终端仍在跑 scrape 请继续等待，完成后点「检查状态」。', true);
            else if (d.lastError) log('更新失败: ' + d.lastError, true);
            else {
              log('更新完成');
              await check();
            }
          } catch (e) {
            log('轮询失败: ' + e.message, true);
          }
          releaseBtns();
          return;
        }
        if (!r.ok) throw new Error(text || r.statusText);
        log('更新完成');
        await check();
      } catch (e) {
        log('更新失败: ' + e.message, true);
      }
      releaseBtns();
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
            const t = await r.text();
            var jj = {};
            try { jj = JSON.parse(t); } catch (e) {}
            if (r.status === 409) {
              log('定时任务：上次抓取仍在运行，跳过');
            } else if (r.status === 202 && jj.started) {
              var dd = await pollScrapeUntilDone();
              if (dd.lastError) log('定时任务：更新失败 ' + dd.lastError, true);
              else if (!dd.timeout) log('定时任务：更新完成');
              await check();
            } else if (!r.ok) {
              throw new Error(t || r.statusText);
            } else {
              log('定时任务：更新完成');
              await check();
            }
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
  if (url === '/api/scrape-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        busy: scrapeBusy,
        lastError: scrapeLastError,
        lastFinishedAt: scrapeLastFinishedAt,
      }),
    );
    return;
  }
  if (url === '/api/update' && req.method === 'POST') {
    if (scrapeBusy) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '抓取已在运行中，请稍候' }));
      return;
    }
    scrapeBusy = true;
    scrapeLastError = null;
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, started: true, message: 'Scrape started' }));
    runUpdate()
      .then(() => {
        scrapeLastFinishedAt = Date.now();
        console.log('[monitor] npm run scrape finished OK');
      })
      .catch((e: Error) => {
        scrapeLastError = String(e?.message ?? e);
        scrapeLastFinishedAt = Date.now();
        console.error('[monitor] npm run scrape failed:', scrapeLastError);
      })
      .finally(() => {
        scrapeBusy = false;
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
