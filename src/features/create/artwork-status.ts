/**
 * The artwork import's user-facing state, shared between the wizard that owns
 * the request and the Brief step that displays it.
 *
 * `unavailable` is kept apart from `none` deliberately. They look the same to a
 * user staring at an empty media list, but one is a normal event with no artwork
 * and the other is a connection or permission gap that nobody will notice unless
 * it is said out loud.
 */

export type ArtworkUiStatus =
  | 'loading'
  | 'imported'
  | 'reused'
  | 'partial'
  | 'in_progress'
  | 'none'
  | 'unavailable'
  | 'failed';

export interface ArtworkUiState {
  status: ArtworkUiStatus;
  warning: string | null;
}

/** The line shown under the import control. Null means say nothing. */
export function describeArtworkState(state: ArtworkUiState | null): string | null {
  if (!state) return null;

  switch (state.status) {
    case 'loading':
      return 'Fetching event artwork...';
    case 'imported':
    case 'reused':
      return state.warning ?? 'Event artwork imported and attached.';
    case 'partial':
      return state.warning ?? 'Some event artwork could not be read.';
    case 'in_progress':
      return 'This artwork is already being imported. It will appear in your library shortly.';
    case 'none':
      return state.warning ?? 'This event has no artwork in the management app.';
    case 'unavailable':
      return (
        state.warning ??
        'Artwork import is not available for this management app connection.'
      );
    case 'failed':
      return state.warning ?? 'Event artwork could not be imported. Add media in the next step.';
    default:
      return null;
  }
}

/** Whether the line reads as a problem, for styling and for `role`. */
export function isArtworkProblem(state: ArtworkUiState | null): boolean {
  return state?.status === 'failed' || state?.status === 'unavailable';
}
