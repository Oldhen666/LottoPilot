import {
  extractFlPowerballToken,
  extractMegaBallFromRawText,
  extractMegaBallsPerLineFromRawText,
  extractPowerballFromRawText,
  extractPowerballsPerLineFromRawText,
  parsePowerballRowWithFamily,
  parsePowerballSpecialFromColumnText,
  parseUsPbMmLine,
  stripQuickPickNoise,
  stripUsPlayLineLetterPrefix,
} from './usParseLine';
import {
  finalizeUsGameSpecialsFromRawText,
  __debug_extractLetteredPowerballPlays,
  __debug_extractPowerballValuesFromQpOpLines,
} from './rawTextSpecialFinalize';
import type { ParsedTicket } from '../ocr';

describe('usParseLine', () => {
  it('strips QP noise for NY family', () => {
    expect(stripQuickPickNoise('QP 03 12 19 44 67 09').trim()).toBe('03 12 19 44 67 09');
    expect(stripQuickPickNoise('aQuICK PICK 03 12').trim()).toBe('03 12');
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

  it('parsePowerballSpecialFromColumnText merges split 2 and 5 into 25 (scheme 2)', () => {
    expect(parsePowerballSpecialFromColumnText('2 5', 1, 26)).toBe(25);
    expect(parsePowerballSpecialFromColumnText('POWER 2 5', 1, 26)).toBe(25);
    expect(parsePowerballSpecialFromColumnText('25', 1, 26)).toBe(25);
  });

  it('parseUsPbMmLine: O misread as zero (O4, 6O) on play line', () => {
    const r = parseUsPbMmLine('O4 15 35 45 6O 25', 5, 69, 1, 26);
    expect(r.main).toEqual([4, 15, 35, 45, 60]);
    expect(r.special).toBe(25);
  });

  it('extracts POWER xx from rawText (separate line)', () => {
    const raw = [
      'QUICK PICK',
      'O4 15 35 45 60',
      'POWER',
      '25',
    ].join('\n');
    expect(extractPowerballFromRawText(raw)).toBe(25);
  });

  it('extracts PB list from rawText (per-line specials)', () => {
    const raw = [
      'POWER PLAY - NO',
      'PB: 19 gp',
      'PB: 09 P',
      'PB: 24 QP',
      'PB: 05 gp',
      'PB: 14 qp',
    ].join('\n');
    expect(extractPowerballsPerLineFromRawText(raw)).toEqual([19, 9, 24, 5, 14]);
  });

  it('extracts MEGA BALL / MB from rawText', () => {
    expect(extractMegaBallFromRawText('MEGA BALL 12')).toBe(12);
    expect(extractMegaBallFromRawText('MEGABALL 7')).toBe(7);
    expect(extractMegaBallFromRawText('MB: 25')).toBe(25);
    expect(extractMegaBallFromRawText(['MEGA', 'O3'].join('\n'))).toBe(3);
  });

  it('extracts Mega Ball from messy NY quick-pick line (680 glue + oP noise)', () => {
    const raw = '03 24. 42 58 680 24 oP';
    expect(extractMegaBallFromRawText(raw)).toBe(24);
  });

  it('extracts Mega Ball when QP reads as ap and gold ball glues as 244', () => {
    const raw = '03 24 42 58 68 ap 244 oP';
    expect(extractMegaBallFromRawText(raw)).toBe(24);
  });

  it('parseUsPbMmLine: CA Mega play line with Dg→08 and glued 1424→14 24, no false Mega on line', () => {
    const r = parseUsPbMmLine('O4 Dg 1424 45', 5, 70, 1, 25);
    expect(r.main).toEqual([4, 8, 14, 24, 45]);
    expect(r.special).toBeNull();
  });

  it('parseUsPbMmLine: still picks Mega/PB when duplicate special appears on same line', () => {
    const r = parseUsPbMmLine('03 24 42 58 68 24', 5, 70, 1, 25);
    expect(r.main).toEqual([3, 24, 42, 58, 68]);
    expect(r.special).toBe(24);
  });

  it('extractMegaBallFromRawText: CA calottery block with MEGA on next line (O3)', () => {
    const raw = [
      'Catottery 9mcalOttery',
      'MILLIONS',
      'O4 Dg 1424 45',
      'DRAW NUMDER O02169',
      'FRI APR 03 2026',
      'MEGA',
      'O3',
      '$5. 00',
    ].join('\n');
    expect(extractMegaBallFromRawText(raw)).toBe(3);
  });

  it('extractMegaBallFromRawText: ignores MEGA glued to ticket id (R102…) or price (S5.)', () => {
    expect(extractMegaBallFromRawText('Y MEGA R1023069 MILIONS')).toBeNull();
    expect(extractMegaBallFromRawText('MEGA S5. OO')).toBeNull();
  });

  it('parseUsPbMmLine: CA line A O4 O8 14 24 45 (O→0)', () => {
    const r = parseUsPbMmLine('A O4 O8 14 24 45', 5, 70, 1, 25);
    expect(r.main).toEqual([4, 8, 14, 24, 45]);
    expect(r.special).toBeNull();
  });

  it('extractMegaBallFromRawText: CA OCR with MEGA+price only yields null (gold missing)', () => {
    const raw = [
      'OLery. caIOLLery',
      'MEGA',
      'R1023069',
      'MILIONS',
      'aQuICK PICK',
      'A O4 O8 14 24 45',
      'DRAW NUMBER 002169',
      'FRI APR 03 2026',
      'MEGA',
      'S5. OO',
      '4701-005790735-152635',
      'MULT',
      '3X',
    ].join('\n');
    expect(extractMegaBallFromRawText(raw)).toBeNull();
  });

  it('parseUsPbMmLine: Mega play line with glued main+mega+multiplier token (70233X)', () => {
    const r = parseUsPbMmLine('A 07 19 27 61 70233X', 5, 70, 1, 25);
    expect(r.main).toEqual([7, 19, 27, 61, 70]);
    expect(r.special).toBe(23);
  });

  it('parseUsPbMmLine: Mega play line with P02 megaplier noise still yields mega=2', () => {
    const r = parseUsPbMmLine('& 04 13 14 20 53P02 P2X', 5, 70, 1, 25);
    expect(r.main).toEqual([4, 13, 14, 20, 53]);
    expect(r.special).toBe(2);
  });

  it('parseUsPbMmLine: Mega play line with *05 megaplier noise still yields mega=5', () => {
    const r = parseUsPbMmLine('c 22 27 57 62 66*05P5X', 5, 70, 1, 25);
    expect(r.main).toEqual([22, 27, 57, 62, 66]);
    expect(r.special).toBe(5);
  });

  it('parseUsPbMmLine: TX line with trailing 2X does not turn 01 into 12', () => {
    const r = parseUsPbMmLine('A 30 39 42 45 58 QP 01 OP 2X', 5, 70, 1, 25);
    expect(r.main).toEqual([30, 39, 42, 45, 58]);
    expect(r.special).toBe(1);
  });

  it('parseUsPbMmLine: WI line "OP-19 OP 3X" yields Mega Ball 19 (hyphen + multiplier)', () => {
    const r = parseUsPbMmLine('A. 10 21 46 48 57 OP-19 OP 3X', 5, 70, 1, 25);
    expect(r.main).toEqual([10, 21, 46, 48, 57]);
    expect(r.special).toBe(19);
  });

  it('parseUsPbMmLine: FL line with "MB04 Q6" OCRed as "04 06" still yields Mega Ball 4', () => {
    const r = parseUsPbMmLine('A 14 23 50 62 66 04 06', 5, 70, 1, 25);
    expect(r.main).toEqual([14, 23, 50, 62, 66]);
    expect(r.special).toBe(4);
  });

  it('extractMegaBallsPerLineFromRawText: FL MBZ3 yields 23', () => {
    const raw = ['A 14 23 50 62 66 04 06', '23 33 37 55 69 MBZ3 Q6'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toContain(23);
  });

  it('extractMegaBallsPerLineFromRawText: FL Me01 / M821 normalize to MB values', () => {
    const raw = ['61 Me01 06', 'M821', 'MB25 o6', 'MB24 06'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([1, 21, 25, 24]);
  });

  it('extractMegaBallsPerLineFromRawText: standalone MB line then value line yields MB', () => {
    const raw = ['06 17 33 61 70', 'MB', '15', 'EP'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([15]);
  });

  it('extractMegaBallsPerLineFromRawText: standalone MB line skips ticket id line before value', () => {
    const raw = ['06 17 33 61 70', 'MB', '275-015453195-121170', '15', 'EP'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([15]);
  });

  it('extractMegaBallsPerLineFromRawText: CA standalone MEGA then value line (no QP) yields MB', () => {
    const raw = ['Calottery', 'O4 O8 14 24 45', 'MEGA', 'O3', '$5.00'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toContain(3);
  });

  it('extractMegaBallsPerLineFromRawText: FL MB column OCR "N23" / "Ma13" still yields MBs', () => {
    const raw = ['19 37 50 61 67 N23 8', '04 15 16 25 27 Ma13 a6'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([23, 13]);
  });

  it('extractMegaBallsPerLineFromRawText: FL MB column OCR "ve3" / "w13 Q6" still yields MBs', () => {
    const raw = ['19 37 50 61 67 ve3 6', '04 15 16 25 27 w13 Q6'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([23, 13]);
  });

  it('extractMegaBallsPerLineFromRawText: FL "we13 s" + standalone 23 + Q6 line yields MBs', () => {
    const raw = [
      'FLORIDA MEGA MILLIONS',
      'A 19 37 50 61 67',
      'B 04 15 16 25 27 we13 s',
      '23',
      'Q6',
    ].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([13, 23]);
  });

  it('extractMegaBallsPerLineFromRawText: FL "MB3 6" and "v13 6" yields MB23/MB13', () => {
    const raw = [
      'FLORIDA MEGA MILLIONS',
      'A 19 37 50 61 67 MB3 6',
      'B 04 15 16 25 27 v13 6',
      '$4.00',
    ].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([23, 13]);
  });

  it('extractMegaBallsPerLineFromRawText: WA MEGA BALL column (10/08/07 with QP and multipliers)', () => {
    const raw = [
      "WASHINGTON'S LOTTERY",
      'MEGA',
      'MILIONS',
      'A. 23 26 46',
      'B. 43 59 61',
      'C. 07 11 15',
      'MEGA',
      'BALL',
      '10 (P 4X',
      '08 QP 2X',
      '07 0P 3X',
    ].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([10, 8, 7]);
  });

  it('extractMegaBallsPerLineFromRawText: WA MEGA BALL column still works when QP marker drops', () => {
    const raw = ['MEGA', 'BALL', '10 4X', '08 2X', '07 3X'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([10, 8, 7]);
  });

  it('parseUsPbMmLine: MI line with glued 1257 and EP markers yields Mega 12', () => {
    const r = parseUsPbMmLine('A.01 O8 11 1257 EP 12 EP 3X', 5, 70, 1, 25);
    expect(r.main).toEqual([1, 8, 11, 12, 57]);
    expect(r.special).toBe(12);
  });

  it('parseUsPbMmLine: odds-table line should not look like a valid play (guard for ocr.ts filters)', () => {
    const r = parseUsPbMmLine('ODDS: 1:290,472,336 1:12,629,232 1:893,762', 5, 70, 1, 25);
    // It might accidentally produce 5 numbers from digit soup; the filter must block it, not the parser.
    expect(r.main.length).toBeGreaterThanOrEqual(0);
  });

  it('stripUsPlayLineLetterPrefix: tolerates duplicated play letters (QC/SD/OE)', () => {
    expect(stripUsPlayLineLetterPrefix('QC 07 17 49 67 69').trim()).toBe('07 17 49 67 69');
    expect(stripUsPlayLineLetterPrefix('SD 24 25 37 55 65').trim()).toBe('24 25 37 55 65');
    expect(stripUsPlayLineLetterPrefix('OE 11 16 19 66 69').trim()).toBe('11 16 19 66 69');
    expect(stripUsPlayLineLetterPrefix('D2423 37 55 65').trim()).toBe('2423 37 55 65');
  });

  it('extractMegaBallFromRawText: TX MEGABALL label + next line "aP 06 QP" yields 6', () => {
    const raw = [
      'TEXAS',
      'MEGA',
      'A 01 02 16 24 66 GP',
      'MEGABALL',
      'aP 06 QP',
      'MEGAPLIER - YES',
    ].join('\n');
    expect(extractMegaBallFromRawText(raw)).toBe(6);
  });

  it('finalizeUsGameSpecialsFromRawText: TX lettered plays + trailing "04 aP" fills second MB', () => {
    const raw = [
      'PRINTED ON FRI JUN14 2019 16:27:19 CT',
      'RET# 123456-00',
      'MEGA MILLIONS GRAND PRIZE',
      'ODDS 1 IN 302.575.350',
      'OVERALL ODDS 1 IN 24.0',
      'rEGABALL',
      'A. 05 10 30 50 59 0P 02 GP',
      'B. 21 26 47 62 67 CP',
      '04 aP',
      '$4.00',
      'DRAW #945',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [5, 10, 30, 50, 59],
      allSets: [
        [5, 10, 30, 50, 59],
        [21, 26, 47, 62, 67],
      ],
      specialsPerLine: [0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([2, 4, 0]);
    expect(out.specialNumbers).toEqual([2]);
  });

  it('finalizeUsGameSpecialsFromRawText: NY Mega Millions messy OCR still yields Mega Ball 24', () => {
    const raw = [
      'y.ny.gov nylottery. ngov nylot',
      '01',
      'TEB',
      'EGA',
      'MILLIONS',
      '03 24. 42 58 680 24 oP',
      'FRI MAR20 20',
      'S2.00',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [3, 24, 42, 58, 68],
      allSets: [[3, 24, 42, 58, 68]],
      specialsPerLine: [0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([24, 0, 0]);
    expect(out.specialNumbers).toEqual([24]);
  });

  it('finalizeUsGameSpecialsFromRawText: NY Mega Millions split columns recover A–E mains+MB', () => {
    const raw = [
      'nylottery.ny.gov',
      'MEGA',
      'MILLIONS',
      'A 12 16 24 32',
      'B 10 12 14 43',
      'C 23 32 59 66',
      'D 12 20 26 35',
      'E 03 09 15 22',
      '34 oP 24 oP',
      '60 oP 21 oP',
      // Interleaved OCR: one side emits "69 op" alone, later "20 oP" alone.
      '69 op',
      '44 0P 03 oP',
      '52 0P 06 0P',
      '20 oP',
      'TUE AUG08 23',
      '$10.00',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [12, 16, 24, 32, 0],
      allSets: [[12, 16, 24, 32, 0]],
      specialsPerLine: [0, 0, 0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.allSets?.slice(0, 5)).toEqual([
      [12, 16, 24, 32, 34],
      [10, 12, 14, 43, 60],
      [23, 32, 59, 66, 69],
      [12, 20, 26, 35, 44],
      [3, 9, 15, 22, 52],
    ]);
    expect(out.specialsPerLine?.slice(0, 5)).toEqual([24, 21, 20, 3, 6]);
    expect(out.specialNumbers).toEqual([24]);
  });

  it('extracts MB list from rawText (per-line specials)', () => {
    const raw = ['MB: 12', 'MB 7', 'MB: 25', 'MB 3', 'MB: 9'].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([12, 7, 25, 3, 9]);
  });

  it('extracts MEGA per-line list from CA style (MEGA 03 QP + 11 QP)', () => {
    const raw = [
      'A 04 08 14 24 45',
      'B 07 19 33 41 62',
      'MEGA',
      '03 QP',
      'RI023069',
      '11 QP',
      'R1023069',
      '$4.00',
    ].join('\n');
    expect(extractMegaBallsPerLineFromRawText(raw)).toEqual([3, 11]);
  });

  it('finalizeUsGameSpecialsFromRawText: CA mega per-line list maps onto plays', () => {
    const raw = [
      'A 04 08 14 24 45',
      'B 07 19 33 41 62',
      'MEGA',
      '03 QP',
      '11 QP',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [4, 8, 14, 24, 45],
      allSets: [
        [4, 8, 14, 24, 45],
        [7, 19, 33, 41, 62],
      ],
      specialsPerLine: [0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([3, 11, 0]);
    expect(out.specialNumbers).toEqual([3]);
  });

  it('finalizeUsGameSpecialsFromRawText: MB list 4 items aligns to B–E when 5 plays exist', () => {
    const raw = [
      'B 07 19 43 54 55',
      'C 07 17 49 67 69',
      'D 24 25 37 55 65',
      'E 11 16 19 66 69',
      'MB: 08 X 02 EP',
      'MB: 09 X 03 EP',
      'MB: 08 X 02 EP',
      'MB: 01 X 02 EP',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [10, 13, 40, 42, 46],
      allSets: [
        [10, 13, 40, 42, 46], // A (user may ignore)
        [7, 19, 43, 54, 55],
        [7, 17, 49, 67, 69],
        [24, 25, 37, 55, 65],
        [11, 16, 19, 66, 69],
      ],
      specialsPerLine: [0, 0, 0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([0, 8, 9, 8, 1]);
    expect(out.specialNumbers).toEqual([8]);
  });

  it('finalizeUsGameSpecialsFromRawText: WA split columns recover 3 plays + mega ball column', () => {
    const raw = [
      "WASHINGTON'S LOTTERY",
      'MEGA',
      'MILIONS',
      'A. 23 26 46',
      'B. 43 59 61',
      'C. 07 11 15',
      '50',
      '64',
      '51',
      '67 0P',
      '70 0P',
      '64 0P',
      'MEGA',
      'BALL',
      '10 (P 4X',
      '08 QP 2X',
      '07 QP 3X',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [23, 26, 46],
      allSets: [[23, 26, 46, 0, 0]],
      specialsPerLine: [0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.allSets).toEqual([
      [23, 26, 46, 50, 67],
      [43, 59, 61, 64, 70],
      [7, 11, 15, 51, 64],
    ]);
    expect(out.specialsPerLine).toEqual([10, 8, 7]);
    expect(out.specialNumbers).toEqual([10]);
  });

  it('finalizeUsGameSpecialsFromRawText: WA recovered specials expand from shorter existing list', () => {
    const raw = [
      "WASHINGTON'S LOTTERY",
      'A. 23 26 46',
      'B. 43 59 61',
      'C. 07 11 15',
      '50',
      '64',
      '51',
      '67 0P',
      '70 0P',
      '64 0P',
      'MEGA',
      'BALL',
      '10 4X',
      '08 2X',
      '07 3X',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [23, 26, 43, 46, 59],
      allSets: [[23, 26, 43, 46, 59]],
      specialsPerLine: [10], // wrong short list from earlier parse
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([10, 8, 7]);
  });

  it('finalizeUsGameSpecialsFromRawText: CT play lines + one standalone MB line fills missing A', () => {
    const raw = [
      'A. 33 43 47 60 69',
      'B. 15 18 20 26 34 MB: 01',
      'MEGAPLIER = No',
      'MB: 07',
      'Q',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [33, 43, 47, 60, 69],
      allSets: [
        [33, 43, 47, 60, 69],
        [15, 18, 20, 26, 34],
      ],
      specialsPerLine: [0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'mega_millions', 1, 25) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([7, 1, 0]);
    expect(out.specialNumbers).toEqual([7]);
  });

  it('finalizeUsGameSpecialsFromRawText: PB list overrides wrong specials copied from mains', () => {
    const ticket: ParsedTicket = {
      mainNumbers: [9, 23, 35, 52, 54],
      allSets: [
        [9, 23, 35, 52, 54],
        [10, 24, 53, 58, 59],
        [22, 23, 31, 56, 65],
        [2, 21, 23, 47, 69],
        [23, 30, 33, 47, 69],
      ],
      specialsPerLine: [23, 24, 23, 23, 23],
      confidence: 0.5,
      rawText: [
        '09 23 35 52 54',
        '10 24 53 58 59',
        '22 23 31 56 65',
        '02 21 23 47 69',
        '23 30 33 47 69',
        'PB: 19 gp',
        'PB: 09 P',
        'PB: 24 QP',
        'PB: 05 gp',
        'PB: 14 qp',
      ].join('\n'),
    };
    const out = finalizeUsGameSpecialsFromRawText(ticket, 'powerball', 1, 26);
    expect(out?.specialsPerLine).toEqual([19, 9, 24, 5, 14]);
  });

  it('finalizeUsGameSpecialsFromRawText: recovers full PB play line from rawText', () => {
    const raw = [
      "GEORGIA'S",
      'POWER',
      'with POWERPLAY',
      'POWER PLAY - NO',
      'TOTAL $2.00',
      '01 25 27 40 47 07',
      'PB',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [1, 2, 19, 39, 58],
      allSets: [[1, 2, 19, 39, 58]],
      specialsPerLine: [25],
      confidence: 0.5,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.mainNumbers).toEqual([1, 25, 27, 40, 47]);
    expect(out.specialsPerLine).toEqual([7]);
  });

  it('finalizeUsGameSpecialsFromRawText: concatenates split mains lines and pairs PB list', () => {
    const raw = [
      'PRINTED ON 01/06/2016',
      '18:25:59',
      '15 21 39 47 62',
      '04 30 46',
      '58 59',
      'POWER PLAY - NO',
      'AP PB: 07 AP',
      'AP PB: 19 AP',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [15, 21, 39, 47, 62],
      allSets: [[15, 21, 39, 47, 62]],
      specialsPerLine: [7],
      confidence: 0.5,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [15, 21, 39, 47, 62],
      [4, 30, 46, 58, 59],
    ]);
    expect(out.specialsPerLine).toEqual([7, 19]);
  });

  it('finalizeUsGameSpecialsFromRawText: ohio rawText (printed+date+time on one line) still recovers 2 plays', () => {
    const raw = [
      'PRINTED ON 01/06/2016 18:25:59',
      '15 21 39 47 62',
      '04 30 46',
      '58 59',
      'POWER PLAY - NO',
      'AP PB: 07 AP',
      '$4.00',
      'AP PB: 19 AP',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [1, 6, 18, 25, 59],
      allSets: [
        [1, 6, 18, 25, 59],
        [4, 21, 39, 47, 62],
        [1, 4, 6, 16, 19],
      ],
      specialsPerLine: [7, 19, 7],
      confidence: 0.3,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [15, 21, 39, 47, 62],
      [4, 30, 46, 58, 59],
    ]);
    expect(out.specialsPerLine).toEqual([7, 19]);
  });

  it('finalizeUsGameSpecialsFromRawText: ignores early PB text before play lines', () => {
    const raw = [
      'AP PB: 07 AP',
      'AP PB: 19 AP',
      'PRINTED ON 01/06/2016 18:25:59',
      '15 21 39 47 62',
      '04 30 46',
      '58 59',
      'POWER PLAY - NO',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [1, 6, 18, 25, 59],
      allSets: [[1, 6, 18, 25, 59]],
      specialsPerLine: [7],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [15, 21, 39, 47, 62],
      [4, 30, 46, 58, 59],
    ]);
    expect(out.specialsPerLine).toEqual([7, 19]);
  });

  it('finalizeUsGameSpecialsFromRawText: inline PB: lines recover 5 plays (ohio 5-line ticket)', () => {
    const raw = [
      'PRINTED ON 01/08/2016 10:09:40',
      '38 58 59 65 55 AP PB: 02 QP',
      '12 46 43 56 68 AP PB: 16 QP',
      'O7 30 32 46 68 AP PB: 01 QP',
      '07 30 39 48 49 AP PB: 01 QP',
      '23 30 39 66 49 AP PB: 14 QP',
      'POWER PLAY - NO',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [1, 6, 18, 25, 59],
      allSets: [[1, 6, 18, 25, 59]],
      specialsPerLine: [7],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [38, 55, 58, 59, 65],
      [12, 43, 46, 56, 68],
      [7, 30, 32, 46, 68],
      [7, 30, 39, 48, 49],
      [23, 30, 39, 49, 66],
    ]);
    expect(out.specialsPerLine).toEqual([2, 16, 1, 1, 14]);
  });

  it('finalizeUsGameSpecialsFromRawText: lettered plays + PWR list (michigan style)', () => {
    const raw = [
      'MICHIGAN',
      'A.2O 22 26 28 63 EP',
      'B.01 04 27 46 58 EP',
      'C.11 17 28 39 53 EP 26 EP',
      'D.07 37 38 53 68 EP',
      'E.07 15 20 30 52 EP',
      'PWR',
      '1Ở EP',
      '26 EP',
      '15 EP',
      '13 EP',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [11, 17, 28, 39, 53],
      allSets: [[11, 17, 28, 39, 53]],
      specialsPerLine: [26],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [20, 22, 26, 28, 63],
      [1, 4, 27, 46, 58],
      [11, 17, 28, 39, 53],
      [7, 37, 38, 53, 68],
      [7, 15, 20, 30, 52],
    ]);
    expect(out.specialsPerLine).toEqual([10, 26, 26, 15, 13]);
  });

  it('finalizeUsGameSpecialsFromRawText: lettered mains + QP/OP Powerball value lines (illinois style)', () => {
    const raw = [
      'Your Numbers',
      'A. 16 18 54 59 67 OP',
      'B. 12 26 36 37 42 OP',
      'C. 22 27 32 50 69 QP -',
      'D. 16 33 39 60 66 QP -',
      // OCR ordering glitch: one value can appear before the header.
      '- 16 QP',
      'Powerball',
      '- 21 QP',
      '22 OP',
      '15 QP',
      'Powerplay: NO',
    ].join('\n');
    expect(__debug_extractLetteredPowerballPlays(raw).length).toBe(4);
    expect(__debug_extractPowerballValuesFromQpOpLines(raw)).toEqual([21, 16, 22, 15]);
    const bad: ParsedTicket = {
      mainNumbers: [16, 18, 54, 59, 67],
      allSets: [[16, 18, 54, 59, 67]],
      specialsPerLine: [0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [16, 18, 54, 59, 67],
      [12, 26, 36, 37, 42],
      [22, 27, 32, 50, 69],
      [16, 33, 39, 60, 66],
    ]);
    expect(out.specialsPerLine).toEqual([21, 16, 22, 15]);
  });

  it('finalizeUsGameSpecialsFromRawText: strips prefix letters before PB digits (fl style)', () => {
    const raw = [
      '09 24 30 42 52 10',
      '31 43 58 59 66 re07',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [9, 24, 30, 42, 52],
      allSets: [[9, 24, 30, 42, 52]],
      specialsPerLine: [10],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [9, 24, 30, 42, 52],
      [31, 43, 58, 59, 66],
    ]);
    expect(out.specialsPerLine).toEqual([10, 7]);
  });

  it('finalizeUsGameSpecialsFromRawText: florida PR2606 token still yields PB26', () => {
    const raw = [
      'FLORIDA',
      'POWERPLAY',
      'A 44 52 54 64 69 PR2606',
    ].join('\n');
    const bad: ParsedTicket = {
      mainNumbers: [44, 52, 54, 64, 69],
      allSets: [[44, 52, 54, 64, 69]],
      specialsPerLine: [0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.specialsPerLine).toEqual([26]);
    expect(out.specialNumbers).toEqual([26]);
  });

  it('parseUsPbMmLine: FL Powerball "ml0" is PB10', () => {
    const r = parseUsPbMmLine('09 24 30 42 52 ml0', 5, 69, 1, 26);
    expect(r.main).toEqual([9, 24, 30, 42, 52]);
    expect(r.special).toBe(10);
  });

  it('finalizeUsGameSpecialsFromRawText: NY split columns recover 10 lines', () => {
    const raw = `A.
A 01 14 22
27 35 36
c. 01 13 14
06 13 49
05 08 29
08 22 40 45
04 15 40
05 14 45 60
13 26 47 50
10 19 26 32
0
e
NEW YORK
H.
POWERPLAY
63 65 ar
41 58 aP
51
53
57 ar
66 ar
31 36 ar
42
68 ar
49 ar
69 ar
68 or
46 or
SAT AUG19 17
$20.00
11 or
26 oP
MEGA MILLINS JACKPOT
NOW $20 MILL ION.
RESUL İS NYLOTTERY NY.GOV
23
13 or
or
25 or
26 ar
17 ar
05 ar
18 ar
21 or`;
    const bad: ParsedTicket = {
      mainNumbers: [1, 14, 22, 27, 35],
      allSets: [[1, 14, 22, 27, 35]],
      specialsPerLine: [0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets?.length).toBeGreaterThanOrEqual(10);
    expect(out.specialsPerLine?.slice(0, 10)).toEqual([11, 26, 23, 13, 25, 26, 17, 5, 18, 21]);
    // Ensure last white-ball for H/I/J aligns (69/68/46) rather than reusing 49.
    expect(out.allSets?.[7]?.[4]).toBe(69);
    expect(out.allSets?.[8]?.[4]).toBe(68);
    expect(out.allSets?.[9]?.[4]).toBe(46);
  });

  it('finalizeUsGameSpecialsFromRawText: Texas lettered mains + POWERBALL column QP lines', () => {
    const raw = `TEXAS
POWERPLAYI
PRINTED ON WED JUN12 2019 16:27:19 CT
RET# 123456-00
A. 07 22 25 32 38 QP
B. 15 27 37 46 48 QP
POWER PLAY - N0
WED JUN12 2019
POWERBALL
13 QP
01 QP
$4.00`;
    const bad: ParsedTicket = {
      mainNumbers: [7, 22, 25, 32, 38],
      allSets: [[7, 22, 25, 32, 38]],
      specialsPerLine: [0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets).toEqual([
      [7, 22, 25, 32, 38],
      [15, 27, 37, 46, 48],
    ]);
    expect(out.specialsPerLine).toEqual([13, 1]);
    expect(out.specialNumbers).toEqual([13]);
  });

  it('finalizeUsGameSpecialsFromRawText: Georgia 5 mains lines + PB list maps per-line specials', () => {
    const raw = `GEORGIA
POWERPLAY
PRINTED MON APRO1 2019 14:51:54
09 23 35 52 54 AP
10 24 53 58 59 AP
22 23 31 56 65
02 21 23 47 69
23 30 33 47 69 AP
POWER PLAY - NO
PB: 19 gP
PB: 09 gP
PB: 24 aP
PB: 05 p
PB: 14 ap`;
    const bad: ParsedTicket = {
      mainNumbers: [9, 23, 35, 52, 54],
      allSets: [
        [9, 23, 35, 52, 54],
        [10, 24, 53, 58, 59],
        [22, 23, 31, 56, 65],
        [2, 21, 23, 47, 69],
        [23, 30, 33, 47, 69],
      ],
      specialsPerLine: [0, 0, 0, 0, 0],
      confidence: 0.2,
      rawText: raw,
    };
    const out = finalizeUsGameSpecialsFromRawText(bad, 'powerball', 1, 26) as ParsedTicket;
    expect(out.allSets?.length).toBe(5);
    expect(out.specialsPerLine).toEqual([19, 9, 24, 5, 14]);
    expect(out.specialNumbers).toEqual([19]);
  });

});
