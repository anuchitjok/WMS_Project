import { ConflictException, NotFoundException } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';

const F = FulfillmentStatus;

/** Task states that still hold stock in the warehouse and may be cancelled. */
export const CANCELLABLE_TASK_STATUSES: FulfillmentStatus[] = [
  F.ALLOCATED, F.PICKING, F.PICKED, F.PACKING, F.PACKED, F.READY_TO_SHIP,
  F.SHORT_PICK, F.DAMAGED, F.HOLD,
];

/** Task states whose goods have been issued (or the task is otherwise finished). */
export const ISSUED_TASK_STATUSES: FulfillmentStatus[] = [F.SHIPPED, F.DELIVERED, F.CLOSED, F.RETURNED];

/**
 * Atomically moves a task to `to` only if it is currently in one of `from`.
 * Guards every state change against double-clicks and concurrent operators.
 */
export async function claimTaskStatus(
  tx: Prisma.TransactionClient,
  taskId: string,
  from: FulfillmentStatus[],
  to: FulfillmentStatus,
  extra: Prisma.FulfillmentTaskUncheckedUpdateManyInput = {},
): Promise<void> {
  const res = await tx.fulfillmentTask.updateMany({
    where: { id: taskId, status: { in: from } },
    data: { ...extra, status: to, version: { increment: 1 } },
  });
  if (res.count === 1) return;
  const task = await tx.fulfillmentTask.findUnique({ where: { id: taskId }, select: { status: true } });
  if (!task) throw new NotFoundException('FulfillmentTask not found');
  throw new ConflictException(`Task is ${task.status}; expected ${from.join(' or ')}`);
}
