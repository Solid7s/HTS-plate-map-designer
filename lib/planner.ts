export type CellLine = { id: string; name: string; densities: string };
export type Compound = { id: string; name: string; concentrations: string };
export type Experiment = {
  version: 1; name: string; format: 96 | 384; replicates: number; blockWidth: number;
  excludeEdges: boolean; vehicleControls: boolean; unit: string; cells: CellLine[]; compounds: Compound[];
};
export type Condition = {
  id: string; cellId: string; cellName: string; density: number; compoundId: string;
  compoundName: string; compoundIndex: number; concentration: number; unit: string; role: 'sample' | 'vehicle' | 'positive' | 'negative';
};
export type Well = Condition & { replicate: number; plate: number; row: number; col: number; address: string };
export type LayoutKind = 'balanced' | 'wide' | 'tall';
export type Plate = { wells: (Well | null)[]; compoundId?: string; compoundName?: string; compoundIndex?: number; batch?: number; };
export type Plan = { kind: LayoutKind; plates: Plate[]; conditions: number; sampleWells: number; controlWells: number; usable: number; rows: number; cols: number; blocks: number; };
export function getWellCoverage(plan: Plan | undefined, plateIndex: number) {
  if (!plan || !plan.plates[plateIndex] || plan.usable <= 0) return null;
  const assigned = plan.plates.map(plate => plate.wells.reduce((count, well) => count + (well ? 1 : 0), 0));
  const summarize = (filled: number, usable: number) => ({ filled, usable, percent: filled / usable * 100 });
  return {
    plate: summarize(assigned[plateIndex], plan.usable),
    overall: summarize(assigned.reduce((total, count) => total + count, 0), plan.usable * plan.plates.length),
  };
}
export function formatCoveragePercent(percent: number) {
  const rounded = Math.round(percent * 10) / 10;
  // A nearly full experiment must not be presented as completely full.
  return rounded === 100 && percent < 100 ? '>99.9' : String(rounded);
}
export const colors = ['#5fae9d', '#b095d2', '#e2b069', '#79a8d1', '#d98b9e', '#91af63', '#c79a75', '#83bfc5'];
export const defaultDensity = '2500';
export const defaultConcentration = '1';
export const defaultExperiment: Experiment = {
  version: 1, name: 'Cell viability screen', format: 96, replicates: 3, blockWidth: 1,
  excludeEdges: false, vehicleControls: false, unit: 'µM',
  cells: [{ id: 'cell-1', name: 'Cell line 1', densities: defaultDensity }, { id: 'cell-2', name: 'Cell line 2', densities: defaultDensity }],
  compounds: [{ id: 'drug-1', name: 'Compound 1', concentrations: defaultConcentration }, { id: 'drug-2', name: 'Compound 2', concentrations: defaultConcentration }],
};
export function parseNumbers(value: string): number[] {
  const tokens = value.split(/[,;\s]+/).filter(Boolean);
  if (!tokens.length || tokens.some(t => !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t))) return [];
  const result = tokens.map(Number);
  if (result.some(n => !Number.isFinite(n) || n < 0)) return [];
  return [...new Set(result)];
}
export function validateExperiment(value: unknown): string[] {
  const e = value as Experiment;
  if (!e || e.version !== 1 || !Array.isArray(e.cells) || !Array.isArray(e.compounds)) return ['This is not a supported experiment file.'];
  const errors: string[] = [];
  if (typeof e.name !== 'string' || !e.name.trim()) errors.push('Give this experiment a name.');
  if (![96, 384].includes(e.format)) errors.push('Choose a 96- or 384-well plate.');
  if (!Number.isInteger(e.replicates) || e.replicates < 1 || e.replicates > 6) errors.push('Replicates must be between 1 and 6.');
  if (!Number.isInteger(e.blockWidth) || e.blockWidth < 1 || e.blockWidth > (e.format === 384 ? 24 : 12)) errors.push('Block width is outside the plate.');
  if (typeof e.excludeEdges !== 'boolean' || typeof e.vehicleControls !== 'boolean' || !['µM', 'nM', 'mM', 'µg/mL', 'ng/mL'].includes(e.unit)) errors.push('Invalid experiment settings.');
  if (!e.cells.length || !e.compounds.length || e.cells.length > 30 || e.compounds.length > 50) errors.push('Include 1–30 cell lines and 1–50 compounds.');
  for (const [type, list, field] of [['Cell line', e.cells, 'densities'], ['Compound', e.compounds, 'concentrations']] as const) {
    const ids = new Set<string>();
    list.forEach((item, i) => {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || typeof item.id !== 'string' || !item.id || ids.has(item.id)) errors.push(`${type} ${i + 1} needs a name and unique ID.`);
      if (item) ids.add(item.id);
      const raw = item && (item as unknown as Record<string, unknown>)[field];
      const nums = typeof raw === 'string' ? parseNumbers(raw) : [];
      if (!nums.length || nums.length > 30 || (field === 'densities' && nums.some(n => n <= 0 || !Number.isInteger(n)))) errors.push(`${type} ${i + 1}: enter up to 30 ${field === 'densities' ? 'positive whole-number densities' : 'nonnegative concentrations'}, separated by commas.`);
    });
  }
  if (!errors.length) {
    const densityCount = e.cells.reduce((n, c) => n + parseNumbers(c.densities).length, 0);
    const doseCount = e.compounds.reduce((n, c) => n + parseNumbers(c.concentrations).length, 0);
    if (densityCount * (doseCount + (e.vehicleControls ? 1 : 0)) * e.replicates > 20000) errors.push('This design exceeds 20,000 wells. Split it into smaller experiments.');
  }
  return errors;
}
export function dimensions(format: number) { return format === 384 ? { rows: 16, cols: 24 } : { rows: 8, cols: 12 }; }
export function isEdge(row: number, col: number, rows: number, cols: number) { return row === 0 || col === 0 || row === rows - 1 || col === cols - 1; }
type PlacedBlock = {
  p: number; r: number; c: number; width: number; height: number;
  wells: (Condition & { replicate: number })[];
};
function alignCellPatterns(blocks: PlacedBlock[], occupied: boolean[][], rows: number, cols: number, margin: number) {
  // Greedy placement can strand one cell line in a narrow leftover strip.
  // Reuse the most common complete-cell pattern if it fits on the same plate,
  // without moving other cell lines or changing any dose-series block shapes.
  const cells = new Map<string, PlacedBlock[]>();
  for (const block of blocks) {
    const id = block.wells[0].cellId;
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id)!.push(block);
  }
  type Pattern = { key: string; offsets: { r: number; c: number }[]; height: number; width: number; count: number };
  type Family = { patterns: Map<string, Pattern>; cells: { blocks: PlacedBlock[]; pattern: Pattern }[] };
  const families = new Map<string, Family>();
  for (const cell of cells.values()) {
    // A cell spanning plates must retain its established continuation region.
    if (cell.some(block => block.p !== cell[0].p)) continue;
    const recipe = JSON.stringify(cell.map(block => [block.width, block.height, block.wells.length]));
    if (!families.has(recipe)) families.set(recipe, { patterns: new Map(), cells: [] });
    const family = families.get(recipe)!;
    const top = Math.min(...cell.map(block => block.r)), left = Math.min(...cell.map(block => block.c));
    const offsets = cell.map(block => ({ r: block.r - top, c: block.c - left }));
    const key = JSON.stringify(offsets);
    if (!family.patterns.has(key)) family.patterns.set(key, {
      key, offsets, count: 0,
      height: Math.max(...cell.map(block => block.r + block.height)) - top,
      width: Math.max(...cell.map(block => block.c + block.width)) - left,
    });
    const pattern = family.patterns.get(key)!;
    pattern.count++;
    family.cells.push({ blocks: cell, pattern });
  }
  function mark(block: PlacedBlock, value: boolean) {
    for (let dr = 0; dr < block.height; dr++) for (let dc = 0; dc < block.width; dc++) occupied[block.p][(block.r + dr) * cols + block.c + dc] = value;
  }
  for (const family of families.values()) {
    // Stable ties favor the first cell's pattern, including two-cell designs.
    const preferred = [...family.patterns.values()].sort((a, b) => b.count - a.count)[0];
    for (const cell of family.cells) {
      if (cell.pattern.key === preferred.key) continue;
      const plate = cell.blocks[0].p;
      cell.blocks.forEach(block => mark(block, false));
      let destination: { r: number; c: number } | undefined;
      for (let r = margin; r <= rows - margin - preferred.height && !destination; r++) {
        for (let c = margin; c <= cols - margin - preferred.width; c++) {
          const free = cell.blocks.every((block, i) => {
            const offset = preferred.offsets[i];
            // Include the unassigned tail of a partial rectangular block.
            for (let dr = 0; dr < block.height; dr++) for (let dc = 0; dc < block.width; dc++) {
              if (occupied[plate][(r + offset.r + dr) * cols + c + offset.c + dc]) return false;
            }
            return true;
          });
          if (free) { destination = { r, c }; break; }
        }
      }
      if (destination) cell.blocks.forEach((block, i) => {
        block.r = destination.r + preferred.offsets[i].r;
        block.c = destination.c + preferred.offsets[i].c;
      });
      cell.blocks.forEach(block => mark(block, true));
    }
  }
}
export function makePlan(e: Experiment, kind: LayoutKind): Plan {
  const errors = validateExperiment(e);
  if (errors.length) throw new Error(errors[0]);
  const physical = dimensions(e.format);
  // Use the row-layout algorithm on swapped axes for column rectangles.
  // Transpose the result back into the plate's real well coordinates below.
  const transposed = kind === 'tall';
  const { rows, cols } = transposed ? { rows: physical.cols, cols: physical.rows } : physical;
  const margin = e.excludeEdges ? 1 : 0, height = rows - margin * 2, width = cols - margin * 2;
  const groups: (Condition & { replicate: number })[][] = [];
  let conditions = 0, sampleWells = 0, controlWells = 0;
  for (const cell of e.cells) for (const density of parseNumbers(cell.densities)) {
    for (const [compoundIndex, compound] of e.compounds.entries()) {
      const group: (Condition & { replicate: number })[] = [];
      for (const concentration of parseNumbers(compound.concentrations)) {
        conditions++;
        for (let replicate = 1; replicate <= e.replicates; replicate++) group.push({ id: JSON.stringify([cell.id, density, compound.id, concentration]), cellId: cell.id, cellName: cell.name.trim(), density, compoundId: compound.id, compoundName: compound.name.trim(), compoundIndex, concentration, unit: e.unit, role: 'sample', replicate });
      }
      sampleWells += group.length;
      groups.push(group);
    }
    if (e.vehicleControls) {
      groups.push(Array.from({ length: e.replicates }, (_, i) => ({ id: JSON.stringify([cell.id, density, 'vehicle']), cellId: cell.id, cellName: cell.name.trim(), density, compoundId: 'vehicle', compoundName: 'Vehicle control', compoundIndex: -1, concentration: 0, unit: e.unit, role: 'vehicle', replicate: i + 1 })));
      controlWells += e.replicates;
    }
  }
  const plates: Plate[] = [];
  const occupied: boolean[][] = [];
  type Bounds = { top: number; left: number; bottom: number; right: number };
  const cellBounds = new Map<string, Map<number, Bounds>>();
  const lastPlateForCell = new Map<string, number>();
  const continuationCenters = new Map<string, Map<number, number>>();
  const blocks: PlacedBlock[] = [];
  function newPlate() { plates.push({ wells: Array(rows * cols).fill(null) }); occupied.push(Array(rows * cols).fill(false)); }
  for (const group of groups) {
    const cellId = group[0].cellId;
    if (!cellBounds.has(cellId)) {
      cellBounds.set(cellId, new Map());
      continuationCenters.set(cellId, new Map());
    }
    const boundsByPlate = cellBounds.get(cellId)!;
    const centersByPlate = continuationCenters.get(cellId)!;
    const preferred = kind === 'balanced' ? Math.ceil(Math.sqrt(group.length)) : e.blockWidth;
    const blockW = Math.min(width, preferred, group.length);
    const chunkSize = Math.max(e.replicates, Math.floor(blockW * height / e.replicates) * e.replicates);
    for (let offset = 0; offset < group.length; offset += chunkSize) {
      const chunk = group.slice(offset, offset + chunkSize), blockH = Math.ceil(chunk.length / blockW);
      let found: { p: number; r: number; c: number } | undefined;
      const locate = (p: number) => {
        const localBounds = boundsByPlate.get(p);
        const previousPlate = lastPlateForCell.get(cellId);
        const previousBounds = previousPlate === undefined ? undefined : boundsByPlate.get(previousPlate);
        let best: { p: number; r: number; c: number } | undefined;
        let bestScore: number[] | undefined;
        for (let r = margin; r <= rows - margin - blockH; r++) for (let c = margin; c <= cols - margin - blockW; c++) {
          let free = true;
          for (let dr = 0; dr < blockH && free; dr++) for (let dc = 0; dc < blockW; dc++) if (occupied[p][(r + dr) * cols + c + dc]) { free = false; break; }
          if (!free) continue;
          if (!localBounds && !previousBounds) return { p, r, c };
          let score: number[];
          if (localBounds) {
            // Keep the cell line's footprint compact. In particular, a block at
            // the right edge should continue below itself, not wrap to the left.
            const spanW = Math.max(localBounds.right, c + blockW) - Math.min(localBounds.left, c);
            const spanH = Math.max(localBounds.bottom, r + blockH) - Math.min(localBounds.top, r);
            const gap = Math.max(0, localBounds.left - c - blockW, c - localBounds.right)
              + Math.max(0, localBounds.top - r - blockH, r - localBounds.bottom);
            const targetCenter = centersByPlate.get(p);
            const center = (Math.max(localBounds.right, c + blockW) + Math.min(localBounds.left, c)) / 2;
            score = [spanW * spanH, gap, targetCenter === undefined ? 0 : Math.abs(center - targetCenter), r, c];
          } else {
            // On another plate, resume near the same horizontal position.
            const anchor = previousBounds!;
            score = [Math.abs((c + blockW / 2) - (anchor.left + anchor.right) / 2), r, c];
          }
          const firstDifference = bestScore ? score.findIndex((value, i) => value !== bestScore![i]) : -1;
          if (!bestScore || (firstDifference >= 0 && score[firstDifference] < bestScore[firstDifference])) {
            best = { p, r, c }; bestScore = score;
          }
        }
        return best;
      };
      // Finish the plate holding this cell line before backfilling earlier gaps.
      const previousPlate = lastPlateForCell.get(cellId);
      if (previousPlate !== undefined) found = locate(previousPlate);
      for (let p = 0; p < plates.length && !found; p++) if (p !== previousPlate) found = locate(p);
      if (!found) { newPlate(); found = locate(plates.length - 1); }
      if (!found) throw new Error('This block cannot fit. Increase the block width or reduce replicates.');
      const { p, r, c } = found;
      const bounds = boundsByPlate.get(p);
      if (!bounds && previousPlate !== undefined) {
        const previousBounds = boundsByPlate.get(previousPlate)!;
        centersByPlate.set(p, (previousBounds.left + previousBounds.right) / 2);
      }
      boundsByPlate.set(p, {
        top: Math.min(bounds?.top ?? r, r), left: Math.min(bounds?.left ?? c, c),
        bottom: Math.max(bounds?.bottom ?? r + blockH, r + blockH), right: Math.max(bounds?.right ?? c + blockW, c + blockW),
      });
      lastPlateForCell.set(cellId, p);
      for (let dr = 0; dr < blockH; dr++) for (let dc = 0; dc < blockW; dc++) occupied[p][(r + dr) * cols + c + dc] = true;
      blocks.push({ p, r, c, width: blockW, height: blockH, wells: chunk });
    }
  }
  alignCellPatterns(blocks, occupied, rows, cols, margin);
  for (const { p, r, c, width: blockW, wells } of blocks) wells.forEach((condition, i) => {
    const layoutRow = r + Math.floor(i / blockW), layoutCol = c + i % blockW;
    const row = transposed ? layoutCol : layoutRow, col = transposed ? layoutRow : layoutCol;
    plates[p].wells[row * physical.cols + col] = { ...condition, row, col, address: `${String.fromCharCode(65 + row)}${col + 1}`, plate: p + 1 };
  });
  return { kind, plates, conditions, sampleWells, controlWells, usable: height * width, rows: physical.rows, cols: physical.cols, blocks: blocks.length };
}
export function csvForPlan(plan: Plan, e: Experiment, options: { levels?: boolean; plateCompound?: boolean } = {}): string {
  const quote = (v: unknown) => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const rows: unknown[][] = [['Experiment', 'Layout', 'Plate', 'Well', 'Role', 'Cell line', options.levels ? 'Density level' : 'Cells per well', 'Compound ID', 'Compound', options.levels ? 'Concentration level' : 'Concentration', 'Unit', 'Replicate', 'Condition ID', ...(options.plateCompound ? ['Plate compound ID', 'Plate compound', 'Batch within compound'] : [])]];
  plan.plates.forEach((plate, p) => plate.wells.forEach((well, index) => {
    const row = Math.floor(index / plan.cols), col = index % plan.cols;
    const control = well?.role === 'positive' || well?.role === 'negative';
    const values = well ? [e.name, plan.kind, p + 1, well.address, well.role, well.cellName, well.density, well.role === 'sample' ? `D${well.compoundIndex + 1}` : well.role === 'positive' ? 'PC' : well.role === 'negative' ? 'NC' : 'VC', well.compoundName, control ? '' : well.concentration, options.levels || control ? '' : well.unit, well.replicate, well.id] : [e.name, plan.kind, p + 1, `${String.fromCharCode(65 + row)}${col + 1}`, e.excludeEdges && isEdge(row, col, plan.rows, plan.cols) ? 'excluded' : 'empty', '', '', '', '', '', '', '', ''];
    if (options.plateCompound) values.push(plate.compoundIndex === undefined ? '' : `D${plate.compoundIndex + 1}`, plate.compoundName ?? '', plate.batch ?? '');
    rows.push(values);
  }));
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
}
