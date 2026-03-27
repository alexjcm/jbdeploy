import sync from 'fast-glob';
import { statSync } from 'fs';
import { basename } from 'path';
import { ARTIFACT_EXTENSIONS } from '../constants.ts';

export interface Artifact {
  path: string;
  name: string;
  size: number;
}

export async function findArtifacts(includeSubprojects = true): Promise<Artifact[]> {
  const patterns = ARTIFACT_EXTENSIONS.flatMap(ext => [
    // Gradle
    `build/libs/*${ext}`,
    ...(includeSubprojects ? [`*/build/libs/*${ext}`] : []),
    // Maven
    `target/*${ext}`,
    ...(includeSubprojects ? [`*/target/*${ext}`] : []),
  ]);

  const paths = await sync(patterns, { onlyFiles: true });
  const artifacts: Artifact[] = paths.map(path => {
    const stats = statSync(path);
    return {
      path,
      name: basename(path),
      size: stats.size,
    };
  });

  const uniqueArtifacts = Array.from(new Map(artifacts.map(a => [a.path, a])).values());
  
  return uniqueArtifacts;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
