import fs from 'fs';
import { LOCAL_SESSION_FILE } from '../paths.js';

// Session file shared with the desktop / menu-bar app, so a login in the browser
// also signs the tray timer in. Setting CLOCKWIZE_SESSION_FILE=off disables it.
const enabled = () => LOCAL_SESSION_FILE !== 'off';

export const saveLocalSession = (token, workspaceId) => {
  if (!enabled()) return;
  try {
    fs.writeFileSync(LOCAL_SESSION_FILE, JSON.stringify({ token, workspaceId }), { mode: 0o600 });
  } catch (e) {
    console.error('Failed to save local session:', e);
  }
};

export const clearLocalSession = () => {
  if (!enabled()) return;
  try {
    if (fs.existsSync(LOCAL_SESSION_FILE)) {
      fs.unlinkSync(LOCAL_SESSION_FILE);
    }
  } catch (e) {
    console.error('Failed to clear local session:', e);
  }
};
