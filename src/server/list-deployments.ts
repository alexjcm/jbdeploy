import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { SERVER_PATHS } from '../constants.ts';

export interface DeploymentStatus {
  name: string;
  status: string;
}

export function listDeployments(serverHome: string): DeploymentStatus[] {
  const deploymentsDir = join(serverHome, ...SERVER_PATHS.DEPLOYMENTS);
  if (!existsSync(deploymentsDir)) return [];

  const files = readdirSync(deploymentsDir);
  const artifacts = files.filter(f => f.endsWith('.war') || f.endsWith('.ear'));
  
  return artifacts.map(name => {
    let status = '🕐 pending';
    if (files.includes(`${name}.deployed`)) status = '✔ deployed';
    if (files.includes(`${name}.failed`)) status = '✖ failed';
    if (files.includes(`${name}.isdeploying`)) status = '⏳ deploying';
    if (files.includes(`${name}.pending`)) status = '🕐 pending';
    
    return { name, status };
  });
}
