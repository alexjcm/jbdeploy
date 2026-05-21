import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ARTIFACT_EXTENSIONS, SERVER_PATHS } from '../constants.ts';

export function listDeployedArtifacts(serverHome: string): string[] {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);

  if (!existsSync(deploymentsDir)) {
    return [];
  }

  try {
    const entries = readdirSync(deploymentsDir, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const undeployedSet = new Set(fileNames.filter((name) => name.endsWith('.undeployed')));
    const failedSet = new Set(fileNames.filter((name) => name.endsWith('.failed')));

    return fileNames
      .filter((fileName) => ARTIFACT_EXTENSIONS.some((ext) => fileName.endsWith(ext)))
      .filter((fileName) => !undeployedSet.has(`${fileName}.undeployed`) && !failedSet.has(`${fileName}.failed`))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
