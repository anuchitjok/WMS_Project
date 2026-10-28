import { ForbiddenException } from '@nestjs/common';

/**
 * Separation of duties (maker ≠ checker).
 *
 * The person who raised, performed or counted something may not approve it.
 * Enforced in the services, so every endpoint that reaches the decision (REST,
 * approval engine, scan, import) gets the same rule. There is no override:
 * HSNT_WMS_SKILL.md defines no emergency/self-approval exception, so none is
 * implemented — an administrator who raised a document needs a second
 * approver like everyone else.
 */
export function assertNotSelfApproval(
  approverId: string,
  makers: Array<string | null | undefined>,
  what: string,
): void {
  if (!approverId) return;
  if (makers.some((m) => !!m && m === approverId)) {
    throw new ForbiddenException(
      `Separation of duties: you cannot approve ${what} you raised or performed yourself`,
    );
  }
}
