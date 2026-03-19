import type { Fetcher } from './types';
import { fetcher649 } from './ca-649';
import { fetcherLottoMax } from './ca-lottomax';
import { fetcherPowerball } from './us-powerball';
import { fetcherMegaMillions } from './us-megamillions';

export const fetchers: Fetcher[] = [
  fetcher649,
  fetcherLottoMax,
  fetcherPowerball,
  fetcherMegaMillions,
];

export { fetcher649, fetcherLottoMax, fetcherPowerball, fetcherMegaMillions };
export type { Fetcher, ParsedDraw, NumbersJson } from './types';
export { getExpectedDrawDates } from './base';
