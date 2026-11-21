/**
 * Number a note's equations straight from its source text, for when the metadata cache is behind the editor.
 */

import { findBlockLinks } from './links';
import { linesOf, scanMathBlocks } from './math-source';
import { EquationLabel, EquationSource, numberEquations } from './numbering';

export interface NoteEquations {
	/** Top-level display equations in document order. */
	equations: EquationSource[];
	/** Block IDs linked from the note itself with `[[#^id]]`. */
	linked: Set<string>;
}

/** Read the equations and same-note block links out of a note's text. */
export function readNoteEquations(text: string): NoteEquations {
	const equations = scanMathBlocks(linesOf(text)).map(({ id, tex }) => ({ id, tex }));
	const linked = new Set(findBlockLinks(text).filter((link) => !link.path).map((link) => link.id));
	return { equations, linked };
}

/**
 * Number the equations of `note` the way the index does.
 * `isReferencedElsewhere` covers links the text alone cannot resolve, such as links from other notes.
 */
export function numberNoteEquations(
	note: NoteEquations,
	isReferencedElsewhere: (id: string) => boolean = () => false,
): Map<string, EquationLabel> {
	return numberEquations(note.equations, (id) => note.linked.has(id) || isReferencedElsewhere(id));
}
