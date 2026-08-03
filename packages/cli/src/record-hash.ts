// CLI-local mirror of lib/ai_act/record/{canonical,hash}.ts so check/verify-record
// work offline without importing the Next app. Keep in sync with lib/ai_act/record.

import { createHash } from 'crypto';
import type { StoredRecord } from './types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Short (12-hex) content hash for human-facing ids and engine versions. */
export function shortHash(value: unknown): string {
  return contentHash(value).slice(0, 12);
}

/** Strip asOf-derived date stamps from Annex IV before hashing. */
function annex4ForHash(annex4: unknown): unknown {
  if (!annex4 || typeof annex4 !== 'object') return annex4;
  const doc = annex4 as {
    sections?: Record<string, { lastUpdated?: string; [key: string]: unknown }>;
    metadata?: { generatedAt?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  const sections = doc.sections
    ? Object.fromEntries(
        Object.entries(doc.sections).map(([key, section]) => {
          const { lastUpdated: _lu, ...rest } = section;
          return [key, rest];
        }),
      )
    : doc.sections;
  const metadata =
    doc.metadata && typeof doc.metadata === 'object'
      ? (() => {
          const { generatedAt: _ga, ...rest } = doc.metadata as { generatedAt?: string };
          return rest;
        })()
      : doc.metadata;
  return { ...doc, sections, metadata };
}

/** Canonical body hashed as recordHash — stable across asOf / generatedBy changes. */
export function recordHashBody(record: StoredRecord): Record<string, unknown> {
  const legalBasis = record.legalBasis as { instrument?: string; engineVersion: string; statement?: string };
  return {
    $schema: record.$schema,
    schemaVersion: record.schemaVersion,
    recordId: record.recordId,
    legalBasis: {
      instrument: legalBasis.instrument,
      engineVersion: legalBasis.engineVersion,
    },
    system: record.system,
    classification: record.classification,
    obligations: record.obligations,
    annex4: annex4ForHash(record.annex4),
    inputHash: record.inputHash,
    disclaimer: record.disclaimer,
  };
}

/** sha256 hex digest of the canonical record body (excludes volatile fields). */
export function computeRecordHash(record: StoredRecord): string {
  return contentHash(recordHashBody(record));
}
