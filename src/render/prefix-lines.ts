import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface PrefixLine {
	prefix: string;
	text: string;
	continuationPrefix?: string;
}

/**
 * Wraps each logical line with its own prefix. pi-tui's Text drops the leading
 * indentation when a long line wraps; result rows need to keep it.
 */
export class PrefixLines implements Component {
	constructor(private readonly lines: PrefixLine[]) {}

	invalidate(): void {}

	render(width: number): string[] {
		const output: string[] = [];
		for (const line of this.lines) {
			const continuation = line.continuationPrefix ?? line.prefix;
			const reserved = Math.max(visibleWidth(line.prefix), visibleWidth(continuation));
			const available = Math.max(1, width - reserved);
			for (const source of line.text.split("\n")) {
				const wrapped = source === "" ? [""] : wrapTextWithAnsi(source, available);
				for (let index = 0; index < wrapped.length; index++) {
					const usedPrefix = index === 0 ? line.prefix : continuation;
					output.push(truncateToWidth(usedPrefix + wrapped[index]!, width, "", true));
				}
			}
		}
		return output;
	}
}
