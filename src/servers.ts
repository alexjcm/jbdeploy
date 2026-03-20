export interface AppServer {
  name: string;
  home: string;
  lastDebugPort?: number;
  lastServerMode?: 'normal' | 'debug';
  memoryProfile?: 'minimal' | 'recommended';
}

export interface Config {
  servers: AppServer[];
  lastServer?: string;
}
