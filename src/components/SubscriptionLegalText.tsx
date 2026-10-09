import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';

type Props = {
  lines: string[];
  /** Smaller text for dense paywalls */
  compact?: boolean;
};

export function SubscriptionLegalText({ lines, compact }: Props) {
  if (!lines.length) return null;
  return (
    <View style={styles.wrap}>
      {lines.map((line) => (
        <Text key={line} style={[styles.line, compact && styles.lineCompact]}>
          • {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, marginBottom: 4, gap: 6 },
  line: { fontSize: 12, lineHeight: 17, color: COLORS.textSecondary },
  lineCompact: { fontSize: 11, lineHeight: 16 },
});
