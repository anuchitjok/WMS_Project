import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Button } from '../src/components/ui/Button';

type Step = 1 | 2 | 3 | 4;

const STEPS = ['Source', 'Item', 'Destination', 'Confirm'];

export default function TransferScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [sourceScan, setSourceScan] = useState('');
  const [itemScan, setItemScan] = useState('');
  const [destScan, setDestScan] = useState('');
  const [qty, setQty] = useState('1');

  const handleConfirm = () => {
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>TRANSFER</Text>
        <Text style={styles.stepCount}>Step {step}/4</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Step Dots */}
        <View style={styles.stepRow}>
          {STEPS.map((label, idx) => {
            const s = (idx + 1) as Step;
            const isActive = step === s;
            const isDone = step > s;
            return (
              <React.Fragment key={label}>
                <View style={styles.stepItem}>
                  <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                    {isDone
                      ? <Ionicons name="checkmark" size={12} color={Colors.bg} />
                      : <Text style={[styles.stepNum, (isActive || isDone) && styles.stepNumActive]}>{s}</Text>
                    }
                  </View>
                  <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{label}</Text>
                </View>
                {idx < STEPS.length - 1 && (
                  <View style={[styles.stepConnector, step > s && styles.stepConnectorDone]} />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {step === 1 && (
          <View>
            <Text style={styles.hint}>Scan the source location where the item currently resides.</Text>
            <ScanInput value={sourceScan} onChangeText={setSourceScan} onScan={() => {}} label="SOURCE LOCATION" placeholder="Scan source location..." />
          </View>
        )}

        {step === 2 && (
          <View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>From Location</Text>
              <Text style={styles.summaryValue}>{sourceScan || 'A-01-B2'}</Text>
            </View>
            <ScanInput value={itemScan} onChangeText={setItemScan} onScan={() => {}} label="ITEM BARCODE" placeholder="Scan item to transfer..." />
            <View style={styles.qtyRow}>
              <Text style={styles.qtyLabel}>QUANTITY</Text>
              <View style={styles.qtyControl}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(q => String(Math.max(1, parseInt(q) - 1)))}>
                  <Ionicons name="remove" size={20} color={Colors.cyan} />
                </TouchableOpacity>
                <TextInput
                  style={styles.qtyInput}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="numeric"
                  textAlign="center"
                />
                <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(q => String(parseInt(q) + 1))}>
                  <Ionicons name="add" size={20} color={Colors.cyan} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {step === 3 && (
          <View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Item</Text>
              <Text style={styles.summaryValue}>{itemScan || 'SKU-HDD-001'}</Text>
            </View>
            <Text style={styles.hint}>Scan the destination location for this transfer.</Text>
            <ScanInput value={destScan} onChangeText={setDestScan} onScan={() => {}} label="DESTINATION LOCATION" placeholder="Scan destination location..." />
          </View>
        )}

        {step === 4 && (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Confirm Transfer</Text>
            {[
              { label: 'From', value: sourceScan || 'A-01-B2', icon: 'location-outline', color: Colors.warning },
              { label: 'Item', value: itemScan || 'SKU-HDD-001', icon: 'cube-outline', color: Colors.cyan },
              { label: 'Qty', value: qty + ' pcs', icon: 'layers-outline', color: Colors.info },
              { label: 'To', value: destScan || 'B-03-A1', icon: 'location', color: Colors.success },
            ].map(row => (
              <View key={row.label} style={styles.confirmRow}>
                <View style={[styles.confirmIcon, { backgroundColor: `${row.color}15` }]}>
                  <Ionicons name={row.icon as any} size={16} color={row.color} />
                </View>
                <View>
                  <Text style={styles.confirmLabel}>{row.label}</Text>
                  <Text style={styles.confirmValue}>{row.value}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.btnRow}>
          {step > 1 && (
            <Button label="BACK" onPress={() => setStep(s => (s - 1) as Step)} variant="ghost" size="lg" style={{ flex: 1 }} />
          )}
          <Button
            label={step < 4 ? 'NEXT' : 'CONFIRM TRANSFER'}
            onPress={() => step < 4 ? setStep(s => (s + 1) as Step) : handleConfirm()}
            size="lg"
            style={{ flex: 2 }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  stepCount: { color: Colors.cyan, fontSize: 13, fontWeight: '700' },
  scroll: { padding: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: Colors.cyan, borderColor: Colors.cyan },
  stepCircleDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  stepNum: { color: Colors.text.muted, fontSize: 12, fontWeight: '700' },
  stepNumActive: { color: Colors.bg },
  stepLabel: { color: Colors.text.muted, fontSize: 9, fontWeight: '600' },
  stepLabelActive: { color: Colors.cyan },
  stepConnector: { width: 28, height: 1, backgroundColor: Colors.border, marginBottom: 16 },
  stepConnectorDone: { backgroundColor: Colors.success },
  hint: { color: Colors.text.secondary, fontSize: 13, marginBottom: 20, lineHeight: 20 },
  summaryBox: { backgroundColor: Colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 16 },
  summaryLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  summaryValue: { color: Colors.cyan, fontSize: 15, fontWeight: '700', marginTop: 4 },
  qtyRow: { marginBottom: 16 },
  qtyLabel: { color: Colors.text.secondary, fontSize: 12, fontWeight: '600', marginBottom: 10, letterSpacing: 0.5 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 56 },
  qtyBtn: { width: 56, height: '100%', alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, color: Colors.text.primary, fontSize: 22, fontWeight: '800' },
  confirmCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: Colors.border, marginBottom: 24, gap: 14 },
  confirmTitle: { color: Colors.text.primary, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  confirmIcon: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600' },
  confirmValue: { color: Colors.text.primary, fontSize: 14, fontWeight: '700', marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 12 },
});
