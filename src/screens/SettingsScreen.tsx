import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity, Switch, Modal, ActivityIndicator, TextInput, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING } from '../constants/theme';
import { getCurrentUserEmail, notifyAuthStateChange, onAuthStateChange, signOut } from '../services/supabase';
import { getEntitlements, setProUnlocked, setProTrialOneMonth, setCompassUnlocked, setHadAstronautSubscription as setHadAstronautEntitlement, revokeAstronautSubscription, claimAdminIfEligible, syncLocalEntitlementsToServer, ADMIN_EMAILS, PLAN_LABELS, type UserPlan } from '../services/entitlements';
import { isIAPAvailable, purchasePirate, purchaseAstronaut, restoreIAPPurchases, onPurchaseSuccess, getIAPProducts, formatPiratePrice, formatAstronautPrice, openSubscriptionManagement } from '../services/iap';
import {
  DISCLAIMER_SHORT,
  DISCLAIMER_SUBSCRIPTION,
  DISCLAIMER_PRIZE_VERIFY,
  DATA_SOURCE_NOTICE,
} from '../constants/disclaimers';
import { LOTTERY_DEFS } from '../constants/lotteries';
import { useJurisdiction } from '../hooks/useJurisdiction';
import { CA_PROVINCES, US_STATES } from '../constants/jurisdictions';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [plan, setPlan] = useState<UserPlan>('free');
  const [hadAstronautSubscription, setHadAstronautSubscription] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminClaiming, setAdminClaiming] = useState(false);
  const { jurisdiction, useLocation, loading, toggleUseLocation, setManual } = useJurisdiction();
  const [overrideModal, setOverrideModal] = useState(false);
  const [overrideCountry, setOverrideCountry] = useState<'CA' | 'US'>('CA');
  const [overrideRegion, setOverrideRegion] = useState('ON');
  const [disclaimerModalVisible, setDisclaimerModalVisible] = useState(false);
  const [developerExpanded, setDeveloperExpanded] = useState(false);
  const [isDeveloperEmail, setIsDeveloperEmail] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [piratePrice, setPiratePrice] = useState('$3.49');
  const [astronautPrice, setAstronautPrice] = useState('$0.99/mo');
  const [cancelSubModalVisible, setCancelSubModalVisible] = useState(false);
  const [cancelSubReason, setCancelSubReason] = useState<string | null>(null);
  const [syncingToServer, setSyncingToServer] = useState(false);

  useEffect(() => {
    const load = async () => {
      const e = await getEntitlements();
      setPlan(e.plan);
      setHadAstronautSubscription(e.hadAstronautSubscription);
      if (isIAPAvailable()) {
        const ok = await restoreIAPPurchases();
        if (ok) {
          const updated = await getEntitlements();
          setPlan(updated.plan);
          setHadAstronautSubscription(updated.hadAstronautSubscription);
        }
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (isIAPAvailable()) {
      getIAPProducts().then(({ pirate, astronaut }) => {
        setPiratePrice(formatPiratePrice(pirate));
        setAstronautPrice(formatAstronautPrice(astronaut));
      });
    }
  }, []);

  useEffect(() => {
    const unsub = onPurchaseSuccess(() => {
      getEntitlements().then((e) => {
        setPlan(e.plan);
        setHadAstronautSubscription(e.hadAstronautSubscription);
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    const check = async (email: string | null) => {
      setCurrentUserEmail(email);
      setIsDeveloperEmail(email !== null && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email));
      const e = await getEntitlements();
      setPlan(e.plan);
      setHadAstronautSubscription(e.hadAstronautSubscription);
    };
    getCurrentUserEmail().then(check);
    return onAuthStateChange(check);
  }, []);

  const handleLogOff = async () => {
    setCurrentUserEmail(null);
    setIsDeveloperEmail(false);
    try {
      await signOut();
      setPlan('free');
    } catch {
      showAlert('Error', 'Could not sign out.');
    }
  };

  const handleUpgradePirate = async () => {
    if (!currentUserEmail && isIAPAvailable()) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (window.confirm('Sign in first to sync your purchases across devices. Go to Sign in?')) {
          navigation.navigate('Login');
        }
        return;
      }
      Alert.alert('Sign in first', 'Sign in to sync your purchases across devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }
    if (isIAPAvailable()) {
      try {
        await purchasePirate();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAlreadyOwned = /already own|already owned|E_ALREADY_OWNED|ITEM_ALREADY_OWNED|ITEM_OWNED/i.test(msg);
        if (isAlreadyOwned) {
          const ok = await restoreIAPPurchases();
          if (ok) {
            const ent = await getEntitlements();
            setPlan(ent.plan);
          }
          showAlert('Restored', 'You already own Pirate Plan. Restored successfully.');
        } else {
          showAlert('Purchase failed', msg || 'Could not complete purchase.');
        }
      }
      return;
    }
    await setCompassUnlocked(true);
    setPlan((p) => (p === 'astronaut' ? 'pirate_astronaut' : 'pirate'));
  };

  const handleUpgradeAstronaut = async () => {
    if (!currentUserEmail && isIAPAvailable()) {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (window.confirm('Sign in first to sync your purchases across devices. Go to Sign in?')) {
          navigation.navigate('Login');
        }
        return;
      }
      Alert.alert('Sign in first', 'Sign in to sync your purchases across devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }
    if (isIAPAvailable()) {
      try {
        await purchaseAstronaut();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAlreadySubscribed = /already subscribed|already own|already owned|E_ALREADY_OWNED|ITEM_ALREADY_OWNED|ITEM_OWNED|active subscription/i.test(msg);
        if (isAlreadySubscribed) {
          let ok = await restoreIAPPurchases();
          if (!ok) {
            await setProUnlocked(true);
            await setHadAstronautEntitlement();
            ok = true;
          }
          const ent = await getEntitlements();
          setPlan(ent.plan);
          setHadAstronautSubscription(ent.hadAstronautSubscription);
          notifyAuthStateChange();
          if (Platform.OS === 'web') {
            showAlert('Restored', 'You already have Astronaut Plan. Restored successfully.');
          } else {
            Alert.alert('Restored', 'You already have Astronaut Plan. Restored successfully.', [
              { text: 'Manage subscriptions', onPress: () => openSubscriptionManagement() },
              { text: 'Got it', style: 'cancel' as const },
            ]);
          }
        } else {
          showAlert('Purchase failed', msg || 'Could not complete purchase.');
        }
      }
      return;
    }
    if (plan === 'pirate') {
      await setProTrialOneMonth();
    } else {
      await setProUnlocked(true);
    }
    setPlan((p) => (p === 'pirate' ? 'pirate_astronaut' : 'astronaut'));
  };

  const handleRestorePurchases = async () => {
    if (!isIAPAvailable()) return;
    try {
      const ok = await restoreIAPPurchases();
      if (ok) {
        const ent = await getEntitlements();
        setPlan(ent.plan);
        setHadAstronautSubscription(ent.hadAstronautSubscription);
        notifyAuthStateChange();
        showAlert('Restored', 'Purchases restored successfully.');
      } else {
        showAlert('Restore', 'No purchases to restore.');
      }
    } catch {
      showAlert('Error', 'Could not restore purchases.');
    }
  };

  const handleCancelSubscription = () => {
    setCancelSubReason(null);
    setCancelSubModalVisible(true);
  };

  const handleConfirmCancelSubscription = async () => {
    setCancelSubModalVisible(false);
    if (cancelSubReason) {
      // Optional: send cancelSubReason to analytics/backend
    }
    await doCancelSubscription();
  };

  const doCancelSubscription = async () => {
    await revokeAstronautSubscription();
    const ent = await getEntitlements();
    setPlan(ent.plan);
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleClaimTestAccount = async () => {
    const testEmail = ADMIN_EMAILS[0];
    setAdminEmail(testEmail);
    setAdminClaiming(true);
    try {
      const ok = await claimAdminIfEligible(testEmail);
      if (ok) {
        setPlan('pirate_astronaut');
        showAlert('Test account unlocked', 'chenk@dybridge.com now has unlimited Compass and Strategy Lab.');
      } else {
        showAlert('Error', 'Could not unlock test account.');
      }
    } catch {
      showAlert('Error', 'Failed to claim admin.');
    } finally {
      setAdminClaiming(false);
    }
  };

  const handleClaimAdmin = async () => {
    if (!adminEmail.trim()) return;
    setAdminClaiming(true);
    try {
      const ok = await claimAdminIfEligible(adminEmail);
      if (ok) {
        setPlan('pirate_astronaut');
        showAlert('Admin unlocked', 'All Pro and AI features are now enabled.');
      } else {
        showAlert('Not eligible', 'This email is not an admin.');
      }
    } catch {
      showAlert('Error', 'Failed to claim admin.');
    } finally {
      setAdminClaiming(false);
    }
  };

  const handleOverride = () => {
    setManual(overrideCountry, overrideRegion, overrideCountry === 'CA' ? CA_PROVINCES[overrideRegion] : US_STATES[overrideRegion]);
    setOverrideModal(false);
  };

  const regionOptions = overrideCountry === 'CA' ? Object.entries(CA_PROVINCES) : Object.entries(US_STATES);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + SPACING.screenPadding, paddingBottom: SPACING.screenPaddingBottom }]}
    >
      <View style={styles.headerRow}>
        <Ionicons name="settings" size={24} color={COLORS.gold} style={styles.titleIcon} />
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Account - Sign in / Log off */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        {currentUserEmail ? (
          <>
            <Text style={styles.cardDesc}>Signed in as {currentUserEmail}</Text>
            <TouchableOpacity style={styles.logOffBtn} onPress={handleLogOff}>
              <Ionicons name="log-out-outline" size={20} color={COLORS.text} style={styles.logOffIcon} />
              <Text style={styles.logOffBtnText}>Log off</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.cardDesc}>Sign in to sync your check records across devices.</Text>
            <TouchableOpacity style={styles.signInBtn} onPress={() => navigation.navigate('Login')}>
              <Ionicons name="log-in-outline" size={20} color={COLORS.gold} style={styles.logOffIcon} />
              <Text style={styles.signInBtnText}>Sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Subscription - show only current tier or higher; checkmark only on current (not on included lower tiers) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Subscription</Text>
        <Text style={styles.cardDesc}>Current: {PLAN_LABELS[plan]}</Text>
        {plan === 'free' && (
          <View style={[styles.planCard, styles.planCardActive]}>
            <View style={styles.planRow}>
              <Text style={styles.planName}>Free Plan</Text>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            </View>
            <Text style={styles.planDesc}>10 Compass uses total. Strategy Lab: Start 1-month free trial.</Text>
          </View>
        )}
        {(plan === 'free' || plan === 'pirate') && (
          <View style={[styles.planCard, plan === 'pirate' && styles.planCardActive]}>
            <View style={styles.planRow}>
              <Text style={styles.planName}>Pirate Plan</Text>
              {plan === 'pirate' && <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />}
            </View>
            <Text style={styles.planDesc}>Unlimited Compass. Strategy Lab: Start 1-month free trial. {piratePrice} one-time.</Text>
            {plan === 'free' && (
              <TouchableOpacity style={styles.planUpgradeBtn} onPress={handleUpgradePirate}>
                <Text style={styles.planUpgradeBtnText}>Upgrade to Pirate {piratePrice}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {(plan === 'free' || plan === 'pirate' || plan === 'astronaut' || plan === 'pirate_astronaut') && (
          <View style={[styles.planCard, (plan === 'astronaut' || plan === 'pirate_astronaut') && styles.planCardActive]}>
            <View style={styles.planRow}>
              <Text style={styles.planName}>Astronaut Plan</Text>
              {(plan === 'astronaut' || plan === 'pirate_astronaut') && <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />}
            </View>
            <Text style={styles.planDesc}>
              {hadAstronautSubscription
                ? `Unlimited Strategy Lab + Compass. ${astronautPrice}. Includes Pirate. Cancel removes both; Pirate (if purchased) stays.`
                : `Unlimited Strategy Lab + Compass. 1-month free trial, then ${astronautPrice}. Includes Pirate. Cancel removes both; Pirate (if purchased) stays.`}
            </Text>
            {(plan === 'free' || plan === 'pirate') && (
              <TouchableOpacity style={styles.planUpgradeBtn} onPress={handleUpgradeAstronaut}>
                <Text style={styles.planUpgradeBtnText}>{hadAstronautSubscription ? 'Upgrade to Astronaut plan' : 'Start 1-month free trial'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {(plan === 'astronaut' || plan === 'pirate_astronaut') && (
          <TouchableOpacity style={styles.cancelSubBtn} onPress={handleCancelSubscription}>
            <Text style={styles.cancelSubBtnText}>Cancel Astronaut subscription</Text>
          </TouchableOpacity>
        )}
        {isIAPAvailable() && (
          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestorePurchases}>
            <Text style={styles.restoreBtnText}>Restore purchases</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Location & Prize Rules */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Location & Prize Rules</Text>
        <Text style={styles.cardDesc}>We use your location only for local lottery prize rules. Exact location is not stored.</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Use my location</Text>
          <Switch value={useLocation} onValueChange={toggleUseLocation} trackColor={{ false: COLORS.bgElevated, true: COLORS.primary }} thumbColor={COLORS.text} />
        </View>
        {loading ? (
          <Text style={styles.jurisdictionText}>Detecting...</Text>
        ) : jurisdiction ? (
          <Text style={styles.jurisdictionText}>
            {jurisdiction.regionName || jurisdiction.regionCode}, {jurisdiction.country === 'CA' ? 'Canada' : 'USA'} ({jurisdiction.source === 'gps' ? 'GPS' : 'Manual'})
          </Text>
        ) : (
          <Text style={styles.jurisdictionText}>No jurisdiction set.</Text>
        )}
        <TouchableOpacity style={styles.linkBtn} onPress={() => setOverrideModal(true)}>
          <Text style={styles.linkBtnText}>Override location</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.gold} />
        </TouchableOpacity>
      </View>

      {/* Privacy & Data */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Privacy & Data</Text>
        <Text style={styles.cardDesc}>Check history is stored locally. If you sign in, records may sync for backup. We do not sell your data.</Text>
        <Text style={styles.cardDesc}>{DATA_SOURCE_NOTICE}</Text>
        <Text style={styles.linkLabel}>Official lottery links</Text>
        {Object.values(LOTTERY_DEFS).map((l) => (
          <TouchableOpacity key={l.id} onPress={() => Linking.openURL(l.source_url)} style={styles.linkRow}>
            <Text style={styles.link}>{l.name}</Text>
            <Ionicons name="open-outline" size={18} color={COLORS.gold} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Legal */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Legal</Text>
        <Text style={styles.cardDesc}>{DISCLAIMER_SHORT}</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={() => setDisclaimerModalVisible(true)}>
          <Text style={styles.linkBtnText}>View full disclaimers</Text>
          <Ionicons name="document-text-outline" size={18} color={COLORS.gold} />
        </TouchableOpacity>
      </View>

      {/* Developer (collapsible) - only visible when chenk@dybridge.com is signed in */}
      {isDeveloperEmail && (
        <View style={styles.card}>
          <TouchableOpacity style={styles.collapseHeader} onPress={() => setDeveloperExpanded(!developerExpanded)} activeOpacity={0.7}>
            <Text style={styles.cardTitle}>Developer</Text>
            <Ionicons name={developerExpanded ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
          {developerExpanded && (
            <View style={styles.developerContent}>
              <Text style={styles.cardDesc}>Admin unlock.</Text>
              <TextInput
                style={styles.adminInput}
                placeholder="Admin email"
                placeholderTextColor={COLORS.textMuted}
                value={adminEmail}
                onChangeText={setAdminEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.adminClaimBtn, adminClaiming && styles.adminClaimBtnDisabled]}
                onPress={handleClaimAdmin}
                disabled={adminClaiming || !adminEmail.trim()}
              >
                {adminClaiming ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <Text style={styles.adminClaimBtnText}>Claim admin</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminClaimBtn, styles.adminClaimBtnSecondary, adminClaiming && styles.adminClaimBtnDisabled]}
                onPress={handleClaimTestAccount}
                disabled={adminClaiming}
              >
                <Text style={styles.adminClaimBtnTextSecondary}>Quick unlock (chenk@dybridge.com)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminClaimBtn, styles.adminClaimBtnSecondary, syncingToServer && styles.adminClaimBtnDisabled]}
                onPress={async () => {
                  setSyncingToServer(true);
                  try {
                    await syncLocalEntitlementsToServer();
                    showAlert('Synced', 'Local entitlements synced to server.');
                    getEntitlements().then((e) => setPlan(e.plan));
                  } catch {
                    showAlert('Error', 'Sync failed.');
                  } finally {
                    setSyncingToServer(false);
                  }
                }}
                disabled={syncingToServer}
              >
                {syncingToServer ? <ActivityIndicator size="small" color={COLORS.gold} /> : <Text style={styles.adminClaimBtnTextSecondary}>Sync entitlements to server</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <Modal visible={overrideModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setOverrideModal(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select region</Text>
            <View style={styles.modalRow}>
              <TouchableOpacity style={[styles.modalTab, overrideCountry === 'CA' && styles.modalTabActive]} onPress={() => { setOverrideCountry('CA'); setOverrideRegion('ON'); }}>
                <Text style={styles.modalTabText}>Canada</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalTab, overrideCountry === 'US' && styles.modalTabActive]} onPress={() => { setOverrideCountry('US'); setOverrideRegion('CA'); }}>
                <Text style={styles.modalTabText}>USA</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.regionList}>
              {regionOptions.map(([code, name]) => (
                <TouchableOpacity key={code} style={[styles.regionItem, overrideRegion === code && styles.regionItemActive]} onPress={() => setOverrideRegion(code)}>
                  <Text style={styles.regionItemText}>{name} ({code})</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalConfirm} onPress={handleOverride}>
              <Text style={styles.modalConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={disclaimerModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDisclaimerModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.disclaimerModalContent}>
            <Text style={styles.modalTitle}>Disclaimers</Text>
            <ScrollView style={styles.disclaimerScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.disclaimerBlockTitle}>General</Text>
              <Text style={styles.disclaimerBlockText}>{DISCLAIMER_SHORT}</Text>
              <Text style={styles.disclaimerBlockTitle}>Prize Results & Verification</Text>
              <Text style={styles.disclaimerBlockText}>{DISCLAIMER_PRIZE_VERIFY}</Text>
              <Text style={styles.disclaimerBlockTitle}>Subscription & Analysis</Text>
              <Text style={styles.disclaimerBlockText}>{DISCLAIMER_SUBSCRIPTION}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.modalConfirm} onPress={() => setDisclaimerModalVisible(false)}>
              <Text style={styles.modalConfirmText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={cancelSubModalVisible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCancelSubModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cancel subscription?</Text>
            <Text style={styles.cancelSubModalMsg}>
              Strategy Lab Pro will be revoked. Pirate Plan (if purchased) will remain. Are you sure?
            </Text>
            <Text style={styles.cancelSubReasonLabel}>Why are you canceling? (optional)</Text>
            <ScrollView style={styles.cancelSubReasonScroll} showsVerticalScrollIndicator={false}>
              {['Too expensive', 'Not using it enough', 'Found alternative', 'Other', 'Prefer not to say'].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.cancelSubReasonOption, cancelSubReason === r && styles.cancelSubReasonOptionActive]}
                  onPress={() => setCancelSubReason((prev) => (prev === r ? null : r))}
                >
                  <Text style={styles.cancelSubReasonOptionText}>{r}</Text>
                  {cancelSubReason === r && <Ionicons name="checkmark" size={18} color={COLORS.gold} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.cancelSubModalBtns}>
              <TouchableOpacity style={styles.cancelSubKeepBtn} onPress={() => setCancelSubModalVisible(false)}>
                <Text style={styles.cancelSubKeepBtnText}>Keep subscription</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelSubConfirmBtn} onPress={handleConfirmCancelSubscription}>
                <Text style={styles.cancelSubConfirmBtnText}>Cancel subscription</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: SPACING.screenPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  titleIcon: { marginRight: 10 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  cardDesc: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  logOffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray700,
  },
  logOffIcon: { marginRight: 8 },
  logOffBtnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  signInBtnText: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  sectionTitle: { color: COLORS.textMuted, fontSize: 12, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  linkLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8, marginBottom: 6 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  link: { color: COLORS.gold, fontSize: 14 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingVertical: 10,
  },
  linkBtnText: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  collapseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 },
  planCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.bgElevated,
  },
  planCardActive: { borderColor: COLORS.success },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  planDesc: { color: COLORS.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 20 },
  planUpgradeBtn: {
    backgroundColor: COLORS.gold,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  planUpgradeBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: 14 },
  cancelSubBtn: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 10,
  },
  cancelSubBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '600' },
  restoreBtn: { marginTop: 12, alignItems: 'center' },
  restoreBtnText: { color: COLORS.textMuted, fontSize: 14 },
  adminInput: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  adminClaimBtn: {
    backgroundColor: COLORS.bgElevated,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  adminClaimBtnDisabled: { opacity: 0.5 },
  adminClaimBtnText: { color: COLORS.gold, fontWeight: '600', fontSize: 14 },
  adminClaimBtnSecondary: { marginTop: 8, borderColor: COLORS.textMuted },
  adminClaimBtnTextSecondary: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  toggleLabel: { color: COLORS.text, fontSize: 14 },
  jurisdictionText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 8 },
  developerContent: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.bgElevated },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, maxHeight: 400 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  modalRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  modalTab: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: COLORS.bgElevated, alignItems: 'center' },
  modalTabActive: { backgroundColor: COLORS.primary },
  modalTabText: { color: COLORS.text, fontSize: 16 },
  regionList: { maxHeight: 200, marginBottom: 16 },
  regionItem: { padding: 12, borderRadius: 8, marginBottom: 4 },
  regionItemActive: { backgroundColor: COLORS.primary },
  regionItemText: { color: COLORS.text, fontSize: 14 },
  modalConfirm: { backgroundColor: COLORS.gold, padding: 14, borderRadius: 10, alignItems: 'center' },
  modalConfirmText: { color: COLORS.bg, fontWeight: '700', fontSize: 16 },
  disclaimerModalContent: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 20, maxHeight: '80%', alignSelf: 'stretch' },
  disclaimerScroll: { maxHeight: 320, marginBottom: 16 },
  disclaimerBlockTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  disclaimerBlockText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },
  cancelSubModalMsg: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 16 },
  cancelSubReasonLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  cancelSubReasonScroll: { maxHeight: 200, marginBottom: 8 },
  cancelSubReasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgElevated,
    marginBottom: 6,
  },
  cancelSubReasonOptionActive: { borderWidth: 1, borderColor: COLORS.gold },
  cancelSubReasonOptionText: { color: COLORS.text, fontSize: 14 },
  cancelSubModalBtns: { marginTop: 20, gap: 12 },
  cancelSubKeepBtn: {
    backgroundColor: COLORS.bgElevated,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.textMuted,
  },
  cancelSubKeepBtnText: { color: COLORS.text, fontWeight: '600', fontSize: 16 },
  cancelSubConfirmBtn: {
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  cancelSubConfirmBtnText: { color: COLORS.error, fontWeight: '600', fontSize: 16 },
});
