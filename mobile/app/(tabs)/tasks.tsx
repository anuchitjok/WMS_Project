import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../src/theme/colors';
import { TaskCard } from '../../src/components/warehouse/TaskCard';
import { Badge } from '../../src/components/ui/Badge';
import type { Task } from '../../src/types';

const MOCK_TASKS: Task[] = [
  { id: '1', type: 'PICK', status: 'OVERDUE', priority: 'URGENT', dueAt: new Date().toISOString(), assignedTo: 'user1', referenceNo: 'PICK-2026-0481', warehouseId: 'WH-A' },
  { id: '2', type: 'RECEIVE', status: 'PENDING', priority: 'HIGH', dueAt: new Date(Date.now() + 3600000).toISOString(), assignedTo: 'user1', referenceNo: 'ASN-2026-0102', warehouseId: 'WH-A' },
  { id: '3', type: 'PUTAWAY', status: 'IN_PROGRESS', priority: 'MEDIUM', dueAt: new Date(Date.now() + 7200000).toISOString(), assignedTo: 'user1', referenceNo: 'PUT-2026-0055', warehouseId: 'WH-A' },
  { id: '4', type: 'TRANSFER', status: 'PENDING', priority: 'LOW', dueAt: new Date(Date.now() + 14400000).toISOString(), assignedTo: 'user1', referenceNo: 'TRF-2026-0022', warehouseId: 'WH-A' },
  { id: '5', type: 'COUNT', status: 'PENDING', priority: 'MEDIUM', dueAt: new Date(Date.now() + 10800000).toISOString(), assignedTo: 'user1', referenceNo: 'CNT-2026-0008', warehouseId: 'WH-A' },
];

const FILTERS = ['All', 'Pending', 'In Progress', 'Overdue'];

export default function TasksScreen() {
  const [filter, setFilter] = useState('All');

  const filtered = MOCK_TASKS.filter(t => {
    if (filter === 'All') return true;
    if (filter === 'Pending') return t.status === 'PENDING';
    if (filter === 'In Progress') return t.status === 'IN_PROGRESS';
    if (filter === 'Overdue') return t.status === 'OVERDUE';
    return true;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>TASK QUEUE</Text>
        <Badge label={`${MOCK_TASKS.filter(t => t.status === 'OVERDUE').length} OVERDUE`} variant="error" />
      </View>

      <View style={styles.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterLabel, filter === f && styles.filterLabelActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={i => i.id}
        renderItem={({ item }) => <TaskCard task={item} onPress={() => {}} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color={Colors.success} />
            <Text style={styles.emptyText}>No tasks in this category</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { color: Colors.text.primary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 16 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterActive: { backgroundColor: 'rgba(0,229,255,0.1)', borderColor: Colors.cyan },
  filterLabel: { color: Colors.text.secondary, fontSize: 13, fontWeight: '600' },
  filterLabelActive: { color: Colors.cyan },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.text.secondary, fontSize: 15 },
});
