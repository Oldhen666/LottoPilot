import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useDraws } from '../hooks/useDraws';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { checkTicket } from '../utils/check';
import { insertRecord } from '../db/sqlite';
import type { LotteryId } from '../types/lottery';

// Simple custom picker for Expo (Picker may need @react-native-picker/picker)
// Fallback: use TouchableOpacity + Modal for draw selection
interface Props {
  preselectedLottery?: LotteryId;
  onBack: () => void;
  onResult: (recordId: string) => void;
}

function parseNumbers(str: string, max: number): number[] {
  const parts = str.split(/[\s,]+/).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!isNaN(n)) nums.push(n);
  }
  return nums.slice(0, max);
}

export default function CheckTicketScreen({
  preselectedLottery = 'lotto_max',
  onBack,
  onResult,
}: Props) {
  const [lotteryId, setLotteryId] = useState<LotteryId>(preselectedLottery);
  const [mainInput, setMainInput] = useState('');
  const [specialInput, setSpecialInput] = useState('');
  const [selectedDraw, setSelectedDraw] = useState<{ draw_date: string; winning_numbers: number[]; special_numbers?: number[] } | null>(null);
  const { draws, loading } = useDraws(lotteryId);
  const def = LOTTERY_DEFS[lotteryId];

  useEffect(() => {
    if (draws.length > 0 && !selectedDraw) {
      setSelectedDraw(draws[0]);
    }
  }, [draws]);

  const handleCheck = async () => {
    if (!selectedDraw || !def) return;
    const userMain = parseNumbers(mainInput, def.main_count);
    const userSpecial = def.special_count > 0 ? parseNumbers(specialInput, def.special_count) : [];

    if (userMain.length < def.main_count) {
      Alert.alert('Invalid input', `Please enter ${def.main_count} main numbers (1-${def.main_max})`);
      return;
    }
    if (def.special_count > 0 && userSpecial.length < def.special_count) {
      Alert.alert('Invalid input', `Please enter ${def.special_count} special number(s)`);
      return;
    }

    const result = checkTicket(
      userMain,
      userSpecial.length ? userSpecial : undefined,
      selectedDraw.winning_numbers,
      selectedDraw.special_numbers,
      def
    );

    const now = new Date().toISOString();
    const id = await insertRecord({
      created_at: now,
      lottery_id: lotteryId,
      draw_date: selectedDraw.draw_date,
      user_numbers: userMain,
      user_special: userSpecial.length ? userSpecial : undefined,
      winning_numbers: selectedDraw.winning_numbers,
      winning_special: selectedDraw.special_numbers,
      match_count_main: result.match_count_main,
      match_count_special: result.match_count_special,
      result_bucket: result.result_bucket,
      source: 'manual',
    });

    onResult(id);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Check Ticket</Text>

      <Text style={styles.label}>Lottery</Text>
      <View style={styles.pickerRow}>
        {(Object.keys(LOTTERY_DEFS) as LotteryId[]).map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.pill, lotteryId === id && styles.pillActive]}
            onPress={() => setLotteryId(id)}
          >
            <Text style={styles.pillText}>{LOTTERY_DEFS[id].name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Draw date</Text>
      {loading ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.drawScroll}>
          {draws.map((d) => (
            <TouchableOpacity
              key={d.draw_date}
              style={[
                styles.drawChip,
                selectedDraw?.draw_date === d.draw_date && styles.drawChipActive,
              ]}
              onPress={() => setSelectedDraw(d)}
            >
              <Text style={styles.drawChipText}>{d.draw_date}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Text style={styles.label}>Your numbers (comma or space separated)</Text>
      <TextInput
        style={styles.input}
        value={mainInput}
        onChangeText={setMainInput}
        placeholder={`e.g. 1 2 3 4 5 6 (${def.main_count} numbers, 1-${def.main_max})`}
        placeholderTextColor="#64748b"
        keyboardType="numbers-and-punctuation"
      />

      {def.special_count > 0 && (
        <>
          <Text style={styles.label}>Special / Bonus number</Text>
          <TextInput
            style={styles.input}
            value={specialInput}
            onChangeText={setSpecialInput}
            placeholder={`1 number, 1-${def.special_max || 49}`}
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
          />
        </>
      )}

      <TouchableOpacity
        style={[styles.checkBtn, (!selectedDraw || loading) && styles.checkBtnDisabled]}
        onPress={handleCheck}
        disabled={!selectedDraw || loading}
      >
        <Text style={styles.checkBtnText}>Check Results</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 16 },
  backText: { color: '#94a3b8', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#f8fafc', marginBottom: 24 },
  label: { color: '#94a3b8', fontSize: 12, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  pillActive: { backgroundColor: '#6366f1' },
  pillText: { color: '#f8fafc', fontSize: 14 },
  drawScroll: { marginBottom: 20, maxHeight: 44 },
  drawChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    marginRight: 8,
  },
  drawChipActive: { backgroundColor: '#6366f1' },
  drawChipText: { color: '#f8fafc', fontSize: 14 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    color: '#f8fafc',
    fontSize: 16,
    marginBottom: 20,
  },
  checkBtn: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
