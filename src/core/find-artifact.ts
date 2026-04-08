import { statSync, readdirSync } from 'fs';
import { join } from 'path';
import { ARTIFACT_EXTENSIONS } from '../constants.ts';

export interface Artifact {
  path: string;
  name: string;
  size: number;
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024, dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export async function findArtifacts(includeSubprojects = true): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  const dirsToCheck = ['.'];

  if (includeSubprojects) {
    try {
      const rootEntries = readdirSync('.', { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          dirsToCheck.push(entry.name);
        }
      }
    } catch {
      // Ignore root read failure
    }
  }

  for (const dir of dirsToCheck) {
    const gradleDir = join(dir, 'build', 'libs');
    const mavenDir = join(dir, 'target');

    for (const targetDir of [gradleDir, mavenDir]) {
      try {
        const files = readdirSync(targetDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && ARTIFACT_EXTENSIONS.some(ext => file.name.endsWith(ext))) {
            const filePath = join(targetDir, file.name).replace(/\\/g, '/');
            const stats = statSync(filePath);
            artifacts.push({
              path: filePath,
              name: file.name,
              size: stats.size,
            });
          }
        }
      } catch {
        // Ignoring if the target folder does not exist
      }
    }
  }

  // Deduplication based on path
  const uniqueArtifacts = Array.from(new Map(artifacts.map(a => [a.path, a])).values());
  return uniqueArtifacts;
}
