import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../theme/colors';
import { Badge } from '../ui/Badge';
import type { Task } from '../../types';

interface TaskCardProps {
  task: Task;
  onPress: () => void;
}

const typeLabel: Record<Task['type'], string> = {
  PICK: 'Pick', PUTAWAY: 'Putaway', RECEIVE: 'Receive', TRANSFER: 'Transfer', COUNT: 'Count',
};

const priorityVariant: Record<Task['priority'], 'error' | 'warning' | 'info' | 'default'> = {
  URGENT: 'error', HIGH: 'warning', MEDIUM: 'info', LOW: 'default',
};

const statusVariant: Record<Task['status'], 'warning' | 'cyan' | 'success' | 'error'> = {
  PENDING: 'warning', IN_PROGRESS: 'cyan', COMPLETED: 'success', OVERDUE: 'error',
};

export const TaskCard: React.FC<TaskCardProps> = ({ task, onPress }) => (
  <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.row}>
      <Text style={styles.ref}>{task.referenceNo}</Text>
      <Badge label={task.priority} variant={priorityVariant[task.priority]} />
    </View>
    <Text style={styles.type}>{typeLabel[task.type]}</Text>
    <View style={[styles.row, { marginTop: 12 }]}>
      <Badge label={task.status.replace('_', ' ')} variant={statusVariant[task.status]} />
      <Text style={styles.due}>Due: {new Date(task.dueAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</Text>
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ref: { color: Colors.cyan, fontSize: 13, fontWeight: '700' },
  type: { color: Colors.text.primary, fontSize: 17, fontWeight: '700', marginTop: 6 },
  due: { color: Colors.text.muted, fontSize: 12 },
});
