import { isValidDrawDate } from './drawDateValidation';

describe('isValidDrawDate', () => {
  it('Powerball: Mon 2025-02-17 is valid', () => {
    expect(isValidDrawDate('2025-02-17', 'powerball')).toBe(true);
  });
  it('Powerball: Wed 2025-02-19 is valid', () => {
    expect(isValidDrawDate('2025-02-19', 'powerball')).toBe(true);
  });
  it('Powerball: Sat 2025-02-22 is valid', () => {
    expect(isValidDrawDate('2025-02-22', 'powerball')).toBe(true);
  });
  it('Powerball: Tue 2025-02-18 is invalid', () => {
    expect(isValidDrawDate('2025-02-18', 'powerball')).toBe(false);
  });
  it('Powerball: Sun 2025-02-16 is invalid', () => {
    expect(isValidDrawDate('2025-02-16', 'powerball')).toBe(false);
  });

  it('Mega Millions: Tue 2025-02-18 is valid', () => {
    expect(isValidDrawDate('2025-02-18', 'mega_millions')).toBe(true);
  });
  it('Mega Millions: Fri 2025-02-21 is valid', () => {
    expect(isValidDrawDate('2025-02-21', 'mega_millions')).toBe(true);
  });
  it('Mega Millions: Mon 2025-02-17 is invalid', () => {
    expect(isValidDrawDate('2025-02-17', 'mega_millions')).toBe(false);
  });
});
