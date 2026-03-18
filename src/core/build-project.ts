import { spawn } from 'bun';
import { existsSync } from 'fs';

export function isGradleProject(): boolean {
  return existsSync('build.gradle') || existsSync('build.gradle.kts');
}

export async function buildProject(): Promise<boolean> {
  const proc = spawn(['gradle', 'clean', 'build', '-x', 'test', '-x', 'pmdMain'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}
