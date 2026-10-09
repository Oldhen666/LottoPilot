import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

export function InsightStarRow({ label, stars }: { label: string; stars: number }) {
  const s = Math.min(5, Math.max(1, Math.round(stars)));
  return (
    <View style={styles.insightStarRow}>
      <Text style={styles.insightStarLabel}>{label}</Text>
      <View style={styles.insightStars}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Ionicons key={i} name={i <= s ? 'star' : 'star-outline'} size={22} color={COLORS.gold} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  insightStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  insightStarLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  insightStars: { flexDirection: 'row', gap: 4 },
});
