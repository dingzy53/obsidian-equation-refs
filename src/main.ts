import { Events, Plugin, TFile, parseLinktext } from 'obsidian';
import { HOVER_SOURCE, Restorable } from './constants';
import { formatReference } from './core/format';
import { blockIdFromSubpath } from './core/links';
import { EquationLabel } from './core/numbering';
import { EquationNumbers } from './index/equation-numbers';
import { equationNumbersInEditor } from './render/live-preview/equation-numbers';
import { referenceLinksInEditor } from './render/live-preview/reference-links';
import { createReadingViewProcessor } from './render/reading-view';
import { DEFAULT_SETTINGS, EquationRefsSettings, EquationRefsSettingTab, readSettings } from './settings';

export default class EquationRefsPlugin extends Plugin {
	settings: EquationRefsSettings = { ...DEFAULT_SETTINGS };
	numbers!: EquationNumbers;
	readonly rendered = new Set<Restorable>();
	private readonly hoveredBlocks = new Map<string, string>();

	async onload(): Promise<void> {
		this.settings = readSettings(await this.loadData());
		this.numbers = this.addChild(new EquationNumbers(this.app));

		this.addSettingTab(new EquationRefsSettingTab(this.app, this));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: this.manifest.name, defaultMod: true });
		const workspaceEvents: Events = this.app.workspace;
		this.registerEvent(workspaceEvents.on('hover-link', (payload: unknown) => this.recordHoverLink(payload)));
		this.registerMarkdownPostProcessor(createReadingViewProcessor(this));
		this.registerEditorExtension([equationNumbersInEditor(this), referenceLinksInEditor(this)]);
	}

	onunload(): void {
		for (const item of this.rendered) item.restore();
		this.rendered.clear();
		this.hoveredBlocks.clear();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.numbers.refreshAll();
	}

	/** Last block ID hovered for `path`, used to number multi-line block hover popovers. */
	hoveredBlockFor(path: string): string | null {
		return this.hoveredBlocks.get(path) ?? null;
	}

	private recordHoverLink(payload: unknown): void {
		if (!payload || typeof payload !== 'object') return;
		const { linktext, sourcePath } = payload as { linktext?: unknown; sourcePath?: unknown };
		if (typeof linktext !== 'string' || typeof sourcePath !== 'string') return;
		const { path, subpath } = parseLinktext(linktext);
		const target = path
			? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath)
			: this.app.vault.getFileByPath(sourcePath);
		if (!target) return;
		const id = blockIdFromSubpath(subpath);
		if (id) this.hoveredBlocks.set(target.path, id);
		else this.hoveredBlocks.delete(target.path);
	}

	/** The text shown for a link from `sourcePath` to an equation in `target`. */
	referenceText(sourcePath: string, target: TFile, label: EquationLabel): string {
		const template = sourcePath === target.path ? this.settings.sameNoteFormat : this.settings.otherNoteFormat;
		return formatReference(template, { n: label.text, note: target.basename });
	}
}
