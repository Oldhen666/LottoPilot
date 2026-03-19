import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { NumberBalls } from '@/components/NumberBalls';

const DRAW_DAY_HINT: Record<string, string> = {
  CA_649: 'Wed/Sat',
  CA_LOTTOMAX: 'Tue/Fri',
  US_POWERBALL: 'Mon/Wed/Sat',
  US_MEGAMILLIONS: 'Tue/Fri',
};

export default async function LotteryDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSupabaseConfigured()) {
    return <div className="text-amber-400">Configure .env.local first.</div>;
  }
  const supabase = getSupabaseClient();
  const [lotteryRes, drawsRes] = await Promise.all([
    supabase.from('lotteries').select('*').eq('code', code).single(),
    supabase.from('lottery_draws').select('*').eq('lottery_code', code).order('draw_date', { ascending: false }).limit(20),
  ]);

  const lottery = lotteryRes.data as Record<string, unknown> | null;
  const draws = (drawsRes.data || []) as Record<string, unknown>[];

  if (!lottery) {
    return (
      <div>
        <Link href="/" className="text-amber-400 hover:underline">← Back</Link>
        <p className="mt-4">Lottery not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-amber-400 hover:underline">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold">{String(lottery.name)}</h1>
        <p className="text-slate-400">Draw days: {DRAW_DAY_HINT[code] ?? '—'}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="px-4 py-3 text-left font-medium">Draw date</th>
              <th className="px-4 py-3 text-left font-medium">Draw ID</th>
              <th className="px-4 py-3 text-left font-medium">Numbers</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Fetched at</th>
              <th className="px-4 py-3 text-left font-medium">Raw</th>
            </tr>
          </thead>
          <tbody>
            {draws.map((d) => (
              <tr key={String(d.id)} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="px-4 py-3">{String(d.draw_date)}</td>
                <td className="px-4 py-3">{d.draw_id ? String(d.draw_id) : '—'}</td>
                <td className="px-4 py-3">
                  <NumberBalls numbers={(d.numbers_json as object) ?? null} lotteryCode={code} />
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    d.status === 'ok' ? 'bg-green-900/50 text-green-400' :
                    d.status === 'no_draw' ? 'bg-slate-700 text-slate-400' :
                    d.status === 'partial' ? 'bg-amber-900/50 text-amber-400' :
                    'bg-red-900/50 text-red-400'
                  }`}>
                    {String(d.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {d.fetched_at ? new Date(String(d.fetched_at)).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  {d.raw_payload ? (
                    <details className="cursor-pointer">
                      <summary className="text-amber-400 hover:underline">View</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-900 p-2 text-xs">
                        {JSON.stringify(d.raw_payload, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draws.length === 0 && <p className="text-slate-500">No draws yet.</p>}
    </div>
  );
}
