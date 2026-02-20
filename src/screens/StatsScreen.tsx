import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { getStatsForInsights, getMyPickStats } from '../db/sqlite';
import { LOTTERY_DEFS } from '../constants/lotteries';

export default function StatsScreen() {
  const [outcome, setOutcome] = useState<Awaited<ReturnType<typeof getStatsForInsights>> | null>(null);
  const [picks, setPicks] = useState<Awaited<ReturnType<typeof getMyPickStats>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStatsForInsights(), getMyPickStats()]).then(([o, p]) => {
      setOutcome(o);
      setPicks(p);
      setLoading(false);
    });
  }, []);

  if (loading || !outcome) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Stats</Text>
        <Text style={styles.empty}>{loading ? 'Loading...' : 'No data yet. Check some tickets first.'}</Text>
      </View>
    );
  }

  const hitRate = outcome.total > 0 ? ((outcome.anyHitCount / outcome.total) * 100).toFixed(1) : '0';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Stats & Insights</Text>
      <Text style={styles.subtitle}>Outcome summary from your checks (for informational use only)</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Outcome Summary</Text>
        <View style={styles.card}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total checks</Text>
            <Text style={styles.statValue}>{outcome.total}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Any hit count</Text>
            <Text style={styles.statValue}>{outcome.anyHitCount}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Hit frequency</Text>
            <Text style={styles.statValue}>{hitRate}%</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Longest dry streak</Text>
            <Text style={styles.statValue}>{outcome.longestDryStreak}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hit Distribution (main numbers)</Text>
        <View style={styles.card}>
          {Object.entries(outcome.hitDistribution)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([k, v]) => (
              <View key={k} style={styles.distRow}>
                <Text style={styles.distLabel}>{k} matches</Text>
                <Text style={styles.distValue}>{v}</Text>
              </View>
            ))}
        </View>
      </View>

      {outcome.specialHitCount > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Special number hits</Text>
          <Text style={styles.statValue}>{outcome.specialHitCount}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>By Lottery</Text>
        {Object.entries(outcome.byLottery).map(([id, data]) => (
          <View key={id} style={styles.lotteryCard}>
            <Text style={styles.lotteryName}>{LOTTERY_DEFS[id]?.name}</Text>
            <Text style={styles.lotteryStats}>
              {data.total} checks • {data.hitCount} hits
            </Text>
          </View>
        ))}
      </View>

      {picks && (picks.topMain.length > 0 || Object.keys(picks.oddEvenRatios).length > 0) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Pick Stats</Text>
          <View style={styles.card}>
            <Text style={styles.pickLabel}>Top picked main numbers</Text>
            <View style={styles.numberRow}>
              {picks.topMain.slice(0, 10).map(({ num, count }) => (
                <View key={num} style={styles.pickBall}>
                  <Text style={styles.pickNum}>{num}</Text>
                  <Text style={styles.pickCount}>{count}</Text>
                </View>
              ))}
            </View>
            {Object.keys(picks.oddEvenRatios).length > 0 && (
              <>
                <Text style={styles.pickLabel}>Odd / Even distribution</Text>
                <View style={styles.oddEvenRow}>
                  <Text style={styles.oddEvenText}>
                    Odd: {picks.oddEvenRatios.odd || 0}
                  </Text>
                  <Text style={styles.oddEvenText}>
                    Even: {picks.oddEvenRatios.even || 0}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 12, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 8 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  statLabel: { color: '#94a3b8' },
  statValue: { color: '#f8fafc', fontWeight: '600' },
  distRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  distLabel: { color: '#94a3b8' },
  distValue: { color: '#f8fafc' },
  lotteryCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  lotteryName: { color: '#f8fafc', fontWeight: '600' },
  lotteryStats: { color: '#94a3b8', fontSize: 14 },
  pickLabel: { color: '#94a3b8', fontSize: 12, marginTop: 12, marginBottom: 8 },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickBall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickNum: { color: '#f8fafc', fontWeight: '700' },
  pickCount: { color: '#64748b', fontSize: 10 },
  oddEvenRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  oddEvenText: { color: '#f8fafc' },
  empty: { color: '#64748b', marginTop: 20 },
});
