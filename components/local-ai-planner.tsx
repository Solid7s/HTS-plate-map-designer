'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Cpu, Download, Sparkles, X } from 'lucide-react';
import { AI_EXAMPLE, AI_MODEL_NAME, AI_PROMPT_LIMIT, parseAiProposal, validateAiPrompt } from '@/lib/ai-experiment';
import type { AiProposal } from '@/lib/ai-experiment';
import { BrowserAi, browserAiModel, friendlyAiError } from '@/lib/browser-ai';
import { buildSimpleExperiment, simpleFields } from '@/lib/simple-planner';
import type { SimpleSetup } from '@/lib/simple-planner';

type Phase = 'off' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'reading' | 'error';
export default function LocalAiPlanner({ current, onApply }: { current: SimpleSetup; onApply: (setup: SimpleSetup) => string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<Phase>('off');
  const [model, setModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [review, setReview] = useState<SimpleSetup | null>(null);
  const [reviewedNotes, setReviewedNotes] = useState(false);
  const client = useRef<BrowserAi | null>(null);
  const operation = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const busy = phase === 'loading' || phase === 'reading';
  const ready = phase === 'ready' || phase === 'reading';
  const reviewErrors = review ? buildSimpleExperiment(review).errors : [];

  useEffect(() => {
    if (!expanded || model || phase === 'unsupported') return;
    let active = true;
    setPhase('checking');
    browserAiModel().then(found => { if (active) { setModel(found); setPhase(found ? 'off' : 'unsupported'); } });
    return () => { active = false; };
  // Checking runs only when the panel is opened; it never downloads a model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  useEffect(() => () => { operation.current++; client.current?.stop(); }, []);
  useEffect(() => { if (proposal) reviewHeading.current?.focus(); }, [proposal]);

  async function enable() {
    if (!model || busy) return;
    const id = ++operation.current;
    setError(''); setNotice(''); setProgress(0); setProgressText('Preparing model download…'); setPhase('loading');
    client.current?.stop();
    const ai = new BrowserAi(); client.current = ai;
    try {
      await ai.load(model, (amount, text) => { if (operation.current === id) { setProgress(amount); setProgressText(text); } });
      if (operation.current === id) { setPhase('ready'); setNotice('Model ready. Your description is processed on this device.'); }
    } catch (cause) {
      if (operation.current !== id) return;
      ai.stop(); setPhase('error'); setError(friendlyAiError(cause));
    }
  }
  function stop() {
    operation.current++; client.current?.stop(); client.current = null;
    setPhase('off'); setError(''); setNotice('AI is off. Cached model files can be reused the next time you enable it.');
  }
  async function extract() {
    if (!client.current || phase !== 'ready') return;
    let input: string;
    try { input = validateAiPrompt(prompt); } catch (cause) { setError(friendlyAiError(cause)); return; }
    const id = ++operation.current;
    const snapshot = { ...current };
    setPhase('reading'); setError(''); setNotice(''); setProposal(null); setReview(null); setReviewedNotes(false);
    try {
      const response = await client.current.extract(input);
      if (operation.current !== id) return;
      const next = parseAiProposal(response, snapshot);
      setProposal(next); setReview(next.setup); setPhase('ready');
    } catch (cause) {
      if (operation.current !== id) return;
      // Releasing a failed worker also handles device loss and timeouts cleanly.
      client.current?.stop(); client.current = null;
      setPhase('error'); setError(friendlyAiError(cause));
    }
  }
  function changePrompt(value: string) { setPrompt(value); setProposal(null); setReview(null); setError(''); setNotice(''); }
  function apply() {
    if (!review || reviewErrors.length || (proposal?.notes.length && !reviewedNotes)) return;
    const errors = onApply(review);
    if (errors.length) { setError(errors.join(' ')); return; }
    setProposal(null); setReview(null); setError(''); setNotice('Reviewed settings applied. Your maps are updated below.');
  }

  return <section className="local-ai" aria-labelledby="ai-heading">
    <div className="ai-header"><div className="ai-title"><span className="ai-icon"><Cpu size={20} /></span><div><h2 id="ai-heading">Describe your screen with AI <span>Optional · v2.0</span></h2><p>Turn a sentence into editable settings, right in your browser.</p></div></div><button type="button" className="secondary-button" aria-expanded={expanded} aria-controls="ai-panel" onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide' : 'Try local AI'}<ChevronDown size={15} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button></div>
    {expanded && <div id="ai-panel" className="ai-panel">
      <div className="ai-model"><div><strong>{AI_MODEL_NAME}</strong><span>4-bit model · about 1 GB download · roughly 2 GB GPU memory</span></div><span className={`ai-status ${ready ? 'is-ready' : ''}`}><i />{phase === 'ready' ? 'Ready on this device' : phase === 'reading' ? 'Reading your description' : phase === 'loading' ? 'Loading model' : phase === 'checking' ? 'Checking browser' : 'AI is off'}</span></div>
      <p className="ai-privacy">The first use downloads model files from Hugging Face and the WebLLM runtime from GitHub. Your description stays in this browser; it is not sent to an AI service. The model is cached when browser storage allows. AI stays off until you enable it.</p>
      {phase === 'unsupported' ? <p className="ai-message" role="status">This browser does not have an available WebGPU adapter. Try an up-to-date browser with hardware acceleration enabled. You can still use all manual planning features below.</p> : <div className="ai-load-actions">
        {!ready && phase !== 'loading' && <button type="button" className="primary-button" disabled={phase === 'checking' || !model} onClick={enable}><Download size={15} />{phase === 'error' ? 'Retry local AI' : 'Enable local AI'}</button>}
        {(ready || phase === 'loading') && <button type="button" className="secondary-button" onClick={stop}><X size={14} />{busy ? 'Cancel and disable AI' : 'Disable AI'}</button>}
        {phase === 'loading' && <div className="ai-progress"><progress max="1" value={progress} aria-label="Model download progress" /><span>{Math.round(progress * 100)}% · {progressText}</span></div>}
      </div>}
      <label className="ai-prompt-label" htmlFor="ai-description">What would you like to screen?</label>
      <textarea id="ai-description" value={prompt} onChange={event => changePrompt(event.target.value)} disabled={phase === 'reading'} maxLength={AI_PROMPT_LIMIT} rows={3} placeholder="For example: 20 cell lines, 40 compounds, one density and concentration, triplicates on 384-well plates, with positive and negative controls." aria-describedby="ai-scope" />
      <div className="ai-prompt-actions"><button type="button" className="ai-text-button" disabled={phase === 'reading'} onClick={() => changePrompt(AI_EXAMPLE)}>Use example description</button><span>{prompt.length} / {AI_PROMPT_LIMIT}</span><button type="button" className="primary-button" disabled={phase !== 'ready' || !prompt.trim()} onClick={extract}><Sparkles size={15} />{phase === 'reading' ? 'Reading…' : 'Review AI settings'}<ArrowRight size={14} /></button></div>
      <p id="ai-scope" className="ai-scope">AI fills counts, plate format, and edge/control settings. Unspecified values keep your current settings. Maps use one compound per plate, equal level counts, and matched controls. Names, actual doses, and custom placement rules are not applied here. For physical doses or seeding amounts, set the level counts yourself in the review.</p>
      {error && <p className="ai-message ai-error" role="alert">{error}</p>}
      {notice && <p className="ai-message" role="status"><Check size={14} />{notice}</p>}
      {proposal && review && <div className="ai-review" aria-labelledby="ai-review-heading">
        <h3 id="ai-review-heading" ref={reviewHeading} tabIndex={-1}>Review before updating your maps</h3><p>Check every value. AI can misread a description. Your existing maps stay unchanged until you apply these settings.</p>
        <div className="ai-review-fields">{simpleFields.map(field => <label key={field.key} htmlFor={`ai-${field.key}`}><span>{field.label}{field.key === 'densities' || field.key === 'concentrations' ? ' (levels)' : ''}</span><input id={`ai-${field.key}`} type="number" min="1" max={field.max} step="1" value={review[field.key]} onChange={event => { setReview({ ...review, [field.key]: event.target.value }); setError(''); }} /><small>{proposal.specified.includes(field.key) ? 'Read from description' : 'Kept from your settings'}</small></label>)}</div>
        <div className="ai-review-options"><label>Plate format<select aria-label="AI plate format" value={review.format} onChange={event => setReview({ ...review, format: Number(event.target.value) as 96 | 384 })}><option value="96">96-well</option><option value="384">384-well</option></select><small>{proposal.specified.includes('format') ? 'Read from description' : 'Kept from your settings'}</small></label><label><span><input type="checkbox" checked={review.excludeEdges} onChange={event => setReview({ ...review, excludeEdges: event.target.checked })} />Exclude outer wells</span><small>{proposal.specified.includes('excludeEdges') ? 'Read from description' : 'Kept from your settings'}</small></label><label><span><input type="checkbox" checked={review.screenControls !== false} onChange={event => setReview({ ...review, screenControls: event.target.checked })} />Positive + negative controls</span><small>{proposal.specified.includes('screenControls') ? 'Read from description' : 'Kept from your settings'}</small></label></div>
        {!!proposal.notes.length && <div className="ai-review-notes"><strong>Requests to review separately</strong><ul>{proposal.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><label><input type="checkbox" checked={reviewedNotes} onChange={event => setReviewedNotes(event.target.checked)} />I understand these notes; only the settings above will be applied.</label></div>}
        {!!reviewErrors.length && <div className="ai-message ai-error" role="alert">{reviewErrors.map(message => <p key={message}>{message}</p>)}</div>}
        <div className="ai-review-actions"><button type="button" className="secondary-button" onClick={() => { setProposal(null); setReview(null); setError(''); }}>Discard suggestion</button><button type="button" className="primary-button" disabled={!!reviewErrors.length || (!!proposal.notes.length && !reviewedNotes)} onClick={apply}>Apply settings & generate maps<ArrowRight size={15} /></button></div>
      </div>}
    </div>}
  </section>;
}
