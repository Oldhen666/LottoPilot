/**
 * LottoPilot Edge Function: AI Analysis
 * Returns insights, simulation summary, and suggested picks with disclaimer.
 * MVP: Rule-based engine (not a real LLM). No "guarantee" or "winning" language.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisRequest {
  lottery_type: string;
  user_preferences?: Record<string, number>;
  history_window?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body: AnalysisRequest = await req.json();
    const { lottery_type, user_preferences = {}, history_window = 20 } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: draws } = await supabase
      .from('draws')
      .select('winning_numbers, special_numbers')
      .eq('lottery_id', lottery_type)
      .order('draw_date', { ascending: false })
      .limit(history_window);

    const nums: number[] = [];
    const specials: number[] = [];
    for (const d of draws || []) {
      (d.winning_numbers as number[]).forEach((n: number) => nums.push(n));
      ((d.special_numbers as number[]) || []).forEach((n: number) => specials.push(n));
    }

    const freq: Record<number, number> = {};
    for (const n of nums) freq[n] = (freq[n] || 0) + 1;
    const hot = Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([n]) => parseInt(n, 10));

    const cold = Object.entries(freq)
      .sort(([, a], [, b]) => a - b)
      .slice(0, 10)
      .map(([n]) => parseInt(n, 10));

    const hotWeight = user_preferences.hot_weight ?? 0.5;
    const coldWeight = user_preferences.cold_weight ?? 0.3;
    const balanceWeight = 1 - hotWeight - coldWeight;

    const suggested = generateSuggestedPicks(
      lottery_type,
      hot,
      cold,
      hotWeight,
      coldWeight,
      balanceWeight
    );

    const response = {
      insights: {
        hot_numbers: hot,
        cold_numbers: cold,
        sample_size: draws?.length ?? 0,
        note: 'Based on historical frequency. For entertainment and decision support only.',
      },
      simulation_summary: {
        approach: 'weighted frequency analysis',
        weights: { hot: hotWeight, cold: coldWeight, balanced: balanceWeight },
      },
      suggested_picks: suggested.map((p) => ({
        numbers: p.main,
        special: p.special,
        explanation: p.explanation,
      })),
      disclaimer:
        'Suggested picks are for analysis purposes only. They do not increase or guarantee any outcome. Use at your own discretion.',
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function getLotteryRules(id: string): { main: number; mainMax: number; specialMax: number } {
  const rules: Record<string, { main: number; mainMax: number; specialMax: number }> = {
    lotto_max: { main: 7, mainMax: 49, specialMax: 49 },
    lotto_649: { main: 6, mainMax: 49, specialMax: 49 },
    powerball: { main: 5, mainMax: 69, specialMax: 26 },
    mega_millions: { main: 5, mainMax: 70, specialMax: 25 },
  };
  return rules[id] || { main: 6, mainMax: 49, specialMax: 49 };
}

function generateSuggestedPicks(
  lotteryId: string,
  hot: number[],
  cold: number[],
  hw: number,
  cw: number,
  bw: number
): Array<{ main: number[]; special: number[]; explanation: string }> {
  const rules = getLotteryRules(lotteryId);
  const picks: Array<{ main: number[]; special: number[]; explanation: string }> = [];

  const takeFrom = (arr: number[], count: number, used: Set<number>): number[] => {
    const out: number[] = [];
    for (const n of arr) {
      if (out.length >= count) break;
      if (!used.has(n)) {
        out.push(n);
        used.add(n);
      }
    }
    return out;
  };

  const fillRandom = (max: number, count: number, used: Set<number>): number[] => {
    const out: number[] = [];
    while (out.length < count) {
      const n = Math.floor(Math.random() * max) + 1;
      if (!used.has(n)) {
        out.push(n);
        used.add(n);
      }
    }
    return out.sort((a, b) => a - b);
  };

  for (let i = 0; i < 3; i++) {
    const used = new Set<number>();
    const fromHot = takeFrom(hot, Math.floor(rules.main * hw), used);
    const fromCold = takeFrom(cold, Math.floor(rules.main * cw), used);
    const rest = fillRandom(rules.mainMax, rules.main - fromHot.length - fromCold.length, used);
    const main = [...fromHot, ...fromCold, ...rest].sort((a, b) => a - b);
    const special = [Math.floor(Math.random() * rules.specialMax) + 1];
    picks.push({
      main,
      special,
      explanation: `Weighted mix: ~${Math.round(hw * 100)}% hot, ~${Math.round(cw * 100)}% cold, ~${Math.round(bw * 100)}% balanced`,
    });
  }

  return picks;
}
