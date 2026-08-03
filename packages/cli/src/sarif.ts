import type { DriftEntry, DriftReport } from './drift.js';

export const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

export interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
    };
  }>;
}

export interface SarifLog {
  $schema: typeof SARIF_SCHEMA;
  version: '2.1.0';
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
          fullDescription: { text: string };
          defaultConfiguration: { level: 'error' | 'warning' | 'note' };
        }>;
      };
    };
    results: SarifResult[];
  }>;
}

const RULES = [
  {
    id: 'legalithm/input-drift',
    name: 'InputDrift',
    short: 'Compliance record input drift',
    full: 'The committed compliance/legalithm.json input hash differs from a freshly generated record.',
    level: 'warning' as const,
  },
  {
    id: 'legalithm/rule-drift',
    name: 'RuleDrift',
    short: 'Rules engine drift',
    full: 'The rules engine version changed; the committed record may be stale vs current law.',
    level: 'error' as const,
  },
  {
    id: 'legalithm/risk-drift',
    name: 'RiskDrift',
    short: 'Risk classification drift',
    full: 'The risk tier in the committed record differs from a freshly generated classification.',
    level: 'error' as const,
  },
  {
    id: 'legalithm/no-record',
    name: 'NoRecord',
    short: 'Missing compliance record',
    full: 'No compliance/legalithm.json found. Run `legalithm init` and commit the record.',
    level: 'error' as const,
  },
];

function resultForDrift(entry: DriftEntry): SarifResult {
  const ruleId = `legalithm/${entry.type}-drift`;
  const level = entry.type === 'input' ? 'warning' : 'error';
  return {
    ruleId,
    level,
    message: {
      text: `${entry.type} drift: ${entry.from} → ${entry.to}`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'compliance/legalithm.json' },
        },
      },
    ],
  };
}

export function driftReportToSarif(report: DriftReport, toolVersion: string): SarifLog {
  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'legalithm',
            version: toolVersion,
            informationUri: 'https://www.legalithm.com',
            rules: RULES.map((r) => ({
              id: r.id,
              name: r.name,
              shortDescription: { text: r.short },
              fullDescription: { text: r.full },
              defaultConfiguration: { level: r.level },
            })),
          },
        },
        results: report.drift.map(resultForDrift),
      },
    ],
  };
}

export function noRecordSarif(toolVersion: string): SarifLog {
  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'legalithm',
            version: toolVersion,
            informationUri: 'https://www.legalithm.com',
            rules: RULES.map((r) => ({
              id: r.id,
              name: r.name,
              shortDescription: { text: r.short },
              fullDescription: { text: r.full },
              defaultConfiguration: { level: r.level },
            })),
          },
        },
        results: [
          {
            ruleId: 'legalithm/no-record',
            level: 'error',
            message: { text: 'No compliance/legalithm.json found — run `legalithm init` first.' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'compliance/legalithm.json' },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
