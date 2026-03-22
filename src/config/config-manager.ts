import { existsSync, mkdirSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

import { Config } from '../servers.ts';
import { SERVER_PATHS } from '../constants.ts';

const CONFIG_DIR = join(homedir(), '.jdeploy');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function getConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return { servers: [] };
  }
  try {
    const text = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(text);
  } catch (error) {
    console.error('Error reading configuration:', error);
    return { servers: [] };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Cleans paths dragged into the terminal (strips quotes and unescapes spaces)
 */
export function normalizePath(input: string): string {
  return input
    .trim()
    .replace(/^['"]|['"]$/g, '') // Strip leading/trailing quotes
    .replace(/\\ /g, ' ');       // Unescape spaces (Unix/macOS)
}

export function validateServerHome(home: string): boolean {
  const cleanPath = normalizePath(home);
  if (!existsSync(cleanPath)) return false;
  const deploymentsPath = join(cleanPath, ...SERVER_PATHS.DEPLOYMENTS);
  return existsSync(deploymentsPath);
}
