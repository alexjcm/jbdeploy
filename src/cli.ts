import { tasks } from '@clack/prompts';
import { readFileSync } from 'fs';
import { log } from './ui/logger.ts';
import { AppServer } from './servers.ts';
import { EXIT_CODES } from './constants.ts';
import { getConfig, saveConfig } from './config/config-manager.ts';
import { selectArtifact, selectAction, selectServerMode, selectServer, addNewServerFlow } from './ui/prompts.ts';
import { isServerRunning } from './server/detect-running.ts';
import { cleanServerTemp } from './server/clean-temp.ts';
import { startServer } from './server/start-server.ts';
import { buildProject, detectBuildTool } from './core/build-project.ts';
import { findArtifacts } from './core/find-artifact.ts';
import { deployArtifact } from './core/deploy-artifact.ts';

function getCliVersion(): string {
  try {
    const pkgRaw = readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  // Global exit handlers to ensure cursor is restored
  process.on('SIGINT', () => {
    process.stdout.write('\n');
  });

  process.on('SIGTERM', () => {
    process.exit(EXIT_CODES.SUCCESS);
  });

  process.on('exit', () => {
    // Restore cursor if it was hidden by clack
    process.stdout.write('\x1b[?25h');
  });

  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${getCliVersion()}\n`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (args.includes('--help') || args.includes('-h')) {
    log.intro('Usage: jbdeploy [options]');
    process.stdout.write('\n');
    log.info('Options:');
    process.stdout.write('    --help, -h       Show this help message\n');
    process.stdout.write('    --version, -v    Show current version\n\n');

    log.info('Configuration:');
    process.stdout.write('    • Stored locally at ~/.jbdeploy/config.json\n');
    process.stdout.write('    • Contains server paths, debug ports, and JVM memory profiles.\n\n');

    log.info('Features:');
    process.stdout.write('    • Semantic logging and persistent interactive UI.\n');
    process.stdout.write('    • Automatic cleanup of JBoss (data, log, tmp) when started through CLI.\n');
    process.stdout.write('    • Configurable Debug Port (default: 5005).\n');
    process.stdout.write('    • Auto-start server after successful build/deployment if stopped.\n');
    process.stdout.write('    • Loop-based workflow to stay in the CLI after actions.\n\n');
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!process.stdout.isTTY) {
    log.error('This tool requires an interactive terminal (TTY).', 'Additional flags for automation will be required in the future.');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  log.intro('🚀 Deploy CLI');

  let config = getConfig();

  let selectedServer: AppServer;

  if (config.servers.length === 0) {
    selectedServer = await addNewServerFlow(config);
    // Refresh config after adding
    config = getConfig();
  } else {
    const serverChoice = await selectServer(config);
    if (serverChoice === 'ADD_NEW') {
      selectedServer = await addNewServerFlow(config);
      // Refresh config after adding
      config = getConfig();
    } else {
      selectedServer = serverChoice;
      if (config.lastServer !== selectedServer.name) {
        config.lastServer = selectedServer.name;
        await saveConfig(config);
      }
    }
  }

  log.info(`Server: ${selectedServer.name} (${selectedServer.home})`);

  // CLI Loop
  while (true) {
    const action = await selectAction();
    const isRunning = await isServerRunning();

    if (action === 'start-only') {
      if (isRunning) {
        log.warn('Server is already running. It may be active in another terminal tab or window.');
        log.note('If you want to restart it, please stop the other instance first.', 'Conflict detected');
        process.exit(EXIT_CODES.SUCCESS);
      }

      const { mode, port } = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
      
      log.step('Server stopped — cleaning temporary directories (data, log, tmp)');
      await cleanServerTemp(selectedServer.home);

      log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);

      try {
        selectedServer.lastServerMode = mode;
        if (mode === 'debug' && port) {
          selectedServer.lastDebugPort = port;
        }
        await saveConfig(config);
        
        await startServer(selectedServer.home, mode === 'debug', port, selectedServer.memoryProfile);
        log.success('Server process finished.');
      } catch (err) {
        log.error('Failed to start server', err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // Build + Deploy or Deploy Only
    if (action === 'build-deploy') {
      const buildTool = detectBuildTool();
      if (!buildTool) {
        log.error('No build tool detected', 'This project does not contain build.gradle, build.gradle.kts or pom.xml at the root.');
        continue;
      }

      const buildTitle = buildTool === 'gradle' 
        ? 'Building project (gradle clean build)' 
        : 'Building project (mvn clean package)';

      try {
        await tasks([
          {
            title: buildTitle,
            task: async () => {
              const success = await buildProject(buildTool);
              if (!success) throw new Error('Build failed');
              return 'Build successful';
            },
          },
        ]);
        
        const { notifySuccess } = await import('./utils/notify.ts');
        notifySuccess('Build completed successfully!', '🛠️ Build Successful');

      } catch (err) {
        log.error('Action failed', err instanceof Error ? err.message : String(err));
        continue;
      }
    }

    // Find artifacts after potential build
    const artifacts = await findArtifacts();
    if (artifacts.length === 0) {
      log.warn('No artifacts found (.war or .ear). Make sure you have built the project.');
      continue;
    }

    const artifact = await selectArtifact(artifacts);
    let deploySuccess = false;

    try {
      await tasks([
        {
          title: `Deploying ${artifact.name}`,
          task: async (taskLog) => {
            if (!isRunning) {
              taskLog('Cleaning temporary directories (data, log, tmp)');
              await cleanServerTemp(selectedServer.home);
            }
            
            const { join } = await import('path');
            const { SERVER_PATHS } = await import('./constants.ts');
            const deploymentsDir = join(selectedServer.home, ...SERVER_PATHS.DEPLOYMENTS);

            taskLog(`Transferring ${artifact.name} to ${deploymentsDir}`);
            deploySuccess = await deployArtifact(artifact, selectedServer.home, isRunning);
            
            if (!deploySuccess) {
              throw new Error('Deployment failed (.failed marker or timeout)');
            }
            return isRunning ? 'Deployment validated (.deployed detected)' : 'Artifact transferred successfully (ready for boot)';
          },
        },
      ]);
    } catch (err) {
      log.error('Deployment failed', err instanceof Error ? err.message : String(err));
    }

    if (deploySuccess && !isRunning) {
      const { mode, port } = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
      
      log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);

      try {
        selectedServer.lastServerMode = mode;
        if (mode === 'debug' && port) {
          selectedServer.lastDebugPort = port;
        }
        await saveConfig(config);
        
        await startServer(selectedServer.home, mode === 'debug', port, selectedServer.memoryProfile);
        log.success('Server process finished.');
      } catch (err) {
        log.error('Failed to start server', err instanceof Error ? err.message : String(err));
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
