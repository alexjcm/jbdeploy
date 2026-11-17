import { System } from '../core/system.ts';

export interface ParsedSystemProperties {
  properties: string[];
  errors: string[];
}

// -Dkey or -Dkey=value, where key only contains letters, digits, dots, underscores and hyphens
const SYSTEM_PROPERTY_PATTERN = /^-D([A-Za-z0-9_.-]+)(?:=(.*))?$/s;

// Windows runs the server script through a shell, so these characters would be interpreted by it
const WINDOWS_UNSAFE_VALUE_PATTERN = /[\s&|<>^"%]/;

// standalone.sh refuses this property and exits with an error
const FORBIDDEN_PROPERTIES = ['java.security.manager'];

/**
 * Extracts the -D system properties from the CLI arguments.
 * They are applied only to the current run and are never persisted.
 */
export function parseSystemProperties(args: string[]): ParsedSystemProperties {
  const properties: string[] = [];
  const errors: string[] = [];

  for (const arg of args) {
    if (!arg.startsWith('-D')) continue;

    const match = SYSTEM_PROPERTY_PATTERN.exec(arg);
    if (!match) {
      errors.push(`Invalid system property '${arg}'. Expected -Dkey=value.`);
      continue;
    }

    const [, key, value] = match;
    if (FORBIDDEN_PROPERTIES.some((forbidden) => key!.startsWith(forbidden))) {
      errors.push(`System property '-D${key}' is not supported by the server startup script.`);
      continue;
    }

    if (System.isWindows && value && WINDOWS_UNSAFE_VALUE_PATTERN.test(value)) {
      errors.push(`The value of '-D${key}' contains characters that are not supported on Windows (spaces, & | < > ^ " %).`);
      continue;
    }

    properties.push(arg);
  }

  return { properties, errors };
}
