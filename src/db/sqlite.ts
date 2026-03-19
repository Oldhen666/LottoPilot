import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { shouldClearDataCaches } from '../utils/storageVersionCheck';

let db: SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (!db) {
    db = await openDatabaseAsync('lottopilot.db', { useNewConnection: true });
  }
  return db;
}

const SCHEMA_VERSION = 7;

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
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

    CREATE TABLE IF NOT EXISTS daily_simulation_usage (
      date_local TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );

    DROP TABLE IF EXISTS schema_version;
    CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1);
    INSERT INTO schema_version (id, version) VALUES (1, 1);
  `);
    const versionRows = await database.getAllAsync<{ version: number }>('SELECT version FROM schema_version WHERE id = 1');
    const version = versionRows?.[0]?.version ?? 1;
    if (version < SCHEMA_VERSION) {
      try {
        await database.execAsync('ALTER TABLE check_records ADD COLUMN jurisdiction_code TEXT');
      } catch {
        /* column may already exist */
      }
      try {
        await database.execAsync('ALTER TABLE check_records ADD COLUMN result_json TEXT');
      } catch {
        /* column may already exist */
      }
      try {
        await database.execAsync('ALTER TABLE check_records ADD COLUMN add_ons_selected_json TEXT');
      } catch {
        /* column may already exist */
      }
      try {
        await database.execAsync('ALTER TABLE check_records ADD COLUMN add_ons_inputs_json TEXT');
      } catch {
        /* column may already exist */
      }
    }
    if (version < 4) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS draws_cache (
          lottery_id TEXT NOT NULL,
          draw_date TEXT NOT NULL,
          winning_numbers TEXT NOT NULL,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (lottery_id, draw_date)
        );
        CREATE INDEX IF NOT EXISTS idx_draws_cache_lottery ON draws_cache(lottery_id);
        CREATE TABLE IF NOT EXISTS compass_cache (
          game_code TEXT PRIMARY KEY,
          computed_at TEXT NOT NULL,
          long_window_days INTEGER NOT NULL,
          short_window_days INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
      await database.runAsync('UPDATE schema_version SET version = ? WHERE id = 1', 4);
    }
    if (version < 5) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS strategy_lab_total_usage (id INTEGER PRIMARY KEY CHECK (id = 1), count INTEGER NOT NULL DEFAULT 0);
        INSERT OR IGNORE INTO strategy_lab_total_usage (id, count) VALUES (1, 0);
      `);
      await database.runAsync('UPDATE schema_version SET version = ? WHERE id = 1', 5);
    }
    if (version < 6) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS pick_book (
          id TEXT PRIMARY KEY,
          draw_date TEXT NOT NULL,
          lottery_id TEXT NOT NULL,
          picks_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pick_book_draw_date ON pick_book(draw_date);
        CREATE INDEX IF NOT EXISTS idx_pick_book_created ON pick_book(created_at DESC);
      `);
      await database.runAsync('UPDATE schema_version SET version = ? WHERE id = 1', 6);
    }
    if (version < 7) {
      try {
        await database.execAsync('ALTER TABLE draws_cache ADD COLUMN special_numbers TEXT');
      } catch {
        /* column may already exist */
      }
      await database.runAsync('DELETE FROM draws_cache');
      await database.runAsync('UPDATE schema_version SET version = ? WHERE id = 1', SCHEMA_VERSION);
    }

    // Clear draws_cache and compass_cache when app/OTA update changed (fixes stale data issues)
    if (shouldClearDataCaches()) {
      try {
        await database.runAsync('DELETE FROM draws_cache');
        await database.runAsync('DELETE FROM compass_cache');
      } catch {
        /* tables may not exist yet */
      }
    }
  })();
  return initPromise;
}

export async function ensureDbReady(): Promise<void> {
  await initDb();
}

export interface AddOnResultExtra {
  user: string;
  winning: string;
  matchedDigits: number;
  prizeText: string;
}

export interface LineResult {
  user_main: number[];
  user_special?: number[];
  match_main: number;
  match_special: number;
  result_bucket: string;
  prizeText?: string;
}

export interface CheckRecordResultJson {
  estimatedPrizeText?: string;
  tierName?: string;
  claimUrl?: string;
  officialRulesUrl?: string;
  disclaimers?: string[];
  lineResults?: LineResult[];
  mainResult?: { match_main: number; match_special: number; tier?: string; prizeText: string };
  options?: { power_play?: boolean; megaplier?: boolean };
  addOnResults?: {
    EXTRA?: AddOnResultExtra;
    ENCORE?: AddOnResultExtra;
    TAG?: AddOnResultExtra;
    DOUBLE_PLAY?: { match_main: number; match_special: number; tier: string; prizeText: string };
    POWER_PLAY?: { multiplier: number; applied: boolean };
    MAXMILLIONS?: { userList: string[]; winningList: string[]; hits: number[] };
    GOLD_BALL?: { userGold: string; winningGold: string; hit: boolean };
    MEGA_MULTIPLIER?: { multiplier: number; applied: boolean };
  };
}

export interface AddOnsSelected {
  EXTRA?: boolean;
  ENCORE?: boolean;
  TAG?: boolean;
  POWER_PLAY?: boolean;
  DOUBLE_PLAY?: boolean;
  MEGA_MULTIPLIER?: boolean;
}

export interface AddOnsInputs {
  EXTRA?: string;
  ENCORE?: string;
  TAG?: string;
  TAG_DRAW_DATE?: string;
  MAXMILLIONS?: string[];
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
  jurisdiction_code?: string;
  result_json?: CheckRecordResultJson;
  add_ons_selected_json?: AddOnsSelected;
  add_ons_inputs_json?: AddOnsInputs;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function insertRecord(r: Omit<CheckRecord, 'id'>): Promise<string> {
  await ensureDbReady();
  const id = generateId();
  const database = await getDb();
  try {
    await database.runAsync(
      `INSERT INTO check_records (id, created_at, lottery_id, draw_date, user_numbers, user_special, winning_numbers, winning_special, match_count_main, match_count_special, result_bucket, source, jurisdiction_code, result_json, add_ons_selected_json, add_ons_inputs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      r.source,
      r.jurisdiction_code ?? null,
      r.result_json ? JSON.stringify(r.result_json) : null,
      r.add_ons_selected_json ? JSON.stringify(r.add_ons_selected_json) : null,
      r.add_ons_inputs_json ? JSON.stringify(r.add_ons_inputs_json) : null
    );
  } catch {
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
  }
  return id;
}

export async function getRecords(opts?: { lottery_id?: string; limit?: number }): Promise<CheckRecord[]> {
  await ensureDbReady();
  let sql = 'SELECT * FROM check_records';
  const params: (string | number)[] = [];
  if (opts?.lottery_id) {
    sql += ' WHERE lottery_id = ?';
    params.push(opts.lottery_id);
  }
  sql += ' ORDER BY created_at DESC';
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
    jurisdiction_code: row.jurisdiction_code ?? undefined,
    result_json: row.result_json ? JSON.parse(row.result_json) : undefined,
    add_ons_selected_json: row.add_ons_selected_json ? JSON.parse(row.add_ons_selected_json) : undefined,
    add_ons_inputs_json: row.add_ons_inputs_json ? JSON.parse(row.add_ons_inputs_json) : undefined,
  }));
}

export async function getRecordById(id: string): Promise<CheckRecord | null> {
  await ensureDbReady();
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
    jurisdiction_code: row.jurisdiction_code ?? undefined,
    result_json: row.result_json ? JSON.parse(row.result_json) : undefined,
    add_ons_selected_json: row.add_ons_selected_json ? JSON.parse(row.add_ons_selected_json) : undefined,
    add_ons_inputs_json: row.add_ons_inputs_json ? JSON.parse(row.add_ons_inputs_json) : undefined,
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

/** Get today's local date as YYYY-MM-DD */
function getTodayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DailyUsage {
  date_local: string;
  count: number;
}

export async function getDailySimulationUsage(): Promise<DailyUsage | null> {
  await ensureDbReady();
  const today = getTodayLocal();
  const database = await getDb();
  const rows = await database.getAllAsync<any>('SELECT * FROM daily_simulation_usage WHERE date_local = ?', today) ?? [];
  if (!rows.length) return null;
  return { date_local: rows[0].date_local, count: rows[0].count };
}

export async function incrementDailySimulationUsage(): Promise<void> {
  await ensureDbReady();
  const today = getTodayLocal();
  const database = await getDb();
  const existing = await getDailySimulationUsage();
  if (existing) {
    await database.runAsync('UPDATE daily_simulation_usage SET count = count + 1 WHERE date_local = ?', today);
  } else {
    await database.runAsync('INSERT OR REPLACE INTO daily_simulation_usage (date_local, count) VALUES (?, 1)', today);
  }
}

export async function getTodaySimulationCount(): Promise<number> {
  const usage = await getDailySimulationUsage();
  return usage?.count ?? 0;
}

/** Strategy Lab total (lifetime) usage count. Free: 1, Pirate: 3. */
export async function getStrategyLabTotalCount(): Promise<number> {
  await ensureDbReady();
  const database = await getDb();
  const rows = await database.getAllAsync<{ count: number }>('SELECT count FROM strategy_lab_total_usage WHERE id = 1') ?? [];
  return rows[0]?.count ?? 0;
}

export async function incrementStrategyLabTotalUsage(): Promise<void> {
  await ensureDbReady();
  const database = await getDb();
  const current = await getStrategyLabTotalCount();
  await database.runAsync('INSERT OR REPLACE INTO strategy_lab_total_usage (id, count) VALUES (1, ?)', current + 1);
}

export interface PickBookRecord {
  id: string;
  draw_date: string;
  lottery_id: string;
  picks: { main: number[]; special: number[]; explanation: string }[];
  created_at: string;
}

export async function pickBookExists(lotteryId: string, drawDate: string): Promise<boolean> {
  await ensureDbReady();
  const database = await getDb();
  const rows = await database.getAllAsync<{ c: number }>(
    'SELECT 1 as c FROM pick_book WHERE lottery_id = ? AND draw_date = ? LIMIT 1',
    lotteryId,
    drawDate
  );
  return (rows?.length ?? 0) > 0;
}

export async function addToPickBook(
  lotteryId: string,
  drawDate: string,
  picks: { main: number[]; special: number[]; explanation: string }[]
): Promise<string | null> {
  await ensureDbReady();
  const exists = await pickBookExists(lotteryId, drawDate);
  if (exists) return null;
  const database = await getDb();
  const id = `pb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  await database.runAsync(
    'INSERT INTO pick_book (id, draw_date, lottery_id, picks_json, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    drawDate,
    lotteryId,
    JSON.stringify(picks),
    now
  );
  return id;
}

export async function getPickBookRecords(opts?: { dateFilter?: string; sortOrder?: 'asc' | 'desc' }): Promise<PickBookRecord[]> {
  await ensureDbReady();
  const database = await getDb();
  let sql = 'SELECT * FROM pick_book';
  const params: string[] = [];
  if (opts?.dateFilter && opts.dateFilter.trim()) {
    sql += ' WHERE draw_date = ?';
    params.push(opts.dateFilter.trim());
  }
  const order = opts?.sortOrder === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY draw_date ${order}, created_at ${order}`;
  const rows = (params.length ? await database.getAllAsync<any>(sql, ...params) : await database.getAllAsync<any>(sql)) ?? [];
  return rows.map((row) => ({
    id: row.id,
    draw_date: row.draw_date,
    lottery_id: row.lottery_id,
    picks: JSON.parse(row.picks_json),
    created_at: row.created_at,
  }));
}

export async function deletePickBookRecord(id: string): Promise<void> {
  await ensureDbReady();
  const database = await getDb();
  await database.runAsync('DELETE FROM pick_book WHERE id = ?', id);
}

/** Draws cache for Compass (offline). Uses transaction + prepared statement for fast batch insert. */
export async function upsertDrawsCache(
  lotteryId: string,
  draws: { draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]
): Promise<void> {
  if (draws.length === 0) return;
  await ensureDbReady();
  const database = await getDb();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const stmt = await database.prepareAsync(
      'INSERT OR REPLACE INTO draws_cache (lottery_id, draw_date, winning_numbers, special_numbers, synced_at) VALUES (?, ?, ?, ?, ?)'
    );
    try {
      for (const d of draws) {
        const special = d.special_numbers?.length ? JSON.stringify(d.special_numbers) : null;
        await stmt.executeAsync(lotteryId, d.draw_date, JSON.stringify(d.winning_numbers), special, now);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

export async function getDrawsFromCache(
  lotteryId: string,
  limit = 500
): Promise<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] }[]> {
  await ensureDbReady();
  const database = await getDb();
  const rows = (await database.getAllAsync<any>(
    'SELECT draw_date, winning_numbers, special_numbers FROM draws_cache WHERE lottery_id = ? ORDER BY draw_date DESC LIMIT ?',
    lotteryId,
    limit
  )) ?? [];
  return rows.map((r) => {
    const wn = typeof r.winning_numbers === 'string' ? JSON.parse(r.winning_numbers) : r.winning_numbers;
    const sn = r.special_numbers != null && r.special_numbers !== ''
      ? (typeof r.special_numbers === 'string' ? JSON.parse(r.special_numbers) : r.special_numbers)
      : undefined;
    return {
      draw_date: r.draw_date,
      winning_numbers: wn,
      special_numbers: Array.isArray(sn) && sn.length > 0 ? sn : undefined,
    };
  });
}

/** Compass cache */
export async function getCompassCache(gameCode: string): Promise<{ payload: unknown; computedAt: string } | null> {
  await ensureDbReady();
  const database = await getDb();
  const rows = (await database.getAllAsync<any>('SELECT payload_json, computed_at FROM compass_cache WHERE game_code = ?', gameCode)) ?? [];
  if (!rows.length) return null;
  return {
    payload: JSON.parse(rows[0].payload_json),
    computedAt: rows[0].computed_at,
  };
}

export async function deleteCompassCache(gameCode: string): Promise<void> {
  await ensureDbReady();
  const database = await getDb();
  await database.runAsync('DELETE FROM compass_cache WHERE game_code = ?', gameCode);
}

export async function setCompassCache(
  gameCode: string,
  longWindowDays: number,
  shortWindowDays: number,
  payload: unknown
): Promise<void> {
  await ensureDbReady();
  const database = await getDb();
  const now = new Date().toISOString();
  await database.runAsync(
    'INSERT OR REPLACE INTO compass_cache (game_code, computed_at, long_window_days, short_window_days, payload_json) VALUES (?, ?, ?, ?, ?)',
    gameCode,
    now,
    longWindowDays,
    shortWindowDays,
    JSON.stringify(payload)
  );
}
