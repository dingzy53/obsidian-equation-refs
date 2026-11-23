import { ChangeSet, EditorState, Prec, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
	blockAtLine,
	classifyEquation,
	linesOf,
	normalizeEquationTex,
	resolveHoverEquationId,
	scanMathBlocks,
	stripTexComments,
} from '../src/core/math-source';
import { numberEquations, sameLabels } from '../src/core/numbering';
import { blockIdFromSubpath, findBlockLinks, unnumberedLinkText } from '../src/core/links';
import { formatReference, validateTemplate } from '../src/core/format';
import { numberNoteEquations, readNoteEquations } from '../src/core/live-numbering';
import { expectedDisplayMathCount, shouldAttachPendingMath } from '../src/core/pending-math';

describe('scanMathBlocks', () => {
	it('finds multi-line blocks with an ID on the next line', () => {
		const src = linesOf(['intro', '$$', 'a = b', '$$', '^eq-1', '', 'text'].join('\n'));
		expect(scanMathBlocks(src)).toEqual([{ startLine: 1, endLine: 4, id: 'eq-1', tex: 'a = b' }]);
	});

	it('finds single-line blocks with an inline ID', () => {
		const src = linesOf('$$ x^2 $$ ^sq');
		expect(scanMathBlocks(src)).toEqual([{ startLine: 0, endLine: 0, id: 'sq', tex: 'x^2' }]);
	});

	it('accepts an ID right after the closing delimiter', () => {
		const src = linesOf(['$$', 'y', '$$ ^why'].join('\n'));
		expect(scanMathBlocks(src)[0]?.id).toBe('why');
	});

	it('returns null IDs for unlabelled blocks', () => {
		const src = linesOf(['$$', 'y', '$$', 'next paragraph'].join('\n'));
		expect(scanMathBlocks(src)).toEqual([{ startLine: 0, endLine: 2, id: null, tex: 'y' }]);
	});

	it('skips code fences, quotes, lists and frontmatter', () => {
		const src = linesOf([
			'---', 'a: $$', '---',
			'```', '$$', 'in code', '$$', '```',
			'> $$', '> quoted', '> $$',
			'- $$ item $$',
			'$$', 'real', '$$', '^r',
		].join('\n'));
		expect(scanMathBlocks(src).map((b) => b.id)).toEqual(['r']);
	});

	it('stops at an unclosed block', () => {
		expect(scanMathBlocks(linesOf('$$\na\nb'))).toEqual([]);
	});

	it('limits the scan to a line range but looks past it for the ID', () => {
		const src = linesOf(['$$', 'a', '$$', '^a', '', '$$', 'b', '$$', '^b'].join('\n'));
		expect(scanMathBlocks(src, 5, 7).map((b) => b.id)).toEqual(['b']);
	});

	it('maps lines to blocks', () => {
		const blocks = scanMathBlocks(linesOf(['$$', 'a', '$$', '^a', 'after'].join('\n')));
		expect(blockAtLine(blocks, 0)?.id).toBe('a');
		expect(blockAtLine(blocks, 3)?.id).toBe('a');
		expect(blockAtLine(blocks, 4)?.id).toBe('a');
		expect(blockAtLine(blocks, 5)).toBeNull();
	});
});

describe('classifyEquation', () => {
	it('detects automatic, tagged and unnumbered equations', () => {
		expect(classifyEquation('a = b')).toEqual({ kind: 'auto' });
		expect(classifyEquation('a = b \\tag{A.1}')).toEqual({ kind: 'tag', tag: 'A.1' });
		expect(classifyEquation('a = b \\tag*{x}')).toEqual({ kind: 'tag', tag: 'x' });
		expect(classifyEquation('a = b \\notag')).toEqual({ kind: 'none' });
		expect(classifyEquation('a = b \\nonumber')).toEqual({ kind: 'none' });
	});

	it('ignores commands in comments and similar names', () => {
		expect(classifyEquation('a % \\tag{x}')).toEqual({ kind: 'auto' });
		expect(classifyEquation('a \\notagged')).toEqual({ kind: 'auto' });
		expect(stripTexComments('50\\% % note')).toBe('50\\% ');
	});
});

describe('numberEquations', () => {
	const eqs = [
		{ id: 'a', tex: 'a' },
		{ id: 'b', tex: 'b' },
		{ id: null, tex: 'c' },
		{ id: 't', tex: 't \\tag{*}' },
		{ id: 'n', tex: 'n \\notag' },
		{ id: 'd', tex: 'd' },
	];

	it('numbers only referenced equations, in order', () => {
		const labels = numberEquations(eqs, (id) => id !== 'b');
		expect(Object.fromEntries(labels)).toEqual({
			a: { text: '1', tagged: false },
			t: { text: '*', tagged: true },
			d: { text: '2', tagged: false },
		});
	});

	it('numbers nothing when nothing is referenced', () => {
		expect(numberEquations(eqs, () => false).size).toBe(0);
	});

	it('compares label maps', () => {
		const one = numberEquations(eqs, () => true);
		expect(sameLabels(one, numberEquations(eqs, () => true))).toBe(true);
		expect(sameLabels(one, numberEquations(eqs, (id) => id !== 'a'))).toBe(false);
		expect(sameLabels(undefined, new Map())).toBe(true);
	});
});

describe('links', () => {
	it('parses block subpaths', () => {
		expect(blockIdFromSubpath('#^abc-1')).toBe('abc-1');
		expect(blockIdFromSubpath('#heading')).toBeNull();
		expect(blockIdFromSubpath('')).toBeNull();
	});

	it('finds unaliased block links and skips aliases and embeds', () => {
		const text = 'see [[Maxwell#^gauss]], [[#^self]], [[A#^x|alias]], ![[B#^y]], [[C#head]]';
		expect(findBlockLinks(text).map(({ path, id, linktext }) => ({ path, id, linktext }))).toEqual([
			{ path: 'Maxwell', id: 'gauss', linktext: 'Maxwell#^gauss' },
			{ path: '', id: 'self', linktext: '#^self' },
		]);
		const [first] = findBlockLinks(text);
		expect(text.slice(first?.from, first?.to)).toBe('[[Maxwell#^gauss]]');
	});
});

describe('format', () => {
	it('fills templates', () => {
		expect(formatReference('({n})', { n: '3', note: 'Maxwell' })).toBe('(3)');
		expect(formatReference('{note} ({n})', { n: '3', note: 'Maxwell' })).toBe('Maxwell (3)');
	});

	it('validates templates', () => {
		expect(validateTemplate('({n})')).toBeUndefined();
		expect(validateTemplate('(x)')).toBeTypeOf('string');
	});
});

describe('live note numbering', () => {
	const labels = (text: string, elsewhere?: (id: string) => boolean) =>
		Object.fromEntries([...numberNoteEquations(readNoteEquations(text), elsewhere)].map(([id, l]) => [id, l.text]));

	it('numbers an equation linked from the same note', () => {
		const text = ['$$', 'a^2 + b^2 = c^2', '$$', '^pyth', '', 'Pythagoras: [[#^pyth]].'].join('\n');
		expect(numberNoteEquations(readNoteEquations(text)).get('pyth')).toEqual({ text: '1', tagged: false });
	});

	it('skips unreferenced equations', () => {
		const text = ['$$ x $$ ^a', '$$ y $$ ^b', 'See [[#^b]].'].join('\n');
		expect(labels(text)).toEqual({ b: '1' });
	});

	it('counts references from elsewhere in document order', () => {
		const text = ['$$ x $$ ^a', '$$ y $$ ^pyth', 'See [[#^pyth]].'].join('\n');
		expect(labels(text, (id) => id === 'a')).toEqual({ a: '1', pyth: '2' });
	});

	it('ignores links to other notes and embeds', () => {
		const text = ['$$ x $$ ^x', '[[Other#^x]] ![[#^x]]'].join('\n');
		expect(readNoteEquations(text).linked.size).toBe(0);
		expect(labels(text)).toEqual({});
	});

	it('keeps manual tags and skips \\notag', () => {
		const text = ['$$ x \\notag $$ ^n', '$$ y \\tag{A} $$ ^t', '$$ z $$ ^z', '[[#^n]] [[#^t]] [[#^z]]'].join('\n');
		expect(labels(text)).toEqual({ t: 'A', z: '1' });
	});
});

describe('unnumberedLinkText', () => {
	it('shows a same-note block link as its link text', () => {
		const [link] = findBlockLinks('See [[#^para]].');
		expect(link && unnumberedLinkText(link)).toBe('#^para');
	});

	it('leaves links to other notes to Obsidian', () => {
		const [link] = findBlockLinks('See [[Other#^para]].');
		expect(link && unnumberedLinkText(link)).toBeNull();
	});
});

describe('pending reading-view math helpers', () => {
	it('computes expected display math count from source blocks or placeholders', () => {
		expect(expectedDisplayMathCount(3, 0)).toBe(3);
		expect(expectedDisplayMathCount(2, 1)).toBe(2);
		expect(expectedDisplayMathCount(0, 2)).toBe(2);
		expect(expectedDisplayMathCount(null, 2)).toBe(2);
		expect(expectedDisplayMathCount(0, 0)).toBe(0);
		expect(expectedDisplayMathCount(null, -3)).toBe(0);
	});

	it('waits for all expected equations unless partial attachment is allowed', () => {
		expect(shouldAttachPendingMath(0, 2, false)).toBe(false);
		expect(shouldAttachPendingMath(0, 2, true)).toBe(false);
		expect(shouldAttachPendingMath(1, 2, false)).toBe(false);
		expect(shouldAttachPendingMath(2, 2, false)).toBe(true);
		expect(shouldAttachPendingMath(1, 2, true)).toBe(true);
	});
});

describe('hover popover TeX helpers', () => {
	it('normalizes display math blocks with or without delimiters and block IDs', () => {
		expect(normalizeEquationTex('$$\na = b +\n  c\n$$')).toBe('a = b + c');
		expect(normalizeEquationTex('$$ x^2 $$ ^sq')).toBe('x^2');
		expect(normalizeEquationTex('  a = b +\n  c  ')).toBe('a = b + c');
	});

	it('resolves hovered block IDs and falls back to unique TeX matches', () => {
		expect(resolveHoverEquationId('gauss', 'a = b', 'a = b', 'gauss')).toBe('gauss');
		// Mismatched TeX falls back to unique TeX match
		expect(resolveHoverEquationId('other', 'c = d', 'a = b', 'gauss')).toBe('gauss');
		// Ambiguous TeX returns null when hovered ID doesn't match
		expect(resolveHoverEquationId('other', 'c = d', 'a = b', null)).toBeNull();
		// Missing hovered ID falls back to unique TeX
		expect(resolveHoverEquationId(null, undefined, 'a = b', 'gauss')).toBe('gauss');
		expect(resolveHoverEquationId(null, undefined, null, 'gauss')).toBeNull();
	});
});

describe('live preview widget precedence (BUG-01)', () => {
	class TextWidget extends WidgetType {
		constructor(readonly label: string) {
			super();
		}

		eq(other: TextWidget): boolean {
			return other.label === this.label;
		}

		toDOM(): HTMLElement {
			return createSpan();
		}
	}

	it('emits updated replacement widgets without splitting over Obsidian delimiter replacements', () => {
		const doc = 'See [[#^faraday]] here.';
		const start = doc.indexOf('[[#^faraday]]');
		const end = start + '[[#^faraday]]'.length;
		const setLabel = StateEffect.define<string>();

		// Simulate Obsidian's default-precedence delimiter replacement `[[#` + `]]`.
		const obsField = StateField.define<DecorationSet>({
			create() {
				const b = new RangeSetBuilder<Decoration>();
				b.add(start, start + 3, Decoration.replace({}));
				b.add(end - 2, end, Decoration.replace({}));
				return b.finish();
			},
			update(value) {
				return value;
			},
		});

		const eqField = StateField.define<DecorationSet>({
			create() {
				const b = new RangeSetBuilder<Decoration>();
				b.add(start, end, Decoration.replace({ widget: new TextWidget('(2)') }));
				return b.finish();
			},
			update(value, tr) {
				for (const e of tr.effects) {
					if (e.is(setLabel)) {
						const b = new RangeSetBuilder<Decoration>();
						b.add(start, end, Decoration.replace({ widget: new TextWidget(e.value) }));
						return b.finish();
					}
				}
				return value;
			},
		});

		const obsExt = EditorView.decorations.from(obsField);
		const eqExt = Prec.high(EditorView.decorations.from(eqField));
		const state1 = EditorState.create({
			doc,
			extensions: [obsField, obsExt, eqField, eqExt],
		});
		const state2 = state1.update({ effects: setLabel.of('(3)') }).state;
		const sets1 = state1.facet(EditorView.decorations).map((s) => (typeof s === 'function' ? Decoration.none : s));
		const sets2 = state2.facet(EditorView.decorations).map((s) => (typeof s === 'function' ? Decoration.none : s));
		expect(sets1[0]).toBe(state1.field(eqField));

		// High-precedence eqField must appear before obsField in facet order:
		// comparing sets1 vs sets2 must report the full [start, end] range, not [start+3, end].
		const changedRanges: Array<[number, number]> = [];
		RangeSet.compare(
			sets1,
			sets2,
			ChangeSet.empty(doc.length),
			{
				compareRange() {},
				comparePoint(from: number, to: number) {
					changedRanges.push([from, to]);
				},
			},
		);
		expect(changedRanges).toEqual([[start, end]]);

		const updatedDeco = Decoration.replace({ widget: new TextWidget('(3)') });
		const emitted: Array<{ from: number; to: number; openStart: number; isUpdated: boolean }> = [];
		RangeSet.spans(
			sets2,
			start,
			end,
			{
				span() {},
				point(from: number, to: number, value: Decoration, _active, openStart: number) {
					emitted.push({
						from,
						to,
						openStart,
						isUpdated: value.eq(updatedDeco),
					});
				},
			},
		);
		expect(emitted).toEqual([{ from: start, to: end, openStart: 0, isUpdated: true }]);
	});
});
