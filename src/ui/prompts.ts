import { group, text, confirm, isCancel, cancel, note, S_BAR, S_BAR_END, S_CHECKBOX_ACTIVE, S_CHECKBOX_INACTIVE, S_CHECKBOX_SELECTED, S_RADIO_ACTIVE, S_RADIO_INACTIVE, symbol, symbolBar } from '@clack/prompts';
import { MultiSelectPrompt, SelectPrompt, settings as clackSettings, wrapTextWithPrefix } from '@clack/core';
import { styleText } from 'node:util';
import type { Readable, Writable } from 'node:stream';
import { Config, AppServer, LastDeployment } from '../servers.ts';
import { saveConfig, validateServerHome, normalizePath } from '../config/config-manager.ts';
import { Artifact, formatBytes, getArtifactBaseName } from '../core/find-artifact.ts';
import { EXIT_CODES, DEFAULT_DEBUG_PORT, ACTIONS, SERVER_MODES, NAV, UI_MESSAGES, ServerMode, DeployAction } from '../constants.ts';
import { log } from './logger.ts';

export class CancelToServerSelect extends Error {
  constructor() { super('User cancelled to server select'); }
}

export interface ActionSelection {
  action: DeployAction;
  mode: ServerMode;
  port?: number;
}

type SelectOption<T> = {
  value: T;
  label?: string;
  hint?: string;
  disabled?: boolean;
};

type SelectMenuOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
  input?: Readable;
  output?: Writable;
  signal?: AbortSignal;
  withGuide?: boolean;
};

type MultiSelectMenuOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  initialValues?: T[];
  required?: boolean;
  cursorAt?: T;
  input?: Readable;
  output?: Writable;
  signal?: AbortSignal;
  withGuide?: boolean;
};

function formatSelectOption<T>(option: SelectOption<T>, state: 'active' | 'inactive' | 'disabled' | 'selected' | 'cancelled'): string {
  const label = option.label ?? String(option.value);

  switch (state) {
    case 'disabled':
      return `${styleText('gray', S_RADIO_INACTIVE)} ${styleText('gray', label)}${option.hint ? ` ${styleText('dim', `(${option.hint ?? 'disabled'})`)}` : ''}`;
    case 'selected':
      return styleText('dim', label);
    case 'active':
      return `${styleText('green', S_RADIO_ACTIVE)} ${label}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'cancelled':
      return styleText(['strikethrough', 'dim'], label);
    default:
      return `${styleText('dim', S_RADIO_INACTIVE)} ${styleText('dim', label)}`;
  }
}

async function selectMenu<T>(opts: SelectMenuOptions<T>): Promise<T | symbol> {
  const promptOptions: ConstructorParameters<typeof SelectPrompt<SelectOption<T>>>[0] = {
    options: opts.options,
    render() {
      const withGuide = opts.withGuide ?? clackSettings.withGuide;
      const activePrefix = withGuide ? `${styleText('cyan', S_BAR)}  ` : '';
      const header = wrapTextWithPrefix(
        opts.output,
        opts.message,
        `${symbolBar(this.state)}  `,
        `${symbol(this.state)}  `,
      );
      const frame = `${withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${header}\n`;

      switch (this.state) {
        case 'submit': {
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          const selected = formatSelectOption(this.options[this.cursor]!, 'selected');
          return `${frame}${wrapTextWithPrefix(opts.output, selected, prefix)}`;
        }
        case 'cancel': {
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          const cancelled = formatSelectOption(this.options[this.cursor]!, 'cancelled');
          return `${frame}${wrapTextWithPrefix(opts.output, cancelled, prefix)}${withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
        }
        default: {
          const rows = this.options.map((option, index) =>
            `${activePrefix}${formatSelectOption(option, option.disabled ? 'disabled' : index === this.cursor ? 'active' : 'inactive')}`
          );
          return `${frame}${rows.join('\n')}${withGuide ? `\n${styleText('cyan', S_BAR_END)}` : ''}\n`;
        }
      }
    },
  };

  if (opts.signal) promptOptions.signal = opts.signal;
  if (opts.input) promptOptions.input = opts.input;
  if (opts.output) promptOptions.output = opts.output;
  if (opts.initialValue !== undefined) promptOptions.initialValue = opts.initialValue;

  return await new SelectPrompt<SelectOption<T>>(promptOptions).prompt() as T | symbol;
}

function mapMultiline(text: string, formatter: (line: string) => string): string {
  return text.split('\n').map((line) => formatter(line)).join('\n');
}

function formatMultiSelectOption<T>(
  option: SelectOption<T>,
  state: 'disabled' | 'active' | 'selected' | 'cancelled' | 'active-selected' | 'submitted' | 'inactive'
): string {
  const label = option.label ?? String(option.value);

  switch (state) {
    case 'disabled':
      return `${styleText('gray', S_CHECKBOX_INACTIVE)} ${mapMultiline(label, (line) => styleText(['strikethrough', 'gray'], line))}${option.hint ? ` ${styleText('dim', `(${option.hint ?? 'disabled'})`)}` : ''}`;
    case 'active':
      return `${styleText('cyan', S_CHECKBOX_ACTIVE)} ${label}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'selected':
      return `${styleText('green', S_CHECKBOX_SELECTED)} ${mapMultiline(label, (line) => styleText('dim', line))}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'cancelled':
      return mapMultiline(label, (line) => styleText(['strikethrough', 'dim'], line));
    case 'active-selected':
      return `${styleText('green', S_CHECKBOX_SELECTED)} ${label}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'submitted':
      return mapMultiline(label, (line) => styleText('dim', line));
    default:
      return `${styleText('dim', S_CHECKBOX_INACTIVE)} ${mapMultiline(label, (line) => styleText('dim', line))}`;
  }
}

async function multiselectMenu<T>(opts: MultiSelectMenuOptions<T>): Promise<T[] | symbol> {
  const required = opts.required ?? true;

  const promptOptions: ConstructorParameters<typeof MultiSelectPrompt<SelectOption<T>>>[0] = {
    options: opts.options,
    required,
    validate(value) {
      if (required && (value === undefined || value.length === 0)) {
        return 'Please select at least one option.';
      }
    },
    render() {
      const withGuide = opts.withGuide ?? clackSettings.withGuide;
      const header = wrapTextWithPrefix(
        opts.output,
        opts.message,
        withGuide ? `${symbolBar(this.state)}  ` : '',
        `${symbol(this.state)}  `,
      );
      const frame = `${withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${header}\n`;
      const selectedValues = this.value ?? [];
      const formatRow = (option: SelectOption<T>, isActive: boolean) => {
        if (option.disabled) return formatMultiSelectOption(option, 'disabled');
        const isSelected = selectedValues.includes(option.value);
        return isActive && isSelected
          ? formatMultiSelectOption(option, 'active-selected')
          : isSelected
            ? formatMultiSelectOption(option, 'selected')
            : formatMultiSelectOption(option, isActive ? 'active' : 'inactive');
      };

      switch (this.state) {
        case 'submit': {
          const selected = this.options
            .filter(({ value }) => selectedValues.includes(value))
            .map((option) => formatMultiSelectOption(option, 'submitted'))
            .join(styleText('dim', ', ')) || styleText('dim', 'none');
          return `${frame}${wrapTextWithPrefix(opts.output, selected, withGuide ? `${styleText('gray', S_BAR)}  ` : '')}`;
        }
        case 'cancel': {
          const selected = this.options
            .filter(({ value }) => selectedValues.includes(value))
            .map((option) => formatMultiSelectOption(option, 'cancelled'))
            .join(styleText('dim', ', '));
          if (selected.trim() === '') {
            return `${frame}${styleText('gray', S_BAR)}`;
          }
          return `${frame}${wrapTextWithPrefix(opts.output, selected, withGuide ? `${styleText('gray', S_BAR)}  ` : '')}${withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
        }
        case 'error': {
          const prefix = withGuide ? `${styleText('yellow', S_BAR)}  ` : '';
          const errorLines = this.error.split('\n').map((line, index) =>
            index === 0
              ? `${withGuide ? `${styleText('yellow', S_BAR_END)}  ` : ''}${styleText('yellow', line)}`
              : `   ${line}`
          ).join('\n');
          const rows = this.options.map((option, index) => `${prefix}${formatRow(option, index === this.cursor)}`);
          return `${frame}${rows.join('\n')}\n${errorLines}\n`;
        }
        default: {
          const prefix = withGuide ? `${styleText('cyan', S_BAR)}  ` : '';
          const rows = this.options.map((option, index) => `${prefix}${formatRow(option, index === this.cursor)}`);
          return `${frame}${rows.join('\n')}${withGuide ? `\n${styleText('cyan', S_BAR_END)}` : ''}\n`;
        }
      }
    },
  };

  if (opts.signal) promptOptions.signal = opts.signal;
  if (opts.input) promptOptions.input = opts.input;
  if (opts.output) promptOptions.output = opts.output;
  if (opts.initialValues !== undefined) promptOptions.initialValues = opts.initialValues;
  if (opts.cursorAt !== undefined) promptOptions.cursorAt = opts.cursorAt;

  return await new MultiSelectPrompt<SelectOption<T>>(promptOptions).prompt() as T[] | symbol;
}

async function promptServerDetails(
  existingConfig: Config,
  currentServer?: AppServer
): Promise<{ name: string; home: string; profile: 'minimal' | 'recommended' }> {
  const namePromptOptions = {
    message: 'Name for this server (e.g., wildfly-dev):',
    placeholder: currentServer?.name ?? 'server-local',
    ...(currentServer?.name ? { initialValue: currentServer.name } : {}),
    validate: (value: string | undefined) => {
      if (!value) return 'Name is required';
      if (existingConfig.servers.some((server) => server.name === value && server.name !== currentServer?.name)) {
        return 'A server with this name already exists';
      }
    },
  };
  const homePromptOptions = {
    message: 'Full path for Server Home:',
    placeholder: currentServer?.home ?? '/opt/wildfly-20.0',
    ...(currentServer?.home ? { initialValue: currentServer.home } : {}),
    validate: (value: string | undefined) => {
      if (!value) return 'Path is required';
      if (!validateServerHome(value)) return 'This path does not look like a valid Server Home (missing standalone/deployments)';
    },
  };

  const result = await group(
    {
      name: () => text(namePromptOptions),
      home: () => text(homePromptOptions),
      profile: () => selectMenu({
        message: 'Select the JVM memory profile for this server (affects -Xms and -Xmx):',
        options: [
          { value: 'recommended', label: '[ Recommended ] 2GB initial - 5GB max (Default)' },
          { value: 'minimal', label: '[ Minimal     ] 1GB initial - 2GB max' },
        ],
        initialValue: currentServer?.memoryProfile ?? 'recommended',
      }),
    },
    {
      onCancel: () => {
        throw new CancelToServerSelect();
      },
    }
  );

  return {
    name: result.name,
    home: normalizePath(result.home),
    profile: result.profile as 'minimal' | 'recommended',
  };
}

export function getActionLabel(
  action: DeployAction,
  opts: { serverRunning?: boolean } = {}
): string {
  const serverRunning = opts.serverRunning ?? false;

  switch (action) {
    case ACTIONS.BUILD_DEPLOY:
      return serverRunning ? 'Build, copy & deploy' : 'Build, copy & start';
    case ACTIONS.DEPLOY_ONLY:
      return serverRunning ? 'Copy & deploy' : 'Copy & start';
    case ACTIONS.START_ONLY:
      return 'Start server';
  }
}

function formatStartupModeLabel(mode: ServerMode, port?: number): string {
  if (mode === SERVER_MODES.DEBUG) {
    return `Startup mode: 🐞 Debug (${port || DEFAULT_DEBUG_PORT})`;
  }

  return 'Startup mode: 🚀 Normal';
}

export async function addNewServerFlow(existingConfig: Config): Promise<AppServer> {
  const result = await promptServerDetails(existingConfig);

  const newServer: AppServer = {
    name: result.name,
    home: result.home,
    memoryProfile: result.profile as 'minimal' | 'recommended',
  };

  const newConfig: Config = {
    ...existingConfig,
    servers: [...existingConfig.servers, newServer],
    lastServer: newServer.name,
  };

  await saveConfig(newConfig);
  note('Server added successfully. You can review or modify this configuration directly at: ~/.jbdeploy/config.json');

  return newServer;
}

export async function editServerFlow(config: Config): Promise<void> {
  const serverToEdit = await selectMenu({
    message: 'Select a server to edit:',
    options: [
      ...config.servers.map((server) => ({
        value: server as AppServer | typeof NAV.BACK,
        label: `${server.name} (${server.home})`,
      })),
      { value: NAV.BACK as AppServer | typeof NAV.BACK, label: '← Cancel' }
    ] as { value: AppServer | typeof NAV.BACK; label: string }[]
  });

  if (isCancel(serverToEdit) || serverToEdit === NAV.BACK) return;

  const target = serverToEdit as AppServer;
  const result = await promptServerDetails(config, target);
  const updatedServer: AppServer = {
    ...target,
    name: result.name,
    home: result.home,
    memoryProfile: result.profile,
  };

  const updatedLastDeployments = config.lastDeployments
    ? Object.fromEntries(
      Object.entries(config.lastDeployments).map(([projectPath, deployment]) => [
        projectPath,
        deployment.serverName === target.name
          ? { ...deployment, serverName: updatedServer.name }
          : deployment,
      ])
    )
    : undefined;

  const newConfig: Config = {
    ...config,
    servers: config.servers.map((server) => server.name === target.name ? updatedServer : server),
    ...(config.lastServer === target.name ? { lastServer: updatedServer.name } : {}),
    ...(updatedLastDeployments ? { lastDeployments: updatedLastDeployments } : {}),
  };

  await saveConfig(newConfig);
  note(`Server '${updatedServer.name}' updated successfully. Project references were kept in sync.`, 'Saved');
}

export async function deleteServerFlow(config: Config): Promise<void> {
  const serverToDelete = await selectMenu({
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
    message: `Are you sure you want to delete '${target.name}'? This will remove all associated project references.`,
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

export async function selectServer(config: Config): Promise<AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER'> {
  const sortedServers = [...config.servers].sort((a, b) => {
    if (a.name === config.lastServer) return -1;
    if (b.name === config.lastServer) return 1;
    return 0;
  });

  const options = [
    ...sortedServers.map(s => ({
      value: s as AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER',
      label: `${s.name} (${s.home})`,
    })),
    { value: 'ADD_NEW' as AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER', label: 'Add new server...' },
    ...(config.servers.length > 0 ? [{ value: 'EDIT_SERVER' as AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER', label: 'Edit saved server...' }] : []),
    ...(config.servers.length > 0 ? [{ value: 'DELETE_SERVER' as AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER', label: 'Delete saved server...' }] : [])
  ] as { value: AppServer | 'ADD_NEW' | 'EDIT_SERVER' | 'DELETE_SERVER'; label: string }[];

  const selected = await selectMenu({
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

function getArtifactRecommendationHint(artifact: Artifact, lastArtifactName?: string): string {
  if (lastArtifactName && getArtifactBaseName(artifact.name) === getArtifactBaseName(lastArtifactName)) {
    return 'Recommended: last artifact deployed in this project';
  }

  return 'Recommended: most recently modified artifact found';
}

function sortArtifactsForRecommendation(artifacts: Artifact[], lastArtifactName?: string): Artifact[] {
  const lastBase = lastArtifactName ? getArtifactBaseName(lastArtifactName) : undefined;
  return [...artifacts].sort((a, b) => {
    const aMatchesLast = lastBase && getArtifactBaseName(a.name) === lastBase ? 1 : 0;
    const bMatchesLast = lastBase && getArtifactBaseName(b.name) === lastBase ? 1 : 0;

    if (aMatchesLast !== bMatchesLast) {
      return bMatchesLast - aMatchesLast;
    }
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    if (a.size !== b.size) {
      return b.size - a.size;
    }

    return a.name.localeCompare(b.name);
  });
}

export async function selectWarArtifacts(
  warArtifacts: Artifact[],
  lastArtifactNames: string[] = []
): Promise<Artifact[] | typeof NAV.BACK> {
  if (warArtifacts.length === 1) {
    const artifact = warArtifacts[0]!;
    note(`WAR artifact detected: ${artifact.name} (${formatBytes(artifact.size)})`);
    return [artifact];
  }

  const lastArtifactLookup = new Set(lastArtifactNames);
  const sorted = sortArtifactsForRecommendation(
    warArtifacts,
    lastArtifactNames.length > 0 ? lastArtifactNames[0] : undefined
  );
  const defaultArtifact = sorted[0]!;

  const rememberedInitialValues = sorted
    .filter((artifact) => lastArtifactLookup.has(artifact.name))
    .map((artifact) => artifact.path);
  const selected = await multiselectMenu({
    message: `${warArtifacts.length} WAR artifacts found. ${log.dim('Use Space to select and Enter to continue (Enter with no selection to go back)')}:`,
    options: [
      ...sorted.map((artifact) => ({
        value: artifact.path,
        label: `${artifact.name} (${formatBytes(artifact.size)})`,
        ...(artifact.path === defaultArtifact.path
          ? { hint: getArtifactRecommendationHint(artifact, lastArtifactNames[0]) }
          : {}),
      })),
    ],
    required: false,
    initialValues: rememberedInitialValues.length > 0
      ? rememberedInitialValues
      : [defaultArtifact.path],
  });

  if (isCancel(selected)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  const selectedPaths = selected as string[];
  if (selectedPaths.length === 0) {
    return NAV.BACK;
  }

  const selectedPathLookup = new Set(selectedPaths);
  return sorted.filter((artifact) => selectedPathLookup.has(artifact.path));
}

export async function selectArtifact(artifacts: Artifact[], lastArtifactName?: string): Promise<Artifact | typeof NAV.BACK> {
  if (artifacts.length === 1) {
    const artifact = artifacts[0]!;
    note(`Artifact detected: ${artifact.name} (${formatBytes(artifact.size)})`);
    return artifact;
  }

  const sorted = sortArtifactsForRecommendation(artifacts, lastArtifactName);
  const defaultArtifact = sorted[0]!;

  const selected = await selectMenu({
    message: `${artifacts.length} artifacts found. Select one:`,
    options: [
      ...sorted.map(a => ({
        value: a as Artifact | typeof NAV.BACK,
        label: `${a.name} (${formatBytes(a.size)})`,
        ...(a.path === defaultArtifact.path ? { hint: getArtifactRecommendationHint(a, lastArtifactName) } : {}),
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
  options: {
    canBuild: boolean;
    canDeploy: boolean;
    serverRunning?: boolean;
    lastServerMode?: ServerMode;
    lastDebugPort?: number;
  } = { canBuild: true, canDeploy: true }
): Promise<ActionSelection | typeof NAV.BACK> {
  const serverRunning = options.serverRunning ?? false;
  let currentMode = options.lastServerMode ?? SERVER_MODES.NORMAL;
  let currentPort = options.lastDebugPort;

  if (currentMode === SERVER_MODES.DEBUG && !currentPort) {
    currentPort = DEFAULT_DEBUG_PORT;
  }

  while (true) {
    const menuOptions: { value: DeployAction | 'startup-mode' | typeof NAV.BACK; label: string }[] = [
      { value: ACTIONS.BUILD_DEPLOY, label: getActionLabel(ACTIONS.BUILD_DEPLOY, { serverRunning }) },
      { value: ACTIONS.DEPLOY_ONLY, label: getActionLabel(ACTIONS.DEPLOY_ONLY, { serverRunning }) },
      ...(serverRunning ? [] : [{ value: ACTIONS.START_ONLY, label: getActionLabel(ACTIONS.START_ONLY) }]),
      ...(serverRunning ? [] : [{ value: 'startup-mode' as const, label: formatStartupModeLabel(currentMode, currentPort) }]),
      { value: NAV.BACK, label: '← Back (change server)' },
    ];

    const filteredOptions = menuOptions.filter((opt) => {
      if (opt.value === ACTIONS.BUILD_DEPLOY) return options.canBuild;
      if (opt.value === ACTIONS.DEPLOY_ONLY) return options.canDeploy;
      return true;
    });

    const action = await selectMenu({
      message: 'Select action:',
      options: filteredOptions,
      ...(initialValue && filteredOptions.some((option) => option.value === initialValue) ? { initialValue } : {}),
    });

    if (isCancel(action)) {
      cancel(UI_MESSAGES.GOODBYE);
      process.exit(EXIT_CODES.INTERRUPTED);
    }

    if (action === NAV.BACK) {
      return NAV.BACK;
    }

    if (action === 'startup-mode') {
      const modeResult = await selectServerMode(currentPort, currentMode);
      if (modeResult === NAV.BACK) {
        continue;
      }

      currentMode = modeResult.mode;
      currentPort = modeResult.port;
      continue;
    }

    return {
      action: action as DeployAction,
      mode: currentMode,
      ...(currentMode === SERVER_MODES.DEBUG && currentPort ? { port: currentPort } : {}),
    };
  }
}

export async function selectServerMode(
  lastUsedPort?: number,
  lastServerMode?: ServerMode
): Promise<{ mode: ServerMode; port?: number } | typeof NAV.BACK> {
  const defaultPort = lastUsedPort || DEFAULT_DEBUG_PORT;
  const debugLabel = lastUsedPort
    ? `🐞 Debug mode (Port: ${lastUsedPort})`
    : `🐞 Debug mode (Default port: ${DEFAULT_DEBUG_PORT})`;

  const modeResult = await selectMenu({
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
      validate: (value: string | undefined) => {
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

export async function selectProjectEntry(
  last: LastDeployment,
  opts: { serverRunning?: boolean } = {}
): Promise<'REPEAT_LAST' | 'MANUAL_FLOW'> {
  const actionLabel = getActionLabel(last.action, { serverRunning: opts.serverRunning ?? false });
  const modeLabel = last.mode === SERVER_MODES.DEBUG
    ? `Debug${last.port ? ` (${last.port})` : ''}`
    : 'Normal';
  const artifactLabel = last.artifactNames && last.artifactNames.length > 0
    ? last.artifactNames.join(', ')
    : last.artifactName;
  const summaryLabel = styleText(
    'dim',
    `[Server: ${last.serverName}, Action: ${actionLabel}, Artifacts: ${artifactLabel}, Mode: ${modeLabel}]`
  );

  const result = await confirm({
    message: `Repeat last flow? ${summaryLabel}`,
    active: 'Repeat last flow',
    inactive: 'Choose manually',
    initialValue: true,
    vertical: true,
  });

  if (isCancel(result)) {
    cancel(UI_MESSAGES.GOODBYE);
    process.exit(EXIT_CODES.INTERRUPTED);
  }

  return result ? 'REPEAT_LAST' : 'MANUAL_FLOW';
}
