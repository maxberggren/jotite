// Randomized test: incremental rendering must equal a fresh render.
// Applies random edits (multi-line inserts and deletes including fences,
// ~~~, HTML comments, lists, quotes) plus undo/redo to one renderer and
// compares every line's block kind and every character's tag set with a
// renderer created from scratch on the same text.
// Run from the repository root: gjs tests/markdown_fuzz.js [seeds] [edits]
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();
const Parser = imports.markdown.parser;
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { MarkdownTextView } = imports.ui.markdownTextView;

const SEEDS = parseInt(ARGV[0] || '20');
const EDITS = parseInt(ARGV[1] || '300');

const colors = {
    background: '#0d1117', foreground: '#e6edf3', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', font: 'monospace',
};

let loggedErrors = 0;
const origLogError = globalThis.logError;
globalThis.logError = (e, msg) => {
    loggedErrors++;
    origLogError(e, msg);
};

function make(text) {
    const tv = new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR });
    const win = new Gtk.Window({ default_width: 700, default_height: 500 });
    win.set_child(new Gtk.ScrolledWindow({ child: tv }));
    const b = tv.get_buffer();
    const r = new MarkdownRenderer(tv, colors, null);
    b.set_text(text, -1);
    r.renderNow(true);
    return { tv, win, b, r };
}
function all(b) {
    const [s, e] = b.get_bounds();
    return b.get_text(s, e, true);
}
// Tag sets per run of characters: [offset, tags] at every tag toggle
function signature(b) {
    const out = [];
    const it = b.get_start_iter();
    for (;;) {
        out.push(it.get_tags().map(t => t.name)
            .map(n => (n.startsWith('md-indent-') ? 'ind' : n)).sort().join(','));
        const off = it.get_offset();
        if (!it.forward_to_tag_toggle(null)) break;
        out[out.length - 1] = `${off}:${out[out.length - 1]}`;
    }
    return out;
}

const SNIPPETS = [
    '\n', '\n\n', '```', '```\n', '\n```', '```js\nx\n```\n', '~~~\n', '\n~~~', '````\n', '# ', '## h\n',
    '- ', '* ', '+ ', '1. ', '2) ', '[ ] ', '- [ ] t\n', '> ', '> - [x] q\n', '**', '*', '_', '~~', '`',
    '[a](b)', '->', '<!--', '-->', '<!-- c -->', '\n<!--\n', '-->\n', '---\n', 'text ', '😀', '    ',
    'http://x.y ', '\\', 'a\nb\nc\n',
];

const ref = { tv: new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR }), r: null };
ref.b = ref.tv.get_buffer();
ref.win = new Gtk.Window({ default_width: 700, default_height: 500 });
ref.win.set_child(new Gtk.ScrolledWindow({ child: ref.tv }));

let failures = 0;
const t0 = GLib.get_monotonic_time();
for (let seedNo = 1; seedNo <= SEEDS && failures === 0; seedNo++) {
    let seed = seedNo * 7919;
    const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const { b, r, win } = make('# Title\n\nSome **bold** text\n- item\n```\ncode\n```\nend\n<!--\nc\n-->\n> q');
    for (let step = 0; step < EDITS; step++) {
        const n = b.get_char_count();
        const op = rnd();
        if (op < 0.08) {
            if (b.can_undo) b.undo();
        } else if (op < 0.12) {
            if (b.can_redo) b.redo();
        } else if (op < 0.38 && n > 0) {
            const s = Math.floor(rnd() * n);
            const len = rnd() < 0.3 ? 1 + Math.floor(rnd() * 30) : 1 + Math.floor(rnd() * 6);
            b.begin_user_action();
            b.delete(b.get_iter_at_offset(s), b.get_iter_at_offset(Math.min(n, s + len)));
            b.end_user_action();
        } else {
            b.begin_user_action();
            b.insert(b.get_iter_at_offset(Math.floor(rnd() * (n + 1))), pick(SNIPPETS), -1);
            b.end_user_action();
        }
        if (rnd() < 0.5) b.place_cursor(b.get_iter_at_offset(Math.floor(rnd() * (b.get_char_count() + 1))));
        if (rnd() < 0.3) continue; // batch several edits before rendering

        r.renderNow(true);
        const text = all(b);
        const cursor = b.get_iter_at_mark(b.get_insert()).get_offset();
        const expectedKinds = Parser.classifyLines(Parser.splitLines(text)).kinds;
        const fenceKinds = [Parser.Kind.FENCE_OPEN, Parser.Kind.FENCE_CLOSE, Parser.Kind.CODE];
        let bad = null;
        for (let l = 0; l < expectedKinds.length && !bad; l++) {
            if (r.isInCodeBlock(l) !== fenceKinds.includes(expectedKinds[l]))
                bad = `line ${l}: isInCodeBlock=${r.isInCodeBlock(l)}, expected kind ${expectedKinds[l]}`;
        }
        if (!bad) {
            // A brand-new renderer on a reference view (removes every tag
            // of the previous one) renders the text from scratch
            if (ref.r) ref.r.destroy();
            ref.b.set_text(text, -1);
            ref.b.place_cursor(ref.b.get_iter_at_offset(cursor));
            ref.r = new MarkdownRenderer(ref.tv, colors, null);
            ref.r.renderNow(true);
            const a = signature(b), c = signature(ref.b);
            const i = a.findIndex((v, k) => v !== c[k]);
            if (i >= 0 || a.length !== c.length)
                bad = `tag run ${i}: incremental [${a[i]}] vs fresh [${c[i]}]`;
        }
        if (bad) {
            failures++;
            print(`FAIL seed ${seedNo} step ${step}: ${bad}\n  text=${JSON.stringify(text)} cursor=${cursor}`);
            break;
        }
    }
    r.destroy();
    win.destroy();
}
const ms = (GLib.get_monotonic_time() - t0) / 1000;
globalThis.logError = origLogError;
if (loggedErrors) {
    failures++;
    print(`FAIL: ${loggedErrors} renderer errors logged`);
}
print(`markdown_fuzz: ${SEEDS} seeds x ${EDITS} edits in ${ms.toFixed(0)} ms, ${failures} failed`);
if (failures > 0) imports.system.exit(1);
