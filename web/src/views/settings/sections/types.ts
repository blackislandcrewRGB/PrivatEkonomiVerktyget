/** What every compact section gets from the page. */
export interface SectionProps {
  open: boolean;
  onToggle: () => void;
  /** Whether the search lets these texts through (always, without a search). */
  match: (...texts: string[]) => boolean;
}
