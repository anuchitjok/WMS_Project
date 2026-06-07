import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { Badge } from '../src/components/ui/Badge';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Button } from '../src/components/ui/Button';

interface PickLine {
  id: string;
  sku: string;
  name: string;
  location: string;
  qty: number;
  picked: number;
  status: 'OVERDUE' | 'PENDING' | 'DONE';
}

const INITIAL_PICKS: PickLine[] = [
  { id: '1', sku: 'SKU-HDD-001', name: 'HDD 1TB SATA 3.5"', location: 'A-01-B2', qty: 2, picked: 0, status: 'OVERDUE' },
  { id: '2', sku: 'SKU-RAM-004', name: 'RAM DDR4 16GB', location: 'B-02-A1', qty: 5, picked: 0, status: 'PENDING' },
  { id: '3', sku: 'SKU-SSD-002', name: 'SSD 512GB NVMe', location: 'A-02-B1', qty: 1, picked: 1, status: 'DONE' },
];

export default function PickingScreen() {
  const router = useRouter();
  const [scan, setScan] = useState('');
  const [picks, setPicks] = useState<PickLine[]>(INITIAL_PICKS);

  const handlePick = (id: string) => {
    setPicks(prev => prev.map(p => {
      if (p.id !== id || p.picked >= p.qty) return p;
      const newPicked = p.picked + 1;
      return { ...p, picked: newPicked, status: newPicked >= p.qty ? 'DONE' : p.status };
    }));
  };

  const totalPicked = picks.reduce((a, p) => a + p.picked, 0);
  const totalQty = picks.reduce((a, p) => a + p.qty, 0);
  const allDone = totalPicked >= totalQty;

  const handleComplete = () => {
    Alert.alert('Complete Pick', 'Mark this pick order as completed?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>PICK EXECUTION</Text>
          <Text style={styles.refNo}>PICK-2026-0481</Text>
        </View>
        <Badge label="OVERDUE" variant="error" />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Progress</Text>
          <Text style={styles.progressCount}>{totalPicked}/{totalQty} items</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(totalPicked / totalQty) * 100}%` }]} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
        <ScanInput value={scan} onChangeText={setScan} onScan={() => {}} label="SCAN ITEM TO PICK" placeholder="Scan item barcode..." />
      </View>

      <FlatList
        data={picks}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <View style={[styles.pickCard, item.status === 'DONE' && styles.pickDone]}>
            <View style={styles.pickRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickSku}>{item.sku}</Text>
                <Text style={styles.pickName}>{item.name}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="location-outline" size={14} color={Colors.text.muted} />
                  <Text style={styles.meta}>{item.location}</Text>
                </View>
              </View>
              <View style={styles.qtySection}>
                <View style={styles.qtyBox}>
                  <Text style={[styles.qtyPicked, { color: item.status === 'DONE' ? Colors.success : Colors.cyan }]}>{item.picked}</Text>
                  <Text style={styles.qtySep}>/</Text>
                  <Text style={styles.qtyTotal}>{item.qty}</Text>
                </View>
                {item.status !== 'DONE' && (
                  <TouchableOpacity style={styles.pickBtn} onPress={() => handlePick(item.id)} activeOpacity={0.7}>
                    <Ionicons name="add" size={20} color={Colors.bg} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {item.status === 'DONE' && (
              <View style={styles.doneBadge}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.doneText}>PICKED</Text>
              </View>
            )}
            {item.status === 'OVERDUE' && (
              <View style={styles.overdueBadge}>
                <Ionicons name="alert-circle" size={14} color={Colors.error} />
                <Text style={styles.overdueText}>SLA OVERDUE</Text>
              </View>
            )}
          </View>
        )}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <Button
            label={allDone ? 'COMPLETE PICK ORDER' : `PICK IN PROGRESS (${totalPicked}/${totalQty})`}
            onPress={handleComplete}
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            style={{ marginTop: 8 }}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.text.primary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  refNo: { color: Colors.cyan, fontSize: 12, fontWeight: '600', marginTop: 2 },
  progressContainer: { paddingHorizontal: 20, marginBottom: 12 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600' },
  progressCount: { color: Colors.text.primary, fontSize: 11, fontWeight: '700' },
  progressBar: { height: 6, backgroundColor: Colors.surface, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.cyan, borderRadius: 3 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  pickCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  pickDone: { opacity: 0.65, borderColor: `${Colors.success}40` },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pickSku: { color: Colors.cyan, fontSize: 12, fontWeight: '700' },
  pickName: { color: Colors.text.primary, fontSize: 15, fontWeight: '600', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  meta: { color: Colors.text.muted, fontSize: 13 },
  qtySection: { alignItems: 'center', gap: 8 },
  qtyBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  qtyPicked: { fontSize: 28, fontWeight: '800' },
  qtySep: { color: Colors.text.muted, fontSize: 18, marginBottom: 2 },
  qtyTotal: { color: Colors.text.muted, fontSize: 20, fontWeight: '600', marginBottom: 1 },
  pickBtn: { backgroundColor: Colors.cyan, width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  doneText: { color: Colors.success, fontSize: 12, fontWeight: '700' },
  overdueBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  overdueText: { color: Colors.error, fontSize: 12, fontWeight: '700' },
});
