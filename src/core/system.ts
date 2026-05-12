export const System = {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin'
} as const;
