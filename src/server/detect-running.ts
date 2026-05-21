import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { SERVER_SCRIPT } from '../constants.ts';
import { System } from '../core/system.ts';

const execAsync = promisify(exec);

function normalizeForComparison(value: string): string {
  const normalizedSlashes = value.replace(/\\/g, '/');
  return System.isWindows ? normalizedSlashes.toLowerCase() : normalizedSlashes;
}

function buildServerHomeMatchers(serverHome: string): string[] {
  const normalizedHome = normalizeForComparison(serverHome);
  const normalizedBinScript = normalizeForComparison(
    join(serverHome, SERVER_SCRIPT.BIN_DIR, System.isWindows ? SERVER_SCRIPT.WIN : SERVER_SCRIPT.UNIX)
  );

  return [
    normalizedHome,
    normalizedBinScript,
    `${normalizedHome}/bin/${System.isWindows ? SERVER_SCRIPT.WIN : SERVER_SCRIPT.UNIX}`,
  ];
}

function isCandidateProcess(commandLine: string): boolean {
  const normalized = normalizeForComparison(commandLine);

  return normalized.includes('standalone')
    || normalized.includes('org.jboss')
    || normalized.includes('jboss-modules')
    || normalized.includes('wildfly');
}

function commandMatchesServerHome(commandLine: string, serverHome: string): boolean {
  if (!isCandidateProcess(commandLine)) {
    return false;
  }

  const normalizedCommand = normalizeForComparison(commandLine);
  return buildServerHomeMatchers(serverHome).some((matcher) => normalizedCommand.includes(matcher));
}

function parseStdoutLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function listUnixProcessCommands(): Promise<string[]> {
  const { stdout } = await execAsync('ps -ax -o command=');
  return parseStdoutLines(stdout);
}

async function listWindowsProcessCommands(): Promise<string[]> {
  try {
    // Fast path: wmic (takes ~200ms)
    const { stdout } = await execAsync('wmic process get CommandLine');
    return parseStdoutLines(stdout);
  } catch {
    // Fallback path: powershell (takes ~1.5s - 3s but extremely robust and guaranteed to be present)
    const command = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine"';
    const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 * 10 });
    return parseStdoutLines(stdout);
  }
}

export async function isServerRunning(serverHome: string): Promise<boolean> {
  try {
    const commands = System.isWindows
      ? await listWindowsProcessCommands()
      : await listUnixProcessCommands();

    return commands.some((commandLine) => commandMatchesServerHome(commandLine, serverHome));
  } catch {
    return false;
  }
}
