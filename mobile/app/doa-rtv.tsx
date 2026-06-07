import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Button } from '../src/components/ui/Button';

type DispositionType = 'DOA' | 'RTV' | 'QUARANTINE';

const DISPOSITION_OPTIONS: { type: DispositionType; label: string; desc: string; color: string; icon: string }[] = [
  { type: 'DOA', label: 'Dead on Arrival', desc: 'Item is defective or non-functional', color: Colors.error, icon: 'close-circle-outline' },
  { type: 'RTV', label: 'Return to Vendor', desc: 'Item to be returned to supplier', color: Colors.warning, icon: 'return-down-back-outline' },
  { type: 'QUARANTINE', label: 'Quarantine', desc: 'Item under investigation, hold for review', color: Colors.info, icon: 'shield-outline' },
];

export default function DoaRtvScreen() {
  const router = useRouter();
  const [itemScan, setItemScan] = useState('');
  const [disposition, setDisposition] = useState<DispositionType | null>(null);
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState('1');
  const [photos, setPhotos] = useState<string[]>([]);

  const handleSubmit = () => {
    if (!itemScan || !disposition || !reason) {
      Alert.alert('Missing Information', 'Please fill in all required fields.');
      return;
    }
    Alert.alert(
      'Confirm Declaration',
      `Declare ${qty} unit(s) of ${itemScan} as ${disposition}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>DOA / RTV DECLARATION</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.warningBanner}>
          <Ionicons name="alert-circle" size={18} color={Colors.warning} />
          <Text style={styles.warningText}>This action will flag items for disposition. Manager approval may be required.</Text>
        </View>

        <ScanInput value={itemScan} onChangeText={setItemScan} onScan={() => {}} label="SCAN ITEM BARCODE *" placeholder="Scan defective item..." />

        {/* Quantity */}
        <Text style={styles.fieldLabel}>QUANTITY *</Text>
        <View style={styles.qtyControl}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(q => String(Math.max(1, parseInt(q) - 1)))}>
            <Ionicons name="remove" size={20} color={Colors.cyan} />
          </TouchableOpacity>
          <TextInput style={styles.qtyInput} value={qty} onChangeText={setQty} keyboardType="numeric" textAlign="center" />
          <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(q => String(parseInt(q) + 1))}>
            <Ionicons name="add" size={20} color={Colors.cyan} />
          </TouchableOpacity>
        </View>

        {/* Disposition */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>DISPOSITION TYPE *</Text>
        <View style={styles.dispositionList}>
          {DISPOSITION_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.type}
              style={[styles.dispositionCard, disposition === opt.type && { borderColor: opt.color, backgroundColor: `${opt.color}08` }]}
              onPress={() => setDisposition(opt.type)}
              activeOpacity={0.8}
            >
              <View style={[styles.dispIcon, { backgroundColor: `${opt.color}15` }]}>
                <Ionicons name={opt.icon as any} size={22} color={opt.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dispLabel, { color: disposition === opt.type ? opt.color : Colors.text.primary }]}>{opt.label}</Text>
                <Text style={styles.dispDesc}>{opt.desc}</Text>
              </View>
              <View style={[styles.radio, disposition === opt.type && { borderColor: opt.color, backgroundColor: opt.color }]}>
                {disposition === opt.type && <Ionicons name="checkmark" size={12} color={Colors.bg} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Reason */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>REASON / NOTES *</Text>
        <TextInput
          style={styles.reasonInput}
          value={reason}
          onChangeText={setReason}
          placeholder="Describe the defect or reason for disposition..."
          placeholderTextColor={Colors.text.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Photo */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>PHOTO EVIDENCE</Text>
        <TouchableOpacity style={styles.photoBtn} onPress={() => Alert.alert('Camera', 'Camera picker would open here')}>
          <Ionicons name="camera-outline" size={24} color={Colors.text.muted} />
          <Text style={styles.photoLabel}>Tap to add photo ({photos.length}/3)</Text>
        </TouchableOpacity>

        <Button label="SUBMIT DECLARATION" onPress={handleSubmit} variant="danger" size="lg" style={{ marginTop: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  scroll: { padding: 20 },
  warningBanner: { flexDirection: 'row', gap: 10, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)', marginBottom: 20, alignItems: 'flex-start' },
  warningText: { color: Colors.warning, fontSize: 13, flex: 1, lineHeight: 19 },
  fieldLabel: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, height: 56 },
  qtyBtn: { width: 56, height: '100%', alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, color: Colors.text.primary, fontSize: 22, fontWeight: '800' },
  dispositionList: { gap: 10 },
  dispositionCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border },
  dispIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dispLabel: { fontSize: 15, fontWeight: '700' },
  dispDesc: { color: Colors.text.muted, fontSize: 12, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  reasonInput: { backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, color: Colors.text.primary, fontSize: 15, padding: 14, minHeight: 100 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', padding: 20, justifyContent: 'center' },
  photoLabel: { color: Colors.text.muted, fontSize: 14 },
});
