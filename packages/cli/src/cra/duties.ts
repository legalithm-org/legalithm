/**
 * The duties that attach to the role a classification found.
 *
 * `cra classify` computed the role from the moment it shipped, and then nothing
 * used it: the Annex I assessment and the technical file are manufacturer-shaped,
 * so an importer who ran the tool learned they were an importer and was handed a
 * manufacturer's checklist.
 *
 * That gap is worth more than it looks. Every product placed on the EU market by
 * a non-EU manufacturer has an importer, and every one of those has a
 * distributor; there are far more of them than manufacturers, their duties are
 * lighter, and none of them are discharged by an Annex I assessment they cannot
 * make.
 *
 * The corpus already carried the role dimension. This reads it.
 */
import { loadFramework, type UnifiedObligation } from '../union.js';

export type CraRole =
  | 'manufacturer'
  | 'importer'
  | 'distributor'
  | 'authorised_representative'
  | 'open_source_steward'
  | 'substantial_modifier';

/**
 * Article 21: an importer or distributor who places a product under its own name
 * or trademark, or substantially modifies one already placed, IS a manufacturer
 * for the purposes of the Regulation.
 *
 * So the duties that apply are not always the duties of the role you call
 * yourself, and a tool that answered only the nominal role would give the most
 * dangerous possible answer to a white-labeller: a short list.
 */
export function effectiveRoles(role: CraRole, rebrandsOrModifies: boolean): CraRole[] {
  if (rebrandsOrModifies && (role === 'importer' || role === 'distributor')) {
    return [role, 'manufacturer'];
  }
  return [role];
}

export interface DutySet {
  role: CraRole;
  /** Roles whose duties actually apply, after Article 21. */
  applied: CraRole[];
  obligations: UnifiedObligation[];
  /** True when Article 21 pulled manufacturer duties in. */
  reassigned: boolean;
}

export function dutiesFor(
  repoRoot: string,
  role: CraRole,
  opts: { rebrandsOrModifies?: boolean } = {},
): DutySet {
  const applied = effectiveRoles(role, Boolean(opts.rebrandsOrModifies));
  const all = loadFramework(repoRoot, 'eu-cra');

  const obligations = all
    .filter((o) => {
      const r = (o as UnifiedObligation & { role?: string }).role;
      // A row with no role is a duty on somebody who is not an economic
      // operator, typically an authority. Excluded rather than shown to
      // everybody, which would be noise in the one place noise is expensive.
      return r !== undefined && r !== null && applied.includes(r as CraRole);
    })
    .sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));

  return { role, applied, obligations, reassigned: applied.length > 1 };
}
