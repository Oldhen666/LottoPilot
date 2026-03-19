/**
 * Web stub - no expo-sqlite (WASM bundling issues). Uses localStorage for check records.
 */
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
  addOnResults?: Record<string, unknown>;
}

export interface AddOnsSelected {
  EXTRA?: boolean;
  ENCORE?: boolean;
  TAG?: boolean;
  POWER_PLAY?: boolean;
  DOUBLE_PLAY?: boolean;
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

export interface DailyUsage {
  date_local: string;
  count: number;
}

const RECORDS_KEY = 'lottopilot_check_records';
const USAGE_KEY = 'lottopilot_daily_usage';
const STRATEGY_LAB_TOTAL_KEY = 'lottopilot_strategy_lab_total';
const PICK_BOOK_KEY = 'lottopilot_pick_book';

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

function getRecordsFromStorage(): CheckRecord[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECORDS_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecordsToStorage(records: CheckRecord[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  }
}

export async function initDb(): Promise<void> {
  /* no-op on web */
}

export async function ensureDbReady(): Promise<void> {
  /* no-op on web */
}

export async function insertRecord(r: Omit<CheckRecord, 'id'>): Promise<string> {
  const id = generateId();
  const records = getRecordsFromStorage();
  records.unshift({ ...r, id });
  saveRecordsToStorage(records);
  return id;
}

export async function getRecords(opts?: { lottery_id?: string; limit?: number }): Promise<CheckRecord[]> {
  let records = getRecordsFromStorage();
  if (opts?.lottery_id) {
    records = records.filter((x) => x.lottery_id === opts.lottery_id);
  }
  if (opts?.limit) {
    records = records.slice(0, opts.limit);
  }
  return records;
}

export async function getRecordById(id: string): Promise<CheckRecord | null> {
  const records = getRecordsFromStorage();
  return records.find((r) => r.id === id) ?? null;
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

function getTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getDailySimulationUsage(): Promise<DailyUsage | null> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(USAGE_KEY) : null;
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.date_local === getTodayLocal() ? data : null;
  } catch {
    return null;
  }
}

export async function incrementDailySimulationUsage(): Promise<void> {
  const today = getTodayLocal();
  const existing = await getDailySimulationUsage();
  const count = (existing?.count ?? 0) + 1;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(USAGE_KEY, JSON.stringify({ date_local: today, count }));
  }
}

export async function getTodaySimulationCount(): Promise<number> {
  const usage = await getDailySimulationUsage();
  return usage?.count ?? 0;
}

export async function getStrategyLabTotalCount(): Promise<number> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STRATEGY_LAB_TOTAL_KEY) : null;
    const n = raw ? parseInt(raw, 10) : 0;
    return isNaN(n) ? 0 : Math.max(0, n);
  } catch {
    return 0;
  }
}

export async function incrementStrategyLabTotalUsage(): Promise<void> {
  const count = await getStrategyLabTotalCount();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STRATEGY_LAB_TOTAL_KEY, String(count + 1));
  }
}

export async function upsertDrawsCache(
  _lotteryId: string,
  _draws: { draw_date: string; winning_numbers: number[] }[]
): Promise<void> {
  /* no-op on web, draws from Supabase */
}

export async function getDrawsFromCache(
  _lotteryId: string,
  _limit = 500
): Promise<{ draw_date: string; winning_numbers: number[] }[]> {
  return [];
}

export async function getCompassCache(_gameCode: string): Promise<{ payload: unknown; computedAt: string } | null> {
  return null;
}

export async function deleteCompassCache(_gameCode: string): Promise<void> {
  /* no-op */
}

export async function setCompassCache(
  _gameCode: string,
  _longWindowDays: number,
  _shortWindowDays: number,
  _payload: unknown
): Promise<void> {
  /* no-op on web */
}

export interface PickBookRecord {
  id: string;
  draw_date: string;
  lottery_id: string;
  picks: { main: number[]; special: number[]; explanation: string }[];
  created_at: string;
}

function getPickBookFromStorage(): PickBookRecord[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PICK_BOOK_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePickBookToStorage(records: PickBookRecord[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PICK_BOOK_KEY, JSON.stringify(records));
  }
}

export async function pickBookExists(lotteryId: string, drawDate: string): Promise<boolean> {
  const records = getPickBookFromStorage();
  return records.some((r) => r.lottery_id === lotteryId && r.draw_date === drawDate);
}

export async function addToPickBook(
  lotteryId: string,
  drawDate: string,
  picks: { main: number[]; special: number[]; explanation: string }[]
): Promise<string | null> {
  const exists = await pickBookExists(lotteryId, drawDate);
  if (exists) return null;
  const id = `pb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const records = getPickBookFromStorage();
  records.unshift({
    id,
    draw_date: drawDate,
    lottery_id: lotteryId,
    picks,
    created_at: now,
  });
  savePickBookToStorage(records);
  return id;
}

export async function getPickBookRecords(opts?: { dateFilter?: string; sortOrder?: 'asc' | 'desc' }): Promise<PickBookRecord[]> {
  let records = getPickBookFromStorage();
  if (opts?.dateFilter && opts.dateFilter.trim()) {
    records = records.filter((r) => r.draw_date === opts.dateFilter!.trim());
  }
  const asc = opts?.sortOrder === 'asc';
  return records.sort((a, b) => {
    const d = asc ? a.draw_date.localeCompare(b.draw_date) : b.draw_date.localeCompare(a.draw_date);
    return d !== 0 ? d : (asc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  });
}

export async function deletePickBookRecord(id: string): Promise<void> {
  const records = getPickBookFromStorage();
  const filtered = records.filter((r) => r.id !== id);
  savePickBookToStorage(filtered);
}
