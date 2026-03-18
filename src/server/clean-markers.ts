import { readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SERVER_PATHS } from '../constants.ts';

export function cleanMarkers(serverHome: string): void {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);
  if (!existsSync(deploymentsDir)) return;

  const files = readdirSync(deploymentsDir);
  const markersToClean = files.filter(f => 
    f.endsWith('.failed') || 
    f.endsWith('.isdeploying') || 
    f.endsWith('.pending')
  );

  for (const marker of markersToClean) {
    rmSync(join(deploymentsDir, marker), { force: true });
  }
}
