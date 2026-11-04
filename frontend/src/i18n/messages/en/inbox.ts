// Notifications page and Work Queue. Notification text and work-item summaries
// are written by the server and shown as sent.
export const inbox = {
  notifications: {
    title: 'Notifications',
    subtitle: 'All system alerts and workflow updates',
    markAll: 'Mark all read',
    allMarked: 'All marked as read',
    empty: 'No notifications',
    clickToOpen: 'Click to open →',
  },
  work: {
    title: 'Work Queue',
    subtitle: 'Open work, oldest first — next action, who is responsible, and how long it has waited',
    stageLabel: 'Stage',
    all: 'All',
    // Keys are the API's stage values.
    stages: {
      Receive: 'Receive',
      Putaway: 'Putaway',
      Approve: 'Approve',
      Allocate: 'Allocate',
      Fulfil: 'Fulfil',
      Return: 'Return',
      Scrap: 'Scrap',
    },
    col: {
      stage: 'Stage',
      reference: 'Reference',
      what: 'What',
      next: 'Next action',
      responsible: 'Responsible',
      waiting: 'Waiting',
    },
    nothing: 'Nothing waiting.',
    nothingIn: 'Nothing waiting in {stage}.',
    mins: '{n} min',
    hours: '{n} h',
    days: '{n} days',
    loadFailed: 'Failed to load work queue',
  },
};
