'use client';

type NumbersJson =
  | { main?: number[]; bonus?: number; encore?: string; extra?: string }
  | { white?: number[]; powerball?: number; power_play_multiplier?: number }
  | { white?: number[]; mega_ball?: number; megaplier_multiplier?: number };

interface Props {
  numbers: NumbersJson | null;
  lotteryCode: string;
}

export function NumberBalls({ numbers, lotteryCode }: Props) {
  if (!numbers) return <span className="text-slate-500">—</span>;

  const isUS = lotteryCode.startsWith('US_');
  const main = 'main' in numbers ? numbers.main : 'white' in numbers ? numbers.white : [];
  const special = 'powerball' in numbers ? numbers.powerball : 'mega_ball' in numbers ? numbers.mega_ball : 'bonus' in numbers ? numbers.bonus : undefined;
  const multiplier = 'power_play_multiplier' in numbers ? numbers.power_play_multiplier : 'megaplier_multiplier' in numbers ? numbers.megaplier_multiplier : undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(main || []).map((n, i) => (
        <span
          key={i}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold"
        >
          {n}
        </span>
      ))}
      {special != null && (
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
            lotteryCode === 'US_POWERBALL' ? 'border-2 border-red-500 bg-red-900/50' : 'border-2 border-amber-500 bg-amber-900/50'
          }`}
        >
          {special}
        </span>
      )}
      {multiplier != null && (
        <span className="rounded bg-slate-600 px-1.5 py-0.5 text-xs font-medium">×{multiplier}</span>
      )}
    </div>
  );
}
