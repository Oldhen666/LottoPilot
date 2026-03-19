import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import Link from 'next/link';

export default async function ErrorsPage() {
  if (!isSupabaseConfigured()) {
    return <div className="text-amber-400">Configure .env.local first.</div>;
  }
  const supabase = getSupabaseClient();
  const { data: errors } = await supabase
    .from('job_errors')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const list = (errors || []) as Record<string, unknown>[];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-amber-400 hover:underline">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold">Job Errors</h1>
        <p className="text-slate-400">Last 50 errors</p>
      </div>

      <div className="space-y-3">
        {list.map((e) => (
          <div
            key={String(e.id)}
            className="rounded-lg border border-slate-700 bg-slate-900/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-red-900/50 px-2 py-0.5 text-red-400">{String(e.stage)}</span>
              <span className="text-slate-400">{String(e.lottery_code)}</span>
              <span className="text-slate-500">{e.created_at ? new Date(String(e.created_at)).toLocaleString() : ''}</span>
            </div>
            <p className="mt-2 font-medium">{String(e.message)}</p>
            {typeof e.error_stack === 'string' && e.error_stack ? (
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-400">
                {e.error_stack}
              </pre>
            ) : null}
            {e.context_json != null ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-amber-400 hover:underline">Context</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-xs">
                  {JSON.stringify(e.context_json, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ))}
      </div>
      {list.length === 0 && <p className="text-slate-500">No errors recorded.</p>}
    </div>
  );
}
