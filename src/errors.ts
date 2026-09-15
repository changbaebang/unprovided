/** Thrown for usage/config problems. The CLI maps it to exit code 2. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}
