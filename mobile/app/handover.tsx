import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Badge } from '../src/components/ui/Badge';
import { Button } from '../src/components/ui/Button';

interface Carton {
  id: string;
  barcode: string;
  weight: string;
  status: 'PENDING' | 'HANDED';
}

export default function HandoverScreen() {
  const router = useRouter();
  const [cartonScan, setCartonScan] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [cartons, setCartons] = useState<Carton[]>([
    { id: '1', barcode: 'CTN-2026-0092-001', weight: '3.2', status: 'PENDING' },
    { id: '2', barcode: 'CTN-2026-0092-002', weight: '4.1', status: 'PENDING' },
  ]);
  const [signed, setSigned] = useState(false);

  const handedCount = cartons.filter(c => c.status === 'HANDED').length;
  const allHandedOver = handedCount === cartons.length;

  const handleScanCarton = () => {
    if (!cartonScan.trim()) return;
    setCartons(prev => prev.map(c => c.barcode === cartonScan.trim() ? { ...c, status: 'HANDED' } : c));
    setCartonScan('');
  };

  const handleSign = () => {
    if (!receiverName.trim()) {
      Alert.alert('Required', 'Receiver name is required for POD.');
      return;
    }
    setSigned(true);
  };

  const handleComplete = () => {
    Alert.alert('Handover Complete', `Shipment SO-2026-0092 has been handed over to ${receiverName}. POD recorded.`, [
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>HANDOVER / POD</Text>
          <Text style={styles.refNo}>SO-2026-0092</Text>
        </View>
        <Badge label={allHandedOver && signed ? 'COMPLETE' : 'IN PROGRESS'} variant={allHandedOver && signed ? 'success' : 'warning'} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Carrier Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CARRIER INFORMATION</Text>
          <View style={styles.infoCard}>
            {[
              { label: 'Carrier', value: 'KERRY EXPRESS', icon: 'car-outline' },
              { label: 'Service', value: 'Next Day Delivery', icon: 'flash-outline' },
              { label: 'Cartons', value: `${cartons.length} boxes`, icon: 'cube-outline' },
              { label: 'Total Weight', value: `${cartons.reduce((a, c) => a + parseFloat(c.weight), 0).toFixed(1)} kg`, icon: 'scale-outline' },
            ].map(row => (
              <View key={row.label} style={styles.infoRow}>
                <Ionicons name={row.icon as any} size={16} color={Colors.text.muted} />
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Carton Scan */}
        <Text style={styles.sectionTitle}>CARTON HANDOVER ({handedCount}/{cartons.length})</Text>
        <ScanInput
          value={cartonScan}
          onChangeText={setCartonScan}
          onScan={handleScanCarton}
          label="SCAN CARTON BARCODE"
          placeholder="Scan each carton to hand over..."
        />
        <TouchableOpacity style={styles.submitScanBtn} onPress={handleScanCarton}>
          <Text style={styles.submitScanLabel}>CONFIRM SCAN</Text>
        </TouchableOpacity>
        {cartons.map(c => (
          <View key={c.id} style={[styles.cartonCard, c.status === 'HANDED' && styles.cartonHanded]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cartonCode}>{c.barcode}</Text>
              <Text style={styles.cartonWeight}>{c.weight} kg</Text>
            </View>
            {c.status === 'HANDED'
              ? <View style={styles.handedChip}><Ionicons name="checkmark" size={14} color={Colors.success} /><Text style={styles.handedLabel}>Handed</Text></View>
              : <View style={styles.pendingChip}><Text style={styles.pendingLabel}>Pending</Text></View>
            }
          </View>
        ))}

        {/* Tracking No */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>TRACKING NUMBER</Text>
        <View style={styles.inputRow}>
          <Ionicons name="qr-code-outline" size={20} color={Colors.text.muted} style={{ paddingLeft: 14 }} />
          <TextInput style={styles.input} value={trackingNo} onChangeText={setTrackingNo} placeholder="Enter or scan tracking number..." placeholderTextColor={Colors.text.muted} />
        </View>

        {/* Receiver */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>RECEIVER DETAILS</Text>
        <TextInput style={[styles.inputRow, styles.inputText]} value={receiverName} onChangeText={setReceiverName} placeholder="Receiver full name *" placeholderTextColor={Colors.text.muted} />
        <TextInput style={[styles.inputRow, styles.inputText, { marginTop: 10 }]} value={receiverPhone} onChangeText={setReceiverPhone} placeholder="Contact phone number" placeholderTextColor={Colors.text.muted} keyboardType="phone-pad" />

        {/* Signature Area */}
        {!signed ? (
          <TouchableOpacity style={styles.signatureBox} onPress={handleSign} activeOpacity={0.8}>
            <Ionicons name="pencil-outline" size={24} color={Colors.text.muted} />
            <Text style={styles.signatureHint}>Tap to capture signature</Text>
            <Text style={styles.signatureNote}>Receiver must sign for delivery confirmation</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.signedBox}>
            <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
            <Text style={styles.signedText}>Signature captured — {receiverName}</Text>
          </View>
        )}

        {/* POD Photo */}
        <TouchableOpacity style={styles.photoBtn} onPress={() => Alert.alert('Camera', 'POD photo capture would open here')}>
          <Ionicons name="camera-outline" size={22} color={Colors.text.muted} />
          <Text style={styles.photoLabel}>Capture POD Photo</Text>
        </TouchableOpacity>

        <Button
          label="COMPLETE HANDOVER"
          onPress={handleComplete}
          size="lg"
          disabled={!allHandedOver || !signed}
          style={{ marginTop: 20 }}
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
  section: { marginBottom: 20 },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  infoCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoLabel: { color: Colors.text.secondary, fontSize: 13, flex: 1 },
  infoValue: { color: Colors.text.primary, fontSize: 13, fontWeight: '700' },
  submitScanBtn: { backgroundColor: 'rgba(0,229,255,0.1)', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,229,255,0.25)', marginBottom: 12, marginTop: -8 },
  submitScanLabel: { color: Colors.cyan, fontSize: 13, fontWeight: '700' },
  cartonCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  cartonHanded: { borderColor: `${Colors.success}40`, backgroundColor: 'rgba(34,197,94,0.04)' },
  cartonCode: { color: Colors.text.primary, fontSize: 13, fontWeight: '700' },
  cartonWeight: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
  handedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  handedLabel: { color: Colors.success, fontSize: 12, fontWeight: '700' },
  pendingChip: { backgroundColor: Colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  pendingLabel: { color: Colors.text.muted, fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 52 },
  inputText: { color: Colors.text.primary, fontSize: 15, paddingHorizontal: 14 },
  input: { flex: 1, color: Colors.text.primary, fontSize: 15, paddingHorizontal: 10 },
  signatureBox: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', padding: 32, alignItems: 'center', gap: 8, marginTop: 20 },
  signatureHint: { color: Colors.text.secondary, fontSize: 14, fontWeight: '600' },
  signatureNote: { color: Colors.text.muted, fontSize: 12 },
  signedBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)', marginTop: 20 },
  signedText: { color: Colors.success, fontSize: 14, fontWeight: '600' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 16, justifyContent: 'center', marginTop: 12 },
  photoLabel: { color: Colors.text.muted, fontSize: 14 },
});
