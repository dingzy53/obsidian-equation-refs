/**
 * Equation labels for the note open in an editor, falling back to the live buffer
 * while the metadata cache has not caught up with an edit.
 */

import { Text } from '@codemirror/state';
import { NoteEquations, numberNoteEquations, readNoteEquations } from '../../core/live-numbering';
import { EquationLabel } from '../../core/numbering';
import type EquationRefsPlugin from '../../main';

const scans = new WeakMap<Text, NoteEquations>();

/** The label of equation `id` in the note at `path`, whose current text is `doc`. */
export function labelInDoc(plugin: EquationRefsPlugin, path: string, doc: Text, id: string): EquationLabel | undefined {
	const cached = plugin.numbers.get(path, id);
	if (cached) return cached;

	let note = scans.get(doc);
	if (!note) {
		note = readNoteEquations(doc.toString());
		scans.set(doc, note);
	}
	if (!note.linked.has(id) && !plugin.numbers.isReferenced(path, id)) return undefined;
	return numberNoteEquations(note, (other) => plugin.numbers.isReferenced(path, other)).get(id);
}
