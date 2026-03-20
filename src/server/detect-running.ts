import { spawn } from 'bun';
import { System } from '../core/system.ts';

export async function isServerRunning(): Promise<boolean> {
  if (System.isWindows) {
    const proc = spawn(['tasklist'], { stdout: 'pipe' });
    const output = await new Response(proc.stdout).text();
    const lc = output.toLowerCase();
    return lc.includes('jboss') || lc.includes('wildfly') || lc.includes('standalone');
  } else {
    const proc = spawn(['pgrep', '-f', 'standalone'], { stdout: 'pipe' });
    const exitCode = await proc.exited;
    return exitCode === 0;
  }
}
