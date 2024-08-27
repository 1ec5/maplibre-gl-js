import {describe, test, expect} from 'vitest';
import {allowsLetterSpacing, charIsWhitespace, charInComplexShapingScript, stringContainsRTLText} from './script_detection';

describe('charIsWhitespace', () => {
    test('detects whitespace', () => {
        expect(charIsWhitespace(' '.codePointAt(0))).toBe(true);
        expect(charIsWhitespace('\t'.codePointAt(0))).toBe(true);
        expect(charIsWhitespace('\v'.codePointAt(0))).toBe(true);
        expect(charIsWhitespace('\f'.codePointAt(0))).toBe(true);
        expect(charIsWhitespace('\r'.codePointAt(0))).toBe(true);
        expect(charIsWhitespace('\n'.codePointAt(0))).toBe(true);
    });
});

describe('allowsLetterSpacing', () => {
    test('allows letter spacing of Latin text', () => {
        expect(allowsLetterSpacing('A')).toBe(true);
    });

    test('disallows letter spacing of Arabic text', () => {
        // Arabic
        expect(allowsLetterSpacing('۳')).toBe(false);
        // Arabic Supplement
        expect(allowsLetterSpacing('ݣ')).toBe(false);
        // Arabic Extended-A
        expect(allowsLetterSpacing('ࢳ')).toBe(false);
        // Arabic Extended-B
        expect(allowsLetterSpacing('࢐')).toBe(false);
        // Arabic Presentation Forms-A
        expect(allowsLetterSpacing('ﰤ')).toBe(false);
        // Arabic Presentation Forms-B
        expect(allowsLetterSpacing('ﺽ')).toBe(false);
    });
});

describe('charInComplexShapingScript', () => {
    test('recognizes that Arabic text needs complex shaping', () => {
        // Non-Arabic
        expect(charInComplexShapingScript('3'.codePointAt(0))).toBe(false);
        // Arabic
        expect(charInComplexShapingScript('۳'.codePointAt(0))).toBe(true);
        // Arabic Supplement
        expect(charInComplexShapingScript('ݣ'.codePointAt(0))).toBe(true);
        // Arabic Extended-A
        expect(charInComplexShapingScript('ࢳ'.codePointAt(0))).toBe(true);
        // Arabic Extended-B
        expect(charInComplexShapingScript('࢐'.codePointAt(0))).toBe(true);
        // Arabic Presentation Forms-A
        expect(charInComplexShapingScript('ﰤ'.codePointAt(0))).toBe(true);
        // Arabic Presentation Forms-B
        expect(charInComplexShapingScript('ﺽ'.codePointAt(0))).toBe(true);
    });
});

describe('stringContainsRTLText', () => {
    test('does not identify direction-neutral text as right-to-left', () => {
        expect(stringContainsRTLText('3')).toBe(false);
    });

    test('identifies Arabic text as right-to-left', () => {
        // Arabic
        expect(stringContainsRTLText('۳')).toBe(true);
        // Arabic Supplement
        expect(stringContainsRTLText('ݣ')).toBe(true);
        // Arabic Extended-A
        expect(stringContainsRTLText('ࢳ')).toBe(true);
        // Arabic Extended-B
        expect(stringContainsRTLText('࢐')).toBe(true);
        // Arabic Presentation Forms-A
        expect(stringContainsRTLText('ﰤ')).toBe(true);
        // Arabic Presentation Forms-B
        expect(stringContainsRTLText('ﺽ')).toBe(true);
    });

    test('identifies Hebrew text as right-to-left', () => {
        // Hebrew
        expect(stringContainsRTLText('ה')).toBe(true);
        // Alphabetic Presentation Forms
        expect(stringContainsRTLText('ﬡ')).toBe(true);
    });

    test('identifies Thaana text as right-to-left', () => {
        // Thaana
        expect(stringContainsRTLText('ޘ')).toBe(true);
    });
});
