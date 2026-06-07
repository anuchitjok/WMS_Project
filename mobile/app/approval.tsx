import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';

interface ApprovalItem {
  id: string;
  type: 'DOA' | 'RTV' | 'TRANSFER' | 'ADJUSTMENT';
  refNo: string;
  requestedBy: string;
  description: string;
  qty: number;
  sku: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  createdAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const MOCK_APPROVALS: ApprovalItem[] = [
  { id: '1', type: 'DOA', refNo: 'DOA-2026-0021', requestedBy: 'W. Operator', description: 'HDD failure — read error on power-on', qty: 3, sku: 'SKU-HDD-001', urgency: 'HIGH', createdAt: new Date(Date.now() - 7200000).toISOString(), status: 'PENDING' },
  { id: '2', type: 'RTV', refNo: 'RTV-2026-0009', requestedBy: 'A. Technician', description: 'Wrong part delivered by vendor', qty: 10, sku: 'SKU-RAM-004', urgency: 'MEDIUM', createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'PENDING' },
  { id: '3', type: 'ADJUSTMENT', refNo: 'ADJ-2026-0005', requestedBy: 'Count Team', description: 'Cycle count discrepancy +5 units', qty: 5, sku: 'SKU-SSD-002', urgency: 'LOW', createdAt: new Date(Date.now() - 172800000).toISOString(), status: 'PENDING' },
  { id: '4', type: 'TRANSFER', refNo: 'TRF-2026-0018', requestedBy: 'S. Supervisor', description: 'Emergency stock rebalance between zones', qty: 20, sku: 'SKU-PSU-007', urgency: 'HIGH', createdAt: new Date(Date.now() - 3600000).toISOString(), status: 'PENDING' },
];

const typeColor: Record<ApprovalItem['type'], string> = {
  DOA: Colors.error, RTV: Colors.warning, TRANSFER: Colors.info, ADJUSTMENT: Colors.cyan,
};
const urgencyVariant: Record<ApprovalItem['urgency'], 'error' | 'warning' | 'default'> = {
  HIGH: 'error', MEDIUM: 'warning', LOW: 'default',
};

export default function ApprovalScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ApprovalItem[]>(MOCK_APPROVALS);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = (id: string) => {
    Alert.alert('Approve Request', 'Approve this request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve', onPress: () => {
          setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'APPROVED' } : i));
        }
      },
    ]);
  };

  const handleReject = (id: string) => {
    if (!rejectReason.trim()) {
      Alert.alert('Required', 'Please provide a rejection reason.');
      return;
    }
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'REJECTED' } : i));
    setRejectModal(null);
    setRejectReason('');
  };

  const pending = items.filter(i => i.status === 'PENDING');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>APPROVAL QUEUE</Text>
        <Badge label={`${pending.length} PENDING`} variant="warning" />
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.card, item.status !== 'PENDING' && styles.cardDone]}>
            {/* Card Header */}
            <View style={styles.cardHeader}>
              <View style={[styles.typeChip, { backgroundColor: `${typeColor[item.type]}15`, borderColor: `${typeColor[item.type]}30` }]}>
                <Text style={[styles.typeLabel, { color: typeColor[item.type] }]}>{item.type}</Text>
              </View>
              <Badge label={item.urgency} variant={urgencyVariant[item.urgency]} />
              {item.status !== 'PENDING' && (
                <Badge label={item.status} variant={item.status === 'APPROVED' ? 'success' : 'error'} />
              )}
            </View>

            {/* Content */}
            <Text style={styles.refNo}>{item.refNo}</Text>
            <Text style={styles.description}>{item.description}</Text>

            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>SKU</Text>
                <Text style={styles.metaValue}>{item.sku}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>QTY</Text>
                <Text style={styles.metaValue}>{item.qty} pcs</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>BY</Text>
                <Text style={styles.metaValue}>{item.requestedBy}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>AGE</Text>
                <Text style={styles.metaValue}>{Math.round((Date.now() - new Date(item.createdAt).getTime()) / 3600000)}h</Text>
              </View>
            </View>

            {item.status === 'PENDING' && (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => setRejectModal(item.id)} activeOpacity={0.8}>
                  <Ionicons name="close" size={18} color={Colors.error} />
                  <Text style={styles.rejectLabel}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(item.id)} activeOpacity={0.8}>
                  <Ionicons name="checkmark" size={18} color={Colors.bg} />
                  <Text style={styles.approveLabel}>Approve</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color={Colors.success} />
            <Text style={styles.emptyText}>No pending approvals</Text>
          </View>
        }
      />

      {/* Reject Modal */}
      <Modal visible={!!rejectModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rejection Reason</Text>
            <TextInput
              style={styles.reasonInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Enter reason for rejection..."
              placeholderTextColor={Colors.text.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button label="CANCEL" onPress={() => setRejectModal(null)} variant="ghost" style={{ flex: 1 }} />
              <Button label="REJECT" onPress={() => handleReject(rejectModal!)} variant="danger" style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  list: { padding: 20, gap: 12 },
  card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border },
  cardDone: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  typeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  refNo: { color: Colors.cyan, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  description: { color: Colors.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metaItem: { minWidth: '22%' },
  metaLabel: { color: Colors.text.muted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  metaValue: { color: Colors.text.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 8, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  rejectLabel: { color: Colors.error, fontSize: 14, fontWeight: '700' },
  approveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.success, borderRadius: 8, paddingVertical: 12 },
  approveLabel: { color: Colors.bg, fontSize: 14, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.text.secondary, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderWidth: 1, borderColor: Colors.border },
  modalTitle: { color: Colors.text.primary, fontSize: 17, fontWeight: '700', marginBottom: 16 },
  reasonInput: { backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, color: Colors.text.primary, fontSize: 15, padding: 14, minHeight: 90, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
});
