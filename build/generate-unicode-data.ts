import * as fs from 'fs';

// Or https://www.unicode.org/Public/draft/UCD/ucd if the next Unicode version is finalized and awaiting publication.
const ucdBaseUrl = 'https://www.unicode.org/Public/UCD/latest/ucd';

async function getPropertyData(property: string, value: string): Promise<{[_: string]: string}> {
    const indicSyllabicCategoryUrl = `${ucdBaseUrl}/${property.replaceAll('_', '')}.txt`;
    const response = await fetch(indicSyllabicCategoryUrl);
    if (!response.ok) {
        throw new Error(`Unable to fetch latest Unicode character database file for ${property}: ${response.status}`);
    }

    const table = await response.text();
    const header = table.match(/^# \w+-(\d+\.\d+\.\d+)\.txt\n# Date: (\d\d\d\d-\d\d-\d\d)/);
    const tableRegExp = new RegExp(`^([0-9A-Z]{4,6}(?:..[0-9A-Z]{4,6})?)(?= *; ${value})`, 'gm');
    const characterClass = table
        .match(tableRegExp)
        .map(record => record
            .split('..')
            .map(codePoint => (codePoint.length > 4) ? `\\u{${codePoint}}` : `\\u${codePoint}`)
            .join('-'))
        .join('');
    return {
        version: header && header[1],
        date: header && header[2],
        characterClass,
    };
}

const indicSyllabicCategory = await getPropertyData('Indic_Syllabic_Category', 'Invisible_Stacker');

fs.writeFileSync('src/data/unicode_properties.ts',
    `// This file is generated. Edit build/generate-unicode-data.ts, then run \`npm run generate-unicode-data\`.

/**
 * Returns whether two grapheme clusters detected by \`Intl.Segmenter\` can be combined to prevent an invisible combining mark from appearing unexpectedly.
 */
export function canCombineGraphemes(former: string, latter: string): boolean {
    // Indic_Syllabic_Category=Invisible_Stacker as of Unicode ${indicSyllabicCategory.version}, published ${indicSyllabicCategory.date}.
    // eslint-disable-next-line no-misleading-character-class
    const invisibleStackersRegExp = /[${indicSyllabicCategory.characterClass}]$/u;
    return invisibleStackersRegExp.test(former) || /^\\p{gc=Mc}/u.test(latter);
}
`);
