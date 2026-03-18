import { spawn } from 'bun';
import { join } from 'path';
import { existsSync, statSync } from 'fs';

const BASE_OPTS = '-server -Xms2048m -Xmx5120m -XX:MetaspaceSize=512m -XX:MaxMetaspaceSize=2048m ' +
  '-Djava.net.preferIPv4Stack=true -Djboss.modules.system.pkgs=org.jboss.byteman ' +
  '-Djava.awt.headless=true -XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+ParallelRefProcEnabled';

const getDebugOpts = (port: number) => `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${port}`;

export async function startServer(serverHome: string, debug: boolean = false, debugPort: number = 5005): Promise<void> {
  const isWin = process.platform === 'win32';
  const binDir = join(serverHome, 'bin');
  const scriptName = isWin ? 'standalone.bat' : 'standalone.sh';
  const scriptPath = join(binDir, scriptName);

  if (!existsSync(scriptPath)) {
    throw new Error(`Startup script not found: ${scriptPath}`);
  }

  // Permission validation
  if (!isWin) {
    const stats = statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0; // Check if any execute bit is set
    if (!isExecutable) {
      throw new Error(`Script does not have execution permissions. Run:\nchmod +x ${scriptPath}`);
    }
  }

  const javaOpts = debug ? `${BASE_OPTS} ${getDebugOpts(debugPort)}` : BASE_OPTS;

  // NOTE: Certain artifacts require the OS to be identified as Linux due to their internal 
  // configuration, even when running on macOS or other Unix-like systems.
  const args: string[] = isWin ? [] : ['-Dos.name=Linux'];

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
