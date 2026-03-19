export interface AppServer {
  name: string;
  home: string;
  lastDebugPort?: number;
  lastServerMode?: 'normal' | 'debug';
}

export interface Config {
  servers: AppServer[];
  lastServer?: string;
}
