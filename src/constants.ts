export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  COMMAND_NOT_FOUND: 127,
  INTERRUPTED: 130,
} as const;

export const SERVER_PATHS = {
  DEPLOYMENTS: ['standalone', 'deployments'],
  DATA: ['standalone', 'data'],
  LOG: ['standalone', 'log'],
  TMP: ['standalone', 'tmp'],
} as const;

export const DEPLOYMENT_MARKERS = {
  DODEPLOY:    '.dodeploy',
  DEPLOYED:    '.deployed',
  FAILED:      '.failed',
  ISDEPLOYING: '.isdeploying',
  SKIPDEPLOY:  '.skipdeploy',
  PENDING:     '.pending',
} as const;

export const ARTIFACT_EXTENSIONS = ['.war', '.ear'] as const;

export const DEFAULT_DEBUG_PORT = 5005;

export const SERVER_SCRIPT = {
  BIN_DIR:  'bin',
  WIN:      'standalone.bat',
  UNIX:     'standalone.sh',
  OS_FLAG:  '-Dos.name=Linux',
} as const;
