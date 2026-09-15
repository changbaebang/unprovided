import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from './errors.js';
import type {
  DefaultedLevel,
  ExternalContextConfig,
  ModuleExportRef,
  UnprovidedConfig,
} from './types.js';

export const DEFAULTED_LEVELS: readonly DefaultedLevel[] = ['info', 'warning', 'error', 'ignore'];

export function isDefaultedLevel(v: unknown): v is DefaultedLevel {
  return typeof v === 'string' && (DEFAULTED_LEVELS as readonly string[]).includes(v);
}

const CONFIG_FILES = ['unprovided.config.json', 'unprovided.config.mjs', 'unprovided.config.js'];

/**
 * Loads `unprovided.config.{json,mjs,js}`. Returns `{}` when nothing is found and no explicit
 * path was requested. Throws ConfigError for a missing explicit path or an invalid shape.
 */
export async function loadConfig(
  root: string,
  explicitPath?: string,
): Promise<{ config: UnprovidedConfig; path: string | null }> {
  let file: string | null = null;
  if (explicitPath) {
    file = path.resolve(root, explicitPath);
    if (!fs.existsSync(file)) throw new ConfigError(`config file not found: ${file}`);
  } else {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return { config: {}, path: null };

  let raw: unknown;
  if (file.endsWith('.json')) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new ConfigError(`failed to parse ${file}: ${(e as Error).message}`);
    }
  } else {
    try {
      const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
      raw = mod.default ?? mod;
    } catch (e) {
      throw new ConfigError(`failed to load ${file}: ${(e as Error).message}`);
    }
  }
  return { config: validateConfig(raw, file), path: file };
}

export function validateConfig(raw: unknown, source = '<inline>'): UnprovidedConfig {
  if (!isRecord(raw)) throw new ConfigError(`${source}: config must be an object`);
  const out: UnprovidedConfig = {};
  const strings = (key: 'entries' | 'always' | 'ignore') => {
    const v = raw[key];
    if (v === undefined) return;
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
      throw new ConfigError(`${source}: "${key}" must be an array of strings`);
    }
    out[key] = v as string[];
  };
  strings('entries');
  strings('always');
  strings('ignore');
  if (raw.tsconfig !== undefined) {
    if (typeof raw.tsconfig !== 'string')
      throw new ConfigError(`${source}: "tsconfig" must be a string`);
    out.tsconfig = raw.tsconfig;
  }
  if (raw.boundary !== undefined) {
    if (typeof raw.boundary !== 'string')
      throw new ConfigError(`${source}: "boundary" must be a string`);
    out.boundary = raw.boundary;
  }
  if (raw.defaultedContexts !== undefined) {
    if (!isDefaultedLevel(raw.defaultedContexts)) {
      throw new ConfigError(
        `${source}: "defaultedContexts" must be one of ${DEFAULTED_LEVELS.join(', ')}`,
      );
    }
    out.defaultedContexts = raw.defaultedContexts;
  }
  if (raw.externalContexts !== undefined) {
    if (!Array.isArray(raw.externalContexts)) {
      throw new ConfigError(`${source}: "externalContexts" must be an array`);
    }
    out.externalContexts = raw.externalContexts.map((c, i) =>
      validateExternal(c, `${source}: externalContexts[${i}]`),
    );
  }
  return out;
}

function validateExternal(raw: unknown, where: string): ExternalContextConfig {
  if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.length === 0) {
    throw new ConfigError(`${where}: "name" is required`);
  }
  const refs = (key: 'providers' | 'consumers'): ModuleExportRef[] => {
    const v = raw[key];
    if (!Array.isArray(v) || v.length === 0)
      throw new ConfigError(`${where}: "${key}" must be a non-empty array`);
    return v.map((r, i) => {
      if (!isRecord(r) || typeof r.module !== 'string' || typeof r.export !== 'string') {
        throw new ConfigError(`${where}.${key}[${i}]: expected { module: string, export: string }`);
      }
      const ref: ModuleExportRef & { throws?: boolean } = { module: r.module, export: r.export };
      if (key === 'consumers') {
        // Library hooks typically throw without their provider, so `throws` defaults to true.
        if (r.throws !== undefined && typeof r.throws !== 'boolean')
          throw new ConfigError(`${where}.${key}[${i}]: "throws" must be a boolean`);
        ref.throws = r.throws === undefined ? true : r.throws;
      }
      return ref;
    });
  };
  return { name: raw.name, providers: refs('providers'), consumers: refs('consumers') };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
