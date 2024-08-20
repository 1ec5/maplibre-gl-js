import {loadGlyphRange} from '../style/load_glyph_range';

import TinySDF from '@mapbox/tiny-sdf';
import {AlphaImage} from '../util/image';

import type {StyleGlyph} from '../style/style_glyph';
import type {RequestManager} from '../util/request_manager';
import type {GetGlyphsResponse} from '../util/actor_messages';

type Entry = {
    // null means we've requested the range, but the glyph wasn't included in the result.
    glyphs: {
        [grapheme: string]: StyleGlyph | null;
    };
    requests: {
        [range: number]: Promise<{[_: number]: StyleGlyph | null}>;
    };
    ranges: {
        [range: number]: boolean | null;
    };
    tinySDF?: TinySDF;
};

export class GlyphManager {
    requestManager: RequestManager;
    localIdeographFontFamily: string | false;
    entries: {[stack: string]: Entry};
    url: string;

    // exposed as statics to enable stubbing in unit tests
    static loadGlyphRange = loadGlyphRange;
    static TinySDF = TinySDF;

    constructor(requestManager: RequestManager, localIdeographFontFamily?: string | false) {
        this.requestManager = requestManager;
        this.localIdeographFontFamily = localIdeographFontFamily;
        this.entries = {};
    }

    setURL(url?: string | null) {
        this.url = url;
    }

    async getGlyphs(glyphs: {[stack: string]: Array<string>}): Promise<GetGlyphsResponse> {
        const glyphsPromises: Promise<{stack: string; grapheme: string; glyph: StyleGlyph}>[] = [];

        for (const stack in glyphs) {
            for (const grapheme of glyphs[stack]) {
                glyphsPromises.push(this._getAndCacheGlyphsPromise(stack, grapheme));
            }
        }

        const updatedGlyphs = await Promise.all(glyphsPromises);

        const result: GetGlyphsResponse = {};

        for (const {stack, grapheme, glyph} of updatedGlyphs) {
            if (!result[stack]) {
                result[stack] = {};
            }
            // Clone the glyph so that our own copy of its ArrayBuffer doesn't get transferred.
            result[stack][grapheme] = glyph && {
                grapheme: glyph.grapheme,
                bitmap: glyph.bitmap.clone(),
                metrics: glyph.metrics
            };
        }

        return result;
    }

    async _getAndCacheGlyphsPromise(stack: string, grapheme: string): Promise<{stack: string; grapheme: string; glyph: StyleGlyph}> {
        let entry = this.entries[stack];
        if (!entry) {
            entry = this.entries[stack] = {
                glyphs: {},
                requests: {},
                ranges: {}
            };
        }

        let glyph = entry.glyphs[grapheme];
        if (glyph !== undefined) {
            return {stack, grapheme, glyph};
        }

        glyph = this._tinySDF(entry, stack, grapheme);
        if (glyph) {
            entry.glyphs[grapheme] = glyph;
            return {stack, grapheme, glyph};
        }

        const id = grapheme.codePointAt(0);
        const range = Math.floor(id / 256);
        if (entry.ranges[range]) {
            return {stack, grapheme, glyph};
        }

        if (!this.url) {
            throw new Error('glyphsUrl is not set');
        }

        if (!entry.requests[range]) {
            const promise = GlyphManager.loadGlyphRange(stack, range, this.url, this.requestManager);
            entry.requests[range] = promise;
        }

        const response = await entry.requests[range];
        for (const grapheme in response) {
            const id = grapheme.codePointAt(0);
            if (!this._doesCharSupportLocalGlyph(+id)) {
                entry.glyphs[grapheme] = response[grapheme];
            }
        }
        entry.ranges[range] = true;
        return {stack, grapheme, glyph: response[grapheme] || null};
    }

    /**
     * Returns whether the given codepoint should be rendered locally.
     *
     * Local rendering is preferred for Unicode code blocks that represent writing systems for
     * which TinySDF produces optimal results and greatly reduces bandwidth consumption. In
     * general, TinySDF is best for any writing system typically set in a monospaced font. With
     * more than 99,000 codepoints accessed essentially at random, Hanzi/Kanji/Hanja (from the CJK
     * Unified Ideographs blocks) is the canonical example of wasteful bandwidth consumption when
     * rendered remotely. For visual consistency within CJKV text, even relatively small CJKV and
     * other siniform code blocks prefer local rendering.
     */
    _doesCharSupportLocalGlyph(_id: number): boolean {
        return true;
    }

    _tinySDF(entry: Entry, stack: string, grapheme: string): StyleGlyph {
        const fontFamily = this.localIdeographFontFamily;
        if (!fontFamily) {
            return;
        }

        const id = grapheme.codePointAt(0);
        if (!this._doesCharSupportLocalGlyph(id)) {
            return;
        }

        // Client-generated glyphs are rendered at 2x texture scale,
        // because CJK glyphs are more detailed than others.
        const textureScale = 2;
        const buffer = 10;

        let tinySDF = entry.tinySDF;
        if (!tinySDF) {
            let fontStyle = 'normal';
            if (/italic/i.test(stack)) {
                fontStyle = 'italic';
            } else if (/oblique/i.test(stack)) {
                fontStyle = 'oblique';
            }
            let fontWeight = '400';
            if (/bold/i.test(stack)) {
                fontWeight = '900';
            } else if (/medium/i.test(stack)) {
                fontWeight = '500';
            } else if (/light/i.test(stack)) {
                fontWeight = '200';
            }
            tinySDF = entry.tinySDF = new GlyphManager.TinySDF({
                fontSize: 24 * textureScale,
                buffer: buffer * textureScale,
                radius: 8 * textureScale,
                cutoff: 0.25,
                fontFamily,
                fontStyle,
                fontWeight
            });
        }

        const char = tinySDF.draw(grapheme);

        const isControl = /^\p{gc=Cf}+$/u.test(grapheme);

        return {
            grapheme,
            bitmap: new AlphaImage({width: char.width || 30 * textureScale, height: char.height || 30 * textureScale}, char.data),
            metrics: {
                width: isControl ? 0 : (char.glyphWidth / textureScale || 24),
                height: char.glyphHeight / textureScale || 24,
                left: (char.glyphLeft - buffer) / textureScale || 0,
                top: char.glyphTop / textureScale || 0,
                advance: isControl ? 0 : (char.glyphAdvance / textureScale || 24),
                isDoubleResolution: true
            }
        };
    }
}
