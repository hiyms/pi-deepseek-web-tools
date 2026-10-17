import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type CardTone = "pending" | "success" | "error";

export interface CardSpec {
	title: string;
	meta?: string;
	children: Component[];
	tone: CardTone;
}

/**
 * A width-safe card frame. pi-tui's Text and Markdown components pad every line
 * to the requested width, so the frame is drawn around their output instead of
 * nesting them inside a Box.
 */
export class Card implements Component {
	constructor(
		private readonly spec: CardSpec,
		private readonly theme: Theme,
	) {}

	invalidate(): void {
		for (const child of this.spec.children) child.invalidate();
	}

	render(width: number): string[] {
		const cardWidth = Math.max(8, Math.floor(width));
		const innerWidth = cardWidth - 2;
		const backgroundToken =
			this.spec.tone === "pending" ? "toolPendingBg" : this.spec.tone === "error" ? "toolErrorBg" : "toolSuccessBg";
		const borderToken = this.spec.tone === "error" ? "error" : this.spec.tone === "pending" ? "borderMuted" : "border";
		const border = (text: string): string => this.theme.fg(borderToken, text);
		const background = (text: string): string => this.theme.bg(backgroundToken, text);

		const lines: string[] = [this.renderTop(cardWidth, border)];
		if (this.spec.meta) {
			const meta = truncateToWidth(this.spec.meta, Math.max(0, innerWidth - 1), "…", false);
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(meta) - 1));
			lines.push(this.renderRow(padding + meta + " ", innerWidth, border));
		}
		for (const child of this.spec.children) {
			for (const line of child.render(innerWidth)) {
				lines.push(this.renderRow(line, innerWidth, border));
			}
		}
		lines.push(border(`╰${"─".repeat(cardWidth - 2)}╯`));
		return lines.map(background);
	}

	private renderTop(width: number, border: (text: string) => string): string {
		const title = ` ${this.theme.bold(this.theme.fg("toolTitle", this.spec.title))} `;
		const maximumTitleWidth = Math.max(0, width - 4);
		const fitted = visibleWidth(title) > maximumTitleWidth
			? truncateToWidth(title, maximumTitleWidth, "…", false)
			: title;
		const fill = Math.max(0, width - 4 - visibleWidth(fitted));
		return border(`╭─${fitted}${"─".repeat(fill)}─╮`);
	}

	private renderRow(content: string, innerWidth: number, border: (text: string) => string): string {
		const fitted = truncateToWidth(content, innerWidth, "…", true);
		return border("│") + fitted + border("│");
	}
}
