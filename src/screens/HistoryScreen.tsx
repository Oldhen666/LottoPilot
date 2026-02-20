import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { getRecords } from '../db/sqlite';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { CheckRecord } from '../db/sqlite';
import type { LotteryId } from '../types/lottery';

interface Props {
  onSelectRecord: (r: CheckRecord) => void;
}

export default function HistoryScreen({ onSelectRecord }: Props) {
  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [filter, setFilter] = useState<LotteryId | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const list = await getRecords(
      filter === 'all' ? {} : { lottery_id: filter }
    );
    setRecords(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const LOTTERY_IDS: (LotteryId | 'all')[] = ['all', 'lotto_max', 'lotto_649', 'powerball', 'mega_millions'];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>History</Text>

      <View style={styles.filterRow}>
        {LOTTERY_IDS.map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.filterChip, filter === id && styles.filterChipActive]}
            onPress={() => setFilter(id)}
          >
            <Text style={styles.filterText}>{id === 'all' ? 'All' : LOTTERY_DEFS[id].name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
      ) : records.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No check records yet</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => onSelectRecord(item)}
            >
              <View style={styles.cardRow}>
                <Text style={styles.cardLottery}>{LOTTERY_DEFS[item.lottery_id]?.name}</Text>
                <Text style={styles.cardDate}>{item.draw_date}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardResult}>
                  {item.match_count_main} main, {item.match_count_special} special • {item.result_bucket}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 16 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  filterChipActive: { backgroundColor: '#6366f1' },
  filterText: { color: '#f8fafc', fontSize: 14 },
  loader: { marginTop: 40 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#64748b' },
  list: { paddingBottom: 40 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardLottery: { color: '#f8fafc', fontWeight: '600' },
  cardDate: { color: '#94a3b8', fontSize: 14 },
  cardResult: { color: '#94a3b8', fontSize: 14 },
});
