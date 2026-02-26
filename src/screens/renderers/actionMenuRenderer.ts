/**
 * Action menu renderer (UI-03) -- choose attack, switch, or Terastallize.
 */

import type { ListScreen } from '../ScreenState.js';

export function renderActionMenu(opts: { teraUsed: boolean }): ListScreen {
  return {
    items: [
      '< Back',
      'Attack',
      'Switch',
      opts.teraUsed ? 'Tera (used)' : 'Terastallize',
    ],
    status: 'Choose action',
  };
}
