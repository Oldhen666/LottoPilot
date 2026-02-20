import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useDraws } from '../hooks/useDraws';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { LotteryId } from '../types/lottery';
import type { Draw } from '../types/lottery';

interface Props {
  lotteryId: LotteryId;
  onBack: () => void;
}

export default function DrawsListScreen({ lotteryId, onBack }: Props) {
  const { draws, loading, error } = useDraws(lotteryId);
  const def = LOTTERY_DEFS[lotteryId];

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{def?.name} - Past Draws</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : draws.length === 0 ? (
        <Text style={styles.empty}>No draws yet</Text>
      ) : (
        <FlatList
          data={draws}
          keyExtractor={(d) => d.draw_date}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.drawDate}>{item.draw_date}</Text>
              <View style={styles.numberRow}>
                {item.winning_numbers.map((n, i) => (
                  <View key={i} style={styles.ball}>
                    <Text style={styles.ballText}>{n}</Text>
                  </View>
                ))}
                {item.special_numbers?.map((n, i) => (
                  <View key={`s${i}`} style={[styles.ball, styles.ballSpecial]}>
                    <Text style={styles.ballText}>{n}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  backBtn: { marginBottom: 16 },
  backText: { color: '#94a3b8', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#f8fafc', marginBottom: 20 },
  loader: { marginTop: 40 },
  error: { color: '#ef4444', marginTop: 20 },
  empty: { color: '#64748b', marginTop: 20 },
  list: { paddingBottom: 40 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  drawDate: { color: '#f8fafc', fontSize: 16, fontWeight: '600', marginBottom: 12 },
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
});
