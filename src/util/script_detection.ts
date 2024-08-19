import {
    codePointAllowsIdeographicBreaking,
    codePointHasUprightVerticalOrientation,
    codePointHasNeutralVerticalOrientation,
    codePointRequiresComplexTextShaping
} from '../util/unicode_properties.g';

export const segmenter = ('Segmenter' in Intl) ? new Intl.Segmenter() : {
    segment: (text: String) => {
        return [...text].map((char, index) => ({
            index,
            segment: char,
        }));
    },
};

export function charIsWhitespace(char: number) {
    return /\s/u.test(String.fromCodePoint(char));
}

// Indic_Syllabic_Category=Invisible_Stacker as of Unicode 16.0.0.
// https://www.unicode.org/Public/UCD/latest/ucd/IndicSyllabicCategory.txt
const invisibleStackerCodePoints = [
    0x1039, // MYANMAR SIGN VIRAMA
    0x17D2, // KHMER SIGN COENG
    0x1A60, // TAI THAM SIGN SAKOT
    0x1BAB, // SUNDANESE SIGN VIRAMA
    0xAAF6, // MEETEI MAYEK VIRAMA
    0x10A3F, // KHAROSHTHI VIRAMA
    0x11133, // CHAKMA VIRAMA
    0x113D0, // TULU-TIGALARI CONJOINER
    0x1193E, // DIVES AKURU VIRAMA
    0x11A47, // ZANABAZAR SQUARE SUBJOINER
    0x11A99, // SOYOMBO SUBJOINER
    0x11D45, // MASARAM GONDI VIRAMA
    0x11D97, // GUNJALA GONDI VIRAMA
    0x11F42, // KAWI CONJOINER
];

const invisibleStackersCharClass = invisibleStackerCodePoints.map(cp => `\\u{${cp.toString(16)}}`);
const invisibleStackersRegExp = new RegExp(`[${invisibleStackersCharClass}]$`, 'u');

export function splitByGraphemeCluster(text: string) {
    const segments = segmenter.segment(text)[Symbol.iterator]();
    let segment = segments.next();
    const nextSegments = segmenter.segment(text)[Symbol.iterator]();
    nextSegments.next();
    let nextSegment = nextSegments.next();

    const baseSegments = [];
    while (!segment.done) {
        const baseSegment = segment;
        while (!nextSegment.done &&
               (/^\p{gc=Mc}/u.test(nextSegment.value.segment) ||
				invisibleStackersRegExp.test(baseSegment.value.segment))) {
            baseSegment.value.segment += nextSegment.value.segment;
            segment = segments.next();
            nextSegment = nextSegments.next();
        }
        baseSegments.push(baseSegment.value);
        segment = segments.next();
        nextSegment = nextSegments.next();
    }

    return baseSegments;
}

export function allowsIdeographicBreaking(chars: string) {
    for (const char of chars) {
        if (!codePointAllowsIdeographicBreaking(char.codePointAt(0))) return false;
    }
    return true;
}

export function allowsVerticalWritingMode(chars: string) {
    for (const char of chars) {
        if (codePointHasUprightVerticalOrientation(char.codePointAt(0))) return true;
    }
    return false;
}

export function allowsLetterSpacing(chars: string) {
    for (const char of chars) {
        if (!charAllowsLetterSpacing(char.codePointAt(0))) return false;
    }
    return true;
}

/**
 * Returns a regular expression matching the given script codes, excluding any
 * code that the execution environment lacks support for in regular expressions.
 */
function sanitizedRegExpFromScriptCodes(scriptCodes: Array<string>): RegExp {
    const supportedPropertyEscapes = scriptCodes.map(code => {
        try {
            return new RegExp(`\\p{sc=${code}}`, 'u').source;
        } catch {
            return null;
        }
    }).filter(pe => pe);
    return new RegExp(supportedPropertyEscapes.join('|'), 'u');
}

/**
 * ISO 15924 script codes of scripts that disallow letter spacing as of Unicode
 * 16.0.0.
 *
 * In general, cursive scripts are incompatible with letter spacing.
 */
const cursiveScriptCodes = [
    'Arab', // Arabic
    'Dupl', // Duployan
    'Mong', // Mongolian
    'Ougr', // Old Uyghur
    'Syrc', // Syriac
];

const cursiveScriptRegExp = sanitizedRegExpFromScriptCodes(cursiveScriptCodes);

export function charAllowsLetterSpacing(char: number) {
    return !cursiveScriptRegExp.test(String.fromCodePoint(char));
}

/**
 * Returns true if the given Unicode codepoint identifies a character with
 * rotated orientation.
 *
 * A character has rotated orientation if it is drawn rotated when the line is
 * oriented vertically, even if both adjacent characters are upright. For
 * example, a Latin letter is drawn rotated along a vertical line. A rotated
 * character causes an adjacent “neutral” character to be drawn rotated as well.
 */
export function charHasRotatedVerticalOrientation(char: number) {
    return !(codePointHasUprightVerticalOrientation(char) ||
             codePointHasNeutralVerticalOrientation(char));
}

export function charInComplexShapingScript(char: number) {
    return /\p{sc=Arab}/u.test(String.fromCodePoint(char));
}

/**
 * ISO 15924 script codes of scripts that are primarily written horizontally
 * right-to-left according to Unicode 16.0.0.
 */
const rtlScriptCodes = [
    'Adlm', // Adlam
    'Arab', // Arabic
    'Armi', // Imperial Aramaic
    'Avst', // Avestan
    'Chrs', // Chorasmian
    'Cprt', // Cypriot
    'Egyp', // Egyptian Hieroglyphs
    'Elym', // Elymaic
    'Gara', // Garay
    'Hatr', // Hatran
    'Hebr', // Hebrew
    'Hung', // Old Hungarian
    'Khar', // Kharoshthi
    'Lydi', // Lydian
    'Mand', // Mandaic
    'Mani', // Manichaean
    'Mend', // Mende Kikakui
    'Merc', // Meroitic Cursive
    'Mero', // Meroitic Hieroglyphs
    'Narb', // Old North Arabian
    'Nbat', // Nabataean
    'Nkoo', // NKo
    'Orkh', // Old Turkic
    'Palm', // Palmyrene
    'Phli', // Inscriptional Pahlavi
    'Phlp', // Psalter Pahlavi
    'Phnx', // Phoenician
    'Prti', // Inscriptional Parthian
    'Rohg', // Hanifi Rohingya
    'Samr', // Samaritan
    'Sarb', // Old South Arabian
    'Sogo', // Old Sogdian
    'Syrc', // Syriac
    'Thaa', // Thaana
    'Todr', // Todhri
    'Yezi', // Yezidi
];

const rtlScriptRegExp = sanitizedRegExpFromScriptCodes(rtlScriptCodes);

export function charInRTLScript(char: number) {
    return rtlScriptRegExp.test(String.fromCodePoint(char));
}

export function charInSupportedScript(char: number, canRenderRTL: boolean) {
    // This is a rough heuristic: whether we "can render" a script
    // actually depends on the properties of the font being used
    // and whether differences from the ideal rendering are considered
    // semantically significant.

    // Even in Latin script, we "can't render" combinations such as the fi
    // ligature, but we don't consider that semantically significant.
    if (!canRenderRTL && charInRTLScript(char)) {
        return false;
    }
    if (codePointRequiresComplexTextShaping(char)) {
        return false;
    }
    return true;
}

export function stringContainsRTLText(chars: string): boolean {
    for (const char of chars) {
        if (charInRTLScript(char.codePointAt(0))) {
            return true;
        }
    }
    return false;
}

export function isStringInSupportedScript(chars: string, canRenderRTL: boolean) {
    for (const char of chars) {
        if (!charInSupportedScript(char.codePointAt(0), canRenderRTL)) {
            return false;
        }
    }
    return true;
}
