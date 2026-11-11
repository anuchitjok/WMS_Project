// PR6 label: which pick-list lines use a stock row the approver chose ("Selected by
// Approver"). Read only — nothing here changes reservation, allocation or stock.
//
// Allocation uses the chosen rows only on a request's FIRST task (a re-allocation
// after a cancelled task goes FIFO), and it closes those picks (releasedAt set).
// So a task line is "selected by approver" when:
//   - its task is the earliest task of its request, and
//   - a closed pick of that request names the same stock row.
// Before allocation (no task yet) a request line is marked while its pick is open.

type PickDb = {
  fulfillmentTask: {
    findMany: (args: {
      where: { requestId: { in: string[] } };
      select: { id: true; requestId: true; createdAt: true };
    }) => Promise<Array<{ id: string; requestId: string; createdAt: Date }>>;
  };
  withdrawalRequestPick: {
    findMany: (args: any) => Promise<Array<{ stockItemId: string; releasedAt: Date | null; requestItem: { requestId: string } }>>;
  };
};

/** The earliest task id of each request (ties broken by id, like a stable sort). */
export function firstTaskByRequest(tasks: Array<{ id: string; requestId: string; createdAt: Date }>): Map<string, string> {
  const best = new Map<string, { id: string; at: number }>();
  for (const t of tasks) {
    const at = new Date(t.createdAt).getTime();
    const cur = best.get(t.requestId);
    if (!cur || at < cur.at || (at === cur.at && t.id < cur.id)) best.set(t.requestId, { id: t.id, at });
  }
  return new Map([...best].map(([req, v]) => [req, v.id]));
}

/**
 * For each given task: the stock row ids its allocation took from approver picks.
 * Tasks that are not their request's first task get an empty set.
 */
export async function approverPickedRows(
  db: PickDb,
  tasks: Array<{ id: string; requestId: string }>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(tasks.map((t) => [t.id, new Set<string>()]));
  const reqIds = [...new Set(tasks.map((t) => t.requestId).filter(Boolean))];
  if (!reqIds.length) return out;

  const picks = await db.withdrawalRequestPick.findMany({
    where: { releasedAt: { not: null }, requestItem: { requestId: { in: reqIds } } },
    select: { stockItemId: true, releasedAt: true, requestItem: { select: { requestId: true } } },
  });
  if (!picks.length) return out; // no approver picks at all: FIFO lines stay unmarked

  const all = await db.fulfillmentTask.findMany({
    where: { requestId: { in: reqIds } },
    select: { id: true, requestId: true, createdAt: true },
  });
  const first = firstTaskByRequest(all);
  const byReq = new Map<string, Set<string>>();
  for (const p of picks) {
    const req = p.requestItem.requestId;
    if (!byReq.has(req)) byReq.set(req, new Set());
    byReq.get(req)!.add(p.stockItemId);
  }
  for (const t of tasks) {
    if (first.get(t.requestId) === t.id) out.set(t.id, byReq.get(t.requestId) ?? new Set());
  }
  return out;
}

/** Before allocation: stock rows still held by an open approver pick of this request. */
export async function openPickRows(db: PickDb, requestId: string): Promise<Set<string>> {
  const picks = await db.withdrawalRequestPick.findMany({
    where: { releasedAt: null, requestItem: { requestId } },
    select: { stockItemId: true, releasedAt: true, requestItem: { select: { requestId: true } } },
  });
  return new Set(picks.map((p) => p.stockItemId));
}
