/**
 * Individual number input boxes with digit-sensing auto-advance.
 * 1 digit → wait before advancing (gives time to type 2nd digit).
 * 2 digits → short delay then advance (prevents jump-too-fast on all boxes).
 * Applies to all boxes and all lines.
 */
import React, { useRef, useEffect, useCallback } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

/** When user types only 1 digit, wait this long before advancing */
const SINGLE_DIGIT_WAIT_MS = 2200;
/** When user completes 2 digits, brief delay before advancing (avoids too-fast jump) */
const COMPLETE_ADVANCE_DELAY_MS = 500;
const BOX_SIZE = 44;

interface Props {
  count: number;
  minVal: number;
  maxVal: number;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  style?: object;
}

export function MainNumbersBoxes({ count, minVal, maxVal, values, onChange, placeholder, style }: Props) {
  const refs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDigits = maxVal >= 10 ? 2 : 1;

  const advanceToNext = useCallback(
    (idx: number, delayMs: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (idx < count - 1) {
          refs.current[idx + 1]?.focus();
        }
      }, delayMs);
    },
    [count]
  );

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = (idx: number, text: string) => {
    const digits = text.replace(/\D/g, '');
    const limited = digits.slice(0, maxDigits);
    const next = [...values];
    next[idx] = limited;
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (limited.length === maxDigits) {
      if (idx < count - 1) advanceToNext(idx, COMPLETE_ADVANCE_DELAY_MS);
    } else if (limited.length === 1 && maxDigits === 2) {
      advanceToNext(idx, SINGLE_DIGIT_WAIT_MS);
    }
  };

  const handleKeyPress = (idx: number, e: { nativeEvent: { key: string } }) => {
    if (e.nativeEvent.key === 'Backspace' && values[idx] === '' && idx > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      refs.current[idx - 1]?.focus();
    }
  };

  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <TextInput
          key={i}
          ref={(r) => { refs.current[i] = r; }}
          style={[styles.box, values[i] ? styles.boxFilled : null]}
          value={values[i]}
          onChangeText={(t) => handleChange(i, t)}
          onKeyPress={(e) => handleKeyPress(i, e)}
          placeholder={i === 0 ? placeholder : ''}
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          maxLength={maxDigits}
          selectTextOnFocus
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  box: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: 10,
    backgroundColor: '#152238',
    borderWidth: 1,
    borderColor: '#1e3254',
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  boxFilled: { borderColor: '#4f46e5' },
});
