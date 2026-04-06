import {
  extractFlPowerballToken,
  parsePowerballRowWithFamily,
  parseUsPbMmLine,
  stripQuickPickNoise,
  stripUsPlayLineLetterPrefix,
} from './usParseLine';

describe('usParseLine', () => {
  it('strips QP noise for NY family', () => {
    expect(stripQuickPickNoise('QP 03 12 19 44 67 09').trim()).toBe('03 12 19 44 67 09');
  });

  it('parses FL PB token', () => {
    expect(extractFlPowerballToken('PB 14')).toBe(14);
    expect(extractFlPowerballToken('x')).toBeNull();
  });

  it('parsePowerballRowWithFamily ny ignores QP', () => {
    const r = parsePowerballRowWithFamily('QP 3 12 19 44 67 9', 'ny_il_nj');
    expect(r.main.length).toBe(5);
    expect(r.special).toBe(9);
  });

  it('strips CA play line letter A before mains', () => {
    expect(stripUsPlayLineLetterPrefix('A 04 15 35 45 60')).toBe('04 15 35 45 60');
    expect(stripUsPlayLineLetterPrefix('A04 15 35 45 60')).toBe('04 15 35 45 60');
  });

  it('parseUsPbMmLine: A 04… → 4 not 1', () => {
    const r = parseUsPbMmLine('A 04 15 35 45 60 25', 5, 69, 1, 26);
    expect(r.main).toEqual([4, 15, 35, 45, 60]);
    expect(r.special).toBe(25);
  });

  it('parseUsPbMmLine: 1+4 from broken OCR → 4', () => {
    const r = parseUsPbMmLine('1 4 15 35 45 60 25', 5, 69, 1, 26);
    expect(r.main[0]).toBe(4);
  });

  it('parseUsPbMmLine: 04 as 0+4 and 25 as 2+5', () => {
    const r = parseUsPbMmLine('0 4 15 35 45 50 2 5', 5, 69, 1, 26);
    expect(r.main).toEqual([4, 15, 35, 45, 50]);
    expect(r.special).toBe(25);
  });

  it('parseUsPbMmLine: P4 duplicate 5/6 confusion → flip one 5 to 6 for full mains', () => {
    const r = parseUsPbMmLine('5 5 15 25 35 12', 5, 69, 1, 26);
    expect(r.main).toEqual([5, 6, 15, 25, 35]);
    expect(r.special).toBe(12);
  });
});
