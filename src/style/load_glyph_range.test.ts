import {test, expect, vi} from 'vitest';
import fs from 'fs';
import path from 'path';
import {RequestManager} from '../util/request_manager';
import {loadGlyphRange} from './load_glyph_range';
import {fakeServer} from 'nise';
import {bufferToArrayBuffer} from '../util/test/util';

test('loadGlyphRange', async ()  => {
    global.fetch = null;

    const transform = vi.fn().mockImplementation((url) => {
        return {url};
    });

    const manager = new RequestManager(transform);

    const server = fakeServer.create();
    server.respondWith(bufferToArrayBuffer(fs.readFileSync(path.join(__dirname, '../../test/unit/assets/0-255.pbf'))));

    const promise = loadGlyphRange('Arial Unicode MS', 0, 'https://localhost/fonts/v1/{fontstack}/{range}.pbf', manager);
    server.respond();
    const result = await promise;

    expect(transform).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledWith('https://localhost/fonts/v1/Arial Unicode MS/0-255.pbf', 'Glyphs');

    expect(Object.keys(result)).toHaveLength(223);
    for (const grapheme in result) {
        const glyph = result[grapheme];

        expect(typeof glyph.grapheme).toBe('string');
        expect(glyph.grapheme).toBe(grapheme);
        expect([...glyph.grapheme].length).toEqual(1);
        expect(glyph.metrics).toBeTruthy();
        expect(typeof glyph.metrics.width).toBe('number');
        expect(typeof glyph.metrics.height).toBe('number');
        expect(typeof glyph.metrics.top).toBe('number');
        expect(typeof glyph.metrics.advance).toBe('number');
    }
    expect(server.requests[0].url).toBe('https://localhost/fonts/v1/Arial Unicode MS/0-255.pbf');
});
