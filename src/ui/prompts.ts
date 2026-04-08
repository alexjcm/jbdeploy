import { group, text, select, confirm, isCancel, cancel, note } from '@clack/prompts';
import { Config, AppServer, LastDeployment } from '../servers.ts';
import { saveConfig, validateServerHome, normalizePath } from '../config/config-manager.ts';
import { Artifact, formatBytes } from '../core/find-artifact.ts';
import { EXIT_CODES, DEFAULT_DEBUG_PORT, ACTIONS, SERVER_MODES, NAV, UI_MESSAGES, ServerMode, DeployAction } from '../constants.ts';

export class CancelToServerSelect extends Error {
  constructor() { super('User cancelled to server select'); }
}

export async function addNewServerFlow(existingConfig: Config): Promise<AppServer> {
  const result = await group(
    {
      name: () => text({
        message: 'Name for this server (e.g., wildfly-dev):',
        placeholder: 'server-local',
        validate: (value) => {
          if (!value) return 'Name is required';
          if (existingConfig.servers.some(s => s.name === value)) return 'A server with this name already exists';
        },
      }),
      home: () => text({
        message: 'Full path for Server Home:',
        placeholder: '/opt/wildfly-20.0',
        validate: (value) => {
          if (!value) return 'Path is required';
          if (!validateServerHome(value)) return 'This path does not look like a valid Server Home (missing standalone/deployments)';
        },
      }),
      profile: () => select({
        message: 'Select the JVM memory profile for this server (affects -Xms and -Xmx):',
        options: [
          { value: 'recommended', label: '[ Recommended ] 2GB initial - 5GB max (Default)' },
          { value: 'minimal', label: '[ Minimal     ] 1GB initial - 2GB max' },
        ],
        initialValue: 'recommended',
      }),
    },
    {
      onCancel: () => {
        throw new CancelToServerSelect();
      },
    }
  );

  const newServer: AppServer = {
    name: result.name,
    home: normalizePath(result.home),
    memoryProfile: result.profile as 'minimal' | 'recommended',
  };

  const newConfig: Config = {
    ...existingConfig,
    servers: [...existingConfig.servers, newServer],
    lastServer: newServer.name,
  };

  await saveConfig(newConfig);
  note('Server saved successfully. You can review or modify this configuration directly at: ~/.jbdeploy/config.json');

  return newServer;
}

export async function deleteServerFlow(config: Config): Promise<void> {
  const serverToDelete = await select({
    message: 'Select a server to delete:',
    options: [
      ...config.servers.map(s => ({
        value: s as AppServer | typeof NAV.BACK,
        label: `${s.name} (${s.home})`,
      })),
      { value: NAV.BACK as AppServer | typeof NAV.BACK, label: '← Cancel' }
    ] as { value: AppServer | typeof NAV.BACK; label: string }[]
  });

  if (isCancel(serverToDelete) || serverToDelete === NAV.BACK) return;

  const target = serverToDelete as AppServer;

  const confirmDelete = await confirm({
    message: `Are you sure you want to delete '${target.name}'?`,
    initialValue: false
  });

  if (isCancel(confirmDelete) || !confirmDelete) return;

  const newConfig = {
    ...config,
    servers: config.servers.filter(s => s.name !== target.name)
  };

  if (newConfig.lastServer === target.name) {
    if (newConfig.servers.length > 0) {
      newConfig.lastServer = newConfig.servers[0]!.name;
    } else {
      delete newConfig.lastServer;
    }
  }

  await saveConfig(newConfig);
  note(`Server '${target.name}' has been removed from configuration.`, 'Deleted');
}

export async function selectServer(config: Config): Promise<AppServer | 'ADD_NEW' | 'DELETE_SERVER'> {
  const sortedServers = [...config.servers].sort((a, b) => {
    if (a.name === config.lastServer) return -1;
    if (b.name === config.lastServer) return 1;
    return 0;
  });

  const options = [
    ...sortedServers.map(s => ({
      value: s as AppServer | 'ADD_NEW' | 'DELETE_SERVER',
      label: `${s.name} (${s.home})`,
    })),
    { value: 'ADD_NEW' as AppServer | 'ADD_NEW' | 'DELETE_SERVER', label: '➕ Add new server...' },
    ...(config.servers.length > 0 ? [{ value: 'DELETE_SERVER' as AppServer | 'ADD_NEW' | 'DELETE_SERVER', label: '🗑️  Delete saved server...' }] : [])
  ] as { value: AppServer | 'ADD_NEW' | 'DELETE_SERVER'; label: string }[];

  const selected = await select({
    message: 'Select server:',
    options,
    initialValue: config.servers.find(s => s.name === config.lastServer) || config.servers[0],
  });

  if (isCancel(selected)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  return selected!;
}

export async function selectArtifact(artifacts: Artifact[], lastArtifactName?: string): Promise<Artifact | typeof NAV.BACK> {
  if (artifacts.length === 1) {
    const artifact = artifacts[0]!;
    note(`Artifact detected: ${artifact.name} (${formatBytes(artifact.size)})`);
    return artifact;
  }

  const sorted = [...artifacts].sort((a, b) => b.size - a.size);
  const defaultArtifact = sorted.find(a => a.name === lastArtifactName) || sorted[0];

  const selected = await select({
    message: `${artifacts.length} artifacts found. Select one:`,
    options: [
      ...sorted.map(a => ({
        value: a as Artifact | typeof NAV.BACK,
        label: `${a.name} (${formatBytes(a.size)})`,
      })),
      { value: NAV.BACK, label: '← Back' },
    ],
    initialValue: defaultArtifact,
  });

  if (isCancel(selected)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  return selected as Artifact | typeof NAV.BACK;
}

export async function selectAction(
  initialValue?: DeployAction,
  options: { canBuild: boolean; canDeploy: boolean } = { canBuild: true, canDeploy: true }
): Promise<DeployAction | typeof NAV.BACK> {
  const menuOptions = [
    { value: ACTIONS.BUILD_DEPLOY, label: 'build + copy + deploy' },
    { value: ACTIONS.DEPLOY_ONLY, label: 'copy + deploy' },
    { value: ACTIONS.START_ONLY, label: 'start server only' },
    { value: NAV.BACK, label: '← Back (change server)' },
  ];

  const filteredOptions = menuOptions.filter((opt) => {
    if (opt.value === ACTIONS.BUILD_DEPLOY) return options.canBuild;
    if (opt.value === ACTIONS.DEPLOY_ONLY) return options.canDeploy;
    return true;
  });

  const action = await select({
    message: 'Select action:',
    options: filteredOptions,
    ...(initialValue && filteredOptions.some((o) => o.value === initialValue) ? { initialValue } : {}),
  });

  if (isCancel(action)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  return action as DeployAction | typeof NAV.BACK;
}

export async function selectServerMode(
  lastUsedPort?: number,
  lastServerMode?: ServerMode
): Promise<{ mode: ServerMode; port?: number } | typeof NAV.BACK> {
  const defaultPort = lastUsedPort || DEFAULT_DEBUG_PORT;
  const debugLabel = lastUsedPort
    ? `🐞 Debug mode (Port: ${lastUsedPort})`
    : `🐞 Debug mode (Default port: ${DEFAULT_DEBUG_PORT})`;

  const modeResult = await select({
    message: 'Select startup mode:',
    options: [
      { value: SERVER_MODES.NORMAL, label: '🚀 Normal mode' },
      { value: SERVER_MODES.DEBUG, label: debugLabel },
      { value: 'debug-custom', label: '🐞 Debug mode (Custom port...)' },
      { value: NAV.BACK, label: '← Back' },
    ],
    initialValue: lastServerMode ?? SERVER_MODES.NORMAL,
  });

  if (isCancel(modeResult)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }
  if (modeResult === NAV.BACK) return NAV.BACK;

  let finalPort: number | undefined;
  if (modeResult === 'debug-custom') {
    const portInput = await text({
      message: 'Enter debug port:',
      placeholder: defaultPort.toString(),
      defaultValue: defaultPort.toString(),
      validate: (value) => {
        if (value && isNaN(Number(value))) return 'Port must be a number';
      },
    });
    if (isCancel(portInput)) {
      cancel(UI_MESSAGES.GOODBYE);
      process.exit(EXIT_CODES.INTERRUPTED);
    }
    finalPort = Number(portInput);
  } else if (modeResult === 'debug') {
    finalPort = defaultPort;
  }

  return {
    mode: modeResult === SERVER_MODES.NORMAL ? SERVER_MODES.NORMAL : SERVER_MODES.DEBUG,
    ...(finalPort ? { port: finalPort } : {}),
  };
}

export async function confirmReuseDeployment(last: LastDeployment): Promise<boolean> {
  const portInfo = last.port ? `:${last.port}` : '';
  const result = await select({
    message: 'Reuse last deployment for this project?',
    options: [
      {
        value: true,
        label: `Yes, reuse last settings`,
        hint: `[Server: ${last.serverName}, Action: ${last.action}, Artifact: ${last.artifactName}, Mode: ${last.mode}${portInfo}]`
      },
      { value: false, label: 'No, skip to manual flow' },
    ],
  });

  if (isCancel(result)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  return result as boolean;
}
