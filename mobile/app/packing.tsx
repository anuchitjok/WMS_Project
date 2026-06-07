import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';

interface PackItem {
  id: string;
  sku: string;
  name: string;
  qty: number;
  packed: number;
}

const PACK_ITEMS: PackItem[] = [
  { id: '1', sku: 'SKU-HDD-001', name: 'HDD 1TB SATA 3.5"', qty: 5, packed: 0 },
  { id: '2', sku: 'SKU-RAM-004', name: 'RAM DDR4 16GB', qty: 10, packed: 0 },
  { id: '3', sku: 'SKU-SSD-002', name: 'SSD 512GB NVMe', qty: 3, packed: 0 },
];

export default function PackingScreen() {
  const router = useRouter();
  const [cartonScan, setCartonScan] = useState('');
  const [orderScan, setOrderScan] = useState('');
  const [weight, setWeight] = useState('');
  const [items, setItems] = useState<PackItem[]>(PACK_ITEMS);
  const [sealed, setSealed] = useState(false);

  const allPacked = items.every(i => i.packed >= i.qty);

  const handlePackItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id && i.packed < i.qty ? { ...i, packed: i.packed + 1 } : i));
  };

  const handleSeal = () => {
    if (!cartonScan || !weight) {
      Alert.alert('Missing Info', 'Please scan carton barcode and enter weight before sealing.');
      return;
    }
    Alert.alert('Seal Carton', `Seal carton ${cartonScan} (${weight} kg)?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Seal', onPress: () => setSealed(true) },
    ]);
  };

  const handleShipLabel = () => {
    Alert.alert('Print Label', 'Shipping label sent to label printer.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>PACKING</Text>
          <Text style={styles.refNo}>SO-2026-0092</Text>
        </View>
        <Badge label={sealed ? 'SEALED' : 'PACKING'} variant={sealed ? 'success' : 'warning'} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScanInput value={orderScan} onChangeText={setOrderScan} onScan={() => {}} label="SCAN SALES ORDER" placeholder="Scan order barcode..." />
        <ScanInput value={cartonScan} onChangeText={setCartonScan} onScan={() => {}} label="SCAN CARTON BARCODE" placeholder="Scan carton label..." />

        {/* Weight */}
        <Text style={styles.fieldLabel}>GROSS WEIGHT (kg) *</Text>
        <View style={styles.weightRow}>
          <Ionicons name="scale-outline" size={22} color={Colors.text.muted} style={{ paddingLeft: 14 }} />
          <TextInput
            style={styles.weightInput}
            value={weight}
            onChangeText={setWeight}
            placeholder="0.00"
            placeholderTextColor={Colors.text.muted}
            keyboardType="decimal-pad"
          />
          <Text style={styles.weightUnit}>kg</Text>
        </View>

        {/* Pack list */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>PACK LIST ({items.filter(i => i.packed >= i.qty).length}/{items.length} complete)</Text>
        {items.map(item => (
          <View key={item.id} style={[styles.packCard, item.packed >= item.qty && styles.packDone]}>
            <View style={styles.packRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.packSku}>{item.sku}</Text>
                <Text style={styles.packName}>{item.name}</Text>
              </View>
              <View style={styles.packQtySection}>
                <Text style={[styles.packQty, { color: item.packed >= item.qty ? Colors.success : Colors.text.primary }]}>
                  {item.packed}/{item.qty}
                </Text>
                {item.packed < item.qty && !sealed && (
                  <TouchableOpacity style={styles.addBtn} onPress={() => handlePackItem(item.id)}>
                    <Ionicons name="add" size={18} color={Colors.bg} />
                  </TouchableOpacity>
                )}
                {item.packed >= item.qty && (
                  <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                )}
              </View>
            </View>
          </View>
        ))}

        {/* Carton dimensions */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>DIMENSIONS (cm) — Optional</Text>
        <View style={styles.dimRow}>
          {['Length', 'Width', 'Height'].map(dim => (
            <View key={dim} style={styles.dimBox}>
              <TextInput style={styles.dimInput} placeholder="0" placeholderTextColor={Colors.text.muted} keyboardType="numeric" />
              <Text style={styles.dimLabel}>{dim}</Text>
            </View>
          ))}
        </View>

        {sealed ? (
          <View style={styles.sealedBanner}>
            <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sealedTitle}>Carton Sealed</Text>
              <Text style={styles.sealedSub}>Ready for handover. Print label below.</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.btnRow}>
          {!sealed ? (
            <Button label="SEAL CARTON" onPress={handleSeal} size="lg" disabled={!allPacked} style={{ flex: 1 }} />
          ) : (
            <Button label="PRINT SHIP LABEL" onPress={handleShipLabel} size="lg" variant="secondary" style={{ flex: 1 }} />
          )}
        </View>
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
  fieldLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  weightRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 56, marginBottom: 4 },
  weightInput: { flex: 1, color: Colors.text.primary, fontSize: 20, fontWeight: '700', paddingHorizontal: 12 },
  weightUnit: { color: Colors.text.muted, fontSize: 15, paddingRight: 16 },
  packCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  packDone: { borderColor: `${Colors.success}40`, backgroundColor: 'rgba(34,197,94,0.04)' },
  packRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  packSku: { color: Colors.cyan, fontSize: 12, fontWeight: '700' },
  packName: { color: Colors.text.primary, fontSize: 14, fontWeight: '600', marginTop: 2 },
  packQtySection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  packQty: { fontSize: 16, fontWeight: '800' },
  addBtn: { backgroundColor: Colors.cyan, width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dimRow: { flexDirection: 'row', gap: 10 },
  dimBox: { flex: 1, alignItems: 'center' },
  dimInput: { width: '100%', backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, color: Colors.text.primary, fontSize: 16, fontWeight: '700', padding: 10, textAlign: 'center' },
  dimLabel: { color: Colors.text.muted, fontSize: 11, marginTop: 4 },
  sealedBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', marginTop: 20, marginBottom: 4 },
  sealedTitle: { color: Colors.success, fontSize: 15, fontWeight: '700' },
  sealedSub: { color: Colors.text.secondary, fontSize: 12, marginTop: 2 },
  btnRow: { marginTop: 20 },
});
