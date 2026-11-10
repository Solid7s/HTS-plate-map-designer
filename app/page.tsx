'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Dna, FlaskConical, Grid2X2, Layers, LayoutGrid, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { colors, csvForPlan, defaultConcentration, defaultDensity, defaultExperiment, dimensions, formatCoveragePercent, getWellCoverage, isEdge, makePlan, parseNumbers, validateExperiment } from '@/lib/planner';
import type { Experiment, LayoutKind, Plan, Well } from '@/lib/planner';

const STORAGE = 'hts-plate-map-designer.v1';
const layouts: { kind: LayoutKind; name: string; description: string }[] = [
  { kind: 'balanced', name: 'Compact squares', description: 'Near-square blocks per dose series' },
  { kind: 'wide', name: 'Row rectangles', description: 'Set the width with the slider' },
  { kind: 'tall', name: 'Column rectangles', description: 'Transposed from row rectangles' },
];
type ColorMode = 'compound' | 'cell' | 'density';
function colorOf(w: Well | null, e: Experiment, mode: ColorMode) {
  if (!w) return '#f1f3f2';
  if (w.role === 'vehicle') return '#b5bec7';
  const index = mode === 'compound' ? w.compoundIndex : mode === 'cell' ? e.cells.findIndex(c => c.id === w.cellId) : [...new Set(e.cells.flatMap(c => parseNumbers(c.densities)))].indexOf(w.density);
  return colors[(Math.max(0, index)) % colors.length];
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function MiniPlate({ plan, e, mode }: { plan: Plan; e: Experiment; mode: ColorMode }) {
  return <div className="mini-plate" style={{ gridTemplateColumns: `repeat(${plan.cols}, 1fr)` }} aria-hidden="true">{plan.plates[0]?.wells.map((w, i) => <i key={i} style={{ background: colorOf(w, e, mode) }} />)}</div>;
}
export default function Page() {
  const [e, setE] = useState<Experiment>(defaultExperiment);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<LayoutKind>('wide');
  const [plateIndex, setPlateIndex] = useState(0);
  const [mode, setMode] = useState<ColorMode>('compound');
  const [selection, setSelection] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [saveState, setSaveState] = useState('Saved on this device');
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<'map' | 'table'>('map');
  const fileInput = useRef<HTMLInputElement>(null);
  const errors = useMemo(() => validateExperiment(e), [e]);
  const plans = useMemo(() => errors.length ? [] : layouts.map(l => makePlan(e, l.kind)), [e, errors]);
  const plan = plans.find(p => p.kind === kind);
  const currentIndex = Math.min(plateIndex, Math.max(0, (plan?.plates.length ?? 1) - 1));
  const plate = plan?.plates[currentIndex];
  const selectedWell = selection === null ? undefined : plate?.wells[selection];
  const dims = dimensions(e.format);
  const blockSpanMax = (kind === 'tall' ? dims.rows : dims.cols) - (e.excludeEdges ? 2 : 0);
  const blockSpan = Math.min(e.blockWidth, blockSpanMax);
  const coverage = useMemo(() => getWellCoverage(plan, currentIndex), [plan, currentIndex]);
  const filename = e.name.trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'experiment';
  const update = (patch: Partial<Experiment>) => { setE(prev => ({ ...prev, ...patch })); setSelection(null); };
  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE); if (saved) { const candidate = JSON.parse(saved); if (!validateExperiment(candidate).length) setE({ ...candidate, blockWidth: defaultExperiment.blockWidth }); else setToast('Saved settings were invalid. The example design is loaded.'); } }
    catch { setSaveState('Device storage unavailable'); }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded && !errors.length) { try { localStorage.setItem(STORAGE, JSON.stringify(e)); setSaveState('Saved on this device'); } catch { setSaveState('Storage unavailable · save a project file'); } } }, [e, loaded, errors]);
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id); } }, [toast]);
  useEffect(() => { if (!help) return; const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') setHelp(false); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [help]);
  async function importProject(file?: File) {
    if (!file) return;
    try { if (file.size > 1_000_000) throw new Error('Choose a project file smaller than 1 MB.'); const candidate = JSON.parse(await file.text()); const issues = validateExperiment(candidate); if (issues.length) throw new Error(issues[0]); setE(candidate); setSelection(null); setPlateIndex(0); setToast('Experiment imported.'); }
    catch (err) { setToast(err instanceof Error ? err.message : 'Could not import this file.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  const legend = mode === 'compound' ? e.compounds.map((c, i) => ({ label: `D${i + 1} · ${c.name}`, color: colors[i % colors.length] })) : mode === 'cell' ? e.cells.map((c, i) => ({ label: c.name, color: colors[i % colors.length] })) : [...new Set(e.cells.flatMap(c => parseNumbers(c.densities)))].map((d, i) => ({ label: `${d.toLocaleString()} cells/well`, color: colors[i % colors.length] }));
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="HTS plate map designer home"><span className="brand-icon"><Grid2X2 size={21} /></span><span>HTS<span className="brand-divider">/</span><span className="brand-sub">plate map designer</span></span></a>
      <div className="top-actions"><a className="secondary-button" href="/simple"><Sparkles size={14} /> Simple mode</a><span className="private-badge"><span /> PERSONAL WORKSPACE</span><button className="icon-button" title="How to use this planner" aria-label="How to use this planner" onClick={() => setHelp(true)}><CircleHelp size={19} /></button></div>
    </header>
    <div className="workspace">
      <aside className="sidebar" id="experiment-setup">
        <div className="sidebar-heading"><SlidersHorizontal size={17} /><h2>Experiment setup</h2><span className="live-badge">LIVE</span></div>
        <section className="setup-section">
          <label className="field-label" htmlFor="experiment-name">EXPERIMENT NAME</label>
          <input id="experiment-name" className="text-input name-input" maxLength={120} value={e.name} onChange={event => update({ name: event.target.value })} />
          <div className="field-label label-space">PLATE FORMAT</div>
          <div className="format-options">{([96, 384] as const).map(format => <button key={format} className={`format-option ${e.format === format ? 'active' : ''}`} aria-pressed={e.format === format} onClick={() => { update({ format, blockWidth: Math.min(e.blockWidth, format === 96 ? 12 : 24) }); setPlateIndex(0); }}><span className={`format-icon format-${format}`}>{Array.from({ length: format === 96 ? 12 : 24 }, (_, i) => <i key={i} />)}</span><strong>{format}<small>well</small></strong><span className="format-size">{format === 96 ? '8 × 12' : '16 × 24'}</span>{e.format === format && <Check size={13} className="format-check" />}</button>)}</div>
        </section>
        <section className="setup-section">
          <div className="section-title"><Dna size={17} /><h3>Cell lines</h3><span className="count-badge">{e.cells.length}</span></div>
          <p className="section-hint">Start with one density; add more with commas.</p>
          <div className="item-list">{e.cells.map((cell, i) => <div className="condition-item" key={cell.id}><div className="item-title"><span className="item-symbol" style={{ background: colors[i % colors.length] + '25', color: colors[i % colors.length] }}>{i + 1}</span><input aria-label={`Cell line ${i + 1} name`} maxLength={80} value={cell.name} onChange={event => update({ cells: e.cells.map(c => c.id === cell.id ? { ...c, name: event.target.value } : c) })} /><button className="tiny-button" aria-label={`Remove cell line ${i + 1}`} disabled={e.cells.length === 1} onClick={() => update({ cells: e.cells.filter(c => c.id !== cell.id) })}><Trash2 size={13} /></button></div><label className="inline-values"><span>Cells/well</span><input aria-label={`Cell line ${i + 1} densities`} value={cell.densities} placeholder={defaultDensity} onChange={event => update({ cells: e.cells.map(c => c.id === cell.id ? { ...c, densities: event.target.value } : c) })} /></label></div>)}</div>
          <button className="add-button" disabled={e.cells.length >= 30} onClick={() => update({ cells: [...e.cells, { id: crypto.randomUUID(), name: `Cell line ${e.cells.length + 1}`, densities: defaultDensity }] })}><Plus size={14} /> Add cell line</button>
        </section>
        <section className="setup-section">
          <div className="section-title"><FlaskConical size={17} /><h3>Compounds</h3><span className="count-badge">{e.compounds.length}</span><select className="unit-select" aria-label="Concentration unit" value={e.unit} onChange={event => update({ unit: event.target.value })}>{['µM', 'nM', 'mM', 'µg/mL', 'ng/mL'].map(u => <option key={u}>{u}</option>)}</select></div>
          <p className="section-hint">Start with one dose; add more with commas.</p>
          <div className="item-list">{e.compounds.map((compound, i) => <div className="condition-item" key={compound.id}><div className="item-title"><span className="drug-dot" style={{ background: colors[i % colors.length] }} /><span className="drug-id">D{i + 1}</span><input aria-label={`Compound ${i + 1} name`} maxLength={80} value={compound.name} onChange={event => update({ compounds: e.compounds.map(c => c.id === compound.id ? { ...c, name: event.target.value } : c) })} /><button className="tiny-button" aria-label={`Remove compound ${i + 1}`} disabled={e.compounds.length === 1} onClick={() => update({ compounds: e.compounds.filter(c => c.id !== compound.id) })}><Trash2 size={13} /></button></div><label className="inline-values"><span>Doses ({e.unit})</span><input aria-label={`Compound ${i + 1} concentrations`} value={compound.concentrations} placeholder={defaultConcentration} onChange={event => update({ compounds: e.compounds.map(c => c.id === compound.id ? { ...c, concentrations: event.target.value } : c) })} /></label></div>)}</div>
          <button className="add-button" disabled={e.compounds.length >= 50} onClick={() => update({ compounds: [...e.compounds, { id: crypto.randomUUID(), name: `Compound ${e.compounds.length + 1}`, concentrations: defaultConcentration }] })}><Plus size={14} /> Add compound</button>
        </section>
        <section className="setup-section">
          <div className="section-title"><Layers size={17} /><h3>Replicates</h3><span className="replicate-value">{e.replicates}×</span></div>
          <input className="range-input" aria-label="Replicate count" type="range" min="1" max="6" value={e.replicates} onChange={event => update({ replicates: +event.target.value })} />
          <div className="range-labels"><span>1 · single</span><strong>{['', 'Single', 'Duplicate', 'Triplicate', 'Quadruplicate', 'Quintuplicate', 'Sextuplicate'][e.replicates]}</strong><span>6</span></div>
          <label className="toggle-row"><span>Exclude outer wells<small>Reserve the plate perimeter</small></span><input type="checkbox" checked={e.excludeEdges} onChange={event => update({ excludeEdges: event.target.checked })} /><i /></label>
          <label className="toggle-row"><span>Vehicle controls<small>{e.replicates} per cell line & density</small></span><input type="checkbox" checked={e.vehicleControls} onChange={event => update({ vehicleControls: event.target.checked })} /><i /></label>
        </section>
        <div className="sidebar-footer"><span className="status-dot" /> Changes update your maps instantly<a className="mobile-setup-link" href="#plate-workspace">Back to map ↑</a></div>
      </aside>
      <main className="main-panel" id="plate-workspace">
        <div className="breadcrumb">WORKSPACE <ChevronRight size={12} /> NEW EXPERIMENT</div>
        <div className="page-heading"><div><div className="eyebrow">LESS PLANNING. MORE DISCOVERY.</div><h1>Every condition.<br className="mobile-break" /> In its place.</h1><p>Design your screen. Explore the possibilities.</p></div><div className="heading-actions"><a className="secondary-button mobile-setup-link" href="#experiment-setup"><SlidersHorizontal size={14} /> Edit setup</a><button className="secondary-button" onClick={() => fileInput.current?.click()} title="Open a saved experiment"><ArrowUpFromLine size={15} /> Import</button><button className="primary-button" disabled={!plan} onClick={() => { if (plan) download(csvForPlan(plan, e), `${filename}-${kind}.csv`, 'text/csv;charset=utf-8'); }}><ArrowDownToLine size={15} /> Export CSV</button><input type="file" accept=".json,application/json" ref={fileInput} className="hidden-input" onChange={event => importProject(event.target.files?.[0])} /></div></div>
        {errors.length > 0 && <div className="error-banner" role="alert"><strong>Check your setup</strong>{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
        <div className="stats-row"><div className="stat"><span>UNIQUE CONDITIONS</span><strong>{plan?.conditions ?? '—'}<small>cell × density × drug × dose</small></strong></div><div className="stat"><span>WELLS REQUIRED</span><strong>{plan ? plan.sampleWells + plan.controlWells : '—'}<small>{plan?.controlWells ? `${plan.controlWells} vehicle wells included` : `${e.replicates} replicates per condition`}</small></strong></div><div className="stat"><span>PLATES IN THIS LAYOUT</span><strong>{plan?.plates.length ?? '—'}<small>{e.format}-well format</small></strong></div><div className="stat utilization" title="Assigned sample and vehicle-control wells divided by usable wells. Excluded outer wells are omitted; empty spaces inside blocks are still unfilled.">
          <span>USABLE WELL COVERAGE</span>
          <strong className="coverage-value">{coverage ? formatCoveragePercent(coverage.plate.percent) : '—'}{coverage && <b>%</b>}</strong>
          <small className="coverage-plate">{coverage ? `Plate ${String(currentIndex + 1).padStart(2, '0')} · ${coverage.plate.filled} / ${coverage.plate.usable} wells` : 'Complete the setup to calculate'}</small>
          {coverage && <>
            <div className="progress-track" role="progressbar" aria-label={`Plate ${currentIndex + 1} usable well coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage.plate.percent} aria-valuetext={`${formatCoveragePercent(coverage.plate.percent)} percent; ${coverage.plate.filled} of ${coverage.plate.usable} usable wells`}><i style={{ width: `${coverage.plate.percent}%` }} /></div>
            <small className="coverage-overall">All plates · {formatCoveragePercent(coverage.overall.percent)}% ({coverage.overall.filled} / {coverage.overall.usable})</small>
          </>}
        </div></div>
        <section className="map-card">
          <div className="map-header"><div className="map-title"><LayoutGrid size={18} /><h2>Plate map</h2><span className="soft-badge">{e.format} wells</span></div><div className="segmented"><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')} aria-pressed={tab === 'map'}>Map</button><button className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')} aria-pressed={tab === 'table'}>Well list</button></div></div>
          <div className="map-toolbar"><div className="plate-nav"><button className="tiny-button" aria-label="Previous plate" disabled={currentIndex === 0} onClick={() => { setPlateIndex(currentIndex - 1); setSelection(null); }}><ChevronLeft size={16} /></button><span>Plate {String(currentIndex + 1).padStart(2, '0')} <small>/ {String(plan?.plates.length ?? 0).padStart(2, '0')}</small></span><button className="tiny-button" aria-label="Next plate" disabled={!plan || currentIndex >= plan.plates.length - 1} onClick={() => { setPlateIndex(currentIndex + 1); setSelection(null); }}><ChevronRight size={16} /></button></div><label className="color-select">Color by <select value={mode} onChange={event => setMode(event.target.value as ColorMode)}><option value="compound">Compound</option><option value="cell">Cell line</option><option value="density">Seeding density</option></select><ChevronDown size={12} /></label></div>
          <div className="width-control"><div><SlidersHorizontal size={17} /><span><strong>Shape your blocks</strong><small>{kind === 'balanced' ? 'Compact squares size their blocks automatically' : kind === 'tall' ? 'Row widths become column heights' : 'Drag to explore rectangular arrangements'}</small></span></div>{kind === 'balanced' ? <><button className="secondary-button" onClick={() => { update({ blockWidth: 1 }); setKind('wide'); setPlateIndex(0); }}>Use 1-well blocks</button><output>Auto</output></> : <><div className="width-slider"><span>{kind === 'tall' ? 'Short' : 'Narrow'}</span><input type="range" min="1" max={blockSpanMax} value={blockSpan} aria-label={kind === 'tall' ? 'Block height' : 'Block width'} onChange={event => update({ blockWidth: +event.target.value })} /><span>{kind === 'tall' ? 'Tall' : 'Wide'}</span></div><output>{blockSpan} {kind === 'tall' ? (blockSpan === 1 ? 'row' : 'rows') : (blockSpan === 1 ? 'well' : 'wells')}</output></>}</div>
          {tab === 'map' ? <div className="plate-scroll"><div className={`plate-frame ${e.format === 384 ? 'dense' : ''}`}><div className="plate-grid" style={{ '--cols': dims.cols } as CSSProperties}><span className="orientation-mark">◢</span>{Array.from({ length: dims.cols }, (_, i) => <span className="axis-label" key={`c${i}`}>{i + 1}</span>)}{Array.from({ length: dims.rows }, (_, row) => <div className="plate-row" key={row}><span className="axis-label">{String.fromCharCode(65 + row)}</span>{Array.from({ length: dims.cols }, (_, col) => { const index = row * dims.cols + col, w = plate?.wells[index] ?? null, excluded = e.excludeEdges && isEdge(row, col, dims.rows, dims.cols); const title = w ? `${w.address} · ${w.cellName} · ${w.density.toLocaleString()} cells/well · ${w.compoundName} · ${w.concentration} ${w.unit} · replicate ${w.replicate}` : `${String.fromCharCode(65 + row)}${col + 1} · ${excluded ? 'Excluded perimeter' : 'Empty well'}`; return <button className={`well ${w ? 'filled' : ''} ${excluded ? 'excluded' : ''} ${selection === index ? 'selected' : ''}`} key={col} title={title} aria-label={title} aria-pressed={selection === index} style={{ '--well-color': colorOf(w, e, mode) } as CSSProperties} onClick={() => setSelection(index)}>{w ? (w.role === 'vehicle' ? 'VC' : `D${w.compoundIndex + 1}`) : excluded ? '×' : '·'}</button>; })}</div>)}</div></div></div> : <div className="well-table-wrap"><table><thead><tr><th>Well</th><th>Cell line</th><th>Cells/well</th><th>Compound</th><th>Dose</th><th>Rep.</th></tr></thead><tbody>{plate?.wells.filter((w): w is Well => !!w).map(w => <tr key={w.address}><td><b>{w.address}</b></td><td>{w.cellName}</td><td>{w.density.toLocaleString()}</td><td><i className="drug-dot" style={{ background: colorOf(w, e, mode) }} />{w.compoundName}</td><td>{w.concentration} {w.unit}</td><td>{w.replicate}</td></tr>)}</tbody></table></div>}
          <div className="legend">{legend.map((l, i) => <span key={i}><i style={{ background: l.color }} />{l.label}</span>)}{e.vehicleControls && <span><i style={{ background: '#b5bec7' }} />Vehicle control</span>}<span><i className="empty-dot" />Empty</span>{e.excludeEdges && <span><i className="excluded-dot" />Excluded</span>}</div>
          <div className={`well-detail ${selectedWell ? 'has-selection' : ''}`} aria-live="polite">{selection === null ? <><span className="detail-icon"><Plus size={15} /></span><span>Select a well to see its cell line, seeding density, dose, and replicate.</span><span className="well-count">{coverage ? `${coverage.plate.filled} / ${coverage.plate.usable} usable wells` : 'Awaiting valid setup'}</span></> : <><span className="well-address">{String.fromCharCode(65 + Math.floor(selection / dims.cols))}{selection % dims.cols + 1}</span>{selectedWell ? <div className="well-details"><span><small>CELL LINE</small>{selectedWell.cellName}</span><span><small>SEEDING DENSITY</small>{selectedWell.density.toLocaleString()} cells/well</span><span><small>TREATMENT</small>{selectedWell.compoundName}</span><span><small>CONCENTRATION</small>{selectedWell.concentration} {selectedWell.unit}</span><span><small>REPLICATE</small>{selectedWell.replicate} of {e.replicates}</span></div> : <span>{e.excludeEdges && isEdge(Math.floor(selection / dims.cols), selection % dims.cols, dims.rows, dims.cols) ? 'Excluded perimeter well' : 'Unassigned well · available for your experiment'}</span>}<button className="tiny-button" aria-label="Close well details" onClick={() => setSelection(null)}><X size={15} /></button></>}</div>
        </section>
        <section className="layout-section"><div className="layout-heading"><div><h2><Sparkles size={18} /> A few ways to lay it out</h2><p>Same conditions. Different arrangements. Pick what works for your workflow.</p></div><span className="solution-count">3 SOLUTIONS</span></div><div className="layout-options">{layouts.map((l, i) => <button key={l.kind} className={`layout-option ${kind === l.kind ? 'active' : ''}`} aria-pressed={kind === l.kind} onClick={() => { setKind(l.kind); setSelection(null); setPlateIndex(0); }}><div className="layout-option-top"><span>0{i + 1}</span><span className="radio">{kind === l.kind && <span />}</span></div>{plans[i] ? <MiniPlate plan={plans[i]} e={e} mode={mode} /> : <div className="mini-placeholder" />}<div className="layout-option-title"><strong>{l.name}</strong><span>{plans[i]?.plates.length ?? '—'} {plans[i]?.plates.length === 1 ? 'plate' : 'plates'}</span></div><p>{l.description}</p></button>)}</div>

          <p className="layout-note">{kind === 'tall' && 'The row pattern is transposed to fill down before moving across, reflowing at plate edges. '}Conditions for each cell line stay close together, continuing on the same side where space allows. Empty spaces preserve block shape; large designs continue onto additional plates.</p>
        </section>
        <footer className="main-footer"><span><Check size={13} /> {errors.length ? 'Finish editing to save' : saveState}</span><div><button onClick={() => { if (!errors.length) { download(JSON.stringify(e, null, 2), `${filename}.json`, 'application/json'); setToast('Project file saved. Import it to continue on another device.'); } }} disabled={!!errors.length}><ArrowDownToLine size={13} /> Save project</button><button onClick={() => { setE(structuredClone(defaultExperiment)); setKind('wide'); setPlateIndex(0); setSelection(null); setToast('Example design restored.'); }}><RotateCcw size={13} /> Load example</button></div></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status">{toast}<button className="tiny-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="How to design a screen" onClick={event => event.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Close help" onClick={() => setHelp(false)}><X size={19} /></button><span className="eyebrow">A QUICK GUIDE</span><h2>From conditions to plates.</h2><ol><li><strong>Define your cells.</strong> Add each cell line and one or more densities in cells per well.</li><li><strong>Set your treatments.</strong> Add compounds and comma-separated concentrations. The selected unit applies to all compounds.</li><li><strong>Choose replicates.</strong> Every cell × density × compound × dose combination receives the same replicate count.</li><li><strong>Explore your layout.</strong> Select a square or rectangular solution, then drag the block slider. Extra plates are created automatically.</li><li><strong>Take it to the bench.</strong> Export all plates as CSV, with a separate row for every well. Save a project file to reopen your setup.</li></ol><p>Vehicle controls contain no drug and are assigned once per cell line and density. All wells in a replicate set have identical conditions. The planner maps your inputs; densities and concentrations in the example are placeholders.</p><button className="primary-button" onClick={() => setHelp(false)}>Start designing <ChevronRight size={15} /></button></section></div>}
  </div>;
}
