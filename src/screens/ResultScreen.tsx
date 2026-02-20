import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LOTTERY_DEFS } from '../constants/lotteries';
import type { CheckRecord } from '../db/sqlite';

interface Props {
  record: CheckRecord;
  onDone: () => void;
}

export default function ResultScreen({ record, onDone }: Props) {
  const def = LOTTERY_DEFS[record.lottery_id];
  const mainSet = new Set(record.winning_numbers);
  const specialSet = record.winning_special?.length
    ? new Set(record.winning_special)
    : undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Check Result</Text>
      <Text style={styles.subtitle}>
        {def?.name} • {record.draw_date}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Numbers</Text>
        <View style={styles.numberRow}>
          {record.user_numbers.map((n, i) => {
            const hit = mainSet.has(n);
            return (
              <View key={i} style={[styles.ball, hit && styles.ballHit]}>
                <Text style={styles.ballText}>{n}</Text>
              </View>
            );
          })}
          {record.user_special?.map((n, i) => {
            const hit = specialSet?.has(n);
            return (
              <View key={`s${i}`} style={[styles.ball, styles.ballSpecial, hit && styles.ballHit]}>
                <Text style={styles.ballText}>{n}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Winning Numbers</Text>
        <View style={styles.numberRow}>
          {record.winning_numbers.map((n, i) => (
            <View key={i} style={styles.ball}>
              <Text style={styles.ballText}>{n}</Text>
            </View>
          ))}
          {record.winning_special?.map((n, i) => (
            <View key={`s${i}`} style={[styles.ball, styles.ballSpecial]}>
              <Text style={styles.ballText}>{n}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.resultBox}>
        <Text style={styles.resultLabel}>Matches</Text>
        <Text style={styles.resultValue}>
          {record.match_count_main} main{record.match_count_special > 0 ? ` + ${record.match_count_special} special` : ''}
        </Text>
        <Text style={styles.bucketText}>{record.result_bucket.replace('_', ' ')}</Text>
      </View>

      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 14, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 8 },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ball: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballSpecial: { backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#10b981' },
  ballHit: { backgroundColor: '#10b981' },
  ballText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultBox: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  resultLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  resultValue: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  bucketText: { color: '#10b981', fontSize: 14, marginTop: 4, textTransform: 'capitalize' },
  doneBtn: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
