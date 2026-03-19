import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SERVER_PATHS, DEPLOYMENT_MARKERS, ARTIFACT_EXTENSIONS } from '../constants.ts';

export interface DeploymentStatus {
  name: string;
  status: string;
}

export function listDeployments(serverHome: string): DeploymentStatus[] {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);
  if (!existsSync(deploymentsDir)) return [];

  const files = readdirSync(deploymentsDir);
  const artifacts = files.filter(f => ARTIFACT_EXTENSIONS.some(ext => f.endsWith(ext)));
  
  return artifacts.map(name => {
    let status = '🕐 pending';
    if (files.includes(`${name}${DEPLOYMENT_MARKERS.DEPLOYED}`))    status = '✔ deployed';
    if (files.includes(`${name}${DEPLOYMENT_MARKERS.FAILED}`))      status = '✖ failed';
    if (files.includes(`${name}${DEPLOYMENT_MARKERS.ISDEPLOYING}`)) status = '⏳ deploying';
    if (files.includes(`${name}${DEPLOYMENT_MARKERS.PENDING}`))     status = '🕐 pending';
    
    return { name, status };
  });
}
