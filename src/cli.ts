import { tasks } from '@clack/prompts';
import { existsSync, readFileSync } from 'fs';
import { log } from './ui/logger.ts';
import { AppServer, Config, LastDeployment } from './servers.ts';
import { EXIT_CODES, ACTIONS, SERVER_MODES, NAV, DeployAction, ServerMode } from './constants.ts';
import { getConfig, saveConfig } from './config/config-manager.ts';
import { selectArtifact, selectWarArtifacts, selectAction, selectServer, deleteServerFlow, editServerFlow, addNewServerFlow, selectProjectEntry, CancelToServerSelect, getActionLabel } from './ui/prompts.ts';
import { isServerRunning } from './server/detect-running.ts';
import { cleanServerTemp } from './server/clean-temp.ts';
import { listDeployedArtifacts } from './server/list-deployed-artifacts.ts';
import { startServer, type StartServerResult } from './server/start-server.ts';
import { buildProject, detectBuildTool, BuildTool } from './core/build-project.ts';
import { findArtifacts, Artifact, getArtifactBaseName } from './core/find-artifact.ts';
import { deployArtifact } from './core/deploy-artifact.ts';
import { notifySuccess } from './utils/notify.ts';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function getLastArtifactNames(lastDep?: LastDeployment): string[] {
  if (!lastDep) return [];
  if (lastDep.artifactNames && lastDep.artifactNames.length > 0) {
    return lastDep.artifactNames.filter((name) => name !== 'server-only');
  }
  if (lastDep.artifactName && lastDep.artifactName !== 'server-only') {
    return [lastDep.artifactName];
  }
  return [];
}

function getCliVersion(): string {
  try {
    const pkgRaw = readFileSync(new URL('../package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function isRunningFromNpmLink(): boolean {
  // Published installs only ship dist/package metadata; npm link points at the full workspace.
  return [
    '../src/cli.ts',
    '../tsconfig.json',
  ].some((relativePath) => existsSync(new URL(relativePath, import.meta.url)));
}

function showServerOnlyArtifacts(localArtifacts: Artifact[], serverHome: string): void {
  const deployedArtifacts = listDeployedArtifacts(serverHome);
  if (deployedArtifacts.length === 0) return;

  const localArtifactNames = new Set(localArtifacts.map((artifact) => artifact.name));
  const artifactsOnlyOnServer = deployedArtifacts.filter((artifactName) => !localArtifactNames.has(artifactName));
  if (artifactsOnlyOnServer.length === 0) return;

  log.message(log.dim(`Artifacts currently on server: ${artifactsOnlyOnServer.join(', ')}`));
}

function logServerProcessResult(selectedServer: AppServer, result: StartServerResult): void {
  if (result === 'stopped-by-user') {
    log.step(`Server stopped ${log.dim(`(${selectedServer.name})`)}`);
    return;
  }

  log.warn(`Server process exited ${log.dim(`(${selectedServer.name})`)}`);
}

// ---------------------------------------------------------------------------
// Action sub-functions — each owns one concern of the action loop
// ---------------------------------------------------------------------------

/**
 * Runs a Maven or Gradle build inside a Clack tasks block.
 * Returns true on success, false on failure (already logs the error).
 */
async function executeBuildStep(buildTool: BuildTool): Promise<boolean> {
  const buildTitle = buildTool === 'gradle'
    ? 'Building project (gradle clean build)'
    : 'Building project (mvn clean package)';

  try {
    await tasks([{
      title: buildTitle,
      task: async () => {
        const success = await buildProject(buildTool);
        if (!success) throw new Error('Build failed');
        return 'Build successful';
      },
    }]);
    return true;
  } catch (err) {
    log.error('Action failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Determines which artifacts to deploy.
 * - When reused and not a BUILD_DEPLOY action, returns the already-selected artifacts directly.
 * - Otherwise scans the filesystem and, if needed, presents selection prompts to the user.
 * Returns 'continue' to signal the action loop should restart (e.g. user pressed Back or no artifacts found).
 */
async function resolveArtifactsToDeploy(
  reused: boolean,
  action: DeployAction,
  buildTool: BuildTool | null,
  reusedArtifacts: Artifact[],
  lastDep: LastDeployment | undefined,
): Promise<Artifact[] | 'continue'> {
  if (reused && action !== ACTIONS.BUILD_DEPLOY) {
    return reusedArtifacts;
  }

  const currentArtifacts = await findArtifacts(!!buildTool);
  if (currentArtifacts.length === 0) {
    log.warn('No artifacts found (.war or .ear). Make sure you have built the project.');
    return 'continue';
  }

  // After a build with reuse, try to remap artifact names from the fresh build output
  let resolved: Artifact[] = [];
  if (reused && reusedArtifacts.length > 0) {
    const lastBases = reusedArtifacts.map((a) => getArtifactBaseName(a.name));
    resolved = currentArtifacts.filter((a) => lastBases.includes(getArtifactBaseName(a.name)));
  }

  if (resolved.length === 0) {
    const lastArtifactNames = getLastArtifactNames(lastDep);
    const warArtifacts = currentArtifacts.filter((a) => a.name.toLowerCase().endsWith('.war'));

    if (warArtifacts.length >= 2) {
      notifySuccess('Multiple WAR artifacts detected. Select one or more.', '📦 Artifact Selection');
      const warSelection = await selectWarArtifacts(warArtifacts, lastArtifactNames);
      if (warSelection === NAV.BACK) return 'continue';
      resolved = warSelection;
    } else {
      if (currentArtifacts.length > 1) {
        notifySuccess('Multiple artifacts detected. Please select one.', '📦 Artifact Selection');
      }
      const artifactResult = await selectArtifact(currentArtifacts, lastDep?.artifactName);
      if (artifactResult === NAV.BACK) return 'continue';
      resolved = [artifactResult];
    }
  }

  return resolved;
}

/**
 * Copies and deploys all selected artifacts to the server.
 * Handles both multi-artifact and single-artifact paths, including the Clack tasks UI block.
 * Returns true if all deployments succeeded.
 */
async function executeDeployments(
  artifactsToDeploy: Artifact[],
  selectedServer: AppServer,
  isRunning: boolean,
): Promise<boolean> {
  let cleanedTempForOfflineDeploy = false;

  if (artifactsToDeploy.length > 1) {
    for (const artifact of artifactsToDeploy) {
      try {
        if (!isRunning && !cleanedTempForOfflineDeploy) {
          cleanServerTemp(selectedServer.home);
          cleanedTempForOfflineDeploy = true;
        }
        const deploySuccess = await deployArtifact(artifact, selectedServer.home, isRunning);
        if (!deploySuccess) {
          log.error(`Deployment failed for ${artifact.name}`, 'Deployment failed (.failed marker or timeout)');
          return false;
        }
      } catch (err) {
        log.error(`Deployment failed for ${artifact.name}`, err instanceof Error ? err.message : String(err));
        return false;
      }
    }
    log.dim(
      isRunning
        ? 'Artifacts deployed successfully (.deployed detected)'
        : 'Artifacts transferred successfully (ready for boot)',
    );
    return true;
  }

  // Single artifact — show progress inside a Clack tasks block
  const artifact = artifactsToDeploy[0]!;
  let deploySuccess = false;

  try {
    await tasks([{
      title: `Deploying ${artifact.name}`,
      task: async (taskLog: (message: string) => void) => {
        if (!isRunning && !cleanedTempForOfflineDeploy) {
          taskLog('Cleaning temporary directories (data, log, tmp)');
          cleanServerTemp(selectedServer.home);
          cleanedTempForOfflineDeploy = true;
        }
        deploySuccess = await deployArtifact(artifact, selectedServer.home, isRunning);
        if (!deploySuccess) throw new Error('Deployment failed (.failed marker or timeout)');
        return isRunning
          ? 'Deployment validated (.deployed detected)'
          : log.dim('Artifact transferred successfully (ready for boot)');
      },
    }]);
  } catch (err) {
    log.error(`Deployment failed for ${artifact.name}`, err instanceof Error ? err.message : String(err));
    return false;
  }

  return deploySuccess;
}

/**
 * Persists the last successful deployment record for this project directory.
 * Mutates config in place and writes it to disk.
 */
async function saveLastDeployment(
  config: Config,
  cwd: string,
  selectedServer: AppServer,
  artifactsToDeploy: Artifact[],
  action: DeployAction,
  mode: ServerMode | undefined,
  port: number | undefined,
): Promise<void> {
  if (!config.lastDeployments) config.lastDeployments = {};
  const deploymentMode = mode || selectedServer.lastServerMode || SERVER_MODES.NORMAL;
  const selectedArtifactNames = artifactsToDeploy.map((artifact) => artifact.name);

  config.lastDeployments[cwd] = {
    serverName: selectedServer.name,
    action: action === ACTIONS.BUILD_DEPLOY ? ACTIONS.BUILD_DEPLOY : ACTIONS.DEPLOY_ONLY,
    artifactName: selectedArtifactNames[0]!,
    ...(selectedArtifactNames.length > 1 ? { artifactNames: selectedArtifactNames } : {}),
    mode: deploymentMode,
    ...(deploymentMode === SERVER_MODES.DEBUG && (port || selectedServer.lastDebugPort)
      ? { port: (port || selectedServer.lastDebugPort) }
      : {}),
  };

  config.lastServer = selectedServer.name;
  await saveConfig(config);
}

/**
 * Handles the START_ONLY action: guards against a running server, optionally prompts
 * for startup mode, cleans temp dirs, saves config, and starts the server.
 * Returns early (without starting) if the user navigates Back from the mode prompt.
 */
async function handleStartOnlyAction(
  selectedServer: AppServer,
  mode: ServerMode | undefined,
  port: number | undefined,
  isRunning: boolean,
  config: Config,
  cwd: string,
): Promise<void> {
  if (isRunning) {
    log.warn('Server is already running. It may be active in another terminal tab or window.');
    log.note('If you want to restart it, please stop the other instance first.', 'Conflict detected');
    process.exit(EXIT_CODES.SUCCESS);
  }

  const finalMode = mode ?? selectedServer.lastServerMode ?? SERVER_MODES.NORMAL;
  const finalPort = finalMode === SERVER_MODES.DEBUG
    ? (port || selectedServer.lastDebugPort)
    : undefined;

  log.step('Server stopped — cleaning temporary directories (data, log, tmp)');
  cleanServerTemp(selectedServer.home);
  log.step(`Starting server in ${finalMode} mode${finalMode === SERVER_MODES.DEBUG ? ` (port ${finalPort})` : ''}...`);

  try {
    selectedServer.lastServerMode = finalMode!;
    if (finalMode === SERVER_MODES.DEBUG && finalPort) {
      selectedServer.lastDebugPort = finalPort;
    }

    if (!config.lastDeployments) config.lastDeployments = {};
    const previousDeployment = config.lastDeployments[cwd];
    const previousArtifactNames = previousDeployment?.artifactNames?.filter((name) => name !== 'server-only') ?? [];
    const preservedArtifacts = previousArtifactNames.length > 0
      ? {
          artifactName: previousArtifactNames[0]!,
          artifactNames: previousArtifactNames,
        }
      : previousDeployment?.artifactName && previousDeployment.artifactName !== 'server-only'
        ? { artifactName: previousDeployment.artifactName }
        : { artifactName: 'server-only' };

    config.lastDeployments[cwd] = {
      serverName: selectedServer.name,
      action: ACTIONS.START_ONLY,
      ...preservedArtifacts,
      mode: finalMode!,
      ...(finalMode === SERVER_MODES.DEBUG && (finalPort || selectedServer.lastDebugPort)
        ? { port: (finalPort || selectedServer.lastDebugPort) }
        : {}),
    };

    config.lastServer = selectedServer.name;
    await saveConfig(config);

    const result = await startServer(
      selectedServer.home,
      finalMode === SERVER_MODES.DEBUG,
      finalPort,
      selectedServer.memoryProfile,
    );
    logServerProcessResult(selectedServer, result);
  } catch (err) {
    log.error(`Failed to start server ${log.dim(`(${selectedServer.name})`)}`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Starts the server after a successful artifact deployment.
 * Prompts the user for startup mode when not in a reused flow.
 * Returns early (without starting) if the user navigates Back from the mode prompt.
 */
async function startServerAfterDeploy(
  selectedServer: AppServer,
  mode: ServerMode | undefined,
  port: number | undefined,
  config: Config,
): Promise<void> {
  const finalMode = mode ?? selectedServer.lastServerMode ?? SERVER_MODES.NORMAL;
  const finalPort = finalMode === SERVER_MODES.DEBUG
    ? (port || selectedServer.lastDebugPort)
    : undefined;

  log.step(`Starting server in ${finalMode} mode${finalMode === SERVER_MODES.DEBUG ? ` (port ${finalPort})` : ''}...`);

  try {
    selectedServer.lastServerMode = finalMode!;
    if (finalMode === SERVER_MODES.DEBUG && finalPort) {
      selectedServer.lastDebugPort = finalPort;
    }
    await saveConfig(config);

    const result = await startServer(
      selectedServer.home,
      finalMode === SERVER_MODES.DEBUG,
      finalPort,
      selectedServer.memoryProfile,
    );
    logServerProcessResult(selectedServer, result);
  } catch (err) {
    log.error(`Failed to start server ${log.dim(`(${selectedServer.name})`)}`, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

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
    process.stdout.write('    • Contains server paths, debug ports, JVM memory profiles, and last project deployment flow.\n\n');

    log.info('Features:');
    process.stdout.write('    • Semantic logging and persistent interactive UI.\n');
    process.stdout.write('    • Explicit repeat-last-flow entry for the current project.\n');
    process.stdout.write('    • Smarter artifact recommendation based on last deployment and recent build output.\n');
    process.stdout.write('    • Quick editing of saved servers directly from the selection flow.\n');
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

  const linkedInstallSuffix = isRunningFromNpmLink()
    ? ` ${log.dim(`(v${getCliVersion()} running from linked workspace)`)}`
    : '';

  log.intro(`🚀 JB Deploy CLI${linkedInstallSuffix}`);

  const cwd = process.cwd();
  let isFirstAppRun = true;

  // Outer loop: allows returning to server selection via "← Back (change server)"
  serverLoop: while (true) {
    let config = getConfig();
    let selectedServer: AppServer | undefined;
    let initialReuse: {
      action: DeployAction;
      artifacts: Artifact[];
      mode: ServerMode;
      port?: number;
    } | null = null;
    let preferredInitialAction: DeployAction | undefined;

    let lastDep: LastDeployment | undefined = config.lastDeployments?.[cwd];

    // Only prompt for reuse on the very first CLI boot, not when returning via Back
    if (isFirstAppRun && lastDep) {
      const server = config.servers.find((s) => s.name === lastDep!.serverName);
      const isRunningOnBoot = server ? await isServerRunning(server.home) : false;
      const entryChoice = await selectProjectEntry(lastDep, { serverRunning: isRunningOnBoot });

      if (entryChoice === 'REPEAT_LAST') {
        preferredInitialAction = lastDep.action;

        if (!server) {
          log.warn(`Saved server '${lastDep.serverName}' no longer exists. Falling back to manual flow.`);
        } else {
          selectedServer = server;
          selectedServer.lastServerMode = lastDep.mode;
          if (lastDep.port) selectedServer.lastDebugPort = lastDep.port;

          const buildTool = detectBuildTool();
          const artifacts = await findArtifacts(!!buildTool);
          const lastArtifactNames = getLastArtifactNames(lastDep);
          
          const reusableArtifacts: Artifact[] = [];
          const versionUpdates: string[] = [];

          for (const lastName of lastArtifactNames) {
            const lastBase = getArtifactBaseName(lastName);
            const candidates = artifacts.filter(
              (artifact) => getArtifactBaseName(artifact.name) === lastBase
            );

            if (candidates.length > 0) {
              candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
              const bestCandidate = candidates[0]!;
              reusableArtifacts.push(bestCandidate);

              if (bestCandidate.name !== lastName) {
                versionUpdates.push(`'${lastName}' -> '${bestCandidate.name}'`);
              }
            }
          }

          const allFound = lastArtifactNames.length > 0 && reusableArtifacts.length === lastArtifactNames.length;

          if (!allFound && lastDep.action !== ACTIONS.START_ONLY) {
            const descriptor = lastArtifactNames.length > 0
              ? `'${lastArtifactNames.join(', ')}'`
              : `'${lastDep.artifactName}'`;
            log.warn(`Artifact ${descriptor} not found. Falling back to manual artifact selection.`);
          } else {
            if (versionUpdates.length > 0) {
              log.info(`Artifact versions updated: ${versionUpdates.join(', ')}`);
            }
            initialReuse = {
              action: lastDep.action,
              artifacts: reusableArtifacts,
              mode: lastDep.mode,
              ...(lastDep.port ? { port: lastDep.port } : {}),
            };
          }
        }
      }
    }

    isFirstAppRun = false;

    try {
      if (!selectedServer) {
        if (config.servers.length === 0) {
          selectedServer = await addNewServerFlow(config);
          config = getConfig();
        } else {
          const serverChoice = await selectServer(config);
          if (serverChoice === 'ADD_NEW') {
            selectedServer = await addNewServerFlow(config);
            config = getConfig();
          } else if (serverChoice === 'EDIT_SERVER') {
            await editServerFlow(config);
            continue serverLoop;
          } else if (serverChoice === 'DELETE_SERVER') {
            await deleteServerFlow(config);
            continue serverLoop;
          } else {
            selectedServer = serverChoice;
          }
        }
      }
    } catch (e) {
      if (e instanceof CancelToServerSelect) continue serverLoop;
      throw e;
    }

    if (selectedServer && config.lastServer !== selectedServer.name) {
      config.lastServer = selectedServer.name;
      await saveConfig(config);
    }

    // Action loop
    let firstIteration = true;

    while (true) {
      let action: DeployAction;
      let artifactsToDeploy: Artifact[] = [];
      let mode: ServerMode | undefined;
      let port: number | undefined;
      let reused = false;

      // Reuse logic (only on first iteration)
      if (firstIteration && initialReuse) {
        action = initialReuse.action;
        artifactsToDeploy = initialReuse.artifacts;
        mode = initialReuse.mode;
        port = initialReuse.port;
        reused = true;
      }
      firstIteration = false;

      const buildTool = detectBuildTool();
      const isRunning = await isServerRunning(selectedServer!.home);

      if (reused) {
        const reuseTarget = artifactsToDeploy.length > 0
          ? artifactsToDeploy.map((artifact) => artifact.name).join(', ')
          : 'server only';
        log.info(`Reusing: ${getActionLabel(action!, { serverRunning: isRunning })} -> ${reuseTarget} on ${selectedServer!.name}`);
      }

      if (!reused) {
        const currentArtifacts = await findArtifacts(!!buildTool);

        const actionResult = await selectAction(
          preferredInitialAction
          ?? (currentArtifacts.length === 0 ? ACTIONS.BUILD_DEPLOY : undefined),
          {
            canBuild: !!buildTool,
            canDeploy: currentArtifacts.length > 0,
            serverRunning: isRunning,
            ...((mode ?? selectedServer!.lastServerMode)
              ? { lastServerMode: mode ?? selectedServer!.lastServerMode }
              : {}),
            ...((port ?? selectedServer!.lastDebugPort)
              ? { lastDebugPort: port ?? selectedServer!.lastDebugPort }
              : {}),
          }
        );

        if (actionResult === NAV.BACK) continue serverLoop;
        action = actionResult.action;
        mode = actionResult.mode;
        port = actionResult.port;
        preferredInitialAction = undefined;
        showServerOnlyArtifacts(currentArtifacts, selectedServer!.home);
      } else {
        action = action!;
      }

      // --- START_ONLY ---
      if (action === ACTIONS.START_ONLY) {
        await handleStartOnlyAction(selectedServer!, mode, port, isRunning, config, cwd);
        lastDep = config.lastDeployments?.[cwd];
        continue;
      }

      // --- BUILD step (BUILD_DEPLOY only) ---
      if (action === ACTIONS.BUILD_DEPLOY) {
        if (!buildTool) {
          log.error('No build tool detected', 'This project does not contain build.gradle, build.gradle.kts or pom.xml at the root.');
          continue;
        }
        const buildOk = await executeBuildStep(buildTool);
        if (!buildOk) continue;
      }

      // --- Artifact resolution ---
      const resolvedArtifacts = await resolveArtifactsToDeploy(reused, action, buildTool, artifactsToDeploy, lastDep);
      if (resolvedArtifacts === 'continue') continue;
      artifactsToDeploy = resolvedArtifacts;

      if (artifactsToDeploy.length === 0) {
        log.warn('No artifacts selected. Please select at least one artifact to continue.');
        continue;
      }

      // --- Deployment ---
      const deploymentsSucceeded = await executeDeployments(artifactsToDeploy, selectedServer!, isRunning);

      if (deploymentsSucceeded) {
        await saveLastDeployment(config, cwd, selectedServer!, artifactsToDeploy, action, mode, port);
        lastDep = config.lastDeployments?.[cwd];
      }

      // --- Auto-start server after offline deploy ---
      if (deploymentsSucceeded && !isRunning) {
        await startServerAfterDeploy(selectedServer!, mode, port, config);
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
});
