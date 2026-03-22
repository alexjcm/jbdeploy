import { spawn } from 'child_process';
import { System } from '../core/system.ts';

/**
 * Sends a native macOS notification using osascript.
 * Bypassed safely on Windows/Linux environments via System.isMac.
 */
export function notifySuccess(message: string, title = 'jbdeploy'): void {
  if (!System.isMac) return;

  const script = `display notification "${message}" with title "${title}" sound name "Glass"`;
  
  spawn('osascript', ['-e', script], {
    stdio: 'ignore'
  });
}
