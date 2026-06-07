import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { Badge } from '../../src/components/ui/Badge';
import type { InventoryItem } from '../../src/types';

const MOCK_ITEMS: InventoryItem[] = [
  { id: '1', sku: 'SKU-HDD-001', name: 'HDD 1TB SATA 3.5"', barcode: '8901234567890', qty: 45, location: 'A-01-B2', status: 'ACTIVE', warehouseId: 'WH-A', updatedAt: new Date().toISOString() },
  { id: '2', sku: 'SKU-RAM-004', name: 'RAM DDR4 16GB', barcode: '8901234567891', qty: 12, location: 'B-02-A1', status: 'ACTIVE', warehouseId: 'WH-A', updatedAt: new Date().toISOString() },
  { id: '3', sku: 'SKU-PSU-007', name: 'Power Supply 650W', barcode: '8901234567892', qty: 0, location: 'C-01-A3', status: 'DOA', warehouseId: 'WH-A', updatedAt: new Date().toISOString() },
  { id: '4', sku: 'SKU-SSD-002', name: 'SSD 512GB NVMe', barcode: '8901234567893', qty: 8, location: 'A-02-B1', status: 'QUARANTINE', warehouseId: 'WH-A', updatedAt: new Date().toISOString() },
];

const statusVariant: Record<InventoryItem['status'], 'success' | 'error' | 'warning' | 'default'> = {
  ACTIVE: 'success', DOA: 'error', QUARANTINE: 'warning', RTV: 'default',
};

export default function InventoryScreen() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_ITEMS.filter(i =>
    i.sku.toLowerCase().includes(search.toLowerCase()) ||
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.barcode.includes(search) ||
    i.location.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>INVENTORY INQUIRY</Text>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={20} color={Colors.text.muted} style={{ paddingRight: 10 }} />
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search SKU, barcode, location..."
          placeholderTextColor={Colors.text.muted}
          autoCapitalize="none"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={20} color={Colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.itemCard} activeOpacity={0.8}>
            <View style={styles.itemHeader}>
              <Text style={styles.sku}>{item.sku}</Text>
              <Badge label={item.status} variant={statusVariant[item.status]} />
            </View>
            <Text style={styles.name}>{item.name}</Text>
            <View style={styles.itemFooter}>
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={14} color={Colors.text.muted} />
                <Text style={styles.meta}>{item.location}</Text>
              </View>
              <Text style={[styles.qty, { color: item.qty === 0 ? Colors.error : Colors.success }]}>
                {item.qty} pcs
              </Text>
            </View>
            <Text style={styles.barcode}>{item.barcode}</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={Colors.text.muted} />
            <Text style={styles.emptyText}>No items found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, marginHorizontal: 20, marginBottom: 16, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, height: 52 },
  search: { flex: 1, color: Colors.text.primary, fontSize: 15 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  itemCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sku: { color: Colors.cyan, fontSize: 13, fontWeight: '700' },
  name: { color: Colors.text.primary, fontSize: 15, fontWeight: '600', marginBottom: 10 },
  itemFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { color: Colors.text.muted, fontSize: 13 },
  qty: { fontSize: 16, fontWeight: '700' },
  barcode: { color: Colors.text.muted, fontSize: 11, marginTop: 8, fontFamily: 'monospace' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.text.secondary, fontSize: 15 },
});
