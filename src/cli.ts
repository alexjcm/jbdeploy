import { tasks } from '@clack/prompts';
import { readFileSync } from 'fs';
import { log } from './ui/logger.ts';
import { AppServer, LastDeployment } from './servers.ts';
import { EXIT_CODES } from './constants.ts';
import { getConfig, saveConfig } from './config/config-manager.ts';
import { selectArtifact, selectAction, selectServerMode, selectServer, addNewServerFlow, confirmReuseDeployment } from './ui/prompts.ts';
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
  let selectedServer: AppServer | undefined;
  let initialReuse: { 
    action: 'build-deploy' | 'deploy-only' | 'start-only', 
    artifact: Artifact | null, 
    mode: 'normal' | 'debug', 
    port?: number, 
    server: AppServer 
  } | null = null;

  const cwd = process.cwd();
  const lastDep: LastDeployment | undefined = config.lastDeployments?.[cwd];

  if (lastDep) {
    const server = config.servers.find(s => s.name === lastDep.serverName);
    if (server) {
      const reuse = await confirmReuseDeployment(lastDep);
      if (reuse) {
        selectedServer = server;
        const buildTool = detectBuildTool();
        const artifacts = await findArtifacts(!!buildTool);
        const artifact = artifacts.find(a => a.name === lastDep.artifactName) || null;

        if (!artifact && lastDep.action !== 'start-only') {
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

  if (!selectedServer) {
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
  }

  // CLI Loop
  let firstIteration = true;

  while (true) {
    let action: 'build-deploy' | 'deploy-only' | 'start-only';
    let artifact: Artifact | null = null;
    let mode: 'normal' | 'debug' | undefined;
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

    if (!reused) {
      const buildTool = detectBuildTool();
      const currentArtifacts = await findArtifacts(!!buildTool);
      
      action = await selectAction(
        currentArtifacts.length === 0 ? 'build-deploy' : undefined,
        { 
          canBuild: !!buildTool, 
          canDeploy: currentArtifacts.length > 0 
        }
      );
    } else {
      action = action!; 
    }

    const isRunning = await isServerRunning();

    if (action === 'start-only') {
      if (isRunning) {
        log.warn('Server is already running. It may be active in another terminal tab or window.');
        log.note('If you want to restart it, please stop the other instance first.', 'Conflict detected');
        process.exit(EXIT_CODES.SUCCESS);
      }

      if (!reused) {
        const result = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
        mode = result.mode;
        port = result.port;
      }
      
      log.step('Server stopped — cleaning temporary directories (data, log, tmp)');
      await cleanServerTemp(selectedServer.home);

      log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);

      try {
        selectedServer.lastServerMode = mode!;
        if (mode === 'debug' && port) {
          selectedServer.lastDebugPort = port;
        }
        
        // Save successful start-only to project memory
        if (!config.lastDeployments) config.lastDeployments = {};
        config.lastDeployments[cwd] = {
          serverName: selectedServer.name,
          action: 'start-only',
          artifactName: 'server-only',
          mode: mode!,
          ...((port || selectedServer.lastDebugPort) ? { port: (port || selectedServer.lastDebugPort) } : {})
        };
        
        await saveConfig(config);
        
        await startServer(selectedServer.home, mode === 'debug', port, selectedServer.memoryProfile);
        log.success('Server process finished.');
      } catch (err) {
        log.error('Failed to start server', err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // Build + Deploy or Deploy Only
    if (action === 'build-deploy' && !reused) {
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

    // Refresh/Select artifacts
    if (!reused) {
      const buildTool = detectBuildTool();
      const currentArtifacts = await findArtifacts(!!buildTool);
      if (currentArtifacts.length === 0) {
        log.warn('No artifacts found (.war or .ear). Make sure you have built the project.');
        continue;
      }
      artifact = await selectArtifact(currentArtifacts);
    }

    let deploySuccess = false;

    try {
      await tasks([
        {
          title: `Deploying ${artifact!.name}`,
          task: async (taskLog) => {
            if (!isRunning) {
              taskLog('Cleaning temporary directories (data, log, tmp)');
              await cleanServerTemp(selectedServer.home);
            }
            
            deploySuccess = await deployArtifact(artifact!, selectedServer.home, isRunning);
            
            if (!deploySuccess) {
              throw new Error('Deployment failed (.failed marker or timeout)');
            }
            
            // Save successful deployment to project memory
            if (!config.lastDeployments) config.lastDeployments = {};
            config.lastDeployments[cwd] = {
              serverName: selectedServer.name,
              action: action === 'build-deploy' ? 'build-deploy' : 'deploy-only',
              artifactName: artifact!.name,
              mode: mode || selectedServer.lastServerMode || 'normal',
              ...( (port || selectedServer.lastDebugPort) ? { port: (port || selectedServer.lastDebugPort) } : {} )
            };
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
        const result = await selectServerMode(selectedServer.lastDebugPort, selectedServer.lastServerMode);
        mode = result.mode;
        port = result.port;
      }
      
      log.step(`Starting server in ${mode} mode${mode === 'debug' ? ` (port ${port})` : ''}...`);

      try {
        selectedServer.lastServerMode = mode!;
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
