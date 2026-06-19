import { stat, readdir } from 'fs/promises';
import { join } from 'path';
import { ARTIFACT_EXTENSIONS } from '../constants.ts';

export interface Artifact {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024, dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getArtifactBaseName(name: string): string {
  return name.replace(/-[0-9].*$/, '');
}


export async function findArtifacts(includeSubprojects = true): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  const dirsToCheck = ['.'];

  if (includeSubprojects) {
    try {
      const rootEntries = await readdir('.', { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          dirsToCheck.push(entry.name);
        }
      }
    } catch {
      // Intentionally ignored: root directory may be unreadable in restricted environments
    }
  }

  const candidates: { filePath: string; fileName: string }[] = [];

  for (const dir of dirsToCheck) {
    const gradleDir = join(dir, 'build', 'libs');
    const mavenDir = join(dir, 'target');

    for (const targetDir of [gradleDir, mavenDir]) {
      try {
        const files = await readdir(targetDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && ARTIFACT_EXTENSIONS.some(ext => file.name.endsWith(ext))) {
            const filePath = join(targetDir, file.name).replace(/\\/g, '/');
            candidates.push({ filePath, fileName: file.name });
          }
        }
      } catch {
        // Intentionally ignored: target directory may not exist for this subproject
      }
    }
  }

  const statPromises = candidates.map(async (c) => {
    try {
      const stats = await stat(c.filePath);
      return {
        path: c.filePath,
        name: c.fileName,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    } catch {
      return null;
    }
  });

  const resolved = await Promise.all(statPromises);
  for (const item of resolved) {
    if (item) artifacts.push(item);
  }

  // Deduplication based on path
  const uniqueArtifacts = Array.from(new Map(artifacts.map(a => [a.path, a])).values());
  return uniqueArtifacts;
}
