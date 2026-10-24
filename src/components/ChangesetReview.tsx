import { useState } from 'react';
import { api } from '../api';
import type { ChangeSet, Project } from '../types';
import { Modal } from './Modal';

export function ChangesetReview({ changeset, project, onClose, onApplied }: {
  changeset: ChangeSet;
  project?: Project;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    setError('');
    try {
      await api.applyChange(changeset.id);
      await onApplied();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the change.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Review changeset" subtitle={(project?.name ?? changeset.projectId) + ' · ' + changeset.path} onClose={onClose} wide>
      <div className="changeset-review">
        <div className="review-meta"><span>Reason</span><strong>{changeset.reason}</strong></div>
        <pre>{changeset.content}</pre>
        <div className="approval-box">
          <div><strong>Apply to the registered workspace</strong><p>The server will reject this write if the source file changed since the proposal was created.</p></div>
          <label>Type APPLY<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button className="danger-button" onClick={apply} disabled={busy || confirmation !== 'APPLY'}>{busy ? 'Applying…' : 'Apply change'}</button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
