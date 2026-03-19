/**
 * Parameters for Compass Generate number feature.
 * All values 0-100, default 50 (middle).
 */
export interface GenerateParams {
  trendScore: number;      // 0=cold, 50=neutral, 100=hot
  positionFreq: number;   // 0=ignore, 100=strong prefer position-frequent
  oddEven: number;        // 0=more even, 50=balanced, 100=more odd
  lowHighSplit: number;   // 0=more low, 50=balanced, 100=more high
  sumRange: number;       // 0=lower sum, 50=mid, 100=higher sum
  maxGap: number;         // 0=smaller gaps, 50=mid, 100=larger gaps
}

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  trendScore: 50,
  positionFreq: 50,
  oddEven: 50,
  lowHighSplit: 50,
  sumRange: 50,
  maxGap: 50,
};
