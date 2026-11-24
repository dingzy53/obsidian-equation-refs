import { browser, expect } from '@wdio/globals';
import { before, beforeEach, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

async function openNote(notePath: string, mode: 'preview' | 'live-preview'): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, targetPath, viewMode) => {
			const file = app.vault.getFileByPath(targetPath);
			if (!file) throw new Error(`Missing vault file: ${targetPath}`);
			const leaf = app.workspace.getLeaf(false);
			const state = viewMode === 'preview' ? { mode: 'preview' } : { mode: 'source', source: false };
			await leaf.openFile(file, { state });
			app.workspace.setActiveLeaf(leaf, { focus: true });
		},
		notePath,
		mode,
	);

	await browser.waitUntil(
		async () =>
			browser.executeObsidian(
				({ app, obsidian }, expectedPath, viewMode) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					if (!view || view.file?.path !== expectedPath) return false;
					const mode = view.getMode();
					return viewMode === 'preview' ? mode === 'preview' : mode === 'source';
				},
				notePath,
				mode,
			),
		{ timeout: 10000, timeoutMsg: `Timed out opening ${notePath} in ${mode}` },
	);
}

describe('Equation Refs E2E', function () {
	before(async function () {
		await browser.executeObsidian(async ({ obsidian }) => {
			await obsidian.loadMathJax();
		});
	});

	beforeEach(async function () {
		await obsidianPage.resetVault('test-vault');
	});

	it('loads the equation-refs plugin cleanly', async function () {
		const enabled = await browser.executeObsidian(({ app }) => {
			const plugins = (app as unknown as { plugins: { enabledPlugins: Set<string> } }).plugins;
			return plugins.enabledPlugins.has('equation-refs');
		});
		expect(enabled).toBe(true);
	});

	it('numbers only linked display equations and formats in-note links in Reading view', async function () {
		await openNote('Maxwell.md', 'preview');

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					const root = view?.previewMode?.containerEl;
					if (!root) return false;
					return root.querySelectorAll('.MathJax.eqref-numbered').length === 3;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected 3 numbered MathJax equations in Reading view' },
		);

		const eqState = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.previewMode?.containerEl;
			if (!root) return null;
			return {
				numbers: Array.from(root.querySelectorAll('.MathJax.eqref-numbered')).map((el) =>
					el.getAttribute('data-eq-number'),
				),
				totalDisplayMath: root.querySelectorAll('mjx-container.MathJax[display="true"]').length,
			};
		});

		expect(eqState?.numbers).toEqual(['(1)', '(2)', '(3)']);
		// Maxwell.md has 7 display equations (6 top-level + 1 inside callout); only ^gauss, ^faraday, ^lorentz get numbers.
		expect(eqState?.totalDisplayMath).toBe(7);

		// Scroll Reading view to the bottom so the trailing links paragraph is rendered on compact viewports.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const scroller = view?.previewMode?.containerEl?.querySelector('.markdown-preview-view') ?? view?.previewMode?.containerEl;
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					const root = view?.previewMode?.containerEl;
					if (!root) return false;
					return root.querySelectorAll('a.internal-link.eqref-link').length === 3;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected 3 formatted in-note links in Reading view' },
		);

		const links = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.previewMode?.containerEl;
			if (!root) return null;
			const texts = (href: string) =>
				Array.from(root.querySelectorAll(`a.internal-link[data-href="${href}"]`)).map((el) => ({
					text: el.textContent?.trim(),
					formatted: el.classList.contains('eqref-link'),
				}));
			return {
				faraday: texts('#^faraday'),
				gauss: texts('#^gauss'),
				lorentz: texts('#^lorentz'),
			};
		});

		expect(links).toEqual({
			faraday: [{ text: '(2)', formatted: true }],
			gauss: [
				{ text: '(1)', formatted: true },
				{ text: "Gauss's law", formatted: false },
			],
			lorentz: [{ text: '(3)', formatted: true }],
		});
	});

	it('formats cross-note links and embedded equations in Reading view', async function () {
		await openNote('Notes.md', 'preview');

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					const root = view?.previewMode?.containerEl;
					if (!root) return false;
					const embedNum = root
						.querySelector('.internal-embed .MathJax.eqref-numbered')
						?.getAttribute('data-eq-number');
					const formattedLinks = root.querySelectorAll('a.internal-link.eqref-link').length;
					return embedNum === '(1)' && formattedLinks > 0;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected embedded equation and cross-note link in Notes.md' },
		);

		const result = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.previewMode?.containerEl;
			if (!root) return null;

			const gaussLinks = Array.from(root.querySelectorAll('a.internal-link[data-href="Maxwell#^gauss"]')).map(
				(el) => ({
					text: el.textContent?.trim(),
					formatted: el.classList.contains('eqref-link'),
				}),
			);
			const embedNumber = root
				.querySelector('.internal-embed .MathJax.eqref-numbered')
				?.getAttribute('data-eq-number');
			return { gaussLinks, embedNumber };
		});

		expect(result).toEqual({
			gaussLinks: [
				{ text: 'Maxwell (1)', formatted: true },
				{ text: 'Gauss', formatted: false },
			],
			embedNumber: '(1)',
		});
	});

	it('numbers equations and renders reference widgets in Live Preview', async function () {
		await openNote('Maxwell.md', 'live-preview');

		// Ensure cursor stays on line 0 (away from links) and scroll to the bottom so CodeMirror renders the links line.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!view) return;
			view.editor.setCursor({ line: 0, ch: 0 });
			const lastLine = view.editor.lastLine();
			view.editor.scrollIntoView({ from: { line: lastLine, ch: 0 }, to: { line: lastLine, ch: 0 } }, true);
		});

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					const root = view?.contentEl.querySelector('.markdown-source-view.is-live-preview');
					if (!root) return false;
					return root.querySelectorAll('.cm-hmd-internal-link.eqref-link').length === 3;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected reference link widgets in Live Preview' },
		);

		const lpLinks = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.contentEl.querySelector('.markdown-source-view.is-live-preview');
			if (!root) return null;
			return Array.from(root.querySelectorAll('.cm-hmd-internal-link.eqref-link')).map((el) =>
				el.textContent?.trim(),
			);
		});
		expect(lpLinks).toEqual(['(2)', '(1)', '(3)']);

		// Scroll back to top so the first numbered equations are in the CodeMirror viewport.
		await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!view) return;
			view.editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
		});

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					const root = view?.contentEl.querySelector('.markdown-source-view.is-live-preview');
					if (!root) return false;
					return root.querySelectorAll('.MathJax.eqref-numbered').length > 0;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected numbered equations in Live Preview' },
		);

		const lpFirstNum = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.contentEl.querySelector('.markdown-source-view.is-live-preview');
			return root?.querySelector('.MathJax.eqref-numbered')?.getAttribute('data-eq-number');
		});
		expect(lpFirstNum).toBe('(1)');
	});

	it('updates equation numbers dynamically when a new reference is added', async function () {
		await openNote('Maxwell.md', 'preview');

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					return (view?.previewMode?.containerEl.querySelectorAll('.MathJax.eqref-numbered').length ?? 0) === 3;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected initial 3 numbered equations in Maxwell.md' },
		);

		await browser.executeObsidian(async ({ app }) => {
			const notes = app.vault.getFileByPath('Notes.md');
			if (!notes) throw new Error('Missing Notes.md');
			const content = await app.vault.read(notes);
			await app.vault.modify(notes, `${content}\n\nNow linked: [[Maxwell#^no-monopoles]].\n`);
		});

		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app, obsidian }) => {
					const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					return (view?.previewMode?.containerEl.querySelectorAll('.MathJax.eqref-numbered').length ?? 0) === 4;
				}),
			{ timeout: 10000, timeoutMsg: 'Expected dynamic renumbering to 4 equations after linking ^no-monopoles' },
		);

		const updatedNumbers = await browser.executeObsidian(({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			const root = view?.previewMode?.containerEl;
			if (!root) return [];
			return Array.from(root.querySelectorAll('.MathJax.eqref-numbered')).map((el) =>
				el.getAttribute('data-eq-number'),
			);
		});
		expect(updatedNumbers).toEqual(['(1)', '(2)', '(3)', '(4)']);
	});
});
