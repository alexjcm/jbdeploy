#!/usr/bin/env bun
import { log } from './ui/logger.ts';
import { EXIT_CODES } from './constants.ts';
import { getConfig } from './config/config-manager.ts';
import { firstRunFlow, selectServer, addNewServerFlow } from './ui/prompts.ts';

async function main() {
  // Termination signal handling
  process.on('SIGINT', () => {
    process.stdout.write('\n');
    // We don't exit here to allow the loop to return to the menu
    // if a sub-process (like the server) was running.
    // Clack prompts handle their own exit via isCancel().
  });

  process.on('SIGTERM', () => {
    process.exit(EXIT_CODES.SUCCESS);
  });

  // Restore cursor on exit (basic cleanup)
  process.on('exit', () => {
    // TODO: review this code 
    process.stdout.write('\x1b[?25h');
  });

  log.intro('🚀 Deploy CLI');

  // TTY Validation (Interactive mode only)
  if (!process.stdout.isTTY) {
    log.error('This tool requires an interactive terminal (TTY).', 'Additional flags for automation will be required in the future.');
    process.exit(EXIT_CODES.USAGE_ERROR);
  }

  let config = getConfig();
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`
  ${log.intro('Usage: jdeploy-cli [options]')}

  ${log.info('Options:')}
    --list    List currently deployed artifacts on the server
    --clean   Clean error markers (.failed, .pending) on the server
    --help, -h Show this help message

  ${log.info('Configuration:')}
    • Stored locally at ~/.jdeploy-cli/config.json
    • Contains server paths, debug ports, and JVM memory profiles.

  ${log.info('Features:')}
    • Semantic logging and persistent interactive UI.
    • Automatic cleanup of JBoss (data, log, tmp) when started through CLI.
    • Configurable Debug Port (default: 5005).
    • Auto-start server after successful build/deployment if stopped.
    • Loop-based workflow to stay in the CLI after actions.
    \n`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (args.includes('--list') || args.includes('--clean')) {
    const server = config.servers.find(s => s.name === config.lastServer) || config.servers[0];
    if (!server) {
      log.cancel('No servers configured. Run the CLI without flags first.');
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    const { handleListDeployments, handleCleanMarkers } = await import('./commands/server-commands.ts');

    if (args.includes('--list')) {
      await handleListDeployments(server);
    }

    if (args.includes('--clean')) {
      await handleCleanMarkers(server);
    }

    log.outro('Utility executed');
    return;
  }

  let server;

  if (config.servers.length === 0) {
    config = await firstRunFlow();
    server = config.servers[0]!;
  } else {
    const selection = await selectServer(config);
    if (selection === 'ADD_NEW') {
      server = await addNewServerFlow(config);
      const { getConfig } = await import('./config/config-manager.ts');
      config = getConfig(); // Refresh memory config to include the newly added server
    } else {
      server = selection;
      if (config.lastServer !== server.name) {
        config.lastServer = server.name;
        const { saveConfig } = await import('./config/config-manager.ts');
        await saveConfig(config);
      }
    }
  }

  log.info(`Server: ${server.name} (${server.home})`);

  // --- Main Action Loop ---
  while (true) {
    const { selectArtifact, selectAction, selectServerMode } = await import('./ui/prompts.ts');
    const { isServerRunning } = await import('./server/detect-running.ts');
    const { cleanServerTemp } = await import('./server/clean-temp.ts');
    const { startServer } = await import('./server/start-server.ts');
    const { buildProject, detectBuildTool } = await import('./core/build-project.ts');
    const { findArtifacts } = await import('./core/find-artifact.ts');
    const { deployArtifact } = await import('./core/deploy-artifact.ts');
    const { tasks } = await import('@clack/prompts');

    const action = await selectAction();
    const isRunning = await isServerRunning();

    if (action === 'start-only') {
      if (isRunning) {
        log.warn('Server is already running. It may be active in another terminal tab or window.');
        log.note('If you want to restart it, please stop the other instance first.', 'Conflict detected');
        process.exit(EXIT_CODES.SUCCESS);
      }

      const { mode, port } = await selectServerMode(server.lastDebugPort, server.lastServerMode);

      log.step('Server stopped — cleaning temporary directories (data, log, tmp)');
      await cleanServerTemp(server.home);

      log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);
      try {
        server.lastServerMode = mode;
        if (mode === 'debug' && port) server.lastDebugPort = port;
        const { saveConfig } = await import('./config/config-manager.ts');
        await saveConfig(config);
        await startServer(server.home, mode === 'debug', port, server.memoryProfile);
        log.success('Server process finished.');
      } catch (error) {
        log.error('Failed to start server', error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    if (action === 'build-deploy') {
      const buildTool = detectBuildTool();
      if (!buildTool) {
        log.error('No build tool detected', 'This project does not contain build.gradle, build.gradle.kts or pom.xml at the root.');
        continue;
      }

      const buildLabel = buildTool === 'gradle'
        ? 'Building project (gradle clean build)'
        : 'Building project (mvn clean package)';

      try {
        await tasks([
          {
            title: buildLabel,
            task: async () => {
              const success = await buildProject(buildTool);
              if (!success) throw new Error('Build failed');
              return 'Build successful';
            }
          }
        ]);
        const { notifySuccess } = await import('./utils/notify.ts');
        notifySuccess('Build completed successfully!', '🛠️ Build Successful');
      } catch (error) {
        log.error('Action failed', error instanceof Error ? error.message : String(error));
        continue;
      }
    }

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
          task: async (message) => {
            if (!isRunning) {
              message('Cleaning temporary directories (data, log, tmp)');
              await cleanServerTemp(server.home);
            }
            
            const { join } = await import('path');
            const { SERVER_PATHS } = await import('./constants.ts');
            const destPath = join(server.home, ...SERVER_PATHS.DEPLOYMENTS);
            message(`Transferring ${artifact.name} to ${destPath}`);
            deploySuccess = await deployArtifact(artifact, server.home, isRunning);
            
            if (!deploySuccess) throw new Error('Deployment failed (.failed marker or timeout)');
            return isRunning ? 'Deployment validated (.deployed detected)' : 'Artifact transferred successfully (ready for boot)';
          }
        }
      ]);
    } catch (error) {
      log.error('Deployment failed', error instanceof Error ? error.message : String(error));
    }
    
    if (deploySuccess) {
      if (!isRunning) {
        const { mode, port } = await selectServerMode(server.lastDebugPort, server.lastServerMode);
        log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);
        try {
          server.lastServerMode = mode;
          if (mode === 'debug' && port) server.lastDebugPort = port;
          const { saveConfig } = await import('./config/config-manager.ts');
          await saveConfig(config);
          await startServer(server.home, mode === 'debug', port, server.memoryProfile);
          log.success('Server process finished.');
        } catch (error) {
          log.error('Failed to start server', error instanceof Error ? error.message : String(error));
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
