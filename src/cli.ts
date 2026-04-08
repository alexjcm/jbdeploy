import { tasks } from '@clack/prompts';
import { readFileSync } from 'fs';
import { log } from './ui/logger.ts';
import { AppServer, LastDeployment } from './servers.ts';
import { EXIT_CODES, ACTIONS, SERVER_MODES, NAV, DeployAction, ServerMode } from './constants.ts';
import { getConfig, saveConfig } from './config/config-manager.ts';
import { selectArtifact, selectAction, selectServerMode, selectServer, deleteServerFlow, addNewServerFlow, confirmReuseDeployment, CancelToServerSelect } from './ui/prompts.ts';
import { isServerRunning } from './server/detect-running.ts';
import { cleanServerTemp } from './server/clean-temp.ts';
import { startServer } from './server/start-server.ts';
import { buildProject, detectBuildTool } from './core/build-project.ts';
import { findArtifacts, Artifact } from './core/find-artifact.ts';
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

  const cwd = process.cwd();

  let isFirstAppRun = true;

  // Outer loop: allows returning to server selection via "← Back (change server)"
  serverLoop: while (true) {
    let config = getConfig();
    let selectedServer: AppServer | undefined;
    let initialReuse: {
      action: DeployAction,
      artifact: Artifact | null,
      mode: ServerMode,
      port?: number,
      server: AppServer
    } | null = null;

    const lastDep: LastDeployment | undefined = config.lastDeployments?.[cwd];

    // Only prompt for reuse on the very first CLI boot, not when returning via Back
    if (isFirstAppRun && lastDep) {
      const server = config.servers.find(s => s.name === lastDep.serverName);
      if (server) {
        const reuse = await confirmReuseDeployment(lastDep);
        if (reuse) {
          selectedServer = server;
          const buildTool = detectBuildTool();
          const artifacts = await findArtifacts(!!buildTool);
          const artifact = artifacts.find(a => a.name === lastDep.artifactName) || null;

          if (!artifact && lastDep.action !== ACTIONS.START_ONLY) {
            log.warn(`Artifact '${lastDep.artifactName}' not found. Falling back to manual flow.`);
          } else {
            initialReuse = {
              action: lastDep.action,
              artifact,
              mode: lastDep.mode,
              server,
              ...(lastDep.port ? { port: lastDep.port } : {})
            };
          }
        }
      }
    }
    
    isFirstAppRun = false;

    if (!selectedServer) {
      if (config.servers.length === 0) {
        try {
          selectedServer = await addNewServerFlow(config);
          config = getConfig();
        } catch (e) {
          if (e instanceof CancelToServerSelect) continue serverLoop;
          throw e;
        }
      } else {
        const serverChoice = await selectServer(config);
        if (serverChoice === 'ADD_NEW') {
          try {
            selectedServer = await addNewServerFlow(config);
            config = getConfig();
          } catch (e) {
            if (e instanceof CancelToServerSelect) continue serverLoop;
            throw e;
          }
        } else if (serverChoice === 'DELETE_SERVER') {
          await deleteServerFlow(config);
          config = getConfig();
          continue serverLoop;
        } else {
          selectedServer = serverChoice;
          if (config.lastServer !== selectedServer.name) {
            config.lastServer = selectedServer.name;
            await saveConfig(config);
          }
        }
      }
    }

    // Action loop
    let firstIteration = true;

    while (true) {
      let action: DeployAction;
      let artifact: Artifact | null = null;
      let mode: ServerMode | undefined;
      let port: number | undefined;
      let reused = false;

      // Reuse logic (only on first iteration)
      if (firstIteration && initialReuse) {
        action = initialReuse.action;
        artifact = initialReuse.artifact;
        mode = initialReuse.mode;
        port = initialReuse.port;
        reused = true;
        log.info(`Reusing: ${action} -> ${artifact?.name || 'server only'} on ${selectedServer!.name}`);
      }
      firstIteration = false;
      const buildTool = reused ? null : detectBuildTool();

      if (!reused) {
        const currentArtifacts = await findArtifacts(!!buildTool);

        const actionResult = await selectAction(
          currentArtifacts.length === 0 ? ACTIONS.BUILD_DEPLOY : undefined,
          {
            canBuild: !!buildTool,
            canDeploy: currentArtifacts.length > 0
          }
        );

        if (actionResult === NAV.BACK) continue serverLoop;
        action = actionResult;
      } else {
        action = action!;
      }

      const isRunning = await isServerRunning();

      if (action === ACTIONS.START_ONLY) {
        if (isRunning) {
          log.warn('Server is already running. It may be active in another terminal tab or window.');
          log.note('If you want to restart it, please stop the other instance first.', 'Conflict detected');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (!reused) {
          const modeResult = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
          if (modeResult === NAV.BACK) continue;
          mode = modeResult.mode;
          port = modeResult.port;
        }

        log.step('Server stopped — cleaning temporary directories (data, log, tmp)');
        cleanServerTemp(selectedServer.home);

        log.step(`Starting server in ${mode} mode${mode === SERVER_MODES.DEBUG ? ` (port ${port})` : ''}...`);

        try {
          selectedServer.lastServerMode = mode!;
          if (mode === SERVER_MODES.DEBUG && port) {
            selectedServer.lastDebugPort = port;
          }

          // Save successful start-only to project memory
          if (!config.lastDeployments) config.lastDeployments = {};
          config.lastDeployments[cwd] = {
            serverName: selectedServer.name,
            action: ACTIONS.START_ONLY,
            artifactName: 'server-only',
            mode: mode!,
            ...((port || selectedServer.lastDebugPort) ? { port: (port || selectedServer.lastDebugPort) } : {})
          };

          // Explicitly sync the overall global state bypass tracking
          config.lastServer = selectedServer.name;
          await saveConfig(config);

          await startServer(selectedServer.home, mode === SERVER_MODES.DEBUG, port, selectedServer.memoryProfile);
          log.success('Server process finished.');
        } catch (err) {
          log.error('Failed to start server', err instanceof Error ? err.message : String(err));
        }
        continue;
      }

      // Build + Deploy or Deploy Only
      if (action === ACTIONS.BUILD_DEPLOY && !reused) {
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

      // Refresh/Select artifacts
      if (!reused) {
        const currentArtifacts = await findArtifacts(!!buildTool);
        if (currentArtifacts.length === 0) {
          log.warn('No artifacts found (.war or .ear). Make sure you have built the project.');
          continue;
        }
        const artifactResult = await selectArtifact(currentArtifacts, lastDep?.artifactName);
        if (artifactResult === NAV.BACK) continue;
        artifact = artifactResult;
      }

      let deploySuccess = false;

      try {
        await tasks([
          {
            title: `Deploying ${artifact!.name}`,
            task: async (taskLog) => {
              if (!isRunning) {
                taskLog('Cleaning temporary directories (data, log, tmp)');
                cleanServerTemp(selectedServer.home);
              }

              deploySuccess = await deployArtifact(artifact!, selectedServer.home, isRunning);

              if (!deploySuccess) {
                throw new Error('Deployment failed (.failed marker or timeout)');
              }

              // Save successful deployment to project memory
              if (!config.lastDeployments) config.lastDeployments = {};
              config.lastDeployments[cwd] = {
                serverName: selectedServer.name,
                action: action === ACTIONS.BUILD_DEPLOY ? ACTIONS.BUILD_DEPLOY : ACTIONS.DEPLOY_ONLY,
                artifactName: artifact!.name,
                mode: mode || selectedServer.lastServerMode || SERVER_MODES.NORMAL,
                ...( (port || selectedServer.lastDebugPort) ? { port: (port || selectedServer.lastDebugPort) } : {} )
              };
              
              // Explicitly sync the overall global state bypass tracking
              config.lastServer = selectedServer.name;
              await saveConfig(config);

              return isRunning ? 'Deployment validated (.deployed detected)' : 'Artifact transferred successfully (ready for boot)';
            },
          },
        ]);
      } catch (err) {
        log.error('Deployment failed', err instanceof Error ? err.message : String(err));
      }

      if (deploySuccess && !isRunning) {
        if (!reused) {
          const modeResult = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
          if (modeResult === NAV.BACK) continue;
          mode = modeResult.mode;
          port = modeResult.port;
        }

        log.step(`Starting server in ${mode} mode${mode === SERVER_MODES.DEBUG ? ` (port ${port})` : ''}...`);

        try {
          selectedServer.lastServerMode = mode!;
          if (mode === SERVER_MODES.DEBUG && port) {
            selectedServer.lastDebugPort = port;
          }
          await saveConfig(config);

          await startServer(selectedServer.home, mode === SERVER_MODES.DEBUG, port, selectedServer.memoryProfile);
          log.success('Server process finished.');
        } catch (err) {
          log.error('Failed to start server', err instanceof Error ? err.message : String(err));
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
