import { useEffect, useMemo, useState } from 'react';
import type { Device, Project } from './types';
import { starterFiles, buildSrcDoc, currentRevision, formatDate, localUpdate } from './types';

const fallback: Project = { id: 'demo', name: 'Northstar Studio', slug: 'northstar-studio', description: 'A magnetic studio landing page', status: 'published', updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), publishedRevisionId: 'rev-demo', currentRevisionId: 'rev-demo', revisions: [{ id: 'rev-demo', label: 'Initial concept', prompt: 'Create a distinctive creative studio landing page.', summary: 'Created the initial Northstar studio concept with a responsive editorial layout.', createdAt: new Date().toISOString(), files: starterFiles }] };

async function request<T>(path: string, options?: RequestInit): Promise<T> { const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }); if (!response.ok) throw new Error(await response.text() || 'Request failed'); return response.json(); }
function SparkIcon() { return <span className="spark-icon">✦</span>; }
function ArrowIcon() { return <span className="arrow-icon">↗</span>; }

export default function App() {
  const [projects, setProjects] = useState<Project[]>([fallback]);
  const [selectedId, setSelectedId] = useState('demo');
  const [prompt, setPrompt] = useState('');
  const [device, setDevice] = useState<Device>('desktop');
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const selected = projects.find(project => project.id === selectedId) || projects[0];
  const revision = currentRevision(selected);
  const srcDoc = useMemo(() => buildSrcDoc(revision.files), [revision]);

  useEffect(() => { request<Project[]>('/api/projects').then(data => { if (data.length) { setProjects(data); setSelectedId(data[0].id); } }).catch(() => undefined); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4200); return () => window.clearTimeout(timer); }, [notice]);

  async function createProject() {
    try { const project = await request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Untitled concept', description: 'A new AI-built website' }) }); setProjects(value => [project, ...value]); setSelectedId(project.id); }
    catch { const project = { ...fallback, id: 'local-' + Date.now(), name: 'Untitled concept', slug: 'untitled-concept-' + Date.now(), status: 'draft' as const, publishedAt: undefined, publishedRevisionId: undefined }; setProjects(value => [project, ...value]); setSelectedId(project.id); }
  }

  async function generate() {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true); setNotice('Forgehouse is mapping your change into a new revision…');
    try { const updated = await request<Project>('/api/projects/' + selected.id + '/generate', { method: 'POST', body: JSON.stringify({ prompt }) }); setProjects(value => value.map(project => project.id === updated.id ? updated : project)); }
    catch { const files = localUpdate(revision.files, prompt); const localRevision = { id: 'local-rev-' + Date.now(), label: 'AI change', prompt, summary: 'Applied a safe visual update in local preview mode.', createdAt: new Date().toISOString(), files }; const updated = { ...selected, currentRevisionId: localRevision.id, updatedAt: localRevision.createdAt, status: 'draft' as const, revisions: [localRevision, ...selected.revisions] }; setProjects(value => value.map(project => project.id === updated.id ? updated : project)); }
    setPrompt(''); setIsGenerating(false); setNotice('New revision ready. Review the preview, then publish when it feels right.');
  }

  async function publish() {
    try { const updated = await request<Project>('/api/projects/' + selected.id + '/publish', { method: 'POST' }); setProjects(value => value.map(project => project.id === updated.id ? updated : project)); setNotice('Published at /sites/' + updated.slug); }
    catch { const updated = { ...selected, status: 'published' as const, publishedAt: new Date().toISOString(), publishedRevisionId: selected.currentRevisionId }; setProjects(value => value.map(project => project.id === updated.id ? updated : project)); setNotice('Published in local preview mode.'); }
  }

  async function restore(id: string) { try { const updated = await request<Project>('/api/projects/' + selected.id + '/revisions/' + id + '/restore', { method: 'POST' }); setProjects(value => value.map(project => project.id === updated.id ? updated : project)); } catch { const target = selected.revisions.find(item => item.id === id); if (!target) return; const restored = { ...target, id: 'local-restore-' + Date.now(), label: 'Restored version', createdAt: new Date().toISOString(), summary: 'Restored from ' + target.label + '.' }; const updated = { ...selected, currentRevisionId: restored.id, status: 'draft' as const, updatedAt: restored.createdAt, revisions: [restored, ...selected.revisions] }; setProjects(value => value.map(project => project.id === updated.id ? updated : project)); } setNotice('Revision restored.'); }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><SparkIcon /></div><div><strong>forgehouse</strong><span>AI website studio</span></div></div>
      <button className="new-project" onClick={createProject}><span>＋</span> New project</button>
      <div className="side-label">Your projects <span>{projects.length}</span></div>
      <div className="project-list">{projects.map(project => <button className={'project-row ' + (project.id === selected.id ? 'active' : '')} key={project.id} onClick={() => setSelectedId(project.id)}><span className="project-dot"></span><span className="project-name">{project.name}</span><span className="project-status">{project.status === 'published' ? 'Live' : 'Draft'}</span></button>)}</div>
      <div className="sidebar-bottom"><div className="usage-card"><div className="usage-top"><span>AI generation</span><span>Starter</span></div><div className="usage-meter"><i></i></div><p>Connect Groq to start building without limits.</p></div><button className="account-row"><span className="avatar">V</span><span><b>vincenzo-afk</b><small>Personal workspace</small></span><span className="dots">•••</span></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{selected.name}</strong><span className="privacy-pill">Private</span></div><div className="top-actions"><button className="icon-button" title="Command menu">⌘ K</button><button className="share-button" onClick={publish}><span className="live-dot"></span>{selected.status === 'published' ? 'Published' : 'Publish'} <ArrowIcon /></button></div></header>
      <section className="workspace-head"><div><div className="eyebrow-ui">AI BUILD SESSION <span className="status-dot"></span> READY</div><h1>{selected.name}</h1><p>{selected.description}</p></div><div className="head-meta"><span>Last edited {formatDate(selected.updatedAt)}</span><span className="meta-separator"></span><span>Revision {selected.revisions.length}</span></div></section>
      <section className="studio-grid">
        <div className="chat-panel panel"><div className="panel-heading"><div><span className="heading-kicker">BUILD WITH AI</span><h2>What should we make?</h2></div><button className="round-button">•••</button></div><div className="conversation"><div className="assistant-message"><div className="message-avatar"><SparkIcon /></div><div><p>Tell me what to change. I’ll turn your idea into a polished, working site and keep every version safe.</p><div className="suggestion-row"><button onClick={() => setPrompt('Make the hero feel more editorial and bold')}>Make it more editorial <ArrowIcon /></button><button onClick={() => setPrompt('Add a testimonials section')}>Add testimonials <ArrowIcon /></button></div></div></div>{revision.prompt && <div className="history-note"><span className="history-line"></span><span>Latest instruction</span><b>{revision.prompt}</b></div>}</div><div className="composer"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) generate(); }} placeholder="Describe a change…" /><div className="composer-footer"><span><span className="kbd">⌘</span> + <span className="kbd">Enter</span> to build</span><button className="build-button" disabled={!prompt.trim() || isGenerating} onClick={generate}>{isGenerating ? <span className="loader"></span> : <SparkIcon />} {isGenerating ? 'Building…' : 'Build change'}</button></div></div></div>
        <div className="preview-panel panel"><div className="preview-toolbar"><div className="toolbar-group"><button className={device === 'desktop' ? 'selected' : ''} onClick={() => setDevice('desktop')}>Desktop</button><button className={device === 'tablet' ? 'selected' : ''} onClick={() => setDevice('tablet')}>Tablet</button><button className={device === 'mobile' ? 'selected' : ''} onClick={() => setDevice('mobile')}>Mobile</button></div><div className="toolbar-group right"><button onClick={() => setShowFiles(value => !value)}>{showFiles ? 'Hide files' : 'View files'}</button><button onClick={() => setNotice('Preview refreshed from revision ' + revision.id.slice(-6))}>↻</button><button onClick={publish} className="toolbar-publish">Publish <ArrowIcon /></button></div></div><div className="preview-stage"><div className={'browser-frame ' + device}><div className="browser-chrome"><div className="browser-dots"><i></i><i></i><i></i></div><div className="browser-url"><span>⌕</span> preview.forgehouse.site/{selected.slug}</div><span className="browser-menu">•••</span></div><iframe title="Live website preview" sandbox="allow-scripts" srcDoc={srcDoc}></iframe>{showFiles && <div className="file-drawer"><div className="file-drawer-head"><b>Project files</b><span>{revision.files.length} files</span></div>{revision.files.map(file => <div className="file-row" key={file.path}><span className="file-icon">{file.path.endsWith('.css') ? '◈' : file.path.endsWith('.js') ? '◇' : '◉'}</span>{file.path}<span>›</span></div>)}</div>}</div></div></div>
        <aside className="inspector panel"><div className="inspector-tabs"><button className="active">Changes</button><button>Files</button></div><div className="inspector-content"><div className="change-summary"><div className="summary-icon"><SparkIcon /></div><div><span className="heading-kicker">CURRENT REVISION</span><h3>{revision.label}</h3><p>{revision.summary}</p></div></div><div className="change-stats"><div><b>{revision.files.length}</b><span>Files</span></div><div><b>{selected.revisions.length}</b><span>Versions</span></div><div><b>Live</b><span>Preview</span></div></div><div className="revision-heading"><span>Version history</span><button onClick={() => setNotice('All revisions are immutable and restorable.')}>About revisions</button></div><div className="revision-list">{selected.revisions.slice(0, 6).map((item, index) => <div className={'revision-item ' + (index === 0 ? 'current' : '')} key={item.id}><div className="revision-marker"><i></i></div><div className="revision-body"><div><b>{item.label}</b>{index === 0 && <span className="current-pill">Current</span>}</div><p>{item.summary}</p><small>{formatDate(item.createdAt)}</small>{index > 0 && <button className="restore-button" onClick={() => restore(item.id)}>Restore this version</button>}</div></div>)}</div></div><div className="inspector-footer"><span>Protected workspace</span><span className="lock">⌑</span></div></aside>
      </section>
      {notice && <div className="toast"><span className="toast-check">✓</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
    </main>
  </div>;
}
