import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SERVER_PATHS } from '../constants.ts';

export function cleanServerTemp(serverHome: string): void {
  const dirsToClean = [
    join(serverHome, ...SERVER_PATHS.DATA),
    join(serverHome, ...SERVER_PATHS.LOG),
    join(serverHome, ...SERVER_PATHS.TMP),
  ];

  for (const dir of dirsToClean) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        console.warn(`Could not clean directory: ${dir}. It might be locked.`);
      }
    }
  }
}
