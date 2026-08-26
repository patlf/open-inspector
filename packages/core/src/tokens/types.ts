/**
 * The input to every emitter.
 *
 * Deliberately a flat, plain shape rather than the analysis modules' richer
 * types: emitters are pure text transformers, and keeping them ignorant of how
 * the data was gathered is what makes their output exactly testable and lets
 * the extraction side change freely.
 */

export interface ColorToken {
  /** Explicit name, if the caller has one. Otherwise derived. */
  name?: string | undefined;
  hex: string;
  rgb?: string | undefined;
  /** How many elements use it. Drives ordering and naming. */
  usage?: number | undefined;
  /** text | background | border | accent */
  role?: string | undefined;
}

export interface FontToken {
  family: string;
  weights?: number[] | undefined;
  usage?: number | undefined;
}

export interface SizeToken {
  px: number;
  rem?: number | undefined;
  usage?: number | undefined;
}

export interface ShadowToken {
  value: string;
  usage?: number | undefined;
}

export interface TokenSet {
  colors: ColorToken[];
  fonts: FontToken[];
  fontSizes: SizeToken[];
  spacing: SizeToken[];
  radii?: SizeToken[] | undefined;
  shadows?: ShadowToken[] | undefined;
  /** Free-form notes surfaced in the LLM handoff, e.g. layout findings. */
  notes?: string[] | undefined;
  /** Where these were taken from. Only used in comments and the handoff. */
  source?: string | undefined;
}

/** A named token, after naming has been resolved. */
export interface NamedToken<T> {
  name: string;
  token: T;
}
