import { useEffect, useMemo, useRef, useState } from 'react';
import './app.css';

type PlanSummary = { id: string; title: string };
type Task = { id: string; name: string; owner: string | null; duration_days: number | ''; depends_on: string[]; quote: string };
type Finding = { title: string; detail: string; quote: string | null };
type Schedule = { status: 'scheduled' | 'cycle'; schedule: { id: string; start_day: number; end_day: number }[]; end_day: number | null; deadline_day: number | null; meets_deadline: boolean | null; days_late: number | null; cycle: string[] };
type Plan = { id: string; text: string; review: { deadline_day: number | null; tasks: Task[]; findings: Finding[] }; schedule: Schedule };
type AiReviewResponse = { review: Plan['review']; schedule: Schedule; provider: string; model: string };

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ? JSON.stringify(body.detail) : `Request failed (${response.status})`);
  }
  return response.json();
}

export default function App() {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recalculating, setRecalculating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [aiReviewMeta, setAiReviewMeta] = useState<{ provider: string; model: string } | null>(null);
  const [calculatedInput, setCalculatedInput] = useState('');
  const [calculationNotice, setCalculationNotice] = useState('');
  const [openDependencyId, setOpenDependencyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<'plan' | 'evidence' | null>(null);
  const sourcePanelRef = useRef<HTMLElement>(null);
  const sourceMarkRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/plans', { signal: controller.signal }).then(asJson<PlanSummary[]>).then((items) => {
      setPlans(items);
      if (items.length) setSelectedId(items[0].id);
      else setLoading(false);
    }).catch((reason) => {
      if (reason.name !== 'AbortError') { setError(reason.message); setLoading(false); }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setPlan(null); setSelectedQuote(null); setCalculationNotice(''); setAiReviewMeta(null);
    fetch(`/api/plans/${encodeURIComponent(selectedId)}`, { signal: controller.signal }).then(asJson<Plan>).then((next) => {
      setPlan(next); setTasks(next.review.tasks); setDeadline(next.review.deadline_day); setSchedule(next.schedule);
      setCalculatedInput(JSON.stringify([next.review.tasks, next.review.deadline_day]));
    }).catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.dependency-picker')) setOpenDependencyId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenDependencyId(null);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const changed = useMemo(() => Boolean(plan && (deadline !== plan.review.deadline_day || JSON.stringify(tasks) !== JSON.stringify(plan.review.tasks))), [deadline, plan, tasks]);
  const updateTask = (id: string, patch: Partial<Task>) => setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  const toggleDependency = (task: Task, dependencyId: string) => updateTask(task.id, {
    depends_on: task.depends_on.includes(dependencyId)
      ? task.depends_on.filter((id) => id !== dependencyId)
      : [...task.depends_on, dependencyId],
  });
  const showEvidence = (quote: string) => {
    setSelectedQuote(quote);
    setCopied(null);
    window.setTimeout(() => sourcePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const copySource = async (value: string, target: 'plan' | 'evidence') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied((current) => current === target ? null : current), 1800);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };
  const locateEvidence = () => sourceMarkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  async function recalculate() {
    if (tasks.some(task => typeof task.duration_days !== 'number' || !Number.isInteger(task.duration_days) || task.duration_days < 1)) { setError('Every task needs a duration of at least one whole day.'); setCalculationNotice(''); return; }
    if (deadline === null) { setError('Add a deadline day before recalculating.'); setCalculationNotice(''); return; }
    setRecalculating(true); setError(''); setCalculationNotice('');
    try {
      const previousEnd = schedule?.end_day;
      const result = await fetch('/api/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline_day: deadline, tasks: tasks.map(({ quote: _quote, ...task }) => task) }),
      }).then(asJson<Schedule>);
      setSchedule(result);
      setCalculatedInput(JSON.stringify([tasks, deadline]));
      if (result.status === 'cycle') {
        setCalculationNotice(`Constraint schedule updated. Circular dependency found: ${result.cycle.join(', ')}. The AI review was not rerun.`);
      } else {
        const difference = previousEnd === null || previousEnd === undefined || result.end_day === null ? null : result.end_day - previousEnd;
        const comparison = difference === 0 ? 'The finish day did not change.' : difference !== null && difference > 0 ? `That is ${difference} day${difference === 1 ? '' : 's'} later.` : difference !== null ? `That is ${Math.abs(difference)} day${difference === -1 ? '' : 's'} earlier.` : '';
        setCalculationNotice(`Constraint schedule updated. Earliest finish: day ${result.end_day}. ${comparison} The AI review was not rerun.`);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not recalculate.'); setCalculationNotice(''); }
    finally { setRecalculating(false); }
  }

  async function runAiReview() {
    if (!plan) return;
    setReviewing(true); setError(''); setCalculationNotice(''); setOpenDependencyId(null);
    try {
      const result = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/review`, { method: 'POST' }).then(asJson<AiReviewResponse>);
      const nextPlan = { ...plan, review: result.review, schedule: result.schedule };
      setPlan(nextPlan); setTasks(result.review.tasks); setDeadline(result.review.deadline_day); setSchedule(result.schedule);
      setCalculatedInput(JSON.stringify([result.review.tasks, result.review.deadline_day]));
      setAiReviewMeta({ provider: result.provider, model: result.model });
      setCalculationNotice(`AI review completed with ${result.provider}. Tasks, findings and evidence were validated before display.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI review could not be completed.');
    } finally { setReviewing(false); }
  }

  function reset() {
    if (!plan) return;
    setTasks(plan.review.tasks); setDeadline(plan.review.deadline_day); setSchedule(plan.schedule); setError(''); setCalculationNotice('Original review restored.');
    setCalculatedInput(JSON.stringify([plan.review.tasks, plan.review.deadline_day]));
  }

  const status = schedule?.status === 'cycle'
    ? { label: 'Circular dependency', detail: `Tasks ${schedule.cycle.join(', ')} wait on each other.`, tone: 'warning', category: 'Needs attention' }
    : schedule?.meets_deadline === null
      ? { label: 'Deadline unknown', detail: `Earliest finish is day ${schedule?.end_day ?? '—'}.`, tone: 'neutral', category: 'Review needed' }
      : schedule?.meets_deadline
        ? { label: 'On track', detail: `Earliest finish is day ${schedule.end_day}, ${Math.max(0, (schedule.deadline_day ?? 0) - (schedule.end_day ?? 0))} days before the deadline.`, tone: 'good', category: 'Feasible' }
        : { label: `${schedule?.days_late} days late`, detail: `Earliest finish is day ${schedule?.end_day}; the deadline is day ${schedule?.deadline_day}.`, tone: 'warning', category: 'At risk' };
  const quoteIndex = plan && selectedQuote ? plan.text.indexOf(selectedQuote) : -1;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">W</div><div><span className="eyebrow">Town council</span><strong>Plan reviewer</strong></div>
      <label className="plan-picker"><span>Plan</span><select disabled={recalculating} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{plans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    </header>
    <main>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading && <div className="skeleton-page" role="status" aria-label="Loading plan">
        <span className="sr-only">Loading plan</span>
        <div className="skeleton-heading"><div><span className="skeleton-line short" /><span className="skeleton-line title" /><span className="skeleton-line subtitle" /></div><span className="skeleton-line badge" /></div>
        <section className="skeleton-decision"><div><span className="skeleton-line short" /><span className="skeleton-line heading" /><span className="skeleton-line subtitle" /></div><div className="skeleton-metrics"><span /><span /><span /></div></section>
        <div className="skeleton-layout"><div className="skeleton-main"><section className="skeleton-card"><span className="skeleton-line short" /><span className="skeleton-line heading" /><span className="skeleton-line row" /><span className="skeleton-line row" /></section><section className="skeleton-card table-card"><span className="skeleton-line short" /><span className="skeleton-line heading" /><div className="skeleton-table">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div></section></div><aside className="skeleton-card skeleton-source"><span className="skeleton-line short" /><span className="skeleton-line heading" />{Array.from({ length: 9 }, (_, index) => <span className={`skeleton-line text ${index % 3 === 2 ? 'narrow' : ''}`} key={index} />)}</aside></div>
      </div>}
      {!loading && plan && schedule && <>
        <div className="page-heading"><div><span className="eyebrow">Events / Plan assessment</span><h1>{plans.find(item => item.id === selectedId)?.title}</h1><p>Review the evidence. Resolve the blockers. Make a confident decision.</p></div><span className="document-badge">Working review · Changes stay in this session</span></div>
        {calculatedInput !== JSON.stringify([tasks, deadline]) && <div className="pending-banner" role="status">You have pending changes. The result below reflects the last calculation.</div>}
        <section className={`decision-card ${status.tone}`}><div className="decision-copy"><div className="decision-label"><span className="eyebrow">Schedule assessment</span><span className="status-pill"><span className="status-dot" aria-hidden="true" />{status.category}</span></div><h1>{status.label}</h1><p>{status.detail}</p></div>
          <div className="metrics" aria-label="Schedule summary"><div><span>Finish</span><strong>{schedule.end_day ?? '—'}</strong></div><div><span>Deadline</span><strong>{schedule.deadline_day ?? '—'}</strong></div><div><span>Tasks</span><strong>{tasks.length}</strong></div></div>
        </section>
        <div className="layout"><div className="main-column">
          <section className="card"><div className="section-heading"><div><span className="eyebrow">AI review</span><h2>What needs attention</h2><p className="section-description">Extracted tasks and evidence are validated before they appear here.</p></div><div className="review-controls"><span className="count-chip">{plan.review.findings.length} findings</span><button className="ai-review-button" type="button" onClick={runAiReview} disabled={reviewing || recalculating}><span aria-hidden="true">✦</span>{reviewing ? 'Reviewing plan…' : 'Run AI review'}</button></div></div>
            {aiReviewMeta && <div className="ai-review-meta"><span className="status-dot" />Reviewed with {aiReviewMeta.provider} · {aiReviewMeta.model}</div>}
            {plan.review.findings.length === 0 ? <p className="empty">No issues were reported.</p> : <div className="findings">{plan.review.findings.map((finding, index) => <article className="finding" key={`${finding.title}-${index}`}><h3>{finding.title}</h3><p>{finding.detail}</p>{finding.quote ? <button className="text-button" onClick={() => showEvidence(finding.quote!)}>View evidence</button> : <span className="no-source">No source quoted</span>}</article>)}</div>}
          </section>
          <section className="card"><div className="section-heading"><div><span className="eyebrow">Schedule</span><h2>Tasks and timing</h2><p className="section-description">Select a task to adjust its duration, owner or dependencies.</p></div><label className="deadline-field">Deadline day<input disabled={recalculating} type="number" value={deadline ?? ''} onChange={(event) => setDeadline(event.target.value === '' ? null : Number(event.target.value))} /></label></div>
            <div className="table-wrap"><table><thead><tr><th>Task</th><th>Owner</th><th>Days</th><th>Dependencies</th><th>Schedule</th><th>Evidence</th></tr></thead><tbody>{tasks.map((task) => {
              const timing = schedule.schedule.find((entry) => entry.id === task.id);
              const dependencyOpen = openDependencyId === task.id;
              return <tr key={task.id}><td><input aria-label={`${task.name} name`} value={task.name} onChange={(event) => updateTask(task.id, { name: event.target.value })} /></td><td><input aria-label={`${task.name} owner`} value={task.owner ?? ''} placeholder="Unassigned" onChange={(event) => updateTask(task.id, { owner: event.target.value || null })} /></td><td><input className="number-input" aria-label={`${task.name} duration`} inputMode="numeric" type="number" min="1" value={task.duration_days} onChange={(event) => updateTask(task.id, { duration_days: event.target.value === '' ? '' : Number(event.target.value) })} /></td><td><div className={`dependency-picker ${dependencyOpen ? 'open' : ''}`}><button type="button" className="dependency-trigger" aria-expanded={dependencyOpen} aria-controls={`dependencies-${task.id}`} onClick={() => setOpenDependencyId(dependencyOpen ? null : task.id)}><span className="dependency-values">{task.depends_on.length ? task.depends_on.map((dependencyId) => <span className="dependency-chip" key={dependencyId}>{dependencyId}</span>) : <span className="dependency-empty">None</span>}</span><span className="chevron" aria-hidden="true">⌄</span></button>{dependencyOpen && <div className="dependency-menu" id={`dependencies-${task.id}`}><div className="menu-header"><div><strong>Dependencies</strong><span>Tasks that must finish first</span></div>{task.depends_on.length > 0 && <button type="button" onClick={() => updateTask(task.id, { depends_on: [] })}>Clear</button>}</div><div className="dependency-options">{tasks.filter((candidate) => candidate.id !== task.id).map((candidate) => <label key={candidate.id}><input type="checkbox" checked={task.depends_on.includes(candidate.id)} onChange={() => toggleDependency(task, candidate.id)} /><span className="checkbox-mark" aria-hidden="true">✓</span><span className="task-id">{candidate.id}</span><span className="dependency-name">{candidate.name}</span></label>)}</div><div className="menu-footer">{task.depends_on.length === 0 ? 'No dependencies selected' : `${task.depends_on.length} ${task.depends_on.length === 1 ? 'dependency' : 'dependencies'} selected`}</div></div>}</div></td><td className="timing">{timing ? <><strong>Day {timing.start_day}</strong><span>to {timing.end_day}</span></> : '—'}</td><td><button className="evidence-button" onClick={() => showEvidence(task.quote)}><span className="evidence-icon" aria-hidden="true">“</span><span>View evidence</span></button></td></tr>;
            })}</tbody></table></div>
            {(calculationNotice || error) && <div className={`calculation-feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">{error || calculationNotice}</div>}
            <div className="actions"><span>{changed ? 'Working copy · Original review preserved' : 'Showing the extracted plan.'}</span><div><button className="secondary-button" onClick={reset} disabled={!changed || recalculating}>Reset changes</button><button className="primary-button" onClick={recalculate} disabled={recalculating}>{recalculating ? 'Calculating…' : 'Recalculate schedule'}</button></div></div>
          </section>
        </div><aside ref={sourcePanelRef} className="card source-panel"><div className="source-header"><div><span className="eyebrow">Source plan</span><h2>Check the evidence</h2><span className="source-meta">Original submission · {plan.text.split(/\s+/).filter(Boolean).length} words</span></div><button className="copy-button" type="button" onClick={() => copySource(plan.text, 'plan')} aria-label="Copy full plan"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="10" height="10" rx="2"/><path d="M14 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"/></svg>{copied === 'plan' ? 'Copied' : 'Copy plan'}</button></div>{selectedQuote ? <div className="evidence-callout"><div className="evidence-callout-header"><span><span className="evidence-check" aria-hidden="true">✓</span>Selected evidence</span><div><button type="button" onClick={locateEvidence} disabled={quoteIndex < 0}>Locate</button><button type="button" onClick={() => copySource(selectedQuote, 'evidence')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="10" height="10" rx="2"/><path d="M14 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"/></svg>{copied === 'evidence' ? 'Copied' : 'Copy'}</button></div></div><blockquote>{selectedQuote}</blockquote></div> : <p className="source-hint">Choose “View evidence” beside a task or finding to inspect the supporting text.</p>}<div className="source-document"><div className="source-document-label"><span>Plan text</span><span>Read only</span></div><pre>{quoteIndex >= 0 && selectedQuote ? <>{plan.text.slice(0, quoteIndex)}<mark ref={sourceMarkRef}>{selectedQuote}</mark>{plan.text.slice(quoteIndex + selectedQuote.length)}</> : plan.text}</pre></div></aside></div>
      </>}
    </main>
  </div>;
}
