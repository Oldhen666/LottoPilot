/**
 * Monitor 核心逻辑 - 供 CLI 与 Web UI 共用
 *
 * 「需更新」判断：库里最新开奖日期 < 当前应已公布的最近一期开奖日（按开奖日历推算），
 * 而不是简单用「距今天数」。开奖日当天整天不要求「今天」这一期已入库，避免晚间开奖前误报。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { spawn, type ChildProcess, type StdioOptions } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

export const WATCH_LOTTERIES = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'] as const;

export const LOTTERY_LABELS: Record<string, string> = {
  lotto_max: 'Lotto Max',
  lotto_649: 'Lotto 649',
  powerball: 'Powerball',
  mega_millions: 'Mega Millions',
};

/** 开奖星期（0=周日 … 6=周六），按北美常见档期，与本地日期对齐即可 */
const DRAW_SCHEDULE: Record<string, number[]> = {
  lotto_max: [2, 5],
  lotto_649: [3, 6],
  powerball: [1, 3, 6],
  mega_millions: [2, 5],
};

export type Status = {
  lottery_id: string;
  latest_date: string | null;
  days_ago: number | null;
  /** 库里最新期是否早于「当前应已公布的最近一期」 */
  stale: boolean;
  /** 推算的「应有」最近一期日期 YYYY-MM-DD（开奖日） */
  expected_latest: string | null;
  /**
   * 仅 lotto_max / lotto_649：最新一条 draws 是否含 WCLC EXTRA 官方 7 位（兑奖用 extra_number）。
   * null 表示不适用（美系彩种）。
   */
  extra_ok: boolean | null;
  /**
   * 仅 lotto_max / lotto_649：最新一条是否含 OLG ENCORE 官方 7 位（encore_number）。
   */
  encore_ok: boolean | null;
  /** 仅 powerball：最新期是否含 Power Play 倍数 */
  power_play_ok: boolean | null;
  /** 仅 mega_millions：最新期是否含 Mega Millions 倍数 */
  mega_multiplier_ok: boolean | null;
};

function toDateKey(dateStr: string): string {
  return String(dateStr).slice(0, 10);
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hasSevenDigitField(v: unknown): boolean {
  if (v == null) return false;
  const d = String(v).replace(/\D/g, '');
  return d.length >= 7;
}

function daysBetween(dateStr: string, now: Date): number {
  const d = new Date(toDateKey(dateStr));
  if (Number.isNaN(d.getTime())) return 999;
  d.setHours(0, 0, 0, 0);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  return Math.floor((n.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 从「今天」往回找：当前应已公布的最近一期开奖日。
 * - 若「今天」是开奖日：当晚开奖前不要求库中已有「今天」这一期（整天均从「昨天」起算上一档开奖日）；
 *   次日才会把「昨天」那一期当作应有期，避免 18:00～开奖前误报「需更新」。
 */
export function getExpectedLatestDrawDate(lotteryId: string, now: Date = new Date()): string | null {
  const schedule = DRAW_SCHEDULE[lotteryId];
  if (!schedule?.length) return null;

  let cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  if (schedule.includes(cursor.getDay())) {
    cursor.setDate(cursor.getDate() - 1);
  }

  for (let i = 0; i < 21; i++) {
    const x = new Date(cursor);
    x.setDate(x.getDate() - i);
    if (schedule.includes(x.getDay())) {
      return formatYMD(x);
    }
  }
  return null;
}

export async function fetchLatestDates(): Promise<Status[]> {
  const results: Status[] = [];
  const now = new Date();

  for (const id of WATCH_LOTTERIES) {
    const expected = getExpectedLatestDrawDate(id, now);

    const { data, error } = await supabase
      .from('draws')
      .select(
        'draw_date, extra_number, encore_number, power_play_multiplier, mega_multiplier',
      )
      .eq('lottery_id', id)
      .order('draw_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      results.push({
        lottery_id: id,
        latest_date: null,
        days_ago: null,
        stale: true,
        expected_latest: expected,
        extra_ok: id === 'lotto_max' || id === 'lotto_649' ? false : null,
        encore_ok: id === 'lotto_max' || id === 'lotto_649' ? false : null,
        power_play_ok: id === 'powerball' ? false : null,
        mega_multiplier_ok: id === 'mega_millions' ? false : null,
      });
      continue;
    }

    const latest = toDateKey(String(data.draw_date));
    const isCaMain = id === 'lotto_max' || id === 'lotto_649';
    const extra_ok = isCaMain ? hasSevenDigitField((data as { extra_number?: string }).extra_number) : null;
    const encore_ok = isCaMain ? hasSevenDigitField((data as { encore_number?: string }).encore_number) : null;
    const row = data as {
      power_play_multiplier?: number | null;
      mega_multiplier?: number | null;
    };
    const power_play_ok =
      id === 'powerball'
        ? row.power_play_multiplier != null && Number(row.power_play_multiplier) >= 2
        : null;
    const mega_multiplier_ok =
      id === 'mega_millions'
        ? row.mega_multiplier != null && Number(row.mega_multiplier) >= 2
        : null;
    const days = daysBetween(latest, now);

    let stale = false;
    if (expected) {
      stale = latest < expected;
    } else {
      stale = days > 10;
    }

    results.push({
      lottery_id: id,
      latest_date: latest,
      days_ago: days,
      stale,
      expected_latest: expected,
      extra_ok,
      encore_ok,
      power_play_ok,
      mega_multiplier_ok,
    });
  }

  return results;
}

function getScrapeCwd(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

/** Relative to project root — written when there is no console (e.g. double-click Electron). */
export const MONITOR_SCRAPE_LOG_REL = path.join('logs', 'monitor-scrape-last.log');

/**
 * Run `npm run scrape` from project root.
 * Windows: use `cmd.exe /c` (spawning npm.cmd with shell:false causes EINVAL).
 * No TTY (double-click icon / hidden VBS): scrape stdout/stderr → `logs/monitor-scrape-last.log`.
 */
export function runUpdate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = getScrapeCwd();
    const env = { ...process.env };
    delete env.CI;

    const isWin = process.platform === 'win32';
    const wantLogFile = !process.stdout.isTTY;
    let logPath = '';
    let ws: fs.WriteStream | null = null;
    if (wantLogFile) {
      try {
        fs.mkdirSync(path.join(cwd, 'logs'), { recursive: true });
        logPath = path.join(cwd, MONITOR_SCRAPE_LOG_REL);
        ws = fs.createWriteStream(logPath, { flags: 'w' });
        ws.write(`=== ${new Date().toISOString()} npm run scrape (cwd=${cwd}) ===\n\n`);
      } catch {
        ws = null;
        logPath = '';
      }
    }

    const stdioOpt: StdioOptions = ws ? ['ignore', 'pipe', 'pipe'] : 'inherit';

    const child: ChildProcess = isWin
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', 'run', 'scrape'], {
          cwd,
          stdio: stdioOpt,
          env,
          windowsHide: true,
        })
      : spawn('npm', ['run', 'scrape'], {
          cwd,
          stdio: stdioOpt,
          shell: false,
          env,
        });

    if (ws && child.stdout) child.stdout.on('data', (chunk: Buffer | string) => ws!.write(chunk));
    if (ws && child.stderr) child.stderr.on('data', (chunk: Buffer | string) => ws!.write(chunk));

    const endLog = (then: () => void) => {
      if (ws) {
        ws.end(() => then());
      } else {
        then();
      }
    };

    child.on('close', (code) => {
      if (ws) ws.write(`\n=== exit ${code} ===\n`);
      endLog(() => {
        if (code === 0) resolve();
        else {
          const hint = logPath ? ` · 详见: ${logPath}` : '';
          reject(new Error(`Scrape 退出码 ${code}（工作目录: ${cwd}）${hint}`));
        }
      });
    });

    child.on('error', (err) => {
      if (ws) ws.write(`\nspawn error: ${err.message}\n`);
      endLog(() => reject(err));
    });
  });
}
