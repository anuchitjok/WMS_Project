import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../src/theme/colors';
import { useAuthStore } from '../../src/store/auth.store';
import { authService } from '../../src/services/auth.service';

const MENU_SECTIONS = [
  {
    title: 'WAREHOUSE OPERATIONS',
    items: [
      { label: 'Receiving', icon: 'download-outline', route: '/receiving', color: Colors.teal },
      { label: 'Putaway', icon: 'archive-outline', route: '/putaway', color: Colors.blue },
      { label: 'Picking', icon: 'hand-left-outline', route: '/picking', color: Colors.warning },
      { label: 'Transfer', icon: 'swap-horizontal-outline', route: '/transfer', color: Colors.info },
    ],
  },
  {
    title: 'QUALITY & COMPLIANCE',
    items: [
      { label: 'Cycle Count', icon: 'calculator-outline', route: '/cycle-count', color: Colors.cyan },
      { label: 'DOA / RTV', icon: 'alert-circle-outline', route: '/doa-rtv', color: Colors.error },
      { label: 'Approval Queue', icon: 'checkmark-circle-outline', route: '/approval', color: Colors.success },
    ],
  },
  {
    title: 'SHIPPING',
    items: [
      { label: 'Packing', icon: 'cube-outline', route: '/packing', color: Colors.cyan },
      { label: 'Handover / POD', icon: 'paper-plane-outline', route: '/handover', color: Colors.teal },
      { label: 'Notifications', icon: 'notifications-outline', route: '/notifications', color: Colors.warning },
    ],
  },
];

export default function MoreScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          try {
            const token = await authService.getStoredToken();
            if (token) await authService.logout(token);
          } finally {
            logout();
            router.replace('/(auth)/login');
          }
        }
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>MORE</Text>

        {/* User Card */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.username?.charAt(0).toUpperCase() ?? 'U'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{user?.username ?? 'Operator'}</Text>
            <Text style={styles.userRole}>{user?.role ?? 'WAREHOUSE_OPERATOR'}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={22} color={Colors.text.muted} />
          </TouchableOpacity>
        </View>

        {MENU_SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, idx) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.menuItem, idx < section.items.length - 1 && styles.menuItemBorder]}
                  onPress={() => router.push(item.route as any)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.menuIcon, { backgroundColor: `${item.color}15` }]}>
                    <Ionicons name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.text.muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.logoutLabel}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1, paddingTop: 16, marginBottom: 16 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 14, marginBottom: 24 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,229,255,0.15)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.cyan, fontSize: 20, fontWeight: '800' },
  userName: { color: Colors.text.primary, fontSize: 16, fontWeight: '700' },
  userRole: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
  section: { marginBottom: 20 },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  sectionCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, color: Colors.text.primary, fontSize: 15, fontWeight: '600' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', marginTop: 8 },
  logoutLabel: { color: Colors.error, fontSize: 15, fontWeight: '700' },
});
