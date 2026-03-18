import { spawn } from 'bun';

export async function isServerRunning(): Promise<boolean> {
  const platform = process.platform;
  
  if (platform === 'win32') {
    // Windows: filtered tasklist (JBoss/Wildfly/Standalone)
    const proc = spawn(['tasklist'], { stdout: 'pipe' });
    const output = await new Response(proc.stdout).text();
    const lc = output.toLowerCase();
    return lc.includes('jboss') || lc.includes('wildfly') || lc.includes('standalone');
  } else {
    // Linux / macOS: pgrep -f standalone
    const proc = spawn(['pgrep', '-f', 'standalone'], { stdout: 'pipe' });
    const exitCode = await proc.exited;
    return exitCode === 0;
  }
}
