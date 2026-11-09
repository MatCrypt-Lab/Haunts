'use client';

import { useEffect, useState } from 'react';
import { SITE } from '@/lib/site';

type Asset = { name: string; size: number; download_count: number; browser_download_url: string };
type Release = { tag_name: string; name: string; html_url: string; published_at: string; prerelease: boolean; assets: Asset[] };
type Run = { id: number; status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string; head_sha: string; event: string; run_number: number };
type Step = { name: string; status: string; conclusion: string | null };
type Job = { name: string; status: string; conclusion: string | null; steps?: Step[] };

const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function kind(name: string) {
  if (name.endsWith('.apk')) return { label: 'Android', note: 'Open on your phone to install', c: '#2fbf86' };
  if (name.endsWith('.ipa')) return { label: 'iPhone', note: 'Sideload with Sideloadly or AltStore', c: '#1b1538' };
  if (name.includes('simulator')) return { label: 'Browser demo', note: 'Upload to Appetize for a demo link', c: '#6a3fd1' };
  return { label: 'File', note: '', c: '#7a7299' };
}

async function gh<T>(path: string): Promise<T> {
  const r = await fetch(`${SITE.repoApi}${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub rate limit reached. Try again in a few minutes.' : `GitHub answered ${r.status}`);
  return r.json() as Promise<T>;
}

/** The newest release (including pre-releases), read live from GitHub. */
export function LatestRelease() {
  const [rel, setRel] = useState<Release | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    gh<Release[]>('/releases?per_page=5')
      .then((rs) => {
        const r = rs.find((x) => x.assets.length);
        if (r) setRel(r);
        else setErr('No builds published yet.');
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  if (err) return <p className="note">{err} All builds are on <a href={SITE.releases}>the Releases page</a>.</p>;
  if (!rel) return <p className="muted">Fetching the latest build from GitHub…</p>;
  const order = (a: Asset) => (a.name.endsWith('.apk') ? 0 : a.name.endsWith('.ipa') ? 1 : 2);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="muted">
        <b style={{ color: 'var(--ink)' }}>{rel.name}</b> · published {when(rel.published_at)}
        {rel.prerelease ? ' · test build' : ''} · <a href={rel.html_url} target="_blank" rel="noreferrer">release notes</a>
      </p>
      {[...rel.assets].sort((a, b) => order(a) - order(b)).map((a) => {
        const k = kind(a.name);
        return (
          <div key={a.name} className="asset">
            <span className="ico hex-ico" style={{ background: k.c }} aria-hidden="true" />
            <span>
              <b>{k.label}</b>
              <small>{a.name} · {mb(a.size)} · {a.download_count.toLocaleString('en-IN')} {a.download_count === 1 ? 'download' : 'downloads'}</small>
              <small>{k.note}</small>
            </span>
            <a className="btn" href={a.browser_download_url}>Download</a>
          </div>
        );
      })}
    </div>
  );
}

function stepClass(s: { status: string; conclusion: string | null }) {
  if (s.status !== 'completed') return s.status === 'in_progress' ? 'run' : '';
  return s.conclusion === 'success' ? 'ok' : s.conclusion === 'skipped' ? 'skip' : 'bad';
}

/** The latest run of the Build apps workflow, with every step as a hex, refreshed while it runs. */
export function BuildStatus() {
  const [run, setRun] = useState<Run | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await gh<{ workflow_runs: Run[] }>('/actions/workflows/build-apps.yml/runs?per_page=1');
        const latest = r.workflow_runs[0] ?? null;
        setRun(latest);
        if (latest) setJobs((await gh<{ jobs: Job[] }>(`/actions/runs/${latest.id}/jobs`)).jobs);
        if (latest && latest.status !== 'completed') timer = setTimeout(load, 30_000);
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, []);

  if (err) return <p className="note">{err}</p>;
  if (!run) return <p className="muted">Reading the pipeline…</p>;
  const st = run.status !== 'completed' ? 'run' : run.conclusion === 'success' ? 'ok' : 'bad';
  const text = st === 'run' ? 'Building now' : st === 'ok' ? 'Last build passed' : `Last build ${run.conclusion}`;
  const mins = Math.round((Date.parse(run.updated_at) - Date.parse(run.created_at)) / 60000);
  return (
    <div className="track">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <span className={`status ${st}`}><i />{text}</span>
        <a className="muted" href={run.html_url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
          Run {run.run_number} · {when(run.created_at)}{st !== 'run' ? ` · ${mins} min` : ''} · commit {run.head_sha.slice(0, 7)}
        </a>
      </div>
      {jobs.map((j) => (
        <div key={j.name} className="job">
          <div className="job-head">
            <span>{j.name}</span>
            <span className="muted" style={{ fontWeight: 500 }}>{j.steps?.filter((s) => s.conclusion === 'success').length ?? 0} of {j.steps?.length ?? 0} steps</span>
          </div>
          <div className="steps" aria-label={`${j.name}: ${j.status} ${j.conclusion ?? ''}`}>
            {(j.steps ?? []).map((s) => <i key={s.name} className={stepClass(s)} title={s.name} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
