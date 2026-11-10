import { defaultExperiment, validateExperiment } from './planner.ts';
import { makeCompoundPlan } from './compound-planner.ts';
import type { Experiment, Plan } from './planner';

export type SimpleSetup = {
  cellLines: string;
  densities: string;
  compounds: string;
  concentrations: string;
  replicates: string;
  format: 96 | 384;
  excludeEdges: boolean;
  screenControls?: boolean;
};

export const defaultSimpleSetup: SimpleSetup = {
  cellLines: '2', densities: '1', compounds: '4', concentrations: '1',
  replicates: '3', format: 96, excludeEdges: false, screenControls: true,
};

export const simpleFields = [
  { key: 'cellLines', label: 'Cell lines', detail: 'Number of cell lines', max: 30 },
  { key: 'densities', label: 'Seeding densities', detail: 'Levels per cell line', max: 30 },
  { key: 'compounds', label: 'Compounds', detail: 'Number of compounds', max: 50 },
  { key: 'concentrations', label: 'Concentrations', detail: 'Levels per compound', max: 30 },
  { key: 'replicates', label: 'Replicates', detail: 'Wells per condition', max: 6 },
] as const;

export function buildSimpleExperiment(setup: SimpleSetup): { experiment: Experiment | null; errors: string[] } {
  const errors: string[] = [];
  for (const field of simpleFields) {
    const value = setup[field.key];
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > field.max) {
      errors.push(`${field.label}: enter a whole number from 1 to ${field.max}.`);
    }
  }
  if (![96, 384].includes(setup.format) || typeof setup.excludeEdges !== 'boolean' || (setup.screenControls !== undefined && typeof setup.screenControls !== 'boolean')) errors.push('Choose valid plate, edge, and control settings.');
  if (errors.length) return { experiment: null, errors };
  const count = (key: typeof simpleFields[number]['key']) => Number(setup[key]);
  const wells = count('cellLines') * count('densities') * count('compounds') * (count('concentrations') + (setup.screenControls !== false ? 2 : 0)) * count('replicates');
  if (wells > 20000) return { experiment: null, errors: ['This setup requires more than 20,000 wells. Reduce the counts or split the screen.'] };
  const levels = (amount: number) => Array.from({ length: amount }, (_, i) => i + 1).join(', ');
  // These numbers are level identifiers, not physical densities or doses.
  const experiment: Experiment = {
    ...defaultExperiment, name: 'Quick screen', format: setup.format,
    excludeEdges: setup.excludeEdges, vehicleControls: false, replicates: count('replicates'),
    cells: Array.from({ length: count('cellLines') }, (_, i) => ({ id: `cell-${i + 1}`, name: `Cell line ${i + 1}`, densities: levels(count('densities')) })),
    compounds: Array.from({ length: count('compounds') }, (_, i) => ({ id: `drug-${i + 1}`, name: `Compound ${i + 1}`, concentrations: levels(count('concentrations')) })),
  };
  const issues = validateExperiment(experiment);
  return { experiment: issues.length ? null : experiment, errors: issues };
}

export type SimpleDesign = {
  experiment: Experiment | null;
  plans: Plan[];
  errors: string[];
  comparison: { format: 96 | 384; minimum: number; maximum: number }[];
};

export function buildSimpleDesign(setup: SimpleSetup): SimpleDesign {
  const { experiment, errors } = buildSimpleExperiment(setup);
  if (!experiment) return { experiment: null, plans: [], errors, comparison: [] };
  const kinds = ['balanced', 'wide', 'tall'] as const;
  try {
    const plans = kinds.map(kind => makeCompoundPlan(experiment, kind, setup.screenControls !== false));
    const comparison: SimpleDesign['comparison'] = [];
    for (const format of [96, 384] as const) {
      try {
        const counts = format === experiment.format ? plans.map(plan => plan.plates.length) : kinds.map(kind => makeCompoundPlan({ ...experiment, format }, kind, setup.screenControls !== false).plates.length);
        comparison.push({ format, minimum: Math.min(...counts), maximum: Math.max(...counts) });
      } catch { /* Another format may exceed the well limit because of repeated controls. */ }
    }
    return { experiment, plans, errors: [], comparison };
  } catch (error) {
    return { experiment: null, plans: [], errors: [error instanceof Error ? error.message : 'Could not fit this screen. Reduce the counts.'], comparison: [] };
  }
}
