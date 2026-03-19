import React, { useState, useEffect } from 'react';
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
import { signIn, getRememberMe, setRememberMe, getLastLoginEmail, setLastLoginEmail, resetPasswordForEmail } from '../services/supabase';

interface Props {
  onSuccess: () => void;
  onGoToSignUp: () => void;
}

export default function LoginScreen({ onSuccess, onGoToSignUp }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMeState] = useState(true);

  useEffect(() => {
    getRememberMe().then(setRememberMeState);
    const last = getLastLoginEmail();
    if (last) setEmail(last);
  }, []);

  const handleLogin = async () => {
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('Please enter email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await setRememberMe(rememberMe);
      const { error: err } = await signIn(trimmed, password);
      if (err) {
        if (err.toLowerCase().includes('email not confirmed')) {
          setError('Please check your email and click the confirmation link before signing in.');
        } else if (err.toLowerCase().includes('invalid login credentials')) {
          setError('Wrong email or password. Tap "Forgot password?" to reset.');
        } else {
          setError(err);
        }
        return;
      }
      setLastLoginEmail(trimmed);
      onSuccess();
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
          <Ionicons name="log-in-outline" size={48} color={COLORS.gold} style={styles.logo} />
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Sign in to sync your check records across devices</Text>
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
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
              editable={!loading}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.forgotRow}
            onPress={async () => {
              const e = email.trim();
              if (!e) {
                setError('Enter your email above, then tap Forgot password?');
                return;
              }
              setError(null);
              setLoading(true);
              const { error: resetErr } = await resetPasswordForEmail(e);
              setLoading(false);
              if (resetErr) setError(resetErr);
              else Alert.alert('Check your email', 'We sent a password reset link to ' + e);
            }}
            disabled={loading}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rememberRow}
            onPress={() => setRememberMeState((v) => !v)}
            activeOpacity={0.7}
            disabled={loading}
          >
            <Ionicons
              name={rememberMe ? 'checkbox' : 'square-outline'}
              size={22}
              color={rememberMe ? COLORS.gold : COLORS.textMuted}
            />
            <Text style={styles.rememberText}>Remember me</Text>
          </TouchableOpacity>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <>
                <ActivityIndicator size="small" color={COLORS.bg} style={styles.btnSpinner} />
                <Text style={styles.primaryBtnText}>Signing in...</Text>
              </>
            ) : (
              <Text style={styles.primaryBtnText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <TouchableOpacity onPress={onGoToSignUp} disabled={loading}>
              <Text style={styles.footerLink}>Sign up</Text>
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
  forgotRow: { alignSelf: 'flex-end', marginTop: 8 },
  forgotText: { color: COLORS.gold, fontSize: 14 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 },
  rememberText: { color: COLORS.textSecondary, fontSize: 14 },
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
