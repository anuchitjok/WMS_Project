import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../src/theme/colors';
import { ScanInput } from '../src/components/scanner/ScanInput';
import { Badge } from '../src/components/ui/Badge';

const PENDING_ASNS = [
  { id: 'ASN-2026-0101', items: 48, supplier: 'TECH CORP', eta: '09:00' },
  { id: 'ASN-2026-0102', items: 22, supplier: 'GLOBAL SUPPLY', eta: '11:30' },
  { id: 'ASN-2026-0103', items: 105, supplier: 'EAST ASIA DIST', eta: '14:00' },
];

export default function ReceivingScreen() {
  const router = useRouter();
  const [asnInput, setAsnInput] = useState('');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>RECEIVING</Text>
        <Badge label="OPEN" variant="success" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ScanInput
          value={asnInput}
          onChangeText={setAsnInput}
          onScan={() => {}}
          label="SCAN ASN / PO NUMBER"
          placeholder="Scan or enter ASN..."
        />

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>3</Text>
            <Text style={styles.statLabel}>Pending ASN</Text>
          </View>
          <View style={[styles.statBox, { borderColor: `${Colors.success}30` }]}>
            <Text style={[styles.statValue, { color: Colors.success }]}>175</Text>
            <Text style={styles.statLabel}>Items Expected</Text>
          </View>
          <View style={[styles.statBox, { borderColor: `${Colors.warning}30` }]}>
            <Text style={[styles.statValue, { color: Colors.warning }]}>2</Text>
            <Text style={styles.statLabel}>Trucks Arriving</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>PENDING ASN QUEUE</Text>
        {PENDING_ASNS.map(asn => (
          <TouchableOpacity key={asn.id} style={styles.asnCard} activeOpacity={0.8}>
            <View style={styles.asnLeft}>
              <View style={[styles.asnIcon, { backgroundColor: `${Colors.teal}15` }]}>
                <Ionicons name="download-outline" size={20} color={Colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.asnNo}>{asn.id}</Text>
                <Text style={styles.asnSub}>{asn.items} items · {asn.supplier}</Text>
                <View style={styles.etaRow}>
                  <Ionicons name="time-outline" size={12} color={Colors.text.muted} />
                  <Text style={styles.etaText}>ETA: {asn.eta}</Text>
                </View>
              </View>
            </View>
            <View style={styles.asnRight}>
              <Badge label="PENDING" variant="warning" />
              <Ionicons name="chevron-forward" size={18} color={Colors.text.muted} style={{ marginTop: 8 }} />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  scroll: { padding: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statBox: { flex: 1, backgroundColor: Colors.card, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: `${Colors.cyan}30` },
  statValue: { color: Colors.cyan, fontSize: 22, fontWeight: '800' },
  statLabel: { color: Colors.text.muted, fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  sectionTitle: { color: Colors.text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  asnCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10, gap: 12 },
  asnLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  asnIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  asnNo: { color: Colors.cyan, fontSize: 14, fontWeight: '700' },
  asnSub: { color: Colors.text.secondary, fontSize: 12, marginTop: 3 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  etaText: { color: Colors.text.muted, fontSize: 11 },
  asnRight: { alignItems: 'flex-end' },
});
