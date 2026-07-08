import { useState } from 'react';

// Wraps a dialog's close action with an unsaved-changes confirmation.
// `isDirty` reflects whether the current form differs from its opening baseline.
// `onDiscard` performs the actual close + form reset — same as the pre-guard behavior.
export function useDiscardGuard(isDirty: boolean, onDiscard: () => void) {
  const [confirming, setConfirming] = useState(false);

  function requestClose() {
    if (isDirty) setConfirming(true);
    else onDiscard();
  }

  function confirmDiscard() {
    setConfirming(false);
    onDiscard();
  }

  function keepEditing() {
    setConfirming(false);
  }

  return { confirming, requestClose, confirmDiscard, keepEditing };
}
