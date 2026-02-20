import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

let db: SQLiteDatabase | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (!db) {
    db = await openDatabaseAsync('lottopilot.db');
  }
  return db;
}

export async function initDb(): Promise<void> {
  const database = await getDb();
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS check_records (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      lottery_id TEXT NOT NULL,
      draw_date TEXT NOT NULL,
      user_numbers TEXT NOT NULL,
      user_special TEXT,
      winning_numbers TEXT NOT NULL,
      winning_special TEXT,
      match_count_main INTEGER NOT NULL,
      match_count_special INTEGER NOT NULL,
      result_bucket TEXT NOT NULL,
      source TEXT DEFAULT 'manual'
    );
    CREATE INDEX IF NOT EXISTS idx_check_records_lottery ON check_records(lottery_id);
    CREATE INDEX IF NOT EXISTS idx_check_records_created ON check_records(created_at DESC);
  `);
}

export interface CheckRecord {
  id: string;
  created_at: string;
  lottery_id: string;
  draw_date: string;
  user_numbers: number[];
  user_special?: number[];
  winning_numbers: number[];
  winning_special?: number[];
  match_count_main: number;
  match_count_special: number;
  result_bucket: string;
  source: string;
}

export async function insertRecord(r: Omit<CheckRecord, 'id'>): Promise<string> {
  const id = crypto.randomUUID();
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO check_records (id, created_at, lottery_id, draw_date, user_numbers, user_special, winning_numbers, winning_special, match_count_main, match_count_special, result_bucket, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    r.created_at,
    r.lottery_id,
    r.draw_date,
    JSON.stringify(r.user_numbers),
    r.user_special ? JSON.stringify(r.user_special) : null,
    JSON.stringify(r.winning_numbers),
    r.winning_special ? JSON.stringify(r.winning_special) : null,
    r.match_count_main,
    r.match_count_special,
    r.result_bucket,
    r.source
  );
  return id;
}

export async function getRecords(opts?: { lottery_id?: string; limit?: number }): Promise<CheckRecord[]> {
  let sql = 'SELECT * FROM check_records ORDER BY created_at DESC';
  const params: (string | number)[] = [];
  if (opts?.lottery_id) {
    sql += ' WHERE lottery_id = ?';
    params.push(opts.lottery_id);
  }
  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  const database = await getDb();
  const rows = (params.length ? await database.getAllAsync<any>(sql, ...params) : await database.getAllAsync<any>(sql)) ?? [];
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    lottery_id: row.lottery_id,
    draw_date: row.draw_date,
    user_numbers: JSON.parse(row.user_numbers),
    user_special: row.user_special ? JSON.parse(row.user_special) : undefined,
    winning_numbers: JSON.parse(row.winning_numbers),
    winning_special: row.winning_special ? JSON.parse(row.winning_special) : undefined,
    match_count_main: row.match_count_main,
    match_count_special: row.match_count_special,
    result_bucket: row.result_bucket,
    source: row.source,
  }));
}

export async function getRecordById(id: string): Promise<CheckRecord | null> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>('SELECT * FROM check_records WHERE id = ?', id) ?? [];
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    created_at: row.created_at,
    lottery_id: row.lottery_id,
    draw_date: row.draw_date,
    user_numbers: JSON.parse(row.user_numbers),
    user_special: row.user_special ? JSON.parse(row.user_special) : undefined,
    winning_numbers: JSON.parse(row.winning_numbers),
    winning_special: row.winning_special ? JSON.parse(row.winning_special) : undefined,
    match_count_main: row.match_count_main,
    match_count_special: row.match_count_special,
    result_bucket: row.result_bucket,
    source: row.source,
  };
}

export async function getStatsForInsights(): Promise<{
  total: number;
  anyHitCount: number;
  longestDryStreak: number;
  hitDistribution: Record<number, number>;
  specialHitCount: number;
  byLottery: Record<string, { total: number; hitCount: number }>;
}> {
  const records = await getRecords({ limit: 10000 });
  let anyHitCount = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  const hitDistribution: Record<number, number> = {};
  let specialHitCount = 0;
  const byLottery: Record<string, { total: number; hitCount: number }> = {};

  for (const r of records) {
    if (r.match_count_main > 0 || r.match_count_special > 0) {
      anyHitCount++;
      currentStreak = 0;
      hitDistribution[r.match_count_main] = (hitDistribution[r.match_count_main] || 0) + 1;
      if (r.match_count_special > 0) specialHitCount++;
      const lot = byLottery[r.lottery_id] || { total: 0, hitCount: 0 };
      lot.total++;
      lot.hitCount++;
      byLottery[r.lottery_id] = lot;
    } else {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
      hitDistribution[0] = (hitDistribution[0] || 0) + 1;
      const lot = byLottery[r.lottery_id] || { total: 0, hitCount: 0 };
      lot.total++;
      byLottery[r.lottery_id] = lot;
    }
  }

  return {
    total: records.length,
    anyHitCount,
    longestDryStreak: longestStreak,
    hitDistribution,
    specialHitCount,
    byLottery,
  };
}

export async function getMyPickStats(): Promise<{
  topMain: Array<{ num: number; count: number }>;
  topSpecial: Array<{ num: number; count: number }>;
  oddEvenRatios: Record<string, number>;
  rangeDistribution: Record<string, number>;
}> {
  const records = await getRecords({ limit: 500 });
  const mainCounts: Record<number, number> = {};
  const specialCounts: Record<number, number> = {};
  const oddEven: Record<string, number> = {};
  const ranges: Record<string, number> = {};

  for (const r of records) {
    for (const n of r.user_numbers) {
      mainCounts[n] = (mainCounts[n] || 0) + 1;
      const odd = n % 2 === 1 ? 'odd' : 'even';
      oddEven[odd] = (oddEven[odd] || 0) + 1;
      const range = Math.floor((n - 1) / 10) * 10;
      const key = `${range + 1}-${range + 10}`;
      ranges[key] = (ranges[key] || 0) + 1;
    }
    if (r.user_special?.length) {
      for (const n of r.user_special) {
        specialCounts[n] = (specialCounts[n] || 0) + 1;
      }
    }
  }

  const topMain = Object.entries(mainCounts)
    .map(([num, count]) => ({ num: parseInt(num, 10), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topSpecial = Object.entries(specialCounts)
    .map(([num, count]) => ({ num: parseInt(num, 10), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { topMain, topSpecial, oddEvenRatios: oddEven, rangeDistribution: ranges };
}
