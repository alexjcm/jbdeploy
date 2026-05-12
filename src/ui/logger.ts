import { note, cancel, outro, log as clackLog } from '@clack/prompts';

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
};

export const log = {
  // Use native clackLog for semantic actions
  info: (msg: string) => clackLog.info(msg),
  success: (msg: string) => clackLog.success(msg),
  warn: (msg: string) => clackLog.warn(`${colors.yellow}${msg}${colors.reset}`),
  error: (msg: string, detail?: string) => {
    clackLog.error(msg);
    if (detail) console.error(`  ${colors.dim}${detail}${colors.reset}\n`);
  },
  step: (msg: string) => clackLog.step(msg),
  message: (msg: string) => clackLog.message(msg),
  
  // Custom wrappers for structured elements
  intro: (msg: string) => console.log(`${colors.cyan}┌  ${msg}${colors.reset}`),
  outro: (msg: string) => outro(`${colors.cyan}└  ${msg}${colors.reset}`),
  cancel: (msg: string) => cancel(`${colors.red}${msg}${colors.reset}`),
  
  // note() is reserved for summary boxes/next steps
  note: (msg: string, title?: string) => note(msg, title),
  dim: (msg: string) => `${colors.dim}${msg}${colors.reset}`,
};
