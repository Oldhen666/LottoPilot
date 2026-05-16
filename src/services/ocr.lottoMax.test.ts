jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

// Avoid importing native/expo modules in Jest. These are only used by the runtime OCR pipeline.
jest.mock('./powerballOcr/mlkitRecognize', () => ({
  recognizeTicketText: jest.fn(async () => ({ text: '' })),
}));
jest.mock('./ticketPreprocess/preprocessTicketImage', () => ({
  preprocessTicketImageForOcr: jest.fn(async () => ({
    variantUris: [],
    labels: [],
    cleanup: jest.fn(async () => {}),
  })),
}));
jest.mock('./ticketPreprocess/debugCopy', () => ({
  copyVariantUrisForDebug: jest.fn(async () => []),
}));

// Use require so the mock applies before module load.
const { parseMlKitResultToTicket, scoreParsedTicket } = require('./ocr') as typeof import('./ocr');
type MlKitResult = import('./ocr').MlKitResult;

describe('Lotto Max OCR parsing (separate from PB/MM)', () => {
  test('parses 3 play lines from typical Lotto Max rawText (structure-based)', () => {
    const text = `
Ontario
LOTTO MAX
1 DRAW
TUE FEB24 26
40-5974-2837078-942-00
QUICK PICK
19 21 23 25 39 40 50 QP
08 11 15 21 40 44 46 QP
06 10 13 28 29 34 48
EXTRA
4788207
ENTERED
SEE REVERSE
6.00
SYSTD 4605
`.trim();

    const r: MlKitResult = { text };
    const parsed = parseMlKitResultToTicket(r, {
      mainCount: 7,
      mainMax: 50,
      specialMax: 0,
      specialCount: 0,
      lotteryId: 'lotto_max',
      playsPerTicket: 3,
      jurisdictionCode: 'CA-ON',
    });

    expect(parsed?.allSets).toEqual([
      [19, 21, 23, 25, 39, 40, 50],
      [8, 11, 15, 21, 40, 44, 46],
      [6, 10, 13, 28, 29, 34, 48],
    ]);
  });

  test('scoring does not depend on PB/MM special-ball heuristics', () => {
    const r: MlKitResult = { text: '19 21 23 25 39 40 50\n08 11 15 21 40 44 46\n06 10 13 28 29 34 48' };
    const parsed = parseMlKitResultToTicket(r, {
      mainCount: 7,
      mainMax: 50,
      specialMax: 0,
      specialCount: 0,
      lotteryId: 'lotto_max',
      playsPerTicket: 3,
    });
    const s = scoreParsedTicket(parsed, 7, 50, { lotteryId: 'lotto_max' });
    expect(s).toBeGreaterThan(0);
  });

  test('extracts Ontario ENCORE when digits are glued (OL4531022)', () => {
    const text = `
PRINTED/IMPRIMÉ 08:25:03 AM ET
Lotto
13-MAY/MAI-2025
QUICK PICK / MISE-ÉCLAIR
02 03 12 40 42 44 45
06 16 24 32 35 44 49
03 09 24 27 30 36 50
$6.00
ENCORE
ENCORE
ENCOREJ
OL4531022
PLAYEDI
Ticket No. Billet
16984-0546-2184-2175-08806
`.trim();

    const r: MlKitResult = { text };
    const parsed = parseMlKitResultToTicket(r, {
      mainCount: 7,
      mainMax: 50,
      specialMax: 0,
      specialCount: 0,
      lotteryId: 'lotto_max',
      playsPerTicket: 3,
      jurisdictionCode: 'CA-ON',
    });

    expect(parsed?.addOnsDetected?.selected?.ENCORE).toBe(true);
    expect(parsed?.addOnsDetected?.inputs?.ENCORE).toBe('4531022');
  });

  test('parses 4 Lotto Max lines for BC-style slip when playsPerTicket allows', () => {
    const text = `
Lotto
02 12 24 27 34 40 50
16 23 27 29 35 46 48
03 05 14 20 28 31 36
08 13 20 22 30 51 52
eytra
47- 73 - 74-97 - YES
`.trim();

    const r: MlKitResult = { text };
    const parsed = parseMlKitResultToTicket(r, {
      mainCount: 7,
      mainMax: 50,
      specialMax: 0,
      specialCount: 0,
      lotteryId: 'lotto_max',
      playsPerTicket: 6,
      jurisdictionCode: 'CA-BC',
    });

    expect(parsed?.allSets?.length).toBe(4);
    expect(parsed?.allSets?.[3]).toEqual([8, 13, 20, 22, 30, 51, 52]);
    expect(parsed?.addOnsDetected?.selected?.EXTRA).toBe(true);
  });
});

