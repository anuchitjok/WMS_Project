import { RequestStatus } from '@prisma/client';
import { deriveRequestStage, REQUEST_STAGES } from './requests.service';

// The stage the Requests page shows and filters by (Phase 1: status sync).
describe('deriveRequestStage', () => {
  it('follows the fulfillment task once the request is in the warehouse', () => {
    expect(deriveRequestStage(RequestStatus.PICKING, 'PICKING')).toBe('IN_FULFILLMENT');
    expect(deriveRequestStage(RequestStatus.PICKING, 'SHIPPED')).toBe('ISSUED');
    expect(deriveRequestStage(RequestStatus.PICKING, 'DELIVERED')).toBe('ISSUED');
    // WR-2026-TIWNMX: stored status PICKING, task CLOSED → shown as CLOSED, not PICKING
    expect(deriveRequestStage(RequestStatus.PICKING, 'CLOSED')).toBe('CLOSED');
  });

  it('a request sent back to APPROVED after its task was cancelled waits for allocation', () => {
    expect(deriveRequestStage(RequestStatus.APPROVED, 'CANCELLED')).toBe('APPROVED');
    expect(deriveRequestStage(RequestStatus.APPROVED, null)).toBe('APPROVED');
    // Legacy: task cancelled before requests were reopened automatically — still PICKING.
    expect(deriveRequestStage(RequestStatus.PICKING, 'CANCELLED')).toBe('APPROVED');
  });

  it('terminal request statuses win over the task', () => {
    expect(deriveRequestStage(RequestStatus.CANCELLED, 'PICKING')).toBe('CANCELLED');
    expect(deriveRequestStage(RequestStatus.COMPLETED, 'CLOSED')).toBe('CLOSED');
    expect(deriveRequestStage(RequestStatus.ISSUED_TO_RMA, 'CLOSED')).toBe('ISSUED');
    expect(deriveRequestStage(RequestStatus.REJECTED)).toBe('REJECTED');
  });

  it('pre-approval stages', () => {
    expect(deriveRequestStage(RequestStatus.DRAFT)).toBe('DRAFT');
    expect(deriveRequestStage(RequestStatus.SUBMITTED)).toBe('PENDING_APPROVAL');
    expect(deriveRequestStage(RequestStatus.PENDING_APPROVAL)).toBe('PENDING_APPROVAL');
  });

  it('every derivable stage is filterable', () => {
    const seen = new Set<string>();
    for (const s of Object.values(RequestStatus)) {
      for (const t of [null, 'ALLOCATED', 'SHIPPED', 'CLOSED', 'CANCELLED', 'RETURNED']) seen.add(deriveRequestStage(s, t));
    }
    for (const s of seen) expect(REQUEST_STAGES).toContain(s);
  });
});
