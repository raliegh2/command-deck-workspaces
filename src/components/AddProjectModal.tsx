import { FormEvent, useState } from 'react';
import { api } from '../api';
import { Modal } from './Modal';

export function AddProjectModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api.registerProject({
        id: String(data.get('id')),
        name: String(data.get('name')),
        root: String(data.get('root')),
        kind: String(data.get('kind')),
        teamId: String(data.get('teamId')),
        description: String(data.get('description') || 'Registered project workspace.'),
      });
      await onAdded();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not register this project.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a project" subtitle="Only this approved local path will be available to the hub." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>Project name<input name="name" placeholder="My project" required minLength={2} /></label>
        <label>Project ID<input name="id" placeholder="my-project" required pattern="[a-z0-9-]+" /></label>
        <label>Absolute local path<input name="root" placeholder="C:/Users/you/projects/my-project" required /></label>
        <div className="form-grid">
          <label>Project type<select name="kind" defaultValue="other"><option value="security">Security</option><option value="builder">Builder</option><option value="integration">Integration</option><option value="other">Other</option></select></label>
          <label>Owner team<select name="teamId" defaultValue="integration-desk"><option value="security-cell">Security Cell</option><option value="build-studio">Build Studio</option><option value="integration-desk">Integration Desk</option><option value="knowledge-crew">Knowledge Crew</option></select></label>
        </div>
        <label>Description<textarea name="description" placeholder="What this project does and how the hub should treat it." /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Registering…' : 'Register project'}</button></div>
      </form>
    </Modal>
  );
}
