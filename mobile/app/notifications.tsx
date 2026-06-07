import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import type { Notification } from '../src/types';

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: '1', type: 'SLA_ALERT', title: 'SLA Breach — PICK-2026-0481', message: 'Pick order is 45 minutes past SLA. Immediate action required.', read: false, createdAt: new Date(Date.now() - 2700000).toISOString() },
  { id: '2', type: 'APPROVAL', title: 'Approval Required: DOA-2026-0021', message: 'W. Operator has submitted a DOA declaration for 3 units of SKU-HDD-001.', read: false, createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: '3', type: 'LOW_STOCK', title: 'Low Stock Alert — SKU-RAM-004', message: 'Inventory level for RAM DDR4 16GB has fallen below reorder threshold (8 units remaining).', read: true, createdAt: new Date(Date.now() - 14400000).toISOString() },
  { id: '4', type: 'SYSTEM', title: 'Cycle Count Assigned', message: 'You have been assigned to cycle count CNT-2026-0008 in Zone A. Due by 18:00.', read: true, createdAt: new Date(Date.now() - 28800000).toISOString() },
  { id: '5', type: 'APPROVAL', title: 'RTV-2026-0009 Approved', message: 'Your RTV request for 10 units of SKU-RAM-004 has been approved by the manager.', read: true, createdAt: new Date(Date.now() - 43200000).toISOString() },
  { id: '6', type: 'SLA_ALERT', title: 'SLA Warning — ASN-2026-0102', message: 'Receiving task is approaching SLA deadline in 30 minutes.', read: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const typeConfig: Record<Notification['type'], { icon: string; color: string; bg: string }> = {
  SLA_ALERT: { icon: 'alert-circle', color: Colors.error, bg: 'rgba(239,68,68,0.12)' },
  LOW_STOCK: { icon: 'trending-down', color: Colors.warning, bg: 'rgba(245,158,11,0.12)' },
  APPROVAL: { icon: 'checkmark-circle', color: Colors.success, bg: 'rgba(34,197,94,0.12)' },
  SYSTEM: { icon: 'information-circle', color: Colors.info, bg: 'rgba(56,189,248,0.12)' },
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>NOTIFICATIONS</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllLabel}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <View style={styles.unreadDot} />
          <Text style={styles.unreadText}>{unreadCount} unread notification{unreadCount > 1 ? 's' : ''}</Text>
        </View>
      )}

      <FlatList
        data={notifications}
        keyExtractor={n => n.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const config = typeConfig[item.type];
          return (
            <TouchableOpacity
              style={[styles.card, !item.read && styles.cardUnread]}
              onPress={() => markRead(item.id)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconContainer, { backgroundColor: config.bg }]}>
                <Ionicons name={config.icon as any} size={22} color={config.color} />
              </View>
              <View style={styles.content}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, !item.read && styles.cardTitleUnread]} numberOfLines={1}>{item.title}</Text>
                  {!item.read && <View style={styles.unreadIndicator} />}
                </View>
                <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.typeTag, { color: config.color }]}>{item.type.replace('_', ' ')}</Text>
                  <Text style={styles.timeText}>{timeAgo(item.createdAt)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={Colors.text.muted} />
            <Text style={styles.emptyText}>No notifications</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  markAllBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  markAllLabel: { color: Colors.cyan, fontSize: 13, fontWeight: '600' },
  unreadBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cyan },
  unreadText: { color: Colors.cyan, fontSize: 13, fontWeight: '600' },
  list: { padding: 20, gap: 10 },
  card: { flexDirection: 'row', gap: 14, backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border },
  cardUnread: { borderColor: 'rgba(0,229,255,0.2)', backgroundColor: 'rgba(0,229,255,0.03)' },
  iconContainer: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  content: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTitle: { flex: 1, color: Colors.text.secondary, fontSize: 13, fontWeight: '600' },
  cardTitleUnread: { color: Colors.text.primary, fontWeight: '700' },
  unreadIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cyan },
  cardMessage: { color: Colors.text.muted, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  timeText: { color: Colors.text.muted, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.text.secondary, fontSize: 15 },
});
