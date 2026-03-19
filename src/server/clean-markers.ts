import { readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SERVER_PATHS, DEPLOYMENT_MARKERS } from '../constants.ts';

export function cleanMarkers(serverHome: string): void {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);
  if (!existsSync(deploymentsDir)) return;

  const files = readdirSync(deploymentsDir);
  const markersToClean = files.filter(f => 
    f.endsWith(DEPLOYMENT_MARKERS.FAILED) || 
    f.endsWith(DEPLOYMENT_MARKERS.ISDEPLOYING) || 
    f.endsWith(DEPLOYMENT_MARKERS.PENDING)
  );

  for (const marker of markersToClean) {
    rmSync(join(deploymentsDir, marker), { force: true });
  }
}
