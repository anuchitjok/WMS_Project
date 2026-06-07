import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../theme/colors';

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'flat';
}

export const KPICard: React.FC<KPICardProps> = ({ label, value, unit, color = Colors.cyan, icon }) => (
  <View style={styles.card}>
    <View style={styles.header}>
      {icon && <View style={[styles.iconBg, { backgroundColor: `${color}20` }]}>{icon}</View>}
      <Text style={styles.label}>{label}</Text>
    </View>
    <View style={styles.valueRow}>
      <Text style={[styles.value, { color }]}>{value}</Text>
      {unit && <Text style={styles.unit}>{unit}</Text>}
    </View>
    <View style={[styles.indicator, { backgroundColor: color }]} />
  </View>
);

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, minWidth: 150, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconBg: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { color: Colors.text.secondary, fontSize: 12, fontWeight: '500', flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  value: { fontSize: 28, fontWeight: '800', lineHeight: 32 },
  unit: { color: Colors.text.muted, fontSize: 13, marginBottom: 2 },
  indicator: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, opacity: 0.7 },
});
