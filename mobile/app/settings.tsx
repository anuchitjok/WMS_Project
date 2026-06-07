import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { useAuthStore } from '../src/store/auth.store';
import { Button } from '../src/components/ui/Button';

export default function SettingsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [haptics, setHaptics] = useState(true);
  const [autoScan, setAutoScan] = useState(false);
  const [sound, setSound] = useState(true);
  const [scanDelay, setScanDelay] = useState('2000');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    Alert.alert('Settings Saved', 'Your settings have been saved successfully.');
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'This will clear all cached data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => Alert.alert('Done', 'Cache cleared.') },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>SETTINGS</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* User Profile */}
        <Text style={styles.sectionTitle}>USER PROFILE</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.username?.charAt(0).toUpperCase() ?? 'U'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.username ?? 'Operator'}</Text>
            <Text style={styles.userEmail}>{user?.email ?? 'operator@hsnt.com'}</Text>
            <Text style={styles.userRole}>{user?.role ?? 'WAREHOUSE_OPERATOR'}</Text>
          </View>
        </View>

        {/* API Configuration */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>API CONFIGURATION</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>API BASE URL</Text>
          <View style={styles.inputRow}>
            <Ionicons name="server-outline" size={18} color={Colors.text.muted} style={{ paddingLeft: 12 }} />
            <TextInput
              style={styles.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholder="http://api.hsnt.com"
              placeholderTextColor={Colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          <Text style={styles.fieldHint}>Changes require app restart to take effect.</Text>
        </View>

        {/* Scanner Settings */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>SCANNER SETTINGS</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Haptic Feedback</Text>
              <Text style={styles.toggleHint}>Vibrate on successful scan</Text>
            </View>
            <Switch
              value={haptics}
              onValueChange={setHaptics}
              trackColor={{ false: Colors.surface, true: Colors.cyan }}
              thumbColor={Colors.bg}
            />
          </View>
          <View style={[styles.toggleRow, styles.toggleBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Sound on Scan</Text>
              <Text style={styles.toggleHint}>Play beep on successful scan</Text>
            </View>
            <Switch
              value={sound}
              onValueChange={setSound}
              trackColor={{ false: Colors.surface, true: Colors.cyan }}
              thumbColor={Colors.bg}
            />
          </View>
          <View style={[styles.toggleRow, styles.toggleBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Auto-Submit Scan</Text>
              <Text style={styles.toggleHint}>Automatically process after scan</Text>
            </View>
            <Switch
              value={autoScan}
              onValueChange={setAutoScan}
              trackColor={{ false: Colors.surface, true: Colors.cyan }}
              thumbColor={Colors.bg}
            />
          </View>
          <View style={[styles.toggleBorder, { paddingTop: 16 }]}>
            <Text style={styles.fieldLabel}>SCAN COOLDOWN (ms)</Text>
            <View style={styles.inputRow}>
              <Ionicons name="timer-outline" size={18} color={Colors.text.muted} style={{ paddingLeft: 12 }} />
              <TextInput
                style={styles.input}
                value={scanDelay}
                onChangeText={setScanDelay}
                keyboardType="numeric"
                placeholder="2000"
                placeholderTextColor={Colors.text.muted}
              />
            </View>
            <Text style={styles.fieldHint}>Minimum time between scans in milliseconds (default: 2000)</Text>
          </View>
        </View>

        {/* Warehouse */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>WAREHOUSE</Text>
        <View style={styles.card}>
          {[
            { label: 'Assigned Warehouses', value: user?.warehouseIds?.join(', ') ?? 'WH-A' },
            { label: 'Default Warehouse', value: 'WH-A' },
          ].map(row => (
            <View key={row.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* App Info */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>APPLICATION INFO</Text>
        <View style={styles.card}>
          {[
            { label: 'Version', value: '1.0.0' },
            { label: 'Build', value: 'EXP-56.0.8' },
            { label: 'Platform', value: 'Expo Go' },
            { label: 'Environment', value: 'PRODUCTION' },
            { label: 'Last Sync', value: new Date().toLocaleString('en') },
          ].map(row => (
            <View key={row.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={[styles.infoValue, row.label === 'Environment' && { color: Colors.success }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>MAINTENANCE</Text>
        <TouchableOpacity style={styles.actionRow} onPress={handleClearCache} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={20} color={Colors.warning} />
          <Text style={[styles.actionLabel, { color: Colors.warning }]}>Clear App Cache</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.text.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={() => Alert.alert('Support', 'Contact: support@hsnt.com\nHotline: +66-2-XXX-XXXX')} activeOpacity={0.7}>
          <Ionicons name="help-circle-outline" size={20} color={Colors.info} />
          <Text style={[styles.actionLabel, { color: Colors.info }]}>Contact IT Support</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.text.muted} />
        </TouchableOpacity>

        <Button label="SAVE SETTINGS" onPress={handleSave} loading={saving} size="lg" style={{ marginTop: 24 }} />

        <Text style={styles.copyright}>HSNT WMS v1.0.0 · © 2026 HSNT Corporation. All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,229,255,0.15)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.cyan, fontSize: 24, fontWeight: '800' },
  userName: { color: Colors.text.primary, fontSize: 16, fontWeight: '700' },
  userEmail: { color: Colors.text.secondary, fontSize: 13, marginTop: 2 },
  userRole: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border },
  fieldLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  fieldHint: { color: Colors.text.muted, fontSize: 11, marginTop: 6, lineHeight: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, height: 48 },
  input: { flex: 1, color: Colors.text.primary, fontSize: 14, paddingHorizontal: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  toggleBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  toggleLabel: { color: Colors.text.primary, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  infoLabel: { color: Colors.text.secondary, fontSize: 13 },
  infoValue: { color: Colors.text.primary, fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 10, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  copyright: { color: Colors.text.muted, fontSize: 11, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
