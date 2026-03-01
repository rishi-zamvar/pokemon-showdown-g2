/**
 * Main menu renderer (UI-01) -- entry point screen.
 */

import type { ListScreen } from '../ScreenState.js';
import { SpeedConfig } from '../../config/SpeedConfig.js';

export function renderMainMenu(): ListScreen {
  return {
    items: ['Enter Battle', `Battle Speed: ${SpeedConfig.current()}`, 'About/Credits'],
    status: 'Pokemon Showdown G2',
  };
}
