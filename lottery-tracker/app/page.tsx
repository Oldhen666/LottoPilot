import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
import { NumberBalls } from '@/components/NumberBalls';

const DRAW_DAY_HINT: Record<string, string> = {
  CA_649: 'Wed/Sat',
  CA_LOTTOMAX: 'Tue/Fri',
  US_POWERBALL: 'Mon/Wed/Sat',
  US_MEGAMILLIONS: 'Tue/Fri',
};

const US_ONLY = ['US_POWERBALL', 'US_MEGAMILLIONS'];

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-6">
        <h2 className="font-semibold text-amber-400">Configuration required</h2>
        <p className="mt-2 text-slate-400">
          Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      </div>
    );
  }
  const supabase = getSupabaseClient();
  const [stateRes, runRes, lotteriesRes] = await Promise.all([
    supabase.from('lottery_state').select('*').order('lottery_code'),
    supabase.from('job_runs').select('*').order('started_at', { ascending: false }).limit(1).single(),
    supabase.from('lotteries').select('*').eq('is_active', true).order('code'),
  ]);

  const states = (stateRes.data || []) as Record<string, unknown>[];
  const run = runRes.data as Record<string, unknown> | null;
  const lotteries = (lotteriesRes.data || []) as Record<string, unknown>[];
  const stateByCode = Object.fromEntries(states.map((s) => [s.lottery_code, s]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {run && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="mb-2 text-sm font-medium text-slate-400">Last job run</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Status: <span className={`font-medium ${run.status === 'success' ? 'text-green-400' : run.status === 'partial' ? 'text-amber-400' : 'text-red-400'}`}>{String(run.status)}</span></span>
            <span>Started: {new Date(String(run.started_at)).toLocaleString()}</span>
            <span>Finished: {run.finished_at ? new Date(String(run.finished_at)).toLocaleString() : '—'}</span>
            {run.summary_json != null && typeof run.summary_json === 'object' ? (
              <span>
                Updated: {(run.summary_json as { updated?: string[] }).updated?.length ?? 0} |
                No draw: {(run.summary_json as { no_draw?: string[] }).no_draw?.length ?? 0} |
                Errors: {(run.summary_json as { errors?: string[] }).errors?.length ?? 0}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="px-4 py-3 text-left font-medium">Lottery</th>
              <th className="px-4 py-3 text-left font-medium">Region</th>
              <th className="px-4 py-3 text-left font-medium">Draw days</th>
              <th className="px-4 py-3 text-left font-medium">Latest draw</th>
              <th className="px-4 py-3 text-left font-medium">Numbers</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last success</th>
              <th className="px-4 py-3 text-left font-medium">Failures</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lotteries.map((lot) => {
              const code = String(lot.code);
              const state = stateByCode[code] as Record<string, unknown> | undefined;
              return (
                <tr key={code} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium">{String(lot.name)}</span>
                      {US_ONLY.includes(code) && (
                        <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-400">
                          US-only purchase; results tracking only
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{code}</span>
                  </td>
                  <td className="px-4 py-3">{String(lot.region)}</td>
                  <td className="px-4 py-3">{DRAW_DAY_HINT[code] ?? '—'}</td>
                  <td className="px-4 py-3">{state?.latest_draw_date ? String(state.latest_draw_date) : '—'}</td>
                  <td className="px-4 py-3">
                    <NumberBalls numbers={(state?.latest_numbers_json as object) ?? null} lotteryCode={code} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${
                      state?.latest_status === 'ok' ? 'bg-green-900/50 text-green-400' :
                      state?.latest_status === 'no_draw' ? 'bg-slate-700 text-slate-400' :
                      state?.latest_status === 'partial' ? 'bg-amber-900/50 text-amber-400' :
                      'bg-red-900/50 text-red-400'
                    }`}>
                      {state?.latest_status ? String(state.latest_status) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {state?.last_success_at ? new Date(String(state.last_success_at)).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">{state?.consecutive_failures != null ? String(state.consecutive_failures) : '0'}</td>
                  <td className="px-4 py-3">
                    <Link href={`/lottery/${code}`} className="text-amber-400 hover:underline">View history</Link>
                    {(state?.consecutive_failures as number) > 0 && (
                      <span className="ml-2">
                        <Link href="/errors" className="text-red-400 hover:underline">View errors</Link>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
