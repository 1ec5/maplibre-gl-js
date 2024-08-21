// This file is generated. Edit build/generate-unicode-data.ts, then run `npm run generate-unicode-data`.

/**
 * Returns whether two grapheme clusters detected by `Intl.Segmenter` can be combined to prevent an invisible combining mark from appearing unexpectedly.
 */
export function canCombineGraphemes(former: string, latter: string): boolean {
    // Indic_Syllabic_Category=Invisible_Stacker as of Unicode 16.0.0, published 2024-04-30.
    // eslint-disable-next-line no-misleading-character-class
    const invisibleStackersRegExp = /[\u1039\u17D2\u1A60\u1BAB\uAAF6\u{10A3F}\u{11133}\u{113D0}\u{1193E}\u{11A47}\u{11A99}\u{11D45}\u{11D97}\u{11F42}]$/u;
    return invisibleStackersRegExp.test(former) || /^\p{gc=Mc}/u.test(latter);
}
