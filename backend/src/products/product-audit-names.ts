// "Created By" / "Last Modified By" for products.
//
// Products created or changed after migration 31 carry createdById / updatedById.
// Older products have nulls there; for those the names are taken from the audit
// trail at read time (earliest create entry / latest change entry). Existing rows
// are never updated to backfill.

/** Audit actions that record a product being created. */
export const PRODUCT_CREATE_ACTIONS = ['PRODUCT_CREATED', 'PRODUCT_IMPORT_CREATE'] as const;
/** Audit actions that record a product being changed. */
export const PRODUCT_UPDATE_ACTIONS = ['PRODUCT_UPDATED', 'PRODUCT_STATUS_CHANGED', 'PRODUCT_IMPORT_UPDATE'] as const;

export interface ProductAuditRef { id: string; createdById?: string | null; updatedById?: string | null }
export interface ProductAuditLogRef { entityId: string | null; action: string; createdAt: Date; userId: string | null }
export interface AuditUserRef { id: string; fullName?: string | null; username?: string | null }
export interface AuditNames { createdBy: string | null; updatedBy: string | null }

/**
 * Pure resolver: product → { createdBy, updatedBy } display names.
 * Stored ids win; otherwise the earliest create log / latest update log is used.
 */
export function pickAuditNames(
  products: ProductAuditRef[],
  logs: ProductAuditLogRef[],
  users: AuditUserRef[],
): Map<string, AuditNames> {
  const nameOf = new Map(users.map((u) => [u.id, (u.fullName || u.username || '').trim() || null]));
  const creates = new Set<string>(PRODUCT_CREATE_ACTIONS);
  const updates = new Set<string>(PRODUCT_UPDATE_ACTIONS);

  const firstCreate = new Map<string, ProductAuditLogRef>();
  const lastUpdate = new Map<string, ProductAuditLogRef>();
  for (const log of logs) {
    if (!log.entityId || !log.userId) continue;
    if (creates.has(log.action)) {
      const prev = firstCreate.get(log.entityId);
      if (!prev || log.createdAt < prev.createdAt) firstCreate.set(log.entityId, log);
    } else if (updates.has(log.action)) {
      const prev = lastUpdate.get(log.entityId);
      if (!prev || log.createdAt > prev.createdAt) lastUpdate.set(log.entityId, log);
    }
  }

  const out = new Map<string, AuditNames>();
  for (const p of products) {
    const createdId = p.createdById ?? firstCreate.get(p.id)?.userId ?? null;
    const updatedId = p.updatedById ?? lastUpdate.get(p.id)?.userId ?? null;
    out.set(p.id, {
      createdBy: createdId ? nameOf.get(createdId) ?? null : null,
      updatedBy: updatedId ? nameOf.get(updatedId) ?? null : null,
    });
  }
  return out;
}

type AuditNamesDb = {
  auditLog: { findMany: (args: any) => Promise<ProductAuditLogRef[]> };
  user: { findMany: (args: any) => Promise<AuditUserRef[]> };
};

/**
 * Batched lookup for a page of products: at most one audit-log query (only for
 * products missing an id) and one user query — never one query per product.
 */
export async function resolveAuditNames(db: AuditNamesDb, products: ProductAuditRef[]): Promise<Map<string, AuditNames>> {
  if (!products.length) return new Map();
  const needLog = products.filter((p) => !p.createdById || !p.updatedById).map((p) => p.id);
  const logs = needLog.length
    ? await db.auditLog.findMany({
        where: {
          entityType: 'Product',
          entityId: { in: needLog },
          action: { in: [...PRODUCT_CREATE_ACTIONS, ...PRODUCT_UPDATE_ACTIONS] },
          userId: { not: null },
        },
        select: { entityId: true, action: true, createdAt: true, userId: true },
      })
    : [];
  const userIds = new Set<string>();
  for (const p of products) {
    if (p.createdById) userIds.add(p.createdById);
    if (p.updatedById) userIds.add(p.updatedById);
  }
  for (const l of logs) if (l.userId) userIds.add(l.userId);
  const users = userIds.size
    ? await db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true, username: true } })
    : [];
  return pickAuditNames(products, logs, users);
}

/** name := description for new products (Acumatica uses Description as the item name). */
export function resolveProductName(name?: string | null, description?: string | null): string {
  const n = (name ?? '').trim();
  if (n) return n;
  return (description ?? '').trim();
}

/**
 * Name to store on update. An explicit name wins. Otherwise the name follows the
 * description only when it was derived from it (name === old description), so
 * existing products with their own name keep it.
 */
export function nameAfterUpdate(
  before: { name: string; description?: string | null },
  dto: { name?: string | null; description?: string | null },
): string | undefined {
  const explicit = (dto.name ?? '').trim();
  if (explicit) return explicit;
  if (dto.description === undefined || dto.description === null) return undefined;
  const nextDesc = dto.description.trim();
  if (!nextDesc) return undefined;
  const derived = (before.description ?? '').trim() === before.name.trim();
  return derived && nextDesc !== before.name ? nextDesc : undefined;
}
