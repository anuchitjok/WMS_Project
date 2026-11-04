/** Password policy: >= 8 chars, upper + lower + digit. Returns what is missing (empty = ok). */
export function passwordPolicyErrors(pw: string | null | undefined): string[] {
  const errs: string[] = [];
  if (!pw || pw.length < 8) errs.push('at least 8 characters');
  if (!/[A-Z]/.test(pw ?? '')) errs.push('one uppercase letter');
  if (!/[a-z]/.test(pw ?? '')) errs.push('one lowercase letter');
  if (!/[0-9]/.test(pw ?? '')) errs.push('one digit');
  return errs;
}
