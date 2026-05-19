// SPDX-License-Identifier: Apache-2.0
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import RefParser from '@apidevtools/json-schema-ref-parser';
import yaml from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = fileURLToPath(new URL('../../openapi.yaml', import.meta.url));

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
}

export interface SchemaValidator {
  validate(schemaName: string, data: unknown): ValidationResult;
}

export async function createSchemaValidator(): Promise<SchemaValidator> {
  const raw = await readFile(SPEC_PATH, 'utf8');
  const spec = yaml.load(raw) as Record<string, unknown>;
  const dereffed = (await RefParser.dereference(spec)) as {
    components: { schemas: Record<string, object> };
  };

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const compiled = new Map<string, ValidateFunction>();
  for (const [name, schema] of Object.entries(dereffed.components.schemas)) {
    compiled.set(name, ajv.compile(schema));
  }

  return {
    validate(name: string, data: unknown): ValidationResult {
      const fn = compiled.get(name);
      if (!fn) {
        throw new Error(`Unknown schema: ${name}`);
      }
      const valid = fn(data);
      return { valid: !!valid, errors: fn.errors ?? null };
    },
  };
}
