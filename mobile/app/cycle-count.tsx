import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';

interface CountEntry {
  id: string;
  sku: string;
  name: string;
  location: string;
  systemQty: number;
  countedQty: number | null;
}

const INITIAL_COUNT: CountEntry[] = [
  { id: '1', sku: 'SKU-HDD-001', name: 'HDD 1TB SATA', location: 'A-01-B2', systemQty: 45, countedQty: null },
  { id: '2', sku: 'SKU-RAM-004', name: 'RAM DDR4 16GB', location: 'A-01-B3', systemQty: 12, countedQty: null },
  { id: '3', sku: 'SKU-SSD-002', name: 'SSD 512GB NVMe', location: 'A-01-B4', systemQty: 8, countedQty: null },
];

export default function CycleCountScreen() {
  const router = useRouter();
  const [locationScan, setLocationScan] = useState('');
  const [itemScan, setItemScan] = useState('');
  const [entries, setEntries] = useState<CountEntry[]>(INITIAL_COUNT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');

  const setCount = (id: string, qty: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, countedQty: qty } : e));
    setEditingId(null);
  };

  const completedCount = entries.filter(e => e.countedQty !== null).length;
  const discrepancies = entries.filter(e => e.countedQty !== null && e.countedQty !== e.systemQty).length;

  const handleSubmit = () => {
    if (completedCount < entries.length) {
      Alert.alert('Incomplete Count', `You have ${entries.length - completedCount} items not yet counted. Submit anyway?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>CYCLE COUNT</Text>
          <Text style={styles.refNo}>CNT-2026-0008</Text>
        </View>
        <Badge label="IN PROGRESS" variant="cyan" />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{completedCount}/{entries.length}</Text>
            <Text style={styles.statLabel}>Counted</Text>
          </View>
          <View style={[styles.statBox, { borderColor: discrepancies > 0 ? `${Colors.error}40` : `${Colors.success}40` }]}>
            <Text style={[styles.statValue, { color: discrepancies > 0 ? Colors.error : Colors.success }]}>{discrepancies}</Text>
            <Text style={styles.statLabel}>Discrepancies</Text>
          </View>
          <View style={[styles.statBox, { borderColor: `${Colors.warning}40` }]}>
            <Text style={[styles.statValue, { color: Colors.warning }]}>{entries.length - completedCount}</Text>
            <Text style={styles.statLabel}>Remaining</Text>
          </View>
        </View>

        <ScanInput value={locationScan} onChangeText={setLocationScan} onScan={() => {}} label="SCAN LOCATION" placeholder="Scan location barcode..." />
        <ScanInput value={itemScan} onChangeText={setItemScan} onScan={() => {}} label="SCAN ITEM (BLIND COUNT)" placeholder="Scan item barcode..." />

        <Text style={styles.sectionTitle}>COUNT SHEET</Text>
        {entries.map(entry => {
          const hasDiscrepancy = entry.countedQty !== null && entry.countedQty !== entry.systemQty;
          const isCounted = entry.countedQty !== null;
          return (
            <View key={entry.id} style={[styles.entryCard, hasDiscrepancy && styles.entryDiscrepancy, isCounted && !hasDiscrepancy && styles.entryOk]}>
              <View style={styles.entryHeader}>
                <View>
                  <Text style={styles.entrySku}>{entry.sku}</Text>
                  <Text style={styles.entryName}>{entry.name}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={Colors.text.muted} />
                    <Text style={styles.entryLocation}>{entry.location}</Text>
                  </View>
                </View>
                <View style={styles.qtySection}>
                  {isCounted ? (
                    <View style={styles.countedBox}>
                      <Text style={[styles.countedQty, { color: hasDiscrepancy ? Colors.error : Colors.success }]}>
                        {entry.countedQty}
                      </Text>
                      <Text style={styles.systemQtyLabel}>System: {entry.systemQty}</Text>
                      {hasDiscrepancy && (
                        <Text style={styles.diffLabel}>
                          {(entry.countedQty! - entry.systemQty) > 0 ? '+' : ''}{entry.countedQty! - entry.systemQty}
                        </Text>
                      )}
                    </View>
                  ) : (
                    editingId === entry.id ? (
                      <View style={styles.editBox}>
                        <TextInput
                          style={styles.editInput}
                          value={editQty}
                          onChangeText={setEditQty}
                          keyboardType="numeric"
                          autoFocus
                          placeholder="0"
                          placeholderTextColor={Colors.text.muted}
                        />
                        <TouchableOpacity onPress={() => setCount(entry.id, parseInt(editQty) || 0)} style={styles.confirmBtn}>
                          <Ionicons name="checkmark" size={18} color={Colors.bg} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.enterBtn}
                        onPress={() => { setEditingId(entry.id); setEditQty(''); }}
                      >
                        <Ionicons name="create-outline" size={16} color={Colors.cyan} />
                        <Text style={styles.enterLabel}>Enter</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              </View>
              {isCounted && (
                <TouchableOpacity onPress={() => { setEditingId(entry.id); setEditQty(String(entry.countedQty)); }}>
                  <Text style={styles.recount}>Re-count</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <Button
          label={`SUBMIT COUNT (${completedCount}/${entries.length})`}
          onPress={handleSubmit}
          size="lg"
          variant={completedCount === entries.length ? 'primary' : 'secondary'}
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.text.primary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  refNo: { color: Colors.cyan, fontSize: 12, fontWeight: '600', marginTop: 2 },
  scroll: { padding: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: `${Colors.cyan}30` },
  statValue: { color: Colors.cyan, fontSize: 20, fontWeight: '800' },
  statLabel: { color: Colors.text.muted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  entryCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  entryDiscrepancy: { borderColor: `${Colors.error}40`, backgroundColor: 'rgba(239,68,68,0.05)' },
  entryOk: { borderColor: `${Colors.success}40` },
  entryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  entrySku: { color: Colors.cyan, fontSize: 12, fontWeight: '700' },
  entryName: { color: Colors.text.primary, fontSize: 14, fontWeight: '600', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  entryLocation: { color: Colors.text.muted, fontSize: 12 },
  qtySection: { alignItems: 'flex-end' },
  countedBox: { alignItems: 'flex-end' },
  countedQty: { fontSize: 28, fontWeight: '800' },
  systemQtyLabel: { color: Colors.text.muted, fontSize: 11, marginTop: 2 },
  diffLabel: { color: Colors.error, fontSize: 12, fontWeight: '700', marginTop: 2 },
  editBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editInput: { width: 64, height: 44, backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.cyan, color: Colors.text.primary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  confirmBtn: { width: 44, height: 44, backgroundColor: Colors.cyan, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  enterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,229,255,0.1)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,229,255,0.25)' },
  enterLabel: { color: Colors.cyan, fontSize: 13, fontWeight: '600' },
  recount: { color: Colors.text.muted, fontSize: 11, marginTop: 10, textDecorationLine: 'underline' },
});
