import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../src/theme/colors';
import { KPICard } from '../../src/components/warehouse/KPICard';
import { useAuthStore } from '../../src/store/auth.store';

const QUICK_ACTIONS = [
  { label: 'Receive', icon: 'download-outline', route: '/receiving', color: Colors.teal },
  { label: 'Putaway', icon: 'archive-outline', route: '/putaway', color: Colors.blue },
  { label: 'Pick', icon: 'hand-left-outline', route: '/picking', color: Colors.warning },
  { label: 'Transfer', icon: 'swap-horizontal-outline', route: '/transfer', color: Colors.info },
  { label: 'Count', icon: 'calculator-outline', route: '/cycle-count', color: Colors.cyan },
  { label: 'DOA/RTV', icon: 'alert-circle-outline', route: '/doa-rtv', color: Colors.error },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise(r => setTimeout(r, 1000));
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.cyan} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.username}>{user?.username ?? 'Operator'}</Text>
          </View>
          <TouchableOpacity style={styles.notifBtn} onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={24} color={Colors.text.primary} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>

        {/* Warehouse Status */}
        <View style={styles.statusBar}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Warehouse A — ONLINE</Text>
          <Text style={styles.statusTime}>{new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</Text>
        </View>

        {/* KPI Cards */}
        <Text style={styles.sectionTitle}>TODAY'S OPERATIONS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiScroll}>
          <KPICard label="Pending Tasks" value={12} color={Colors.warning} icon={<Ionicons name="list-outline" size={16} color={Colors.warning} />} />
          <KPICard label="Completed" value={47} color={Colors.success} icon={<Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />} />
          <KPICard label="SLA Overdue" value={3} color={Colors.error} icon={<Ionicons name="alert-outline" size={16} color={Colors.error} />} />
          <KPICard label="Items Received" value={284} unit="pcs" color={Colors.cyan} icon={<Ionicons name="download-outline" size={16} color={Colors.cyan} />} />
        </ScrollView>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionBtn, { borderColor: `${a.color}30` }]}
              onPress={() => router.push(a.route as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${a.color}15` }]}>
                <Ionicons name={a.icon as any} size={26} color={a.color} />
              </View>
              <Text style={[styles.actionLabel, { color: a.color }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Pending Alerts */}
        <Text style={styles.sectionTitle}>ACTIVE ALERTS</Text>
        <View style={styles.alertCard}>
          <View style={styles.alertRow}>
            <View style={[styles.alertDot, { backgroundColor: Colors.error }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>3 Pick Tasks Overdue SLA</Text>
              <Text style={styles.alertSub}>ORD-2026-0481, ORD-2026-0482, ORD-2026-0483</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.text.muted} />
          </View>
        </View>
        <View style={styles.alertCard}>
          <View style={styles.alertRow}>
            <View style={[styles.alertDot, { backgroundColor: Colors.warning }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>2 RTV Items Aging &gt; 30 Days</Text>
              <Text style={styles.alertSub}>Requires manager approval</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.text.muted} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 16, paddingBottom: 12 },
  greeting: { color: Colors.text.secondary, fontSize: 13 },
  username: { color: Colors.text.primary, fontSize: 22, fontWeight: '800' },
  notifBtn: { padding: 8 },
  notifDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error, borderWidth: 1.5, borderColor: Colors.bg },
  statusBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, padding: 12, gap: 8, borderWidth: 1, borderColor: Colors.border, marginBottom: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  statusText: { color: Colors.text.primary, fontSize: 13, fontWeight: '600', flex: 1 },
  statusTime: { color: Colors.text.muted, fontSize: 12 },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  kpiScroll: { gap: 12, paddingRight: 20, marginBottom: 20 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  actionBtn: { width: '30%', backgroundColor: Colors.card, borderRadius: 12, alignItems: 'center', paddingVertical: 16, borderWidth: 1, gap: 8 },
  actionIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 12, fontWeight: '700' },
  alertCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  alertDot: { width: 10, height: 10, borderRadius: 5 },
  alertTitle: { color: Colors.text.primary, fontSize: 14, fontWeight: '600' },
  alertSub: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
});
