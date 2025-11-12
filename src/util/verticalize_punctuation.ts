import {charHasRotatedVerticalOrientation} from './script_detection';

export const verticalizedCharacterMap = {
    '!': '︕',
    '#': '＃',
    '$': '＄',
    '%': '％',
    '&': '＆',
    '(': '︵',
    ')': '︶',
    '*': '＊',
    '+': '＋',
    ',': '︐',
    '-': '︲',
    '.': '・',
    '/': '／',
    ':': '︓',
    ';': '︔',
    '<': '︿',
    '=': '＝',
    '>': '﹀',
    '?': '︖',
    '@': '＠',
    '[': '﹇',
    '\\': '＼',
    ']': '﹈',
    '^': '＾',
    '_': '︳',
    '`': '｀',
    '{': '︷',
    '|': '―',
    '}': '︸',
    '~': '～',
    '¢': '￠',
    '£': '￡',
    '¥': '￥',
    '¦': '￤',
    '¬': '￢',
    '¯': '￣',
    '–': '︲',
    '—': '︱',
    '‘': '﹃',
    '’': '﹄',
    '“': '﹁',
    '”': '﹂',
    '…': '︙',
    '⋯': '︙',
    '‧': '・',
    '₩': '￦',
    '、': '︑',
    '。': '︒',
    '〈': '︿',
    '〉': '﹀',
    '《': '︽',
    '》': '︾',
    '「': '﹁',
    '」': '﹂',
    '『': '﹃',
    '』': '﹄',
    '【': '︻',
    '】': '︼',
    '〔': '︹',
    '〕': '︺',
    '〖': '︗',
    '〗': '︘',
    '！': '︕',
    '（': '︵',
    '）': '︶',
    '，': '︐',
    '－': '︲',
    '．': '・',
    '：': '︓',
    '；': '︔',
    '＜': '︿',
    '＞': '﹀',
    '？': '︖',
    '［': '﹇',
    '］': '﹈',
    '＿': '︳',
    '｛': '︷',
    '｜': '―',
    '｝': '︸',
    '｟': '︵',
    '｠': '︶',
    '｡': '︒',
    '｢': '﹁',
    '｣': '﹂'
};

const segmenter = new Intl.Segmenter();

export function verticalizePunctuation(input: string) {
    let output = '';

    let prevChar = {premature: true, value: undefined};
    const chars = segmenter.segment(input)[Symbol.iterator]();
    let char = chars.next();
    const nextChars = segmenter.segment(input)[Symbol.iterator]();
    nextChars.next();
    let nextChar = nextChars.next();

    while (!char.done) {
        const canReplacePunctuation = (
            (nextChar.done || !charHasRotatedVerticalOrientation(nextChar.value.segment.codePointAt(0)) || verticalizedCharacterMap[nextChar.value.segment]) &&
            (prevChar.premature || !charHasRotatedVerticalOrientation(prevChar.value.segment.codePointAt(0)) || verticalizedCharacterMap[prevChar.value.segment])
        );

        if (canReplacePunctuation && verticalizedCharacterMap[char.value.segment]) {
            output += verticalizedCharacterMap[char.value.segment];
        } else {
            output += char.value.segment;
        }

        prevChar = {value: char.value, premature: false};
        char = chars.next();
        nextChar = nextChars.next();
    }

    return output;
}

