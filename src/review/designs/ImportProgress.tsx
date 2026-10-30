import { useEffect, useState } from 'react';
import type { ScheduleSearchJob } from '../types';

function duration(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ImportProgress({ job, startedAt, fileCount }: { job?: ScheduleSearchJob; startedAt: string; fileCount: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const progress = job?.progress;
  const stage = progress?.stage;
  const files = progress?.totalFiles ?? fileCount;
  const steps = ['Request received', ...(files ? ['Files sent'] : []), files ? 'AI analysis' : 'Schedule research', 'Preview'];
  const current = !job || job.status === 'queued' || !stage || stage === 'starting' ? 0 : stage === 'uploading' ? 1 : stage === 'finalizing' ? steps.length - 1 : steps.length - 2;
  const title = !job ? 'Sending request' : job.status === 'queued' ? 'Waiting to start' : stage === 'uploading' ? 'Sending files to Claude' : stage === 'analyzing' ? (progress!.round > 1 ? 'Continuing AI analysis' : 'Analyzing your files') : stage === 'researching' ? 'Finding the schedule' : stage === 'finalizing' ? 'Preparing your preview' : 'Starting your import';
  const detail = stage === 'uploading' ? `${progress!.filesDone} of ${files} files sent` : stage === 'analyzing' ? `Claude is processing your request${progress!.round > 1 ? ` (pass ${progress!.round})` : ''}. The preview will open when it finishes.` : stage === 'researching' ? 'Claude is checking public schedule sources.' : stage === 'finalizing' ? 'Analysis finished. Saving the result for review.' : job ? 'Your request has been received.' : 'Uploading your request and attachments.';
  const elapsed = Math.max(0, Math.floor((now - Date.parse(job?.startedAt || startedAt)) / 1000)) || 0;
  const sinceUpdate = progress?.updatedAt ? Math.max(0, Math.floor((now - Date.parse(progress.updatedAt)) / 1000)) : null;
  return <section className="work-ai-progress" aria-label="Import progress">
    <div className="work-ai-progress-heading"><strong role="status">{title}</strong><span role="timer" aria-live="off">{duration(elapsed)} elapsed</span></div>
    <ol aria-label="Import stages">{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}><span aria-hidden="true">{index < current ? '\u2713' : index + 1}</span>{step}</li>)}</ol>
    <p>{detail}</p>
    {stage === 'analyzing' && <small>{sinceUpdate !== null ? `Analysis status checked ${sinceUpdate < 5 ? 'just now' : `${duration(sinceUpdate)} ago`}. ` : ''}Claude does not report a completion percentage. Larger files can take several minutes.</small>}
    <small>Keep AI Import open until your preview is ready.</small>
  </section>;
}
