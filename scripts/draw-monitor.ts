/**
 * LottoPilot 本地数据监控 (CLI)
 * 运行: npm run monitor
 * 命令: c=检查 u=更新 l=日志 a=提醒 i=间隔 q=退出
 */
import * as readline from 'readline';
import {
  fetchLatestDates,
  runUpdate,
  LOTTERY_LABELS,
  type Status,
} from './monitor-core';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let verbose = true;
let alarmOn = true;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function log(msg: string, force = false) {
  if (force || verbose) {
    const ts = new Date().toLocaleString('zh-CN', { hour12: false });
    console.log(`[${ts}] ${msg}`);
  }
}

function beep() {
  try {
    process.stdout.write('\x07');
  } catch (_) {}
}

function formatStatus(status: Status[]): string {
  const lines: string[] = [];
  for (const s of status) {
    const label = LOTTERY_LABELS[s.lottery_id] ?? s.lottery_id;
    if (s.latest_date && s.days_ago !== null) {
      const flag = s.stale ? ' ⚠️ 需更新' : ' ✓';
      const exp = s.expected_latest ? ` 应有≥${s.expected_latest}` : '';
      let addon = '';
      if (s.extra_ok !== null || s.encore_ok !== null) {
        const bits: string[] = [];
        if (s.extra_ok !== null) bits.push(`EXTRA:${s.extra_ok ? '✓' : '缺'}`);
        if (s.encore_ok !== null) bits.push(`ENCORE:${s.encore_ok ? '✓' : '缺'}`);
        addon = ` · ${bits.join(' ')}`;
      }
      lines.push(`  ${label}: 最新 ${s.latest_date} (${s.days_ago} 天前)${exp}${flag}${addon}`);
    } else {
      lines.push(`  ${label}: 无数据 ⚠️`);
    }
  }
  return lines.join('\n');
}

async function runCheck(showAlways = true): Promise<Status[]> {
  log('检查数据库更新状态...');
  const status = await fetchLatestDates();
  const anyStale = status.some((s) => s.stale);

  if (showAlways || verbose) {
    console.log('\n--- 数据状态 ---');
    console.log(formatStatus(status));
    console.log('---\n');
  }

  const addonMissing = status.filter(
    (s) =>
      (s.lottery_id === 'lotto_max' || s.lottery_id === 'lotto_649') &&
      s.latest_date &&
      (s.extra_ok === false || s.encore_ok === false),
  );

  if (alarmOn && (anyStale || addonMissing.length > 0)) {
    beep();
    if (anyStale) {
      const staleNames = status.filter((s) => s.stale).map((s) => LOTTERY_LABELS[s.lottery_id] ?? s.lottery_id);
      console.log(`\n🔔 提醒: ${staleNames.join(' / ')} 数据可能过期，建议运行更新 (输入 u)\n`);
    }
    if (addonMissing.length > 0) {
      const names = addonMissing.map((s) => LOTTERY_LABELS[s.lottery_id] ?? s.lottery_id);
      console.log(
        `🔔 加奖号码: ${names.join(' / ')} 最新期缺少 EXTRA 或 ENCORE 官方号（draws.extra_number / encore_number）。` +
          `「更新数据库」会运行 scrape 并尝试一并写入。\n`,
      );
    }
  }

  return status;
}

function doUpdate(): Promise<void> {
  log('正在运行 scrape 更新数据库...');
  console.log('(请等待 scrape 完成)\n');
  return runUpdate().then(() => log('Scrape 完成'));
}

function scheduleDailyMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  const delay = Math.max(60_000, next.getTime() - now.getTime());
  log(`下次自动检查: 每日 0:00（约 ${next.toLocaleString('zh-CN')}）`);
  midnightTimer = setTimeout(() => {
    runCheck(false).finally(() => scheduleDailyMidnight());
  }, delay);
}

function stopPeriodicCheck() {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
    log('定时检查已停止');
  }
}

function printMenu() {
  console.log(`
  [c] check   - 立即检查状态
  [u] update  - 立即更新数据库
  [l] log     - 切换日志 (当前: ${verbose ? '详细' : '简洁'})
  [a] alarm   - 切换提醒 (当前: ${alarmOn ? '开' : '关'})
  [q] quit    - 退出
  （自动检查固定为每日 0:00）
  `);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('请配置 .env 中的 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log('\n=== LottoPilot 数据监控 (备选方案) ===\n');
  console.log('首次启动将立即检查一次状态，之后每日 0:00 自动检查。');
  printMenu();

  await runCheck(true);
  scheduleDailyMidnight();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question('> ', async (line) => {
    const cmd = (line || '').trim().toLowerCase();
    if (!cmd) {
      prompt();
      return;
    }

    const action = cmd[0];

    switch (action) {
      case 'c':
        await runCheck(true);
        break;
      case 'u':
        stopPeriodicCheck();
        try {
          await doUpdate();
          await runCheck(true);
        } catch (e) {
          console.error('更新失败:', e);
        }
        scheduleDailyMidnight();
        break;
      case 'l':
        verbose = !verbose;
        log(`日志: ${verbose ? '详细' : '简洁'}`);
        break;
      case 'a':
        alarmOn = !alarmOn;
        console.log(`提醒: ${alarmOn ? '开' : '关'}`);
        break;
      case 'q':
        stopPeriodicCheck();
        console.log('再见');
        rl.close();
        process.exit(0);
      default:
        printMenu();
    }

    prompt();
  });

  prompt();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
