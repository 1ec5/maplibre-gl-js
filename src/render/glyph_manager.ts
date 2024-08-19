import {loadGlyphRange} from '../style/load_glyph_range';

import TinySDF from '@mapbox/tiny-sdf';
import {codePointUsesLocalIdeographFontFamily} from '../util/unicode_properties.g';
import {AlphaImage} from '../util/image';
import {warnOnce} from '../util/util';

import type {StyleGlyph} from '../style/style_glyph';
import type {RequestManager} from '../util/request_manager';
import type {GetGlyphsResponse} from '../util/actor_messages';

import {v8} from '@maplibre/maplibre-gl-style-spec';

type Entry = {
    // null means we've requested the range, but the glyph wasn't included in the result.
    glyphs: {
        [grapheme: string]: StyleGlyph | null;
    };
    requests: {
        [range: number]: Promise<{[_: string]: StyleGlyph | null}>;
    };
    ranges: {
        [range: number]: boolean | null;
    };
    tinySDF?: TinySDF;
    ideographTinySDF?: TinySDF;
};

/**
 * The style specification hard-codes some last resort fonts as a default fontstack.
 */
const defaultStack = v8.layout_symbol['text-font'].default.join(',');
/**
 * The CSS generic font family closest to `defaultStack`.
 */
const defaultGenericFontFamily = 'sans-serif';

/**
 * Scale factor for client-generated glyphs.
 *
 * Client-generated glyphs are rendered at 2× because CJK glyphs are more detailed than others.
 */
const textureScale = 2;

export class GlyphManager {
    requestManager: RequestManager;
    localIdeographFontFamily: string | false;
    entries: {[stack: string]: Entry};
    url: string;
    lang?: string;

    // exposed as statics to enable stubbing in unit tests
    static loadGlyphRange = loadGlyphRange;
    static TinySDF = TinySDF;

    constructor(requestManager: RequestManager, localIdeographFontFamily?: string | false, lang?: string) {
        this.requestManager = requestManager;
        this.localIdeographFontFamily = localIdeographFontFamily;
        this.entries = {};
        this.lang = lang;
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
        // Create an entry for this fontstack if it doesn’t already exist.
        let entry = this.entries[stack];
        if (!entry) {
            entry = this.entries[stack] = {
                glyphs: {},
                requests: {},
                ranges: {}
            };
        }

        // Try to get the glyph from the cache of client-side glyphs by grapheme.
        let glyph = entry.glyphs[grapheme];
        if (glyph !== undefined) {
            return {stack, grapheme, glyph};
        }

        // Draw the glyph locally and cache it if necessary.
        if (!this.url || [...grapheme].length > 1 || this._charUsesLocalIdeographFontFamily(grapheme.codePointAt(0))) {
            glyph = entry.glyphs[grapheme] = this._drawGlyph(entry, stack, grapheme);
            return {stack, grapheme, glyph};
        }

        return await this._downloadAndCacheRangePromise(stack, grapheme);
    }

    async _downloadAndCacheRangePromise(stack: string, grapheme: string): Promise<{stack: string; grapheme: string; glyph: StyleGlyph}> {
        // Try to get the glyph from the cache of server-side glyphs by PBF range.
        const entry = this.entries[stack];
        const id = grapheme.codePointAt(0);
        const range = Math.floor(id / 256);
        if (entry.ranges[range]) {
            return {stack, grapheme, glyph: null};
        }

        // Start downloading this range unless we’re currently downloading it.
        if (!entry.requests[range]) {
            const promise = GlyphManager.loadGlyphRange(stack, range, this.url, this.requestManager);
            entry.requests[range] = promise;
        }

        try {
            // Get the response and cache the glyphs from it.
            const response = await entry.requests[range];
            for (const responseGrapheme in response) {
                // FIXME: Whyyyyy??
                const key = responseGrapheme.length > 1 ? String.fromCodePoint(responseGrapheme) : responseGrapheme;
                entry.glyphs[key] = response[responseGrapheme];
            }
            entry.ranges[range] = true;
            return {stack, grapheme, glyph: response[grapheme] || null};
        } catch (e) {
            this._warnOnMissingGlyphRange(range, id, e);
            // Fall back to drawing the glyph locally and caching it.
            const glyph = entry.glyphs[grapheme] = this._drawGlyph(entry, stack, grapheme);
            return {stack, grapheme, glyph};
        }
    }

    _warnOnMissingGlyphRange(range: number, id: number, err: Error) {
        const begin = range * 256;
        const end = begin + 255;
        const codePoint = id.toString(16).padStart(4, '0').toUpperCase();
        warnOnce(`Unable to load glyph range ${range}, ${begin}-${end}. Rendering codepoint U+${codePoint} locally instead. ${err}`);
    }

    /**
     * Returns whether the given codepoint should be rendered locally.
     */
    _charUsesLocalIdeographFontFamily(id: number): boolean {
        return !!this.localIdeographFontFamily && codePointUsesLocalIdeographFontFamily(id);
    }

    /**
     * Draws a glyph offscreen using TinySDF, creating a TinySDF instance lazily.
     */
    _drawGlyph(entry: Entry, stack: string, grapheme: string): StyleGlyph {
        // The CJK fallback font specified by the developer takes precedence over the last resort fontstack in the style specification.
        const usesLocalIdeographFontFamily = stack === defaultStack && this._charUsesLocalIdeographFontFamily(grapheme.codePointAt(0));

        // Keep a separate TinySDF instance for when we need to apply the localIdeographFontFamily fallback to keep the font selection from bleeding into non-CJK text.
        const tinySDFKey = usesLocalIdeographFontFamily ? 'ideographTinySDF' : 'tinySDF';
        entry[tinySDFKey] ||= this._createTinySDF(usesLocalIdeographFontFamily ? this.localIdeographFontFamily : stack);
        const char = entry[tinySDFKey].draw(grapheme);

        return {
            grapheme,
            bitmap: new AlphaImage({width: char.width || 30 * textureScale, height: char.height || 30 * textureScale}, char.data),
            metrics: {
                width: char.glyphWidth / textureScale || 24,
                height: char.glyphHeight / textureScale || 24,
                left: char.glyphLeft / textureScale || 0,
                top: char.glyphTop / textureScale || 0,
                advance: char.glyphAdvance / textureScale || 24,
                isDoubleResolution: true
            }
        };
    }

    _createTinySDF(stack: String | false): TinySDF {
        // Escape and quote the font family list for use in CSS.
        const fontFamilies = stack ? stack.split(',') : [];
        fontFamilies.push(defaultGenericFontFamily);
        const fontFamily = fontFamilies.map(fontName =>
            /[-\w]+/.test(fontName) ? fontName : `'${CSS.escape(fontName)}'`
        ).join(',');

        return new GlyphManager.TinySDF({
            fontSize: 24 * textureScale,
            buffer: 8 * textureScale,
            radius: 8 * textureScale,
            cutoff: 0.25,
            fontFamily: fontFamily,
            fontWeight: this._fontWeight(fontFamilies[0]),
            fontStyle: this._fontStyle(fontFamilies[0]),
            lang: this.lang
        });
    }

    /**
     * Sniffs the font style out of a font family name.
     */
    _fontStyle(fontFamily: string): string {
        if (/italic/i.test(fontFamily)) {
            return 'italic';
        } else if (/oblique/i.test(fontFamily)) {
            return 'oblique';
        }
        return 'normal';
    }

    /**
     * Sniffs the font weight out of a font family name.
     */
    _fontWeight(fontFamily: string): string {
        // Based on the OpenType specification
        // https://learn.microsoft.com/en-us/typography/opentype/spec/os2#usweightclass
        const weightsByName = {
            thin: 100, hairline: 100,
            'extra light': 200, 'ultra light': 200,
            light: 300,
            normal: 400, regular: 400,
            medium: 500,
            semibold: 600, demibold: 600,
            bold: 700,
            'extra bold': 800, 'ultra bold': 800,
            black: 900, heavy: 900,
            'extra black': 950, 'ultra black': 950
        };
        let match;
        for (const [name, weight] of Object.entries(weightsByName)) {
            if (new RegExp(`\\b${name}\\b`, 'i').test(fontFamily)) {
                match = `${weight}`;
            }
        }
        return match;
    }

    destroy() {
        for (const stack in this.entries) {
            const entry = this.entries[stack];
            if (entry.tinySDF) {
                entry.tinySDF = null;
            }
            if (entry.ideographTinySDF) {
                entry.ideographTinySDF = null;
            }
            entry.glyphs = {};
            entry.requests = {};
            entry.ranges = {};
        }
        this.entries = {};
    }
}
