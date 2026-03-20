import { spawn } from 'bun';
import { existsSync, chmodSync } from 'fs';
import { System } from './system.ts';

export type BuildTool = 'gradle' | 'maven';

/**
 * Gets the correct executable for a build tool (supports wrappers and Windows).
 * Tries to assign execution permissions on Unix before returning the wrapper.
 */
function getTargetCommand(tool: BuildTool): string {
  const isWindows = System.isWindows;
  
  if (tool === 'gradle') {
    const wrapper = isWindows ? 'gradlew.bat' : './gradlew';
    if (existsSync(wrapper)) {
      if (!isWindows) {
        try { chmodSync(wrapper, 0o755); } catch { /* ignore */ } // Auto-fix execution permissions
      }
      return wrapper;
    }
    return 'gradle';
  }

  if (tool === 'maven') {
    const wrapper = isWindows ? 'mvnw.cmd' : './mvnw';
    if (existsSync(wrapper)) {
      if (!isWindows) {
        try { chmodSync(wrapper, 0o755); } catch { /* ignore */ } // Auto-fix execution permissions
      }
      return wrapper;
    }
    return 'mvn';
  }
  
  return tool;
}

export function isGradleProject(): boolean {
  return existsSync('build.gradle') || existsSync('build.gradle.kts');
}

async function buildGradle(): Promise<boolean> {
  const cmd = getTargetCommand('gradle');
  const proc = spawn([cmd, 'clean', 'build', '-x', 'test', '-x', 'pmdMain'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0;
}

export function isMavenProject(): boolean {
  return existsSync('pom.xml');
}

async function buildMaven(): Promise<boolean> {
  const cmd = getTargetCommand('maven');
  const proc = spawn([cmd, 'clean', 'package', '-DskipTests'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0;
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
  if (tool === 'gradle') return buildGradle();
  return buildMaven();
}
