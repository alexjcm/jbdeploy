export interface AppServer {
  name: string;
  home: string;
  lastDebugPort?: number;
  lastServerMode?: 'normal' | 'debug';
  memoryProfile?: 'minimal' | 'recommended';
}

export interface LastDeployment {
  serverName: string;
  action: 'build-deploy' | 'deploy-only' | 'start-only';
  artifactName: string;
  mode: 'normal' | 'debug';
  port?: number;
}

export interface Config {
  servers: AppServer[];
  lastServer?: string;
  lastDeployments?: Record<string, LastDeployment>;
}
