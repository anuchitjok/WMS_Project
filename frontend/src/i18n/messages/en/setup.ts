export const setup = {
  title: 'Setup Checklist',
  subtitle: 'What is set up, what is missing, and where to fix it — checked from the data each time',
  checkAgain: 'Check again',
  complete: 'Setup is complete.',
  readyCount: '{ready} of {total} steps ready.',
  nothingLeft: 'Nothing left to do.',
  open: 'Open',
  status: {
    READY: 'Ready',
    IN_PROGRESS: 'In progress',
    NOT_STARTED: 'Not started',
    NEEDS_FIX: 'Needs fix',
    REVIEW: 'Review',
  },
  // Step titles keyed by the server's step key. Summaries and issue lines are
  // built by the server from live counts and are shown as sent.
  steps: {
    company: 'Company profile',
    codes: 'Units of measure, departments and reason codes',
    partners: 'Brands and vendors',
    warehouse: 'Warehouse structure',
    products: 'Products',
    access: 'Roles, users and warehouse access',
    approvals: 'Approval rules',
    settings: 'System settings',
  },
};
