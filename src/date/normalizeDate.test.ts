/**
 * Unit tests for date normalization (15+ samples: French, OCR errors, formats).
 * Run: npx jest src/date/normalizeDate.test.ts
 */

import { normalizeDateCandidates } from './normalizeDate';

const LOTTO_MAX = 'lotto_max' as const;

describe('normalizeDateCandidates', () => {
  it('parses YYYY-MM-DD', () => {
    const r = normalizeDateCandidates('Draw date: 2025-02-17', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-02-17');
    expect(r.candidates).toContain('2025-02-17');
  });

  it('parses YYYY/MM/DD', () => {
    const r = normalizeDateCandidates('2025/02/17', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-02-17');
  });

  it('parses YYYYMMDD', () => {
    const r = normalizeDateCandidates('20250217', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-02-17');
  });

  it('parses MMM DD YYYY (JAN 10 2025)', () => {
    const r = normalizeDateCandidates('JAN 10 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-01-10');
  });

  it('parses MMM DD, YYYY', () => {
    const r = normalizeDateCandidates('September 5, 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses DD MMM YYYY (10 JAN 2025)', () => {
    const r = normalizeDateCandidates('10 JAN 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-01-10');
  });

  it('parses French month JANV', () => {
    const r = normalizeDateCandidates('10 JANV 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-01-10');
  });

  it('parses French month FÉVR', () => {
    const r = normalizeDateCandidates('Draw: 15 FÉVR 2025', LOTTO_MAX);
    expect(r.candidates[0]).toBe('2025-02-15');
  });

  it('parses French month MARS', () => {
    const r = normalizeDateCandidates('20 MARS 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-03-20');
  });

  it('parses OCR error O->0 (JAN1O2025)', () => {
    const r = normalizeDateCandidates('JAN1O2025', LOTTO_MAX);
    expect(r.candidates).toContain('2025-01-10');
  });

  it('parses OCR error |->/ (2025|01|10)', () => {
    const r = normalizeDateCandidates('2025|01|10', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-01-10');
  });

  it('parses SEP 05 25 (WCLC short format)', () => {
    const r = normalizeDateCandidates('SEP 05 25', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses FRI SEP05 25 (weekday + no space between month and day)', () => {
    const r = normalizeDateCandidates('FRI SEP05 25', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses 1DRAWSEP05 25 (1 DRAW and date merged by OCR)', () => {
    const r = normalizeDateCandidates('1DRAWSEP05 25', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses 1 DRAW FRI SEP05 25 (with space)', () => {
    const r = normalizeDateCandidates('1 DRAW FRI SEP05 25', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses DRAWFRI SEP05 25 (DRAW and weekday merged)', () => {
    const r = normalizeDateCandidates('DRAWFRI SEP05 25', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses MM/DD/YY (North American)', () => {
    const r = normalizeDateCandidates('02/17/25', LOTTO_MAX);
    expect(r.candidates).toContain('2025-02-17');
  });

  it('parses with weekday prefix (TUE JAN 10 2025)', () => {
    const r = normalizeDateCandidates('TUE JAN 10 2025', LOTTO_MAX);
    expect(r.candidates).toContain('2025-01-10');
  });

  it('parses Draw date: prefix', () => {
    const r = normalizeDateCandidates('Draw date: SEP 05 2025', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-09-05');
  });

  it('parses For draw: prefix', () => {
    const r = normalizeDateCandidates('For draw: 2025-02-17', LOTTO_MAX);
    expect(r.dateISO).toBe('2025-02-17');
  });

  it('returns empty when no date found', () => {
    const r = normalizeDateCandidates('No date here 12345', LOTTO_MAX);
    expect(r.dateISO).toBeUndefined();
    expect(r.candidates).toHaveLength(0);
  });

  it('boosts confidence for Lotto Max draw days (Tue/Fri)', () => {
    const r = normalizeDateCandidates('2025-02-18', LOTTO_MAX); // Tue
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});
