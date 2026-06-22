import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { System } from '../core/system.ts';

type NotificationLevel = 'success' | 'error';
type NotifyOptions = {
  playSound?: boolean;
  showVisual?: boolean;
};

const SOUND_FILE_BY_LEVEL: Record<NotificationLevel, string> = {
  success: '/System/Library/Sounds/Glass.aiff',
  error: '/System/Library/Sounds/Basso.aiff',
};

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildNotificationScript(message: string, title: string): string {
  const safeMessage = escapeAppleScriptString(message);
  const safeTitle = escapeAppleScriptString(title);

  return [
    'ObjC.import("Foundation");',
    'ObjC.import("AppKit");',
    'var center = $.NSUserNotificationCenter.defaultUserNotificationCenter;',
    'var notification = $.NSUserNotification.alloc.init;',
    `notification.setTitle("${safeTitle}");`,
    `notification.setInformativeText("${safeMessage}");`,
    'center.deliverNotification(notification);',
  ].join(' ');
}

/**
 * Sends a best-effort macOS notification and optionally plays a system sound.
 * Bypassed safely on Windows/Linux environments via System.isMac.
 */
function notify(message: string, title: string, level: NotificationLevel, options?: NotifyOptions): void {
  if (!System.isMac) return;

  if (options?.showVisual !== false) {
    const script = buildNotificationScript(message, title);

    try {
      execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
        stdio: 'ignore',
      });
    } catch {
      // Best effort only: the CLI flow must continue even if macOS drops the banner.
    }
  }

  if (options?.playSound) {
    playSound(level);
  }
}

function playSound(level: NotificationLevel): void {
  const soundFile = SOUND_FILE_BY_LEVEL[level];
  if (existsSync(soundFile)) {
    const soundProc = spawn('afplay', [soundFile], {
      stdio: 'ignore',
      detached: true,
    });
    soundProc.on('error', () => {
      process.stderr.write('\u0007');
    });
    soundProc.unref();
    return;
  }

  process.stderr.write('\u0007');
}

export function notifySuccess(message: string, title = 'jbdeploy', options?: NotifyOptions): void {
  notify(message, title, 'success', options);
}

export function notifyError(message: string, title = 'jbdeploy', options?: NotifyOptions): void {
  notify(message, title, 'error', options);
}
