import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimpleExperiment, buildSimpleDesign, defaultSimpleSetup } from '../lib/simple-planner.ts';
import { makeCompoundPlan } from '../lib/compound-planner.ts';
import { defaultExperiment, makePlan, parseNumbers, validateExperiment, csvForPlan, isEdge, getWellCoverage, formatCoveragePercent } from '../lib/planner.ts';
const kinds = ['balanced', 'wide', 'tall'];
const multiConditionExperiment = {
  ...defaultExperiment,
  cells: defaultExperiment.cells.map(c => ({ ...c, densities: '2500, 5000' })),
  compounds: defaultExperiment.compounds.map(c => ({ ...c, concentrations: '0.1, 1, 10' })),
};
function audit(e, plan) {
  const actual = new Map();
  const expected = new Map();
  for (const cell of e.cells) for (const density of parseNumbers(cell.densities)) {
    for (const compound of e.compounds) for (const dose of parseNumbers(compound.concentrations)) expected.set(JSON.stringify([cell.id, density, compound.id, dose]), e.replicates);
    if (e.vehicleControls) expected.set(JSON.stringify([cell.id, density, 'vehicle']), e.replicates);
  }
  for (const [p, plate] of plan.plates.entries()) {
    assert.equal(plate.wells.length, e.format);
    const addresses = new Set();
    for (const [i, well] of plate.wells.entries()) if (well) {
      assert.equal(well.plate, p + 1);
      assert.equal(well.row * plan.cols + well.col, i);
      assert.equal(addresses.has(well.address), false);
      addresses.add(well.address);
      if (e.excludeEdges) assert.equal(isEdge(well.row, well.col, plan.rows, plan.cols), false);
      const reps = actual.get(well.id) ?? new Set();
      assert.equal(reps.has(well.replicate), false, 'a replicate was placed twice');
      reps.add(well.replicate); actual.set(well.id, reps);
    }
  }
  assert.equal(actual.size, expected.size);
  for (const [id, count] of expected) assert.deepEqual([...actual.get(id)].sort(), Array.from({ length: count }, (_, i) => i + 1));
  assert.equal([...expected.values()].reduce((a, b) => a + b, 0), plan.sampleWells + plan.controlWells);
}
test('all combinations appear exactly once per replicate across formats, shapes, and exclusions', () => {
  for (const format of [96, 384]) for (const excludeEdges of [false, true]) for (const replicates of [1, 2, 3, 6]) for (const blockWidth of [1, 3, 6, format === 96 ? 12 : 24]) for (const kind of kinds) {
    const e = { ...multiConditionExperiment, format, excludeEdges, replicates, blockWidth, vehicleControls: true };
    audit(e, makePlan(e, kind));
  }
});
test('large dose series split onto multiple plates with no loss of conditions', () => {
  const e = { ...defaultExperiment, excludeEdges: true, replicates: 6, blockWidth: 1, compounds: [{ id: 'long', name: 'Long series', concentrations: Array.from({ length: 30 }, (_, i) => i / 10).join(',') }] };
  for (const kind of kinds) { const plan = makePlan(e, kind); assert.ok(plan.plates.length > 1); audit(e, plan); }
});
test('new examples use one density and concentration, while multi-value designs remain supported', () => {
  const p = makePlan(defaultExperiment, 'balanced');
  assert.ok(defaultExperiment.cells.every(c => parseNumbers(c.densities).length === 1));
  assert.ok(defaultExperiment.compounds.every(c => parseNumbers(c.concentrations).length === 1));
  assert.equal(p.conditions, 4); assert.equal(p.sampleWells, 12); assert.equal(p.plates.length, 1);
  const multi = makePlan(multiConditionExperiment, 'balanced');
  assert.equal(multi.conditions, 24); assert.equal(multi.sampleWells, 72);
  assert.deepEqual(parseNumbers('0.1, 1; 10 1 1e1'), [0.1, 1, 10]);
  assert.deepEqual(parseNumbers('1, bad'), []);
});
test('layout choice and slider actually change assignments', () => {
  const a = makePlan(multiConditionExperiment, 'balanced'); const b = makePlan(multiConditionExperiment, 'wide');
  const c = makePlan({ ...multiConditionExperiment, blockWidth: 4 }, 'wide');
  assert.notDeepEqual(a.plates, b.plates); assert.notDeepEqual(b.plates, c.plates);
});
test('invalid imported values and oversized designs are rejected before planning', () => {
  for (const value of [null, {}, { ...defaultExperiment, cells: [null] }, { ...defaultExperiment, replicates: 0 }, { ...defaultExperiment, cells: [{ id: 'a', name: 'Cell', densities: '-1' }] }, { ...defaultExperiment, cells: [{ id: 'a', name: 'Cell', densities: '1.5' }] }, { ...defaultExperiment, compounds: [{ id: 'a', name: 'Drug', concentrations: 'Infinity' }] }]) assert.ok(validateExperiment(value).length > 0);
  const huge = { ...multiConditionExperiment, replicates: 6, cells: Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: 'Cell', densities: Array.from({ length: 30 }, (_, j) => j + 1).join(',') })) };
  assert.ok(validateExperiment(huge).length > 0);
});
test('CSV exports every position, quotes text, neutralizes formula cells, and identifies excluded wells', () => {
  const e = { ...defaultExperiment, name: '=MYFORMULA', excludeEdges: true, cells: [{ id: 'c', name: 'Cell, "quoted"', densities: '5000' }] };
  const p = makePlan(e, 'balanced'), csv = csvForPlan(p, e);
  assert.equal(csv.split('\r\n').length, p.plates.length * e.format + 1);
  assert.ok(csv.includes('"\'=MYFORMULA"')); assert.ok(csv.includes('Cell, ""quoted""'));
  assert.ok(csv.includes('"A1","excluded"'));
});

test('Desktop 3.png geometry: narrow row blocks keep the orange cell line on the right', () => {
  const e = { ...defaultExperiment, excludeEdges: true, blockWidth: 1,
    cells: Array.from({ length: 7 }, (_, i) => ({ id: `c${i + 1}`, name: `Cell line ${i + 1}`, densities: '2500' })),
    compounds: Array.from({ length: 4 }, (_, i) => ({ id: `d${i + 1}`, name: `Compound ${i + 1}`, concentrations: '1' })),
  };
  const plan = makePlan(e, 'wide');
  audit(e, plan);
  assert.equal(plan.plates.length, 2, 'grouping should not add a plate to the reference design');
  assert.equal(plan.plates[0].wells.filter(Boolean).length, 60);
  const orange = plan.plates[0].wells.filter(w => w?.cellId === 'c3');
  assert.equal(orange.length, 12);
  assert.deepEqual(orange.map(w => w.address), ['B10', 'B11', 'C10', 'C11', 'D10', 'D11', 'E10', 'E11', 'F10', 'F11', 'G10', 'G11']);
  assert.ok(orange.filter(w => w.compoundIndex >= 2).every(w => w.row >= 4));
});

test('Desktop 1.png geometry: the purple cell line uses the matching block at the far right', () => {
  const e = { ...defaultExperiment, excludeEdges: true, blockWidth: 1, replicates: 2,
    cells: Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, name: `Cell line ${i + 1}`, densities: '2500' })),
    compounds: Array.from({ length: 5 }, (_, i) => ({ id: `d${i + 1}`, name: `Compound ${i + 1}`, concentrations: '1' })),
  };
  const plan = makePlan(e, 'tall');
  audit(e, plan);
  assert.equal(plan.plates.length, 1);
  const purple = plan.plates[0].wells.filter(w => w?.cellId === 'c2');
  assert.deepEqual(purple.map(w => w.address), ['B10', 'B11', 'C10', 'C11', 'D10', 'D11', 'E10', 'E11', 'F10', 'F11']);
  const startColumns = { c1: 1, c2: 9, c3: 3, c4: 5, c5: 7 };
  for (const well of plan.plates[0].wells.filter(Boolean)) {
    assert.equal(well.row, well.compoundIndex + 1);
    assert.equal(well.col, startColumns[well.cellId] + well.replicate - 1);
  }
  assert.ok(plan.plates[0].wells.slice(6 * 12, 7 * 12).every(w => w === null), 'row G should be free');
  assert.equal(getWellCoverage(plan, 0).plate.filled, 50);
  assert.equal(formatCoveragePercent(getWellCoverage(plan, 0).plate.percent), '83.3');
});

test('matching complete cell-line patterns also fill available space with two cells and on 384-well plates', () => {
  for (const [format, replicates, compoundCount] of [[96, 2, 5], [384, 1, 13]]) for (const cellCount of [2, 5]) {
    const e = { ...defaultExperiment, format, excludeEdges: true, blockWidth: 1, replicates,
      cells: Array.from({ length: cellCount }, (_, i) => ({ id: `c${i}`, name: `Cell ${i}`, densities: '2500' })),
      compounds: Array.from({ length: compoundCount }, (_, i) => ({ id: `d${i}`, name: `Drug ${i}`, concentrations: '1' })),
    };
    const plan = makePlan(e, 'tall');
    audit(e, plan);
    assert.equal(plan.plates.length, 1);
    for (const cell of e.cells) {
      const wells = plan.plates[0].wells.filter(w => w?.cellId === cell.id);
      const left = Math.min(...wells.map(w => w.col));
      for (const well of wells) {
        assert.equal(well.row, well.compoundIndex + 1);
        assert.equal(well.col - left, well.replicate - 1);
      }
    }
  }
});

test('pattern alignment preserves density levels, doses, controls and partial-block blanks in every layout', () => {
  for (const [kind, format, replicates] of [['wide', 96, 1], ['tall', 96, 1], ['balanced', 384, 3]]) {
    const e = { ...defaultExperiment, format, excludeEdges: true, replicates, blockWidth: 2, vehicleControls: true,
      cells: Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, name: `Cell ${i}`, densities: `${1000 * (i + 1)},${5000 * (i + 1)}` })),
      compounds: [{ id: 'd0', name: 'Drug 1', concentrations: '0.1,1' }, { id: 'd1', name: 'Drug 2', concentrations: '1' }],
    };
    const plan = makePlan(e, kind);
    audit(e, plan);
    assert.equal(plan.plates.length, 1);
    const patterns = e.cells.map(cell => {
      const wells = plan.plates[0].wells.filter(w => w?.cellId === cell.id);
      const top = Math.min(...wells.map(w => w.row)), left = Math.min(...wells.map(w => w.col));
      if (kind === 'balanced') for (const density of parseNumbers(cell.densities)) for (const compoundId of ['d1', 'vehicle']) {
        const block = wells.filter(w => w.density === density && w.compoundId === compoundId);
        const r = Math.min(...block.map(w => w.row)), c = Math.min(...block.map(w => w.col));
        assert.equal(plan.plates[0].wells[(r + 1) * plan.cols + c + 1], null, 'the fourth slot of a triplicate block must remain blank');
      }
      return wells.map(w => [w.row - top, w.col - left, parseNumbers(cell.densities).indexOf(w.density), w.compoundId, w.concentration, w.replicate]);
    });
    for (const pattern of patterns) assert.deepEqual(pattern, patterns[0]);
  }
});

test('row overflow onto a new plate retains a cell line’s horizontal region when space permits', () => {
  const e = { ...defaultExperiment, excludeEdges: true, blockWidth: 1,
    cells: [{ id: 'first', name: 'First', densities: '1000, 2000, 3000, 4000' }, { id: 'second', name: 'Second', densities: '1000, 2000' }],
    compounds: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `Drug ${i}`, concentrations: '1' })),
  };
  const plan = makePlan(e, 'wide');
  audit(e, plan);
  assert.equal(plan.plates.length, 2);
  for (const plate of plan.plates) {
    const second = plate.wells.filter(w => w?.cellId === 'second');
    assert.equal(second.length, 12);
    assert.ok(second.every(w => w.col >= 7), 'right-side cell line moved to the left');
  }
});

test('column blocks transpose row blocks including replicate order and partial-block blanks', () => {
  for (const format of [96, 384]) for (const excludeEdges of [false, true]) {
    const e = { ...defaultExperiment, format, excludeEdges, blockWidth: 6,
      cells: [{ id: 'c1', name: 'Cell', densities: '2500' }],
      compounds: [{ id: 'd1', name: 'Drug', concentrations: '0.1, 1, 10' }],
    };
    const rowPlan = makePlan(e, 'wide'), columnPlan = makePlan(e, 'tall');
    audit(e, columnPlan);
    assert.equal(columnPlan.plates.length, 1);
    for (const well of rowPlan.plates[0].wells.filter(Boolean)) {
      const transposed = columnPlan.plates[0].wells[well.col * columnPlan.cols + well.row];
      assert.ok(transposed);
      assert.equal(transposed.id, well.id);
      assert.equal(transposed.replicate, well.replicate);
      assert.equal(transposed.row, well.col);
      assert.equal(transposed.col, well.row);
    }
    const margin = excludeEdges ? 1 : 0;
    // The row block is 2×6 with its last three positions empty.
    // Those blanks must become the bottom three slots of the second column.
    for (let r = margin + 3; r < margin + 6; r++) assert.equal(columnPlan.plates[0].wells[r * columnPlan.cols + margin + 1], null);
  }
});

test('column rectangles also transpose the placement order of separate cell-line blocks', () => {
  const e = { ...defaultExperiment, replicates: 2, blockWidth: 2,
    compounds: [{ id: 'd1', name: 'Drug', concentrations: '1' }],
  };
  const rowPlan = makePlan(e, 'wide'), columnPlan = makePlan(e, 'tall');
  assert.deepEqual(rowPlan.plates[0].wells.filter(Boolean).map(w => w.address), ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual(columnPlan.plates[0].wells.filter(Boolean).map(w => w.address), ['A1', 'B1', 'C1', 'D1']);
  for (const well of rowPlan.plates[0].wells.filter(Boolean)) {
    const transposed = columnPlan.plates[0].wells[well.col * columnPlan.cols + well.row];
    assert.equal(transposed.id, well.id);
    assert.equal(transposed.replicate, well.replicate);
  }
});

test('column layouts retain the physical plate dimensions and export actual well addresses', () => {
  const e = { ...defaultExperiment, blockWidth: 6,
    cells: [{ id: 'c1', name: 'Cell', densities: '2500' }],
    compounds: [{ id: 'd1', name: 'Drug', concentrations: '0.1, 1, 10' }],
  };
  const plan = makePlan(e, 'tall');
  assert.equal(plan.rows, 8); assert.equal(plan.cols, 12);
  const csv = csvForPlan(plan, e);
  assert.ok(csv.includes('"B1","sample","Cell","2500","D1","Drug","0.1","µM","2"'));
  assert.ok(csv.includes('"A2","sample","Cell","2500","D1","Drug","10","µM","1"'));
  const large = { ...multiConditionExperiment, excludeEdges: true, blockWidth: 12, replicates: 6 };
  const overflow = makePlan(large, 'tall');
  assert.ok(overflow.plates.length > 1);
  audit(large, overflow);
});

test('coverage distinguishes the selected plate from the whole multi-plate layout', () => {
  const e = { ...defaultExperiment, excludeEdges: true, blockWidth: 6,
    cells: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Cell ${i}`, densities: '2500' })),
    compounds: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, name: `Drug ${i}`, concentrations: '1' })),
  };
  const plan = makePlan(e, 'tall');
  const first = getWellCoverage(plan, 0), second = getWellCoverage(plan, 1);
  assert.deepEqual(first.plate, { filled: 60, usable: 60, percent: 100 });
  assert.deepEqual(second.plate, { filled: 24, usable: 60, percent: 40 });
  assert.deepEqual(first.overall, { filled: 84, usable: 120, percent: 70 });
  assert.deepEqual(second.overall, first.overall);
});

test('coverage uses the correct usable capacity for both formats and includes controls', () => {
  for (const [format, excludeEdges, capacity] of [[96, false, 96], [96, true, 60], [384, false, 384], [384, true, 308]]) {
    for (const kind of kinds) {
      const e = { ...defaultExperiment, format, excludeEdges, vehicleControls: true };
      const coverage = getWellCoverage(makePlan(e, kind), 0);
      assert.equal(coverage.plate.filled, 18, '12 sample wells plus 6 vehicle wells');
      assert.equal(coverage.plate.usable, capacity);
      assert.equal(coverage.plate.percent, 18 / capacity * 100);
      assert.deepEqual(coverage.overall, coverage.plate);
    }
  }
});

test('blank spaces in rectangular blocks remain unfilled and percentages retain decimals', () => {
  const e = { ...defaultExperiment, cells: defaultExperiment.cells.slice(0, 1), compounds: defaultExperiment.compounds.slice(0, 1) };
  const p = makePlan(e, 'balanced');
  assert.equal(p.blocks, 1);
  const coverage = getWellCoverage(p, 0);
  assert.equal(coverage.plate.filled, 3, 'three assigned wells in a four-position footprint');
  assert.equal(formatCoveragePercent(coverage.plate.percent), '3.1');
  const example = getWellCoverage(makePlan(defaultExperiment, 'balanced'), 0);
  assert.equal(formatCoveragePercent(example.plate.percent), '12.5');
  assert.equal(formatCoveragePercent(100), '100');
  assert.equal(formatCoveragePercent(99.98), '>99.9');
  assert.equal(formatCoveragePercent(0), '0');
});

test('coverage is unavailable for invalid or absent plate selections', () => {
  assert.equal(getWellCoverage(undefined, 0), null);
  const p = makePlan(defaultExperiment, 'balanced');
  assert.equal(getWellCoverage(p, 50), null);
  assert.equal(getWellCoverage(p, -1), null);
  assert.equal(getWellCoverage({ ...p, usable: 0 }, 0), null);
  assert.equal(getWellCoverage({ ...p, plates: [] }, 0), null);
});

test('quick counts expand into every condition and replicate across all candidate layouts', () => {
  for (const format of [96, 384]) for (const excludeEdges of [false, true]) {
    const { experiment, errors } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '3', densities: '2', compounds: '4', concentrations: '3', replicates: '3', format, excludeEdges });
    assert.deepEqual(errors, []);
    for (const kind of kinds) {
      const plan = makePlan(experiment, kind);
      assert.equal(plan.conditions, 72);
      assert.equal(plan.sampleWells, 216);
      audit(experiment, plan);
      if (format === 96) assert.ok(plan.plates.length > 1);
    }
  }
});

test('quick setup rejects empty, fractional, zero, out-of-range, and oversized counts', () => {
  for (const key of ['cellLines', 'densities', 'compounds', 'concentrations', 'replicates']) {
    for (const value of ['', '0', '-1', '1.5', 'Infinity', 'foo', '999', 2, null]) {
      const result = buildSimpleExperiment({ ...defaultSimpleSetup, [key]: value });
      assert.equal(result.experiment, null);
      assert.ok(result.errors.length > 0);
    }
  }
  const result = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '30', densities: '30', compounds: '50', concentrations: '30', replicates: '6' });
  assert.equal(result.experiment, null);
  assert.match(result.errors[0], /20,000/);
});

test('quick defaults use one density and concentration and never overwrite the detailed example', () => {
  const before = structuredClone(defaultExperiment);
  const { experiment, errors } = buildSimpleExperiment(defaultSimpleSetup);
  assert.deepEqual(errors, []);
  assert.ok(experiment.cells.every(cell => cell.densities === '1'));
  assert.ok(experiment.compounds.every(compound => compound.concentrations === '1'));
  assert.equal(makePlan(experiment, 'wide').sampleWells, 24);
  assert.deepEqual(defaultExperiment, before);
});

test('quick CSV exports level identifiers without claiming physical doses or densities', () => {
  const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, densities: '2', concentrations: '3', excludeEdges: true });
  const plan = makePlan(experiment, 'tall');
  const csv = csvForPlan(plan, experiment, { levels: true });
  assert.ok(csv.includes('"Density level"'));
  assert.ok(csv.includes('"Concentration level"'));
  assert.ok(!csv.includes('"Cells per well"'));
  assert.ok(!csv.includes('µM'));
  assert.ok(csv.includes('"A1","excluded"'));
  assert.equal(csv.split('\r\n').length, plan.plates.length * 96 + 1);
});

function auditCompoundScreen(e, plan, controls = true) {
  const samples = new Map();
  let sampleCount = 0, controlCount = 0;
  const expected = new Map();
  for (const cell of e.cells) for (const density of parseNumbers(cell.densities)) for (const compound of e.compounds) for (const dose of parseNumbers(compound.concentrations)) {
    expected.set(JSON.stringify([cell.id, density, compound.id, dose]), e.replicates);
  }
  for (const [index, plate] of plan.plates.entries()) {
    const groups = new Map();
    for (const [position, well] of plate.wells.entries()) {
      if (!well) continue;
      assert.equal(well.plate, index + 1);
      assert.equal(well.row * plan.cols + well.col, position);
      assert.equal(well.address, `${String.fromCharCode(65 + well.row)}${well.col + 1}`);
      if (e.excludeEdges) assert.equal(isEdge(well.row, well.col, plan.rows, plan.cols), false);
      const key = JSON.stringify([well.cellId, well.density]);
      const group = groups.get(key) ?? { sample: 0, positive: new Set(), negative: new Set() };
      if (well.role === 'sample') {
        assert.equal(well.compoundId, plate.compoundId, 'test compounds were mixed on one plate');
        const reps = samples.get(well.id) ?? { plate: index, values: new Set() };
        assert.equal(reps.plate, index, 'a replicate set was split across plates');
        assert.equal(reps.values.has(well.replicate), false);
        reps.values.add(well.replicate); samples.set(well.id, reps);
        group.sample++; sampleCount++;
      } else {
        assert.ok(controls);
        assert.ok(['positive', 'negative'].includes(well.role));
        assert.equal(group[well.role].has(well.replicate), false, 'duplicate control for one cell/density on a plate');
        group[well.role].add(well.replicate); controlCount++;
      }
      groups.set(key, group);
    }
    assert.ok(groups.size > 0, 'empty plate');
    for (const group of groups.values()) {
      assert.ok(group.sample > 0, 'control-only cell/density on a plate');
      for (const role of ['positive', 'negative']) assert.deepEqual([...group[role]].sort(), controls ? Array.from({ length: e.replicates }, (_, i) => i + 1) : []);
    }
  }
  assert.equal(samples.size, expected.size);
  for (const [key, count] of expected) assert.deepEqual([...samples.get(key).values].sort(), Array.from({ length: count }, (_, i) => i + 1));
  assert.equal(plan.sampleWells, sampleCount);
  assert.equal(plan.controlWells, controlCount);
}

test('20 cell lines × 40 compounds includes all matched controls and repeatable compound plates', () => {
  for (const format of [96, 384]) for (const excludeEdges of [false, true]) {
    const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '20', compounds: '40', format, excludeEdges });
    for (const kind of kinds) {
      const p = makeCompoundPlan(experiment, kind);
      auditCompoundScreen(experiment, p);
      assert.equal(p.conditions, 800);
      assert.equal(p.sampleWells, 2400);
      assert.equal(p.controlWells, 4800);
      assert.equal(p.plates.length, format === 384 ? 40 : excludeEdges ? 160 : kind === 'tall' ? 80 : 120);
      if (format === 384) for (const plate of p.plates) assert.equal(new Set(plate.wells.filter(Boolean).map(w => w.cellId)).size, 20);
      const first = p.plates.filter(plate => plate.compoundIndex === 0);
      for (let compoundIndex = 1; compoundIndex < 40; compoundIndex++) {
        const same = p.plates.filter(plate => plate.compoundIndex === compoundIndex);
        assert.equal(same.length, first.length);
        for (let i = 0; i < first.length; i++) {
          const shape = plate => plate.wells.map(w => w ? [w.cellId, w.density, w.concentration, w.role, w.replicate] : null);
          assert.deepEqual(shape(same[i]), shape(first[i]), 'cell positions changed between compounds');
        }
      }
    }
  }
});

test('compound layouts preserve every sample and control across doses, densities, replicates, and edges', () => {
  for (const format of [96, 384]) for (const excludeEdges of [false, true]) for (const replicates of ['1', '2', '3', '6']) for (const controls of [false, true]) {
    const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '3', compounds: '2', densities: '2', concentrations: '4', replicates, format, excludeEdges, screenControls: controls });
    for (const kind of kinds) auditCompoundScreen(experiment, makeCompoundPlan(experiment, kind, controls), controls);
  }
});

test('oversized dose series repeat controls on continuation plates without splitting replicate sets', () => {
  const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '2', compounds: '2', densities: '2', concentrations: '30', replicates: '6', excludeEdges: true });
  for (const kind of kinds) {
    const p = makeCompoundPlan(experiment, kind);
    auditCompoundScreen(experiment, p);
    assert.ok(p.controlWells > 2 * 2 * 2 * 2 * 6, 'continuations need fresh controls');
  }
});

test('compound column rectangles transpose the row pattern and preserve the 1-well setting', () => {
  const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '1', compounds: '1' });
  const row = makeCompoundPlan(experiment, 'wide');
  const column = makeCompoundPlan(experiment, 'tall');
  for (const well of row.plates[0].wells.filter(Boolean)) {
    const transposed = column.plates[0].wells[well.col * column.cols + well.row];
    assert.equal(transposed.id, well.id); assert.equal(transposed.replicate, well.replicate);
  }
  assert.deepEqual(row.plates[0].wells.filter(w => w?.role === 'sample').map(w => w.address), ['A1', 'B1', 'C1']);
});

test('compound CSV distinguishes controls from drug doses and identifies their plate compound', () => {
  const { experiment } = buildSimpleExperiment({ ...defaultSimpleSetup, cellLines: '1', compounds: '2' });
  const p = makeCompoundPlan(experiment, 'wide');
  const csv = csvForPlan(p, experiment, { levels: true, plateCompound: true });
  assert.ok(csv.includes('"Plate compound ID","Plate compound","Batch within compound"'));
  assert.ok(csv.includes('"positive","Cell line 1","1","PC","Positive control","","","1"'));
  assert.ok(csv.includes('"negative","Cell line 1","1","NC","Negative control","","","1"'));
  assert.equal((csv.match(/,"positive",/g) ?? []).length, 6);
  assert.equal((csv.match(/,"negative",/g) ?? []).length, 6);
  assert.equal((csv.match(/"sample"/g) ?? []).length, 6);
  assert.ok(csv.includes('"D2","Compound 2","1"'));
});

test('large-screen planning compares formats and rejects oversized designs including repeated controls', () => {
  const design = buildSimpleDesign({ ...defaultSimpleSetup, cellLines: '20', compounds: '40', format: 384 });
  assert.deepEqual(design.errors, []);
  assert.deepEqual(design.comparison, [{ format: 96, minimum: 80, maximum: 120 }, { format: 384, minimum: 40, maximum: 40 }]);
  const over = buildSimpleDesign({ ...defaultSimpleSetup, cellLines: '30', compounds: '50', concentrations: '2', replicates: '6' });
  assert.equal(over.experiment, null);
  assert.match(over.errors[0], /20,000/);
  // This screen fits the lower bound, but continuation controls exceed it.
  const repeated = buildSimpleDesign({ ...defaultSimpleSetup, cellLines: '5', compounds: '20', concentrations: '30', replicates: '6', excludeEdges: true });
  assert.equal(repeated.experiment, null);
  assert.match(repeated.errors[0], /repeated controls/);
});

// Browser AI is untrusted input: validate independently before generating maps.
const { parseAiProposal, checkAiExtraction, validateAiPrompt, AI_PROMPT_LIMIT } = await import('../lib/ai-experiment.ts');
const aiResult = patch => JSON.stringify({ cellLines: null, densities: null, compounds: null, concentrations: null, replicates: null, format: null, excludeEdges: null, screenControls: null, notes: [], ...patch });
test('AI extraction preserves unspecified settings and never mutates the current experiment', () => {
  const current = { ...defaultSimpleSetup, densities: '2', concentrations: '4', format: 384, screenControls: false };
  const before = structuredClone(current);
  const result = parseAiProposal(aiResult({ cellLines: 6, compounds: 10, replicates: 2 }), current);
  assert.deepEqual(current, before);
  assert.equal(result.setup.densities, '2'); assert.equal(result.setup.concentrations, '4');
  assert.equal(result.setup.format, 384); assert.equal(result.setup.screenControls, false);
  assert.equal(result.setup.cellLines, '6'); assert.equal(result.setup.replicates, '2');
  assert.deepEqual(result.specified, ['cellLines', 'compounds', 'replicates']);
});
test('AI settings produce the same complete 20-by-40 design as manual inputs', () => {
  const result = parseAiProposal(aiResult({ cellLines: 20, compounds: 40, densities: 1, concentrations: 1, replicates: 3, format: 384, excludeEdges: false, screenControls: true }), defaultSimpleSetup);
  assert.deepEqual(result.errors, []);
  const design = buildSimpleDesign(result.setup);
  assert.deepEqual(design.errors, []);
  for (const plan of design.plans) {
    assert.equal(plan.plates.length, 40); assert.equal(plan.sampleWells, 2400); assert.equal(plan.controlWells, 4800);
  }
});
test('AI counts outside supported limits remain visible errors rather than silently clamped', () => {
  for (const patch of [{cellLines:31}, {compounds:51}, {replicates:0}, {densities:-1}, {concentrations:2500}]) {
    assert.ok(parseAiProposal(aiResult(patch), defaultSimpleSetup).errors.length);
  }
  assert.match(parseAiProposal(aiResult({cellLines:30,compounds:50,concentrations:30,replicates:6}),defaultSimpleSetup).errors.join(' '), /20,000/);
});
test('AI rejects malformed, extra, missing, non-integer and mistyped settings', () => {
  for (const text of ['[]','null','{}','```json\n{}\n```','{"cellLines":20', aiResult({cellLines:'20'}),aiResult({cellLines:2.5}),aiResult({format:1536}),aiResult({excludeEdges:'false'}),aiResult({screenControls:1}),aiResult({notes:'fine'}),aiResult({extra:'ignored'}),aiResult({notes:['x'.repeat(501)]})]) {
    assert.throws(() => parseAiProposal(text, defaultSimpleSetup));
  }
});
test('AI keeps unsupported requests as review notes and handles explicit false values', () => {
  const result = parseAiProposal(aiResult({screenControls:false,excludeEdges:false,notes:['Random well placement is not applied.']}), {...defaultSimpleSetup,excludeEdges:true});
  assert.equal(result.setup.screenControls,false); assert.equal(result.setup.excludeEdges,false);
  assert.deepEqual(result.notes,['Random well placement is not applied.']);
  assert.throws(()=>parseAiProposal(aiResult({}),defaultSimpleSetup), /No experiment/);
});
test('AI prompt size is bounded before model inference', () => {
  assert.throws(()=>validateAiPrompt('  '));
  assert.throws(()=>validateAiPrompt('x'.repeat(AI_PROMPT_LIMIT+1)));
  assert.equal(validateAiPrompt('  three cell lines  '), 'three cell lines');
});

test('AI literal checks preserve absent settings and verify explicit counts and options', () => {
  const guessed = aiResult({cellLines:4,densities:10,compounds:3,concentrations:1,replicates:1,format:96,excludeEdges:false,screenControls:true});
  const checked = JSON.parse(checkAiExtraction(guessed,'Six cell lines and ten compounds, in duplicate.'));
  assert.equal(checked.cellLines,6); assert.equal(checked.compounds,10); assert.equal(checked.replicates,2);
  for (const key of ['densities','concentrations','format','excludeEdges','screenControls']) assert.equal(checked[key],null,key);
  const full = JSON.parse(checkAiExtraction(guessed,'20 cell lines, 40 compounds, one density and one concentration, triplicate on 384-well plates. Use the outer wells. Positive and negative controls.'));
  assert.deepEqual(full,{cellLines:20,densities:1,compounds:40,concentrations:1,replicates:3,format:384,excludeEdges:false,screenControls:true,notes:[]});
});
test('AI physical values and unsupported controls require manual review', () => {
  const checked = JSON.parse(checkAiExtraction(aiResult({densities:3000,concentrations:2,screenControls:true}), 'Seed at 3000 cells per well and 2 micromolar. Only negative controls, six wells per plate.'));
  assert.equal(checked.densities,null); assert.equal(checked.concentrations,null); assert.equal(checked.screenControls,null);
  assert.equal(checked.notes.length,3);
  const edges = JSON.parse(checkAiExtraction(aiResult({excludeEdges:false,screenControls:true}), 'Exclude perimeter wells. No controls.'));
  assert.equal(edges.excludeEdges,true); assert.equal(edges.screenControls,false);
  const ambiguous = JSON.parse(checkAiExtraction(aiResult({excludeEdges:true}), 'Do not exclude outer wells.'));
  assert.equal(ambiguous.excludeEdges,null); assert.equal(ambiguous.notes.length,1);
});
