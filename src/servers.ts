import { ServerMode, DeployAction } from './constants.ts';

export interface AppServer {
  name: string;
  home: string;
  lastDebugPort?: number;
  lastServerMode?: ServerMode;
  memoryProfile?: 'minimal' | 'recommended';
}

export interface LastDeployment {
  serverName: string;
  action: DeployAction;
  artifactName: string;
  mode: ServerMode;
  port?: number;
}

export interface Config {
  servers: AppServer[];
  lastServer?: string;
  lastDeployments?: Record<string, LastDeployment>;
}
