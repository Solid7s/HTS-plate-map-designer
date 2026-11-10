'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronLeft, ChevronRight, Grid2X2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { colors, csvForPlan, formatCoveragePercent, getWellCoverage, isEdge } from '@/lib/planner';
import type { Experiment, LayoutKind, Plan, Well } from '@/lib/planner';
import { buildSimpleDesign, defaultSimpleSetup, simpleFields } from '@/lib/simple-planner';
import type { SimpleSetup } from '@/lib/simple-planner';
import LocalAiPlanner from '@/components/local-ai-planner';
import './simple.css';

const STORAGE = 'hts-plate-map-designer.simple.v1';
const layouts: { kind: LayoutKind; name: string; description: string }[] = [
  { kind: 'balanced', name: 'Compact squares', description: 'Square replicate sets; one compound per plate.' },
  { kind: 'wide', name: 'Row rectangles', description: 'One-well-wide replicate sets; one compound per plate.' },
  { kind: 'tall', name: 'Column rectangles', description: 'One-row-high replicate sets, transposed from row rectangles.' },
];
type ColorMode = 'cell' | 'compound' | 'density' | 'concentration';
const controlColors = { positive: '#c17296', negative: '#667f97' };
const colorAt = (index: number) => colors[index] ?? `hsl(${(index * 137.508 + 20) % 360} 44% 55%)`;
function wellColor(well: Well, mode: ColorMode, experiment: Experiment) {
  if (well.role === 'positive' || well.role === 'negative') return controlColors[well.role];
  return colorAt(colorIndex(well, mode, experiment));
}
function colorIndex(well: Well, mode: ColorMode, experiment: Experiment) {
  if (mode === 'cell') return experiment.cells.findIndex(cell => cell.id === well.cellId);
  if (mode === 'compound') return well.compoundIndex;
  return (mode === 'density' ? well.density : well.concentration) - 1;
}
function wellDescription(well: Well) {
  return `${well.cellName} · Density ${well.density} · ${well.compoundName}${well.role === 'sample' ? ` · Concentration ${well.concentration}` : ''} · Replicate ${well.replicate}`;
}
function exportPlan(plan: Plan, experiment: Experiment) {
  const url = URL.createObjectURL(new Blob([csvForPlan(plan, experiment, { levels: true, plateCompound: true })], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `quick-screen-${experiment.format}w-${plan.kind}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LayoutPreview({ plan, experiment, mode, pending }: { plan: Plan; experiment: Experiment; mode: ColorMode; pending: boolean }) {
  const [plateIndex, setPlateIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const plate = plan.plates[plateIndex];
  const coverage = getWellCoverage(plan, plateIndex)!;
  const layout = layouts.find(item => item.kind === plan.kind)!;
  const selection = selected === null ? null : plate.wells[selected];
  const compoundPlates = plan.plates.map((item, index) => ({ item, index })).filter(({ item }) => item.compoundId === plate.compoundId);
  const filled = plate.wells.filter((well): well is Well => !!well);
  const cellCount = new Set(filled.map(well => well.cellId)).size;
  const densityCount = new Set(filled.map(well => `${well.cellId}:${well.density}`)).size;
  const roleCounts = (role: Well['role']) => filled.filter(well => well.role === role).length;
  const move = (index: number) => { setPlateIndex(index); setSelected(null); };
  const step = (direction: number) => { setPlateIndex(index => Math.max(0, Math.min(plan.plates.length - 1, index + direction))); setSelected(null); };
  return <article className="quick-map" aria-label={layout.name}>
    <div className="quick-map-heading"><div><h3>{layout.name}</h3><p>{layout.description}</p></div><span className="quick-plate-total">{plan.plates.length} {plan.plates.length === 1 ? 'plate' : 'plates'}</span></div>
    <div className="quick-compound-selector"><label>Test compound <select aria-label="Test compound" value={plate.compoundIndex} onChange={event => move(plan.plates.findIndex(item => item.compoundIndex === Number(event.target.value)))}>{experiment.compounds.map((compound, index) => <option key={compound.id} value={index}>D{index + 1} · {compound.name}</option>)}</select></label></div>
    <div className="quick-plate-nav">
      <button className="tiny-button" aria-label="Previous plate" disabled={plateIndex === 0} onClick={() => step(-1)}><ChevronLeft size={17} /></button>
      <label>Batch <select aria-label="Plate within compound" value={plateIndex} onChange={event => move(Number(event.target.value))}>{compoundPlates.map(({ item, index }) => <option key={index} value={index}>{item.batch}</option>)}</select> of {compoundPlates.length}</label><small>Plate {plateIndex + 1} / {plan.plates.length}</small>
      <button className="tiny-button" aria-label="Next plate" disabled={plateIndex === plan.plates.length - 1} onClick={() => step(1)}><ChevronRight size={17} /></button>
    </div>
    <div className="quick-plate-context"><strong>{cellCount} cell {cellCount === 1 ? 'line' : 'lines'}{densityCount !== cellCount ? ` · ${densityCount} cell/density groups` : ''}</strong><span>{roleCounts('sample')} drug wells · {roleCounts('positive')} PC · {roleCounts('negative')} NC</span></div>
    <div className="quick-plate-scroll">
      <div className={`plate-frame ${experiment.format === 384 ? 'dense' : ''}`}>
        <div className="plate-grid" style={{ '--cols': plan.cols } as CSSProperties}>
          <span className="orientation-mark">◢</span>
          {Array.from({ length: plan.cols }, (_, col) => <span className="axis-label" key={`col-${col}`}>{col + 1}</span>)}
          {Array.from({ length: plan.rows }, (_, row) => <div className="plate-row" key={row}>
            <span className="axis-label">{String.fromCharCode(65 + row)}</span>
            {Array.from({ length: plan.cols }, (_, col) => {
              const index = row * plan.cols + col, well = plate.wells[index];
              const excluded = experiment.excludeEdges && isEdge(row, col, plan.rows, plan.cols);
              const address = `${String.fromCharCode(65 + row)}${col + 1}`;
              const description = `${address} · ${well ? wellDescription(well) : excluded ? 'Excluded perimeter' : 'Empty well'}`;
              return <button key={col} className={`well ${well ? 'filled' : ''} ${excluded ? 'excluded' : ''} ${selected === index ? 'selected' : ''}`}
                title={description} aria-label={description} aria-pressed={selected === index}
                style={{ '--well-color': well ? wellColor(well, mode, experiment) : '#f1f3f2' } as CSSProperties}
                onClick={() => setSelected(index)}>{well ? well.role === 'positive' ? 'PC' : well.role === 'negative' ? 'NC' : `D${well.compoundIndex + 1}` : excluded ? '×' : '·'}</button>;
            })}
          </div>)}
        </div>
      </div>
    </div>
    <div className="quick-coverage">
      <div><span>This plate</span><strong className="quick-plate-percent">{formatCoveragePercent(coverage.plate.percent)}%</strong><small>{coverage.plate.filled} / {coverage.plate.usable} usable wells</small></div>
      <div><span>All plates</span><strong className="quick-overall-percent">{formatCoveragePercent(coverage.overall.percent)}%</strong><small>{coverage.overall.filled} / {coverage.overall.usable} usable wells</small></div>
    </div>
    <p className="quick-layout-totals"><strong>{(plan.sampleWells + plan.controlWells).toLocaleString()} wells</strong> across this layout · {plan.sampleWells.toLocaleString()} drug + {plan.controlWells.toLocaleString()} control</p>
    <div className="quick-well-detail" aria-live="polite">{selected === null ? 'Select any well to see its complete condition.' : <><strong>{String.fromCharCode(65 + Math.floor(selected / plan.cols))}{selected % plan.cols + 1}</strong><span>{selection ? wellDescription(selection) : experiment.excludeEdges && isEdge(Math.floor(selected / plan.cols), selected % plan.cols, plan.rows, plan.cols) ? 'Excluded perimeter well' : 'Empty well'}</span><button className="tiny-button" aria-label="Close well details" onClick={() => setSelected(null)}>×</button></>}</div>
    <button className="secondary-button quick-export" disabled={pending} onClick={() => exportPlan(plan, experiment)}><ArrowDownToLine size={15} /> Export this layout <span>CSV · all plates</span></button>
  </article>;
}

export default function SimplePage() {
  const [draft, setDraft] = useState<SimpleSetup>(defaultSimpleSetup);
  const [generated, setGenerated] = useState(defaultSimpleSetup);
  const [generation, setGeneration] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<ColorMode>('cell');
  const [saveState, setSaveState] = useState('Local planning · no account needed');
  const [design, setDesign] = useState(() => buildSimpleDesign(defaultSimpleSetup));
  const experiment = design.experiment!;
  const plans = design.plans;
  const pending = JSON.stringify(draft) !== JSON.stringify(generated);
  const total = plans[0];
  const legendCount = mode === 'cell' ? Number(generated.cellLines) : mode === 'compound' ? Number(generated.compounds) : mode === 'density' ? Number(generated.densities) : Number(generated.concentrations);
  const legendLabel = mode === 'cell' ? 'Cell line' : mode === 'compound' ? 'Compound' : mode === 'density' ? 'Density' : 'Concentration';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const saved = { ...defaultSimpleSetup, ...parsed };
          const result = buildSimpleDesign(saved);
          if (!result.errors.length) { setDraft(saved); setGenerated(saved); setDesign(result); setGeneration(value => value + 1); setSaveState('Last quick setup restored from this device'); }
          else setSaveState('Saved setup no longer fits with controls; the default screen is shown');
        }
      }
    } catch { setSaveState('Device storage unavailable · CSV exports still work'); }
  }, []);

  function applySetup(setup: SimpleSetup) {
    const result = buildSimpleDesign(setup);
    setErrors(result.errors);
    if (!result.experiment) return result.errors;
    setDraft({ ...setup }); setGenerated({ ...setup }); setDesign(result); setGeneration(value => value + 1);
    try { localStorage.setItem(STORAGE, JSON.stringify(setup)); setSaveState('Quick setup saved on this device'); }
    catch { setSaveState('Device storage unavailable · CSV exports still work'); }
    return [];
  }
  function generate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); applySetup(draft); }
  function update(patch: Partial<SimpleSetup>) { setDraft(previous => ({ ...previous, ...patch })); setErrors([]); }

  return <div className="quick-app">
    <header className="topbar">
      <a className="brand" href="/simple"><span className="brand-icon"><Grid2X2 size={21} /></span><span>HTS<span className="brand-divider">/</span><span className="brand-sub">plate map designer</span></span></a>
      <a className="secondary-button" href="/"><SlidersHorizontal size={14} /><span>Detailed designer</span></a>
    </header>
    <main className="quick-main">
      <div className="quick-intro"><div className="eyebrow">QUICK PLANNER</div><h1>Your screen, simplified.</h1><p>Compare cell lines on the same compound, with controls on every plate.</p></div>
      <LocalAiPlanner current={draft} onApply={applySetup} />
      <form className="quick-form" onSubmit={generate} noValidate>
        <div className="quick-form-heading"><h2><span>01</span> Describe your screen</h2><button type="button" className="secondary-button" onClick={() => applySetup({ ...defaultSimpleSetup, cellLines: '20', compounds: '40', format: 384 })}>Try 20 cells × 40 compounds</button></div>
        <div className="quick-fields">{simpleFields.map((field, index) => <label className="quick-field" key={field.key} htmlFor={`quick-${field.key}`}>
          <span>{field.label}</span><small>{field.detail}</small>
          <div className="quick-number"><input id={`quick-${field.key}`} type="number" inputMode="numeric" min="1" max={field.max} step="1" value={draft[field.key]} onChange={event => update({ [field.key]: event.target.value })} aria-describedby={`hint-${field.key}`} />{field.key === 'replicates' && <b>×</b>}</div>
          <small id={`hint-${field.key}`}>1–{field.max}{index === 1 || index === 3 ? ' levels' : ''}</small>
        </label>)}</div>
        <div className="quick-form-footer">
          <fieldset className="quick-format"><legend>Plate format</legend><div>{([96, 384] as const).map(format => <button type="button" key={format} aria-pressed={draft.format === format} className={draft.format === format ? 'active' : ''} onClick={() => update({ format })}>{format}-well</button>)}</div></fieldset>
          <label className="quick-edge"><input type="checkbox" checked={draft.excludeEdges} onChange={event => update({ excludeEdges: event.target.checked })} /><span>Exclude outer wells<small>{draft.excludeEdges ? draft.format === 96 ? 60 : 308 : draft.format} usable wells per plate</small></span></label>
          <label className="quick-edge quick-controls"><input type="checkbox" checked={draft.screenControls !== false} onChange={event => update({ screenControls: event.target.checked })} /><span>Positive + negative controls<small>{draft.replicates || '—'} of each per cell line / density / plate</small></span></label>
          <button type="submit" className="primary-button quick-generate"><Sparkles size={17} /> Generate maps <ArrowRight size={16} /></button>
        </div>
        <p className="quick-level-note">Density and concentration numbers represent <strong>levels</strong>, not cells/well or µM. For example, 2 densities creates “Density 1” and “Density 2” for every cell line.</p>
        {errors.length > 0 && <div className="error-banner" role="alert"><strong>Check your counts</strong>{errors.map(error => <p key={error}>{error}</p>)}</div>}
      </form>
      <section className="quick-results" aria-labelledby="results-heading">
        <div className="quick-results-heading"><div><h2 id="results-heading"><span>02</span> Compare your maps</h2><p>One compound per plate. All cell lines are repeated across compounds.</p></div><label className="quick-color">Color by <select value={mode} onChange={event => setMode(event.target.value as ColorMode)}><option value="cell">Cell line</option><option value="compound">Compound</option><option value="density">Density level</option><option value="concentration">Concentration level</option></select></label></div>
        <div className="quick-summary" aria-live="polite"><span><strong>{total.conditions.toLocaleString()}</strong> drug conditions</span><span><strong>{total.sampleWells.toLocaleString()}</strong> drug wells</span><span className="quick-equation">{generated.cellLines} cells × {generated.densities} densities × {generated.compounds} compounds × {generated.concentrations} concentrations × {generated.replicates} replicates</span></div>
        <div className="quick-format-comparison"><span>Plate counts for this screen:</span>{design.comparison.map(item => <strong key={item.format}>{item.format}-well: {item.minimum === item.maximum ? item.minimum : `${item.minimum}–${item.maximum}`} plates</strong>)}<small>Across the three layouts, with the selected edge and control settings.</small></div>
        <p className="quick-control-note">{generated.screenControls !== false ? `${generated.replicates} positive + ${generated.replicates} negative control wells accompany every cell line and density on each plate. Controls are shared across its concentration levels on that plate and repeated on continuation plates.` : 'Positive and negative controls are turned off.'} Controls count toward the totals and coverage below.</p>
        {pending && <p className="quick-pending" role="status">Inputs changed. Select <strong>Generate maps</strong> to update these results and exports.</p>}
        <div className={`quick-map-grid ${pending ? 'pending' : ''}`}>{plans.map(plan => <LayoutPreview key={`${generation}-${plan.kind}-${JSON.stringify(generated)}`} plan={plan} experiment={experiment} mode={mode} pending={pending} />)}</div>
        <div className="quick-legend" aria-label="Map legend">{Array.from({ length: legendCount }, (_, i) => <span key={i}><i style={{ background: colorAt(i) }} />{legendLabel} {i + 1}</span>)}{generated.screenControls !== false && <><span><i style={{ background: controlColors.positive }} />PC · Positive control</span><span><i style={{ background: controlColors.negative }} />NC · Negative control</span></>}<span><i className="quick-empty" />Empty</span>{generated.excludeEdges && <span><i className="quick-excluded" />Excluded</span>}</div>
        <p className="quick-results-note">D1, D2, … identify the test compound; PC and NC are control placeholders for you to define. Replicate sets stay intact. A cell line’s full dose series and controls stay on the same plate when they fit. Larger series continue with fresh controls. Cell positions repeat across compounds. Select a well for its cell line, density, dose, and replicate.</p>
      </section>
      <footer className="quick-footer"><span><Check size={14} />{saveState}</span><a href="/">Need names, actual values, or vehicle controls? Open the detailed designer <ArrowRight size={14} /></a></footer>
    </main>
  </div>;
}
