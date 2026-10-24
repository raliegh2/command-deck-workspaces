import { File, Folder, GitBranch, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Project } from '../types';
import { Modal } from './Modal';
import { Status } from './Status';

interface OpenFile { path: string; content: string; hash: string; size: number }

export function ProjectDrawer({ project, onClose, onChanged }: { project: Project; onClose: () => void; onChanged: () => Promise<void> }) {
  const [files, setFiles] = useState<Array<{ path: string; type: 'file' | 'directory' }>>([]);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project.exists) return;
    api.files(project.id).then((result) => setFiles(result.files)).catch((error) => setMessage(error.message));
  }, [project]);

  async function open(path: string) {
    setBusy(true);
    setMessage('');
    try {
      const file = await api.file(project.id, path);
      setOpenFile(file);
      setContent(file.content);
      setReason('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the file.');
    } finally {
      setBusy(false);
    }
  }

  async function stage() {
    if (!openFile || reason.trim().length < 3 || content === openFile.content) return;
    setBusy(true);
    try {
      await api.stageChange({ projectId: project.id, path: openFile.path, content, reason, baseHash: openFile.hash });
      setMessage('Changeset staged. Review it in Work queue before applying.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not stage this change.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={project.name} subtitle={project.description} onClose={onClose} wide>
      <div className="project-meta">
        <Status state={project.state} />
        <span><GitBranch size={15} />{project.isGit ? (project.dirty ? 'Git · local changes' : 'Git · clean') : 'Folder workspace'}</span>
        <code>{project.root ?? 'Local path not registered'}</code>
      </div>
      {!project.exists ? (
        <div className="setup-callout"><strong>This project needs a local path.</strong><p>Use “Add project” after cloning or locating the workspace. No agent can read or change it until then.</p>{project.remoteUrl ? <a href={project.remoteUrl} target="_blank" rel="noreferrer">Open repository ↗</a> : null}</div>
      ) : (
        <div className="workspace-browser">
          <aside>
            <h3>Workspace files</h3>
            <div className="file-list">
              {files.map((entry) => entry.type === 'directory' ? (
                <div className="folder-row" key={entry.path}><Folder size={15} />{entry.path}</div>
              ) : (
                <button className={openFile?.path === entry.path ? 'file-row active' : 'file-row'} key={entry.path} onClick={() => open(entry.path)}><File size={15} />{entry.path}</button>
              ))}
            </div>
          </aside>
          <main className="editor-pane">
            {busy && !openFile ? <LoaderCircle className="spin center-loader" /> : openFile ? (
              <>
                <div className="editor-heading"><strong>{openFile.path}</strong><span>{openFile.size.toLocaleString()} bytes</span></div>
                <textarea className="code-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
                <div className="stage-bar">
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this change" />
                  <button className="primary-button" onClick={stage} disabled={busy || reason.trim().length < 3 || content === openFile.content}><Save size={16} />Stage for review</button>
                </div>
              </>
            ) : <div className="editor-empty"><File size={28} /><strong>Select a source file</strong><p>Read it here, prepare an edit, then stage a hash-checked changeset for approval.</p></div>}
          </main>
        </div>
      )}
      {message ? <p className="drawer-message">{message}</p> : null}
    </Modal>
  );
}
