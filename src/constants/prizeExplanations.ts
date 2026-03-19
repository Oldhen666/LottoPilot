/**
 * Prize explanation for each lottery. Shown in Check Ticket page.
 * Rules vary by jurisdiction; this is a general reference.
 */
import type { LotteryId } from '../types/lottery';

export interface PrizeTierRow {
  match: string;
  prize: string;
}

export const PRIZE_EXPLANATIONS: Record<LotteryId, { title: string; intro: string; tiers: PrizeTierRow[]; note: string }> = {
  lotto_max: {
    title: 'Lotto Max Prize Rules',
    intro: 'Pick 7 main numbers (1–50) + 1 Bonus. Main numbers match against the draw; Bonus is drawn from the 8 drawn numbers (7 main + 1 bonus).',
    tiers: [
      { match: '7 main + Bonus', prize: 'Jackpot' },
      { match: '7 main', prize: 'Match 7 (pari-mutuel)' },
      { match: '6 main + Bonus', prize: 'Match 6 + Bonus (pari-mutuel)' },
      { match: '6 main', prize: 'Varies (pari-mutuel)' },
      { match: '5 main + Bonus', prize: 'Varies (pari-mutuel)' },
      { match: '5 main', prize: 'Varies (pari-mutuel)' },
      { match: '4 main + Bonus', prize: 'Varies (pari-mutuel)' },
      { match: '4 main', prize: '$20' },
      { match: '3 main + Bonus', prize: '$20' },
      { match: '3 main', prize: 'Free Play' },
    ],
    note: '3 plays per ticket. Prizes in CAD; amounts may vary by province.',
  },
  lotto_649: {
    title: 'Lotto 6/49 Prize Rules',
    intro: 'Pick 6 main numbers (1–49) + 1 Bonus. Main numbers match against the draw; Bonus is drawn from the 7 drawn numbers (6 main + 1 bonus).',
    tiers: [
      { match: '6 main', prize: 'Jackpot (pari-mutuel)' },
      { match: '5 main + Bonus', prize: 'Varies (pari-mutuel)' },
      { match: '5 main', prize: 'Varies (pari-mutuel)' },
      { match: '4 main', prize: 'Varies (pari-mutuel)' },
      { match: '3 main + Bonus', prize: '$10' },
      { match: '3 main', prize: '$10' },
      { match: '2 main + Bonus', prize: '$5' },
      { match: '2 main', prize: 'Free Play' },
    ],
    note: '3 plays per ticket. Prizes in CAD; amounts may vary by province.',
  },
  powerball: {
    title: 'Powerball Prize Rules',
    intro: 'Pick 5 white balls (1–69) + 1 Powerball red ball (1–26). White balls and Powerball are matched separately.',
    tiers: [
      { match: '5 white + Powerball', prize: 'Jackpot' },
      { match: '5 white', prize: '$1,000,000' },
      { match: '4 white + Powerball', prize: '$50,000' },
      { match: '4 white', prize: '$100' },
      { match: '3 white + Powerball', prize: '$100' },
      { match: '3 white', prize: '$7' },
      { match: '2 white + Powerball', prize: '$7' },
      { match: '1 white + Powerball', prize: '$4' },
      { match: 'Powerball only', prize: '$4' },
    ],
    note: '5 plays per ticket. Draw days: Mon, Wed, Sat. Power Play multiplies non-jackpot prizes.',
  },
  mega_millions: {
    title: 'Mega Millions Prize Rules',
    intro: 'Pick 5 white balls (1–70) + 1 Mega Ball gold ball (1–25). White balls and Mega Ball are matched separately.',
    tiers: [
      { match: '5 white + Mega Ball', prize: 'Jackpot' },
      { match: '5 white', prize: '$1,000,000' },
      { match: '4 white + Mega Ball', prize: '$10,000' },
      { match: '4 white', prize: '$500' },
      { match: '3 white + Mega Ball', prize: '$200' },
      { match: '3 white', prize: '$10' },
      { match: '2 white + Mega Ball', prize: '$10' },
      { match: '1 white + Mega Ball', prize: '$4' },
      { match: 'Mega Ball only', prize: '$2' },
    ],
    note: '5 plays per ticket. Draw days: Tue, Fri. Megaplier multiplies non-jackpot prizes.',
  },
};
