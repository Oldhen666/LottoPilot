import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING } from '../constants/theme';
import { signUp } from '../services/supabase';

interface Props {
  onSuccess: () => void;
  onGoToLogin: () => void;
}

export default function SignUpScreen({ onSuccess, onGoToLogin }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async () => {
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('Please enter email and password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: err, session } = await signUp(trimmed, password);
      if (err) {
        if (err.toLowerCase().includes('already registered')) {
          setError('This email is already registered. Use Sign in below, or check your email for a confirmation link.');
        } else {
          setError(err);
        }
        return;
      }
      if (session) {
        onSuccess();
      } else {
        Alert.alert(
          'Verify your email',
          'Account created. Please check your email and click the confirmation link. After verifying, you can sign in.',
          [{ text: 'OK', onPress: onGoToLogin }]
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Ionicons name="person-add-outline" size={48} color={COLORS.gold} style={styles.logo} />
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Sign up to sync your check records across devices</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="your@email.com"
            placeholderTextColor={COLORS.textMuted}
            value={email}
            onChangeText={(t) => { setEmail(t); setError(null); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!loading}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              placeholder="At least 6 characters"
              placeholderTextColor={COLORS.textMuted}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              editable={!loading}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>Confirm password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              editable={!loading}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirmPassword((v) => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
            onPress={handleSignUp}
            disabled={loading}
          >
            {loading ? (
              <>
                <ActivityIndicator size="small" color={COLORS.bg} style={styles.btnSpinner} />
                <Text style={styles.primaryBtnText}>Creating account...</Text>
              </>
            ) : (
              <Text style={styles.primaryBtnText}>Sign up</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={onGoToLogin} disabled={loading}>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { paddingHorizontal: SPACING.screenPadding },
  backBtn: { marginBottom: 16, alignSelf: 'flex-start' },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  form: { marginTop: 8 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  passwordWrap: { position: 'relative' },
  passwordInput: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    paddingRight: 48,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  errorText: { color: COLORS.error, fontSize: 14, marginTop: 12 },
  primaryBtn: {
    flexDirection: 'row',
    backgroundColor: COLORS.gold,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  btnSpinner: { marginRight: 10 },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, gap: 8 },
  footerText: { color: COLORS.textSecondary, fontSize: 14 },
  footerLink: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
});
