// Error and validation messages produced by the web app, plus translations for
// common messages returned by the API. Unknown API messages are shown as sent.
export const errors = {
  network: 'Network error — please check your connection and try again',
  unauthorized: 'Your session has expired. Please sign in again.',
  requestFailed: 'Request failed',
  requestFailedStatus: 'Request failed ({status})',
  uploadFailed: 'Upload failed',
  downloadFailed: 'Download failed ({status})',
  printFailed: 'Print failed',
  importFailed: 'Import failed',
  loadFailed: 'Could not load data',
  saveFailed: 'Could not save changes',
  unexpected: 'An unexpected error occurred',
  // By HTTP status, used when the API returns no readable message.
  http: {
    400: 'Some of the information entered is not valid.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to do this.',
    404: 'The record could not be found.',
    409: 'This record was changed or already exists. Refresh and try again.',
    413: 'The file is too large.',
    422: 'The request could not be processed.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Server error. Please try again later.',
    503: 'The service is temporarily unavailable. Please try again later.',
  },
  // Exact API messages that have a translation. Keys are the English text the API sends.
  api: {
    'Invalid credentials': 'Invalid username or password',
    'Account is inactive': 'This account is inactive. Contact your administrator.',
    'Account is locked': 'This account is temporarily locked. Try again later.',
    'Forbidden resource': 'You do not have permission to do this.',
    'Unauthorized': 'Your session has expired. Please sign in again.',
    'Internal server error': 'Server error. Please try again later.',
    'Too Many Requests': 'Too many requests. Please wait a moment and try again.',
    'ThrottlerException: Too Many Requests': 'Too many attempts. Please wait a minute and try again.',
  },
  validation: {
    required: 'This field is required',
    requiredField: '{field} is required',
    positiveNumber: 'Enter a number greater than 0',
    maxQty: 'Quantity cannot exceed {max}',
    selectOne: 'Select at least one item',
    invalidFile: 'Choose a valid file',
    reasonRequired: 'Please enter a reason',
  },
};
