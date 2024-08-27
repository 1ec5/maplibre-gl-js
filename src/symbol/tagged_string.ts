import type {Formatted, FormattedSection, VerticalAlign} from '@maplibre/maplibre-gl-style-spec';

import ONE_EM from './one_em';
import type {ImagePosition} from '../render/image_atlas';
import type {StyleGlyph} from '../style/style_glyph';
import {verticalizePunctuation} from '../util/verticalize_punctuation';
import {charIsWhitespace, segmenter, splitByGraphemeCluster} from '../util/script_detection';
import {codePointAllowsIdeographicBreaking} from '../util/unicode_properties.g';
import {warnOnce} from '../util/util';

export type TextSectionOptions = {
    scale: number;
    verticalAlign: VerticalAlign;
    fontStack: string;
};

export type ImageSectionOptions = {
    scale: number;
    verticalAlign: VerticalAlign;
    imageName: string;
};

export type SectionOptions = TextSectionOptions | ImageSectionOptions;

// Max number of images in label is 6401 U+E000–U+F8FF that covers
// Basic Multilingual Plane Unicode Private Use Area (PUA).
const PUAbegin = 0xE000;
const PUAend = 0xF8FF;

type Break = {
    index: number;
    x: number;
    priorBreak: Break;
    badness: number;
};

const wordSegmenter = ('Segmenter' in Intl) ? new Intl.Segmenter(undefined, {granularity: 'word'}) : {
    // Polyfill for Intl.Segmenter with word granularity for the purpose of line breaking
    segment: (text: String) => {
        // Prefer breaking on an individual CJKV ideograph instead of keeping the entire run of CJKV together.
        const segments = text.split(/\b|(?=\p{Ideo})/u).map((segment, index) => ({
            index,
            segment,
        }));
        return {
            containing: (index: number) => segments.find(s => s.index <= index && s.index + s.segment.length > index),
            [Symbol.iterator]: () => segments[Symbol.iterator](),
        };
    },
};

function getGlyphAdvance(
    grapheme: string,
    section: SectionOptions,
    glyphMap: {
        [_: string]: {
            [_: string]: StyleGlyph;
        };
    },
    imagePositions: {[_: string]: ImagePosition},
    spacing: number,
    layoutTextSize: number
): number {
    if ('fontStack' in section) {
        const positions = glyphMap[section.fontStack];
        const glyph = positions && positions[grapheme];
        if (!glyph) return 0;
        return glyph.metrics.advance * section.scale + spacing;
    } else {
        const imagePosition = imagePositions[section.imageName];
        if (!imagePosition) return 0;
        return imagePosition.displaySize[0] * section.scale * ONE_EM / layoutTextSize + spacing;
    }
}

function calculateBadness(lineWidth: number,
    targetWidth: number,
    penalty: number,
    isLastBreak: boolean) {
    const raggedness = Math.pow(lineWidth - targetWidth, 2);
    if (isLastBreak) {
        // Favor finals lines shorter than average over longer than average
        if (lineWidth < targetWidth) {
            return raggedness / 2;
        } else {
            return raggedness * 2;
        }
    }

    return raggedness + Math.abs(penalty) * penalty;
}

function calculatePenalty(codePoint: number, nextCodePoint: number) {
    let penalty = 0;
    // Force break on newline
    if (codePoint === 0x0a) {
        penalty -= 10000;
    }

    // Penalize open parenthesis at end of line
    if (codePoint === 0x28 || codePoint === 0xff08) {
        penalty += 50;
    }

    // Penalize close parenthesis at beginning of line
    if (nextCodePoint === 0x29 || nextCodePoint === 0xff09) {
        penalty += 50;
    }
    return penalty;
}

function evaluateBreak(
    breakIndex: number,
    breakX: number,
    targetWidth: number,
    potentialBreaks: Array<Break>,
    penalty: number,
    isLastBreak: boolean
): Break {
    // We could skip evaluating breaks where the line length (breakX - priorBreak.x) > maxWidth
    //  ...but in fact we allow lines longer than maxWidth (if there's no break points)
    //  ...and when targetWidth and maxWidth are close, strictly enforcing maxWidth can give
    //     more lopsided results.

    let bestPriorBreak: Break = null;
    let bestBreakBadness = calculateBadness(breakX, targetWidth, penalty, isLastBreak);

    for (const potentialBreak of potentialBreaks) {
        const lineWidth = breakX - potentialBreak.x;
        const breakBadness =
            calculateBadness(lineWidth, targetWidth, penalty, isLastBreak) + potentialBreak.badness;
        if (breakBadness <= bestBreakBadness) {
            bestPriorBreak = potentialBreak;
            bestBreakBadness = breakBadness;
        }
    }

    return {
        index: breakIndex,
        x: breakX,
        priorBreak: bestPriorBreak,
        badness: bestBreakBadness
    };
}

function leastBadBreaks(lastLineBreak?: Break | null): Array<number> {
    if (!lastLineBreak) {
        return [];
    }
    return leastBadBreaks(lastLineBreak.priorBreak).concat(lastLineBreak.index);
}

export class TaggedString {
    text: string;
    sections: Array<SectionOptions>;
    /** Maps each character in `text` to its corresponding entry in `sections`. */
    sectionIndex: Array<number>;
    imageSectionID: number | null;

    constructor(text: string = '', sections: Array<SectionOptions> = [], sectionIndex: Array<number> = []) {
        this.text = text;
        this.sections = sections;
        this.sectionIndex = sectionIndex;
        this.imageSectionID = null;
    }

    static fromFeature(text: Formatted, defaultFontStack: string) {
        const result = new TaggedString();
        for (let i = 0; i < text.sections.length; i++) {
            const section = text.sections[i];
            if (!section.image) {
                result.addTextSection(section, defaultFontStack);
            } else {
                result.addImageSection(section);
            }
        }
        return result;
    }

    length(): number {
        return splitByGraphemeCluster(this.text).length;
    }

    getSection(index: number): SectionOptions {
        return this.sections[this.sectionIndex[index]];
    }

    getSectionIndex(index: number): number {
        return this.sectionIndex[index];
    }

    verticalizePunctuation() {
        this.text = verticalizePunctuation(this.text);
    }

    trim() {
        const leadingWhitespace = this.text.match(/^\s*/);
        const leadingLength = leadingWhitespace ? leadingWhitespace[0].length : 0;
        // Require a preceding non-space character to avoid overlapping leading and trailing matches.
        const trailingWhitespace = this.text.match(/\S\s*$/);
        const trailingLength = trailingWhitespace ? trailingWhitespace[0].length - 1 : 0;
        this.text = this.text.substring(leadingLength, this.text.length - trailingLength);
        this.sectionIndex = this.sectionIndex.slice(leadingLength, this.sectionIndex.length - trailingLength);
    }

    substring(start: number, end: number): TaggedString {
        const text = splitByGraphemeCluster(this.text).slice(start, end).map(s => s.segment).join('');
        const sectionIndex = this.sectionIndex.slice(start, end);
        return new TaggedString(text, this.sections, sectionIndex);
    }

    /**
     * Converts a grapheme cluster index to a UTF-16 code unit (JavaScript character index).
     */
    toCodeUnitIndex(unicodeIndex: number): number {
        return splitByGraphemeCluster(this.text).slice(0, unicodeIndex).map(s => s.segment).join('').length;
    }

    toString(): string {
        return this.text;
    }

    getMaxScale() {
        return this.sectionIndex.reduce((max, index) => Math.max(max, this.sections[index].scale), 0);
    }

    getMaxImageSize(imagePositions: {[_: string]: ImagePosition}): {
        maxImageWidth: number;
        maxImageHeight: number;
    } {
        let maxImageWidth = 0;
        let maxImageHeight = 0;
        for (let i = 0; i < this.length(); i++) {
            const section = this.getSection(i);
            if ('imageName' in section) {
                const imagePosition = imagePositions[section.imageName];
                if (!imagePosition) continue;
                const size = imagePosition.displaySize;
                maxImageWidth = Math.max(maxImageWidth, size[0]);
                maxImageHeight = Math.max(maxImageHeight, size[1]);
            }
        }
        return {maxImageWidth, maxImageHeight};
    }

    addTextSection(section: FormattedSection, defaultFontStack: string) {
        this.text += section.text;
        this.sections.push({
            scale: section.scale || 1,
            verticalAlign: section.verticalAlign || 'bottom',
            fontStack: section.fontStack || defaultFontStack,
        } as TextSectionOptions);
        const index = this.sections.length - 1;
        this.sectionIndex.push(...splitByGraphemeCluster(section.text).map(() => index));
    }

    addImageSection(section: FormattedSection) {
        const imageName = section.image ? section.image.name : '';
        if (imageName.length === 0) {
            warnOnce('Can\'t add FormattedSection with an empty image.');
            return;
        }

        const nextImageSectionCharCode = this.getNextImageSectionCharCode();
        if (!nextImageSectionCharCode) {
            warnOnce(`Reached maximum number of images ${PUAend - PUAbegin + 2}`);
            return;
        }

        this.text += String.fromCharCode(nextImageSectionCharCode);
        this.sections.push({
            scale: 1,
            verticalAlign: section.verticalAlign || 'bottom',
            imageName,
        } as ImageSectionOptions);
        this.sectionIndex.push(this.sections.length - 1);
    }

    getNextImageSectionCharCode(): number | null {
        if (!this.imageSectionID) {
            this.imageSectionID = PUAbegin;
            return this.imageSectionID;
        }

        if (this.imageSectionID >= PUAend) return null;
        return ++this.imageSectionID;
    }

    determineLineBreaks(
        spacing: number,
        maxWidth: number,
        glyphMap: {
            [_: string]: {
                [_: string]: StyleGlyph;
            };
        },
        imagePositions: {[_: string]: ImagePosition},
        layoutTextSize: number
    ): Array<number> {
        const potentialLineBreaks = [];
        const targetWidth = this.determineAverageLineWidth(spacing, maxWidth, glyphMap, imagePositions, layoutTextSize);

        let currentX = 0;
        let graphemeIndex = 0;
        for (const {index: wordIndex, segment: word} of wordSegmenter.segment(this.text)) {
            const graphemes = splitByGraphemeCluster(word);
            for (const {segment: grapheme} of graphemes) {
                const section = this.getSection(graphemeIndex);
                if (grapheme.trim()) {
                    currentX += getGlyphAdvance(grapheme, section, glyphMap, imagePositions, spacing, layoutTextSize);
                }
                graphemeIndex++;
            }

            const nextWordIndex = wordIndex + word.length;
            const lastCodePoint = graphemes.at(-1).segment.codePointAt(0);
            const nextWordCodePoint = this.text.codePointAt(nextWordIndex);
            if (!nextWordCodePoint) {
                continue;
            }

            const penalty = calculatePenalty(lastCodePoint, nextWordCodePoint);
            const lineBreak = evaluateBreak(graphemeIndex, currentX, targetWidth, potentialLineBreaks, penalty, false);
            potentialLineBreaks.push(lineBreak);
        }

        return leastBadBreaks(
            evaluateBreak(
                this.length(),
                currentX,
                targetWidth,
                potentialLineBreaks,
                0,
                true));
    }

    determineAverageLineWidth(
        spacing: number,
        maxWidth: number,
        glyphMap: {
            [_: string]: {
                [_: string]: StyleGlyph;
            };
        },
        imagePositions: {[_: string]: ImagePosition},
        layoutTextSize: number) {
        let totalWidth = 0;

        let index = 0;
        for (const {segment} of splitByGraphemeCluster(this.text)) {
            const section = this.getSection(index);
            totalWidth += getGlyphAdvance(segment, section, glyphMap, imagePositions, spacing, layoutTextSize);
            index++;
        }

        const lineCount = Math.max(1, Math.ceil(totalWidth / maxWidth));
        return totalWidth / lineCount;
    }
}
