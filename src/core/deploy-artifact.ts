import { join, basename, extname } from 'path';
import { readdirSync, rmSync, existsSync } from 'fs';
import { copyFile, writeFile } from 'fs/promises';
import { Artifact } from './find-artifact.ts';
import { SERVER_PATHS, DEPLOYMENT_MARKERS } from '../constants.ts';

function removeMarkers(base: string): void {
  const { DEPLOYED, FAILED, ISDEPLOYING, SKIPDEPLOY, PENDING } = DEPLOYMENT_MARKERS;
  for (const marker of [DEPLOYED, FAILED, ISDEPLOYING, SKIPDEPLOY, PENDING]) {
    rmSync(`${base}${marker}`, { force: true });
  }
}

export async function deployArtifact(artifact: Artifact, serverHome: string, isRunning = true): Promise<boolean> {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);
  const destPath = join(deploymentsDir, artifact.name);

  try {
    // Smart Cleanup: Remove previous versions of the same artifact
    const ext = extname(artifact.name);
    const baseWithoutExt = basename(artifact.name, ext);
    
    // Pattern: everything before the first hyphen followed by a digit
    const versionMatch = /^(.+?)-\d/.exec(baseWithoutExt);
    const prefix = versionMatch ? versionMatch[1] : baseWithoutExt;

    if (existsSync(deploymentsDir)) {
      const files = readdirSync(deploymentsDir);
      for (const file of files) {
        const isPreviousVersion = file.startsWith(`${prefix}-`) && file.endsWith(ext) && file !== artifact.name;
        if (isPreviousVersion) {
          const fullPath = join(deploymentsDir, file);
          rmSync(fullPath, { force: true });
          removeMarkers(fullPath);
        }
      }
    }

    removeMarkers(destPath);

    await copyFile(artifact.path, destPath);
    
    // The JBoss/Wildfly server will delete this .dodeploy marker and create either .deployed or .failed
    await writeFile(`${destPath}${DEPLOYMENT_MARKERS.DODEPLOY}`, '', 'utf-8');
    
    // If the server is offline, skip polling since JBoss isn't there to process the marker yet
    if (!isRunning) return true;
    
    const deployedMarker = `${destPath}${DEPLOYMENT_MARKERS.DEPLOYED}`;
    const failedMarker = `${destPath}${DEPLOYMENT_MARKERS.FAILED}`;
    
    let attempts = 0;
    const maxAttempts = 120; // 120 seconds timeout
    
    while (attempts < maxAttempts) {
      if (existsSync(deployedMarker)) return true;
      if (existsSync(failedMarker)) return false;
      
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    
    throw new Error(`Timeout (${maxAttempts}s): Server took too long to deploy.`);
  } catch (err) {
    if (err instanceof Error) throw err;
    return false;
  }
}
