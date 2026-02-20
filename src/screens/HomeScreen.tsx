import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLatestDraw } from '../hooks/useDraws';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';

const LOTTERY_IDS: LotteryId[] = ['lotto_max', 'lotto_649', 'powerball', 'mega_millions'];

interface Props {
  onSelectLottery: (id: LotteryId) => void;
  onCheckTicket: () => void;
}

export default function HomeScreen({ onSelectLottery, onCheckTicket }: Props) {
  const [selectedId, setSelectedId] = useState<LotteryId>('lotto_max');
  const { draw, loading } = useLatestDraw(selectedId);
  const def = LOTTERY_DEFS[selectedId];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>LottoPilot</Text>
      <Text style={styles.subtitle}>Official lottery ticket checker</Text>

      <View style={styles.lotteryGrid}>
        {LOTTERY_IDS.map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.lotteryCard, selectedId === id && styles.lotteryCardActive]}
            onPress={() => setSelectedId(id)}
          >
            <Text style={styles.lotteryName}>{LOTTERY_DEFS[id].name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.latestSection}>
        <Text style={styles.sectionTitle}>Latest Draw ({def?.name})</Text>
        {loading ? (
          <ActivityIndicator size="small" color="#6366f1" />
        ) : draw ? (
          <View style={styles.drawDisplay}>
            <Text style={styles.drawDate}>{draw.draw_date}</Text>
            <View style={styles.numberRow}>
              {draw.winning_numbers.map((n, i) => (
                <View key={i} style={styles.ball}>
                  <Text style={styles.ballText}>{n}</Text>
                </View>
              ))}
              {draw.special_numbers?.map((n, i) => (
                <View key={`s${i}`} style={[styles.ball, styles.ballSpecial]}>
                  <Text style={styles.ballText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Text style={styles.noData}>No draw data yet. Run seed script.</Text>
        )}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onCheckTicket}>
        <Text style={styles.primaryBtnText}>Check My Ticket</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => onSelectLottery(selectedId)}
      >
        <Text style={styles.secondaryBtnText}>View Draw History</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 24 },
  lotteryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  lotteryCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  lotteryCardActive: { backgroundColor: '#6366f1' },
  lotteryName: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  drawDisplay: { marginTop: 8 },
  latestSection: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  sectionTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 8 },
  drawDate: { color: '#f8fafc', fontSize: 14, marginBottom: 12 },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ball: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballSpecial: { backgroundColor: '#10b981' },
  ballText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  noData: { color: '#64748b', fontSize: 14 },
  primaryBtn: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryBtnText: { color: '#94a3b8', fontSize: 16 },
});
