import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Button } from '../src/components/ui/Button';

type Step = 1 | 2 | 3;

const STEPS = ['Scan Item', 'Scan Location', 'Confirm'];

export default function PutawayScreen() {
  const router = useRouter();
  const [itemScan, setItemScan] = useState('');
  const [locationScan, setLocationScan] = useState('');
  const [step, setStep] = useState<Step>(1);

  const canProceed = (step === 1 && itemScan.trim()) || (step === 2 && locationScan.trim()) || step === 3;

  const handleConfirm = () => {
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>PUTAWAY</Text>
        <Text style={styles.stepCount}>Step {step}/3</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Step Indicator */}
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
                      ? <Ionicons name="checkmark" size={14} color={Colors.bg} />
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
          <View style={styles.stepContent}>
            <Text style={styles.stepHint}>Scan or enter the barcode of the item to be put away.</Text>
            <ScanInput
              value={itemScan}
              onChangeText={setItemScan}
              onScan={() => {}}
              label="ITEM BARCODE"
              placeholder="Scan item barcode..."
            />
            {itemScan ? (
              <View style={styles.scannedCard}>
                <Ionicons name="cube-outline" size={20} color={Colors.cyan} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scannedLabel}>Item Scanned</Text>
                  <Text style={styles.scannedValue}>{itemScan}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
              </View>
            ) : null}
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.stepHint}>Scan the destination location barcode.</Text>
            <View style={styles.itemSummary}>
              <Text style={styles.summaryLabel}>Item</Text>
              <Text style={styles.summaryValue}>{itemScan}</Text>
            </View>
            <ScanInput
              value={locationScan}
              onChangeText={setLocationScan}
              onScan={() => {}}
              label="DESTINATION LOCATION"
              placeholder="Scan location barcode..."
            />
            {locationScan ? (
              <View style={styles.scannedCard}>
                <Ionicons name="location-outline" size={20} color={Colors.teal} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scannedLabel}>Location Scanned</Text>
                  <Text style={styles.scannedValue}>{locationScan}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
              </View>
            ) : null}
          </View>
        )}

        {step === 3 && (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Confirm Putaway</Text>
            <View style={styles.confirmRow}>
              <View style={styles.confirmIcon}>
                <Ionicons name="cube-outline" size={18} color={Colors.cyan} />
              </View>
              <View>
                <Text style={styles.confirmLabel}>Item</Text>
                <Text style={styles.confirmValue}>{itemScan}</Text>
              </View>
            </View>
            <View style={[styles.confirmRow, { marginTop: 12 }]}>
              <View style={[styles.confirmIcon, { backgroundColor: `${Colors.teal}15` }]}>
                <Ionicons name="location-outline" size={18} color={Colors.teal} />
              </View>
              <View>
                <Text style={styles.confirmLabel}>Destination</Text>
                <Text style={styles.confirmValue}>{locationScan}</Text>
              </View>
            </View>
            <View style={styles.confirmDivider} />
            <Text style={styles.confirmNote}>Once confirmed, stock will be moved to the new location in the system.</Text>
          </View>
        )}

        <View style={styles.btnRow}>
          {step > 1 && (
            <Button
              label="BACK"
              onPress={() => setStep(s => (s - 1) as Step)}
              variant="ghost"
              size="lg"
              style={{ flex: 1 }}
            />
          )}
          <Button
            label={step < 3 ? 'NEXT' : 'CONFIRM PUTAWAY'}
            onPress={() => step < 3 ? setStep(s => (s + 1) as Step) : handleConfirm()}
            size="lg"
            style={{ flex: 2 }}
            disabled={!canProceed}
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
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  stepItem: { alignItems: 'center', gap: 6 },
  stepCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: Colors.cyan, borderColor: Colors.cyan },
  stepCircleDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  stepNum: { color: Colors.text.muted, fontSize: 13, fontWeight: '700' },
  stepNumActive: { color: Colors.bg },
  stepLabel: { color: Colors.text.muted, fontSize: 10, fontWeight: '600' },
  stepLabelActive: { color: Colors.cyan },
  stepConnector: { width: 40, height: 1, backgroundColor: Colors.border, marginBottom: 18 },
  stepConnectorDone: { backgroundColor: Colors.success },
  stepContent: { marginBottom: 24 },
  stepHint: { color: Colors.text.secondary, fontSize: 13, marginBottom: 20, lineHeight: 20 },
  scannedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,229,255,0.05)', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(0,229,255,0.2)', marginTop: 8 },
  scannedLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600' },
  scannedValue: { color: Colors.text.primary, fontSize: 14, fontWeight: '700', marginTop: 2 },
  itemSummary: { backgroundColor: Colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 16 },
  summaryLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  summaryValue: { color: Colors.cyan, fontSize: 15, fontWeight: '700', marginTop: 4 },
  confirmCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: Colors.border, marginBottom: 24 },
  confirmTitle: { color: Colors.text.primary, fontSize: 17, fontWeight: '700', marginBottom: 16 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  confirmIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: `${Colors.cyan}15`, alignItems: 'center', justifyContent: 'center' },
  confirmLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '600' },
  confirmValue: { color: Colors.text.primary, fontSize: 15, fontWeight: '700', marginTop: 2 },
  confirmDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 16 },
  confirmNote: { color: Colors.text.muted, fontSize: 12, lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 12 },
});
