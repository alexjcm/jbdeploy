import { spawn } from 'bun';
import { existsSync } from 'fs';

export type BuildTool = 'gradle' | 'maven';

export function isGradleProject(): boolean {
  return existsSync('build.gradle') || existsSync('build.gradle.kts');
}

async function buildGradle(): Promise<boolean> {
  const proc = spawn(['gradle', 'clean', 'build', '-x', 'test', '-x', 'pmdMain'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0;
}

export function isMavenProject(): boolean {
  return existsSync('pom.xml');
}

async function buildMaven(): Promise<boolean> {
  const mvn = existsSync('./mvnw') ? './mvnw' : 'mvn';
  const proc = spawn([mvn, 'clean', 'package', '-DskipTests'], {
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
