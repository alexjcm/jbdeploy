import { spawn } from 'child_process';
import { existsSync, chmodSync } from 'fs';
import { System } from './system.ts';

export type BuildTool = 'gradle' | 'maven';

/**
 * Gets the correct executable for a build tool (supports wrappers and Windows).
 * Tries to assign execution permissions on Unix before returning the wrapper.
 */
function getTargetCommand(tool: BuildTool): string {
  const isWin = System.isWindows;
  const wrappers: Record<BuildTool, string> = {
    gradle: isWin ? 'gradlew.bat' : './gradlew',
    maven:  isWin ? 'mvnw.cmd'    : './mvnw',
  };
  const fallbacks: Record<BuildTool, string> = { gradle: 'gradle', maven: 'mvn' };
  const wrapper = wrappers[tool];
  if (existsSync(wrapper)) {
    if (!isWin) try { chmodSync(wrapper, 0o755); } catch { /* ignore */ }
    return wrapper;
  }
  return fallbacks[tool];
}

export function isGradleProject(): boolean {
  return existsSync('build.gradle') || existsSync('build.gradle.kts');
}

export function isMavenProject(): boolean {
  return existsSync('pom.xml');
}

async function runBuild(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: System.isWindows });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', (err) => { console.error(`Build error: ${err.message}`); resolve(false); });
  });
}

/**
 * Detects the active build tool. Gradle takes priority over Maven.
 * Returns null if neither is found.
 */
export function detectBuildTool(): BuildTool | null {
  if (isGradleProject()) return 'gradle';
  if (isMavenProject()) return 'maven';
  return null;
}

/**
 * Runs the build for the detected tool.
 * Caller is responsible for checking detectBuildTool() first.
 */
export async function buildProject(tool: BuildTool): Promise<boolean> {
  const args = tool === 'gradle'
    ? ['clean', 'build', '-x', 'test', '-x', 'pmdMain']
    : ['clean', 'package', '-DskipTests'];
  return runBuild(getTargetCommand(tool), args);
}
