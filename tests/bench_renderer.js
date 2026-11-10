// Renderer benchmark. Run from the repository root:
//   gjs tests/bench_renderer.js [lines=10000] [--show]
// Prints timings against the targets:
//   keystroke / cursor move  <= 16 ms at 10k lines (and flat in doc size)
//   theme / zoom change      <= 100 ms at 10k lines
//   initial render           no single renderer main-loop block > ~50 ms
// (GTK's own text layout work in the same main loop is reported separately,
// next to a baseline of GTK laying out the same text without the renderer)
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { MarkdownTextView } = imports.ui.markdownTextView;

const args = ARGV.filter(a => !a.startsWith('--'));
const N = parseInt(args[0] || '10000');
const SHOW = ARGV.includes('--show');

const colors = {
    background: '#0d1117', foreground: '#e6edf3', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', font: 'monospace',
};
const colors2 = Object.assign({}, colors, {
    background: '#fdf6e3', foreground: '#333333', red: '#dc322f', blue: '#268bd2', cyan: '#2aa198',
});

function makeDoc(n) {
    const kinds = [
        '# Heading {i} with **bold**',
        'Plain text line {i} with **bold** and *italic* and `code` -> arrow',
        '- bullet item {i} with [link](https://example.com/{i})',
        '  - [ ] nested todo {i}',
        '1. numbered {i} 😀 emoji',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit {i}. https://example.org/x_{i}',
        '> quoted {i} with ~~strike~~',
        '',
        '* star bullet {i}',
        '```js',
        'const x = {i}; // **not bold** -> no arrow',
        '```',
    ];
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(kinds[i % kinds.length].replace(/\{i\}/g, i));
    return lines.join('\n');
}

const ms = (us) => (us / 1000).toFixed(2) + ' ms';
const now = () => GLib.get_monotonic_time();

// Longest single renderer main-loop callback (flush, background chunk,
// indent measuring) since the last reset, in microseconds
let cbLongest = 0, cbTotal = 0;
function instrument(r) {
    for (const name of ['_flush', '_backgroundStep', '_measurePending']) {
        const orig = r[name].bind(r);
        r[name] = (...a) => {
            const s = now();
            try {
                return orig(...a);
            } finally {
                const d = now() - s;
                cbLongest = Math.max(cbLongest, d);
                cbTotal += d;
            }
        };
    }
}

function drain(maxUs = 60e6) {
    // Run the main loop until nothing is pending; return the longest single
    // iteration (= longest UI block, renderer and GTK layout) in microseconds.
    const ctx = GLib.MainContext.default();
    let longest = 0;
    const t0 = now();
    while (now() - t0 < maxUs) {
        const a = now();
        const did = ctx.iteration(false);
        longest = Math.max(longest, now() - a);
        if (!did) break;
    }
    return longest;
}

// The same document in a plain text view without the renderer: GTK's own
// layout work, for comparison with the iteration times above
function gtkBaseline(n) {
    const tv = new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR });
    const win = new Gtk.Window({ default_width: 800, default_height: 600 });
    win.set_child(new Gtk.ScrolledWindow({ child: tv }));
    if (SHOW) win.present();
    const text = makeDoc(n);
    const t = now();
    tv.get_buffer().set_text(text, -1);
    tv.get_buffer().place_cursor(tv.get_buffer().get_start_iter());
    const setText = now() - t;
    const longest = drain();
    win.destroy();
    return { setText, longest };
}

function measure(n) {
    const tv = new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR });
    const win = new Gtk.Window({ default_width: 800, default_height: 600 });
    win.set_child(new Gtk.ScrolledWindow({ child: tv }));
    if (SHOW) win.present();
    const buffer = tv.get_buffer();

    let t = now();
    const r = new MarkdownRenderer(tv, colors, null);
    const ctor = now() - t;

    // Measure time spent inside the renderer's own main-loop callbacks
    // (the rest of a main-loop iteration is GTK's own layout work)
    instrument(r);

    // Loading a file: GTK inserts the text and moves the cursor (both GTK's
    // own work, reported separately), then the renderer's synchronous flush
    const text = makeDoc(n);
    t = now();
    buffer.set_text(text, -1);
    buffer.place_cursor(buffer.get_start_iter());
    const setText = now() - t;
    t = now();
    r.renderNow();
    const firstFlush = now() - t;
    t = now();
    cbLongest = cbTotal = 0;
    const longestIteration = drain();
    const backgroundTotal = now() - t;
    const longestChunk = cbLongest, ownChunkTotal = cbTotal;

    // Keystrokes in the middle of the document
    const mid = Math.floor(n / 2);
    const keys = 50;
    let worstKey = 0, totalKey = 0;
    for (let k = 0; k < keys; k++) {
        const line = mid + (k % 12);
        const r2 = buffer.get_iter_at_line(line);
        const iter = Array.isArray(r2) ? r2[1] : r2;
        iter.forward_to_line_end();
        t = now();
        buffer.insert(iter, k % 7 === 0 ? '*' : 'x', -1);
        r.renderNow();
        const d = now() - t;
        worstKey = Math.max(worstKey, d);
        totalKey += d;
    }
    // Enter key (line split) and backspace (line join)
    let worstEnter = 0;
    for (let k = 0; k < 10; k++) {
        const r2 = buffer.get_iter_at_line(mid + k);
        const iter = Array.isArray(r2) ? r2[1] : r2;
        iter.forward_chars(3);
        t = now();
        buffer.insert(iter, '\n', -1);
        r.renderNow();
        const s = buffer.get_iter_at_mark(buffer.get_insert());
        const e = s.copy();
        s.backward_char();
        buffer.delete(s, e);
        r.renderNow();
        worstEnter = Math.max(worstEnter, now() - t);
    }

    // Cursor moves between lines
    let worstMove = 0, totalMove = 0;
    for (let k = 0; k < 50; k++) {
        const r2 = buffer.get_iter_at_line(mid - 25 + k);
        const iter = Array.isArray(r2) ? r2[1] : r2;
        iter.forward_chars(Math.min(5, iter.get_chars_in_line() - 1));
        t = now();
        buffer.place_cursor(iter);
        r.renderNow();
        const d = now() - t;
        worstMove = Math.max(worstMove, d);
        totalMove += d;
    }

    // Typing a fence at the top turns the whole document into code
    const top = buffer.get_start_iter();
    t = now();
    buffer.insert(top, '```\n', -1);
    r.renderNow();
    const fenceSync = now() - t;
    cbLongest = 0;
    drain();
    const fenceChunk = cbLongest;
    const e4 = buffer.get_iter_at_offset(4);
    buffer.delete(buffer.get_start_iter(), e4);
    r.renderNow();
    drain();

    t = now();
    r.updateColors(colors2);
    const theme = now() - t;
    t = now();
    r.updateColors(colors);
    const theme2 = now() - t;

    t = now();
    r.setZoom(22);
    const zoom = now() - t;
    t = now();
    r.setZoom(15);
    const zoom2 = now() - t;

    const [s, e] = buffer.get_bounds();
    const same = buffer.get_text(s, e, true) !== '' ;
    r.destroy();
    win.destroy();
    return {
        n, ctor, setText, firstFlush, longestChunk, longestIteration, backgroundTotal, ownChunkTotal,
        avgKey: totalKey / keys, worstKey, worstEnter,
        avgMove: totalMove / 50, worstMove, fenceSync, fenceChunk,
        theme: Math.max(theme, theme2), zoom: Math.max(zoom, zoom2), same,
    };
}

const sizes = N >= 10000 ? [1000, N] : [N];
let ok = true;
for (const size of sizes) {
    const m = measure(size);
    const check = (label, value, target) => {
        const pass = target === undefined || value <= target;
        if (!pass) ok = false;
        print(`  ${label.padEnd(44)} ${ms(value).padStart(11)}${target !== undefined ? `   (target <= ${target / 1000} ms) ${pass ? 'OK' : 'FAIL'}` : ''}`);
    };
    print(`\n== ${size} lines${SHOW ? ' (window shown)' : ''}`);
    check('renderer constructor', m.ctor, 20000);
    check('load: GTK set_text + place_cursor', m.setText);
    check('load: first synchronous render flush', m.firstFlush, 50000);
    check('load: longest renderer chunk', m.longestChunk, 50000);
    check('load: renderer background total', m.ownChunkTotal);
    check('load: total until idle (renderer + GTK)', m.backgroundTotal);
    check('load: longest main-loop iteration (+ GTK)', m.longestIteration);
    const base = gtkBaseline(size);
    check('  GTK alone, no renderer: set_text + cursor', base.setText);
    check('  GTK alone, no renderer: longest iteration', base.longest);
    check('keystroke + render (avg)', m.avgKey);
    check('keystroke + render (worst)', m.worstKey, 16000);
    check('enter + backspace + render (worst)', m.worstEnter, 16000);
    check('cursor move + reveal (avg)', m.avgMove);
    check('cursor move + reveal (worst)', m.worstMove, 16000);
    check('type ``` at top: sync part', m.fenceSync, 50000);
    check('type ``` at top: longest chunk', m.fenceChunk, 50000);
    check('theme change (updateColors)', m.theme, 100000);
    check('zoom change (setZoom)', m.zoom, 100000);
}
print(ok ? '\nAll targets met' : '\nSome targets missed');
