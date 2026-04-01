/**
 * Monitor 核心逻辑 - 供 CLI 与 Web UI 共用
 *
 * 「需更新」判断：库里最新开奖日期 < 当前应已公布的最近一期开奖日（按开奖日历推算），
 * 而不是简单用「距今天数」——否则会出现「非开奖日间隔长却被判异常」的问题。
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';

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
 * - 若「今天」是开奖日且本地时间早于 18:00，假定当晚开奖尚未入库，从「昨天」起算。
 */
export function getExpectedLatestDrawDate(lotteryId: string, now: Date = new Date()): string | null {
  const schedule = DRAW_SCHEDULE[lotteryId];
  if (!schedule?.length) return null;

  const hour = now.getHours();
  let cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  if (schedule.includes(cursor.getDay()) && hour < 18) {
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
      .select('draw_date')
      .eq('lottery_id', id)
      .order('draw_date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      results.push({
        lottery_id: id,
        latest_date: null,
        days_ago: null,
        stale: true,
        expected_latest: expected,
      });
      continue;
    }

    const latest = toDateKey(String(data.draw_date));
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
    });
  }

  return results;
}

function getScrapeCwd(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

export function runUpdate(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = getScrapeCwd();
    const env = { ...process.env };
    delete env.CI;
    const child = spawn('npm', ['run', 'scrape'], {
      cwd,
      stdio: 'ignore',
      shell: true,
      env,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Scrape 退出码 ${code}（工作目录: ${cwd}）`));
    });

    child.on('error', reject);
  });
}
