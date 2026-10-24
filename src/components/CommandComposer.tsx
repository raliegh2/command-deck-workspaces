import { ArrowRight, CornerDownRight, LoaderCircle } from 'lucide-react';
import { FormEvent, useState } from 'react';

export function CommandComposer({ onDispatch, busy, disabled = false }: { onDispatch: (prompt: string) => Promise<void>; busy: boolean; disabled?: boolean }) {
  const [prompt, setPrompt] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 3 || busy || disabled) return;
    await onDispatch(prompt.trim());
    setPrompt('');
  }
  return (
    <form className="command-form" onSubmit={submit}>
      <div className="command-field">
        <CornerDownRight size={20} strokeWidth={1.6} aria-hidden="true" />
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask the hub to investigate, change, or build…"
          aria-label="Command for the hub"
          disabled={disabled}
          title={disabled ? 'Dispatch runs from the local Command Deck.' : undefined}
        />
        <button type="submit" disabled={disabled || busy || prompt.trim().length < 3}>
          {busy ? <LoaderCircle className="spin" size={19} /> : null}
          <span>{disabled ? 'Local only' : busy ? 'Routing' : 'Dispatch'}</span>
          {!busy ? <ArrowRight size={21} strokeWidth={2} /> : null}
        </button>
      </div>
      <div className="routing-caption">
        <span />
        <p>{disabled ? 'Open the local Command Deck to dispatch work or change project files.' : 'Your request will be routed to the right agents and project workspace.'}</p>
      </div>
    </form>
  );
}
