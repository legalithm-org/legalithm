// Read/write the committed compliance record + render the human-facing markdown artifacts.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { StoredRecord } from './types.js';

export const RECORD_DIR = 'compliance';
export const RECORD_FILE = 'legalithm.json';
export const ANNEX_FILE = 'annex-iv.md';
export const CHECKLIST_FILE = 'checklist.md';

export function recordPath(cwd: string): string {
  return join(cwd, RECORD_DIR, RECORD_FILE);
}

export function readRecord(cwd: string): StoredRecord | null {
  const path = recordPath(cwd);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as StoredRecord;
}

/** Write the record + the two markdown artifacts into <cwd>/compliance/. */
export function writeRecordBundle(cwd: string, record: StoredRecord): void {
  const dir = join(cwd, RECORD_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, CHECKLIST_FILE), renderChecklistMarkdown(record), 'utf8');
  writeFileSync(join(dir, ANNEX_FILE), renderAnnexMarkdown(record), 'utf8');
}

interface ObligationLike {
  title: string;
  description: string;
  how_to_prove?: string;
  priority?: string;
}
interface SectionLike {
  title: string;
  content: string;
  todo?: string[];
}

export function renderChecklistMarkdown(record: StoredRecord): string {
  const obligations = (record.obligations as ObligationLike[] | undefined) ?? [];
  const lines: string[] = [
    `# AI Act Obligations — ${record.system.name}`,
    `> ${record.legalBasis.statement}`,
    `> ${(record as { disclaimer?: string }).disclaimer ?? 'Not legal advice.'}`,
    '',
    `**Risk classification:** ${record.classification.risk}`,
    '',
  ];
  if (obligations.length === 0) {
    lines.push('_No high-risk obligations attached at this classification._');
  }
  for (const o of obligations) {
    lines.push(`- [ ] **${o.title}**${o.priority ? ` (${o.priority})` : ''} — ${o.description}`);
    if (o.how_to_prove) lines.push(`  - _How to prove:_ ${o.how_to_prove}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderAnnexMarkdown(record: StoredRecord): string {
  const annex = record.annex4 as { sections?: Record<string, SectionLike> } | undefined;
  const sections = annex?.sections ?? {};
  const lines: string[] = [
    `# Annex IV Technical Documentation — ${record.system.name}`,
    `> ${record.legalBasis.statement} · Risk: ${record.classification.risk}`,
    `> ${(record as { disclaimer?: string }).disclaimer ?? 'Not legal advice.'}`,
    '',
  ];
  for (const section of Object.values(sections)) {
    lines.push(`## ${section.title}`, '', section.content, '');
    if (section.todo?.length) {
      lines.push('**TODO:**', ...section.todo.map((t) => `- ${t}`), '');
    }
  }
  return `${lines.join('\n')}\n`;
}
