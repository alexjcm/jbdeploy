import { spawn } from 'bun';
import { join } from 'path';
import { existsSync, statSync, chmodSync } from 'fs';
import { DEFAULT_DEBUG_PORT, SERVER_SCRIPT } from '../constants.ts';
import { System } from '../core/system.ts';

function getMemoryArgs(profile?: 'minimal' | 'recommended'): string {
  if (profile === 'minimal') {
    return '-Xms1024m -Xmx2048m';
  }
  return '-Xms2048m -Xmx5120m'; // Default to recommended
}

const getDebugOpts = (port: number) => `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${port}`;

export async function startServer(
  serverHome: string, 
  debug = false, 
  debugPort: number = DEFAULT_DEBUG_PORT,
  memoryProfile?: 'minimal' | 'recommended'
): Promise<void> {
  const memOpts = getMemoryArgs(memoryProfile);
  const BASE_OPTS = `-server ${memOpts} -XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=2048m ` +
    '-Djava.net.preferIPv4Stack=true -Djboss.modules.system.pkgs=org.jboss.byteman ' +
    '-Djava.awt.headless=true -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ParallelRefProcEnabled';
  const isWin = System.isWindows;
  const binDir = join(serverHome, SERVER_SCRIPT.BIN_DIR);
  const scriptName = isWin ? SERVER_SCRIPT.WIN : SERVER_SCRIPT.UNIX;
  const scriptPath = join(binDir, scriptName);

  if (!existsSync(scriptPath)) {
    throw new Error(`Startup script not found: ${scriptPath}`);
  }

  // Permission validation
  if (!isWin) {
    const stats = statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0; // Check if any execute bit is set
    if (!isExecutable) {
      try {
        chmodSync(scriptPath, 0o755); // Auto-fix permissions
      } catch (e) {
        throw new Error(`Script does not have execution permissions and auto-fix failed. Run:\nchmod +x ${scriptPath}`, { cause: e });
      }
    }
  }

  const javaOpts = debug ? `${BASE_OPTS} ${getDebugOpts(debugPort)}` : BASE_OPTS;

  // NOTE: Certain artifacts require the OS to be identified as Linux due to their internal 
  // configuration, even when running on macOS or other Unix-like systems.
  const args: string[] = isWin ? [] : [SERVER_SCRIPT.OS_FLAG];

  const proc = spawn([scriptPath, ...args], {
    cwd: binDir,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: {
      ...process.env,
      JAVA_OPTS: javaOpts
    }
  });

  await proc.exited;
}
