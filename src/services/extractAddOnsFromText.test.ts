import { extractAddOnsFromText } from './extractAddOnsFromText';

describe('extractAddOnsFromText', () => {
  it('detects Atlantic TAG even when OCR adds diacritics (TẤC)', () => {
    const text = `
649
Atlantic,
Atlantique
TẤC
235621
$5
    `.trim();
    const parsed = extractAddOnsFromText(text, 'lotto_649', 'NATIONAL');
    expect(parsed?.selected?.TAG).toBe(true);
    expect(parsed?.inputs?.TAG).toBe('235621');
  });

  it('detects TAG from full Atlantic 6/49 raw text', () => {
    const text = `
649
RETAILER PLAY
01 April/avril 2017
MAIN DRAW/TIRAGE PRINCIPAL
06 13 20 28 38 40
GUARANTEED PRIZE DRAW
TIRAGE LOT GARANTI
91510318-01
49
Atlantic,
Atlantique
MAIN DRAW/TIRAGE PRINCIPAL
01 08 09 13 15 47
GUARANTEED PRIZE DRAW
TIRAGE LOT GARANTI
A5604218-01
TẤC
235621
$5
TRAINING MODE - INVALID
NOT FOR SALE
2 111 1100 00000
It's your ticket. Siqh It
Find more lotto, rules, chances!
    `.trim();
    const parsed = extractAddOnsFromText(text, 'lotto_649', 'CA-NATIONAL');
    expect(parsed?.selected?.TAG).toBe(true);
    expect(parsed?.inputs?.TAG).toBe('235621');
  });
});

describe('extractAddOnsFromText — Ontario ENCORE', () => {
  test('OL-detached encore digits after repeated ENCORE block', () => {
    const text = `
PRINTED
02 03 12 40 42 44 45
ENCORE
ENCORE
ENCOREJ
OL4531022
Ticket No.
16984-0546-2184-2175-08806
`.trim();

    const r = extractAddOnsFromText(text, 'lotto_max', 'CA-ON');
    expect(r?.selected.ENCORE).toBe(true);
    expect(r?.inputs.ENCORE).toBe('4531022');
  });

  test('does not pick OLG ticket id hyphen segments as ENCORE', () => {
    const text = `EXTRA\n4788207\n16984-0546-2184-2175-08806`;
    expect(extractAddOnsFromText(text, 'lotto_max', 'CA-ON')).toBeUndefined();
  });
});

describe('extractAddOnsFromText — BC EXTRA (stylized OCR)', () => {
  test('eytra + grouped EXTRA line yields 8-digit normalized input', () => {
    const text = `
Lotto
02 12 24 27 34 40 50
16 23 27 29 35 46 48
03 05 14 20 28 31 36
08 13 20 22 30 51 52
eytra
47- 73 - 74-97 - YES
`.trim();

    const r = extractAddOnsFromText(text, 'lotto_max', 'CA-BC');
    expect(r?.selected.EXTRA).toBe(true);
    expect(r?.inputs.EXTRA).toBe('47737497');
  });
});
