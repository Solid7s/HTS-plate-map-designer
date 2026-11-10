import { dimensions, parseNumbers, validateExperiment } from './planner.ts';
import type { Condition, Experiment, LayoutKind, Plan, Plate } from './planner';

// Each slot holds one complete replicate set. Rectangular slots remain one
// well wide; the column solution transposes both slots and placement order.
export function makeCompoundPlan(e: Experiment, kind: LayoutKind, controls = true): Plan {
  const errors = validateExperiment(e);
  if (errors.length) throw new Error(errors[0]);
  const physical = dimensions(e.format);
  const transposed = kind === 'tall';
  const rows = transposed ? physical.cols : physical.rows;
  const cols = transposed ? physical.rows : physical.cols;
  const margin = e.excludeEdges ? 1 : 0;
  const slotWidth = kind === 'balanced' ? Math.ceil(Math.sqrt(e.replicates)) : 1;
  const slotHeight = Math.ceil(e.replicates / slotWidth);
  const slots: { row: number; col: number }[] = [];
  for (let row = margin; row + slotHeight <= rows - margin; row += slotHeight) {
    for (let col = margin; col + slotWidth <= cols - margin; col += slotWidth) slots.push({ row, col });
  }
  const controlsPerGroup = controls ? 2 : 0;
  const dosesPerBatch = slots.length - controlsPerGroup;
  if (dosesPerBatch < 1) throw new Error('There is not enough usable space for a drug condition and its controls.');
  const plates: Plate[] = [];
  let conditions = 0, sampleWells = 0, controlWells = 0, blocks = 0;
  for (const [compoundIndex, compound] of e.compounds.entries()) {
    const concentrations = parseNumbers(compound.concentrations);
    let plate: Plate | undefined;
    let slotIndex = 0, batch = 0;
    const newPlate = () => {
      plate = { wells: Array(e.format).fill(null), compoundId: compound.id, compoundName: compound.name, compoundIndex, batch: ++batch };
      plates.push(plate); slotIndex = 0;
    };
    const place = (condition: Condition) => {
      const slot = slots[slotIndex++];
      for (let replicate = 1; replicate <= e.replicates; replicate++) {
        const layoutRow = slot.row + Math.floor((replicate - 1) / slotWidth);
        const layoutCol = slot.col + (replicate - 1) % slotWidth;
        const row = transposed ? layoutCol : layoutRow, col = transposed ? layoutRow : layoutCol;
        plate!.wells[row * physical.cols + col] = { ...condition, row, col, replicate, plate: plates.length, address: `${String.fromCharCode(65 + row)}${col + 1}` };
      }
      if (condition.role === 'sample') { sampleWells += e.replicates; conditions++; }
      else controlWells += e.replicates;
      blocks++;
      if (sampleWells + controlWells > 20000) throw new Error('This layout exceeds 20,000 wells including repeated controls. Reduce the counts or split the screen.');
    };
    for (const cell of e.cells) for (const density of parseNumbers(cell.densities)) {
      // Keep the entire cell/density dose series and both controls together
      // whenever possible. Only oversized dose series span multiple plates;
      // every continuation receives its own complete control sets.
      for (let offset = 0; offset < concentrations.length; offset += dosesPerBatch) {
        const doses = concentrations.slice(offset, offset + dosesPerBatch);
        if (!plate || slots.length - slotIndex < doses.length + controlsPerGroup) newPlate();
        const base = { cellId: cell.id, cellName: cell.name, density };
        for (const concentration of doses) {
          place({ ...base, id: JSON.stringify([cell.id, density, compound.id, concentration]), compoundId: compound.id, compoundName: compound.name, compoundIndex, concentration, unit: e.unit, role: 'sample' });
        }
        if (controls) for (const role of ['positive', 'negative'] as const) {
          place({ ...base, id: JSON.stringify([cell.id, density, compound.id, role, plates.length]), compoundId: `${role}-control`, compoundName: `${role === 'positive' ? 'Positive' : 'Negative'} control`, compoundIndex: -1, concentration: 0, unit: '', role });
        }
      }
    }
  }
  return { kind, plates, conditions, sampleWells, controlWells, usable: (rows - 2 * margin) * (cols - 2 * margin), rows: physical.rows, cols: physical.cols, blocks };
}
