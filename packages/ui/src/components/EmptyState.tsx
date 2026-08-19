import * as React from "react";
import { Button } from "./Button";

export interface EmptyStateProps {
  title: string;
  body: string;
  /**
   * A single optional object, not two loose optional props — bundling label
   * and handler means a caller can't supply one without the other, which
   * would silently produce a no-op button.
   */
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="empty" data-testid="empty-state">
      <div className="oc-mark" aria-hidden="true" />
      <h4>{title}</h4>
      <p className="note-plain">{body}</p>
      {action ? <Button onClick={action.onPress}>{action.label}</Button> : null}
    </div>
  );
}
