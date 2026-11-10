// GTK-level renderer tests (needs a display, e.g. WAYLAND_DISPLAY).
// Run from the repository root: gjs tests/markdown_render.js
imports.gi.versions.Gtk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();
const Parser = imports.markdown.parser;
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { MarkdownTextView } = imports.ui.markdownTextView;

let failures = 0, passes = 0;
function check(cond, msg) {
    if (cond) {
        passes++;
    } else {
        failures++;
        print(`FAIL: ${msg}`);
    }
}
function eq(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    check(sa === sb, `${msg}\n   expected ${sb}\n   got      ${sa}`);
}

// Count renderer errors (they are logged, never thrown)
let loggedErrors = 0;
const origLogError = globalThis.logError;
globalThis.logError = (e, msg) => {
    loggedErrors++;
    origLogError(e, msg);
};

const colors = {
    background: '#0d1117', foreground: '#e6edf3', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', font: 'monospace',
};

function spin(ms = 50) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_LOW, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}

function make(text, opts = {}) {
    const tv = new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR, left_margin: 20, right_margin: 20 });
    const win = new Gtk.Window({ default_width: opts.width || 700, default_height: 500 });
    win.set_child(new Gtk.ScrolledWindow({ child: tv, hscrollbar_policy: Gtk.PolicyType.NEVER }));
    if (opts.show) win.present();
    const b = tv.get_buffer();
    const r = new MarkdownRenderer(tv, colors, opts.moods || null);
    if (text !== undefined) b.set_text(text, -1);
    place(b, opts.cursor || 0);
    r.renderNow(true);
    return { tv, win, b, r };
}
function all(b) {
    const [s, e] = b.get_bounds();
    return b.get_text(s, e, true);
}
function place(b, off) {
    b.place_cursor(b.get_iter_at_offset(off));
}
// Offset of the n-th occurrence of needle, in code points
function off(b, needle, n = 0) {
    const t = all(b);
    let i = -1;
    for (let k = 0; k <= n; k++) i = t.indexOf(needle, i + 1);
    if (i < 0) throw new Error(`not found: ${needle}`);
    return Array.from(t.slice(0, i)).length;
}
function tags(b, offset) {
    return b.get_iter_at_offset(offset).get_tags().map(t => t.name).filter(n => n !== 'no-hyphens');
}
function hasTag(b, offset, name) {
    return tags(b, offset).some(n => n === name || (name.endsWith('*') && n.startsWith(name.slice(0, -1))));
}

// --- Basic rendering and byte-identical text ------------------------------------
{
    const text = 'zzz\n# Hello 😀 world\n- [ ] read [docs](https://example.com) today\n' +
        '😀😀😀 **bold** -> x <- y\nliteral → and ← stay\n<!-- a -> b -->\n`a -> b`\n```\ncode **x** ->\n```\n* star';
    const { b, r, win } = make(text);
    eq(all(b), text, 'buffer text unchanged by rendering');
    check(hasTag(b, off(b, 'Hello'), 'gradient-*'), 'heading gradient');
    check(hasTag(b, off(b, '😀'), 'emoji-h1'), 'emoji in heading gets fallback scale');
    check(hasTag(b, off(b, '#'), 'invisible'), 'heading marker hidden');
    check(hasTag(b, off(b, 'docs'), 'link'), 'link after checkbox');
    check(hasTag(b, off(b, '[ ]') + 1, 'todo-unchecked'), 'checkbox');
    check(hasTag(b, off(b, '**bold') + 2, 'bold'), 'bold after emoji');
    check(!hasTag(b, off(b, '**bold') + 1, 'bold') || hasTag(b, off(b, '**bold') + 1, 'invisible'), 'bold markers hidden');
    check(!hasTag(b, off(b, '**bold') - 1, 'bold'), 'bold does not start early (emoji offsets)');
    check(hasTag(b, off(b, '-> x'), 'arrow') && hasTag(b, off(b, '-> x') + 1, 'arrow'), 'arrow tagged');
    check(hasTag(b, off(b, '<- y'), 'arrow'), 'left arrow tagged');
    check(!hasTag(b, off(b, '→'), 'arrow'), 'unicode arrow untouched');
    check(!hasTag(b, off(b, 'a -> b'), 'arrow') && !hasTag(b, off(b, 'a -> b') + 2, 'arrow'), 'no arrow in comment');
    check(hasTag(b, off(b, 'a -> b'), 'comment'), 'comment styled');
    check(!hasTag(b, off(b, 'a -> b', 1) + 2, 'arrow'), 'no arrow in code span');
    check(hasTag(b, off(b, 'code **x**'), 'code-block'), 'fenced code');
    check(!hasTag(b, off(b, '**x**') + 2, 'bold'), 'no bold in fence');
    check(!hasTag(b, off(b, ' ->', 2) + 1, 'arrow'), 'no arrow in fence');
    check(hasTag(b, off(b, '* star'), 'bullet-star'), 'star bullet dot');
    eq(r.getLinkAtIter(b.get_iter_at_offset(off(b, 'docs'))), 'https://example.com', 'getLinkAtIter on link text');
    eq(r.getLinkAtIter(b.get_iter_at_offset(off(b, 'today'))), null, 'getLinkAtIter elsewhere');
    check(r.isInCodeBlock(8) && r.isInCodeBlock(7) && r.isInCodeBlock(9), 'isInCodeBlock for fence lines');
    check(!r.isInCodeBlock(6), 'isInCodeBlock false for inline code line');
    check(r.isInCodeSpan(b.get_iter_at_offset(off(b, 'a -> b', 1) + 1)), 'isInCodeSpan inside');
    check(!r.isInCodeSpan(b.get_iter_at_offset(off(b, 'today'))), 'isInCodeSpan outside');
    eq(all(b), text, 'text still identical');
    r.destroy();
    win.destroy();
}

// --- Regression: headings with emoji / CJK / fallback glyphs never throw ------
{
    const before = loggedErrors;
    const { b, r, win } = make('# 🎉 Heading 世界 ✓ Привет\n## 🚀🔥💯\nx');
    eq(loggedErrors, before, 'no renderer errors for fallback glyphs in headings');
    check(hasTag(b, off(b, '🎉'), 'emoji-h1'), 'emoji scaled in h1');
    check(hasTag(b, off(b, '🚀'), 'emoji-h2'), 'emoji scaled in h2');
    check(hasTag(b, off(b, 'Heading'), 'gradient-*'), 'latin text gradient');
    r.destroy();
    win.destroy();
}

// --- Links of every kind via getLinkAtIter ------------------------------------
{
    const { b, r, win } = make('a [t](u "title") b <https://auto.example> c https://bare.example/x_(y). d\n' +
        '[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) 😀 [e](f)');
    const at = (needle, d = 1) => r.getLinkAtIter(b.get_iter_at_offset(off(b, needle) + d));
    eq(at('[t]'), 'u', 'inline link');
    eq(at('<https'), 'https://auto.example', 'autolink');
    eq(at('https://bare'), 'https://bare.example/x_(y)', 'bare URL');
    eq(at('[wiki]'), 'https://en.wikipedia.org/wiki/Foo_(bar)', 'link with parens');
    eq(at('[e]'), 'f', 'link after emoji');
    eq(at(' b <', 0), null, 'no link on plain text');
    check(hasTag(b, off(b, 'https://bare'), 'link'), 'bare URL styled as link');
    r.destroy();
    win.destroy();
}

// --- Cursor reveal: per line, no dropped moves -----------------------------------
{
    const { b, r, win } = make('first\nsecond\nthird');
    // Type **x** on line 2 like a user, then immediately press Down
    const iter = b.get_iter_at_offset(off(b, 'second') + 6);
    b.place_cursor(iter);
    for (const ch of ' **x**') {
        b.insert_at_cursor(ch, -1);
    }
    spin(30);
    const star = off(b, '**x');
    check(hasTag(b, star, 'dim'), 'markers dimmed while cursor on them');
    // Down: move to line 3 and let the main loop run (no renderNow)
    place(b, off(b, 'third') + 2);
    spin(30);
    check(hasTag(b, star, 'invisible') && !hasTag(b, star, 'dim'), 'markers hidden after moving away');
    check(hasTag(b, off(b, 'x**'), 'bold'), 'bold still applied');
    // Quick edit-then-move without spinning in between
    place(b, off(b, 'first') + 5);
    b.insert_at_cursor(' *i*', -1);
    place(b, off(b, 'third'));
    spin(30);
    check(hasTag(b, off(b, '*i*'), 'invisible'), 'rapid edit then move: italic markers hidden');
    // Heading reveal is per line
    b.set_text('# Title\ntext', -1);
    place(b, off(b, 'Title') + 2);
    r.renderNow();
    check(hasTag(b, 0, 'dim-h1'), 'heading marker revealed on its line');
    place(b, off(b, 'text'));
    r.renderNow();
    check(hasTag(b, 0, 'invisible'), 'heading marker hidden when cursor leaves');
    // Arrow raw text revealed only when adjacent
    b.set_text('go -> here', -1);
    place(b, 0);
    r.renderNow();
    check(hasTag(b, 3, 'arrow'), 'arrow drawn with cursor away');
    place(b, 5);
    r.renderNow();
    check(!hasTag(b, 3, 'arrow'), 'arrow raw with cursor right after it');
    place(b, 3);
    r.renderNow();
    check(!hasTag(b, 3, 'arrow'), 'arrow raw with cursor right before it');
    eq(all(b), 'go -> here', 'arrow text unchanged');
    // Cursor never adjusted by the renderer
    b.set_text('a **bold** b', -1);
    for (let i = 0; i <= 12; i++) {
        place(b, i);
        r.renderNow();
        eq(b.get_iter_at_mark(b.get_insert()).get_offset(), i, `cursor stays at ${i}`);
    }
    r.destroy();
    win.destroy();
}

// --- Fences: incremental cascade and block reveal --------------------------------
{
    const text = 'top\npara **b**\n```\ncode\n```\nafter **b**';
    const { b, r, win } = make(text);
    check(hasTag(b, off(b, 'para **b**') + 7, 'bold'), 'bold before typing fence');
    // Type a fence at the very top: everything below becomes code
    b.insert(b.get_start_iter(), '```\n', -1);
    r.renderNow(true);
    check(hasTag(b, off(b, 'para'), 'code-block') && !hasTag(b, off(b, 'para **b**') + 7, 'bold'),
        'typing ``` cascades into following lines');
    check(r.isInCodeBlock(1), 'isInCodeBlock follows the edit immediately');
    // The old opening fence now closes the new block; after it is text
    check(!hasTag(b, off(b, 'code'), 'code-block'), 'fence pairing shifts');
    // Undo restores the previous rendering (rendering is not in undo history)
    const s = b.get_start_iter();
    const e = b.get_iter_at_offset(4);
    b.delete(s, e);
    r.renderNow(true);
    eq(all(b), text, 'text restored');
    check(hasTag(b, off(b, 'para **b**') + 7, 'bold') && !hasTag(b, off(b, 'para'), 'code-block'),
        'removing the fence restores rendering');
    check(hasTag(b, off(b, 'code'), 'code-block'), 'original block is code again');
    // Block reveal: fence lines visible while the cursor is in the block
    place(b, off(b, 'code') + 1);
    r.renderNow();
    check(hasTag(b, off(b, '```'), 'dim') && hasTag(b, off(b, '```', 1), 'dim'), 'fences dimmed with cursor in block');
    place(b, 0);
    r.renderNow();
    check(hasTag(b, off(b, '```'), 'invisible') && hasTag(b, off(b, '```', 1), 'invisible'), 'fences hidden with cursor away');
    // Unclosed fence: opening line stays visible
    b.set_text('x\n```\nunclosed', -1);
    place(b, 0);
    r.renderNow(true);
    check(hasTag(b, off(b, '```'), 'dim'), 'unclosed fence stays visible');
    b.insert(b.get_end_iter(), '\n```', -1);
    place(b, 0);
    r.renderNow(true);
    check(hasTag(b, off(b, '```'), 'invisible'), 'fence hidden once closed');
    r.destroy();
    win.destroy();
}

// --- Theme, moods, zoom ----------------------------------------------------------------
{
    const { b, r, win, tv } = make('# Title\n## Sub\n`code`\n- item that is long\n  - [ ] nested');
    const table = b.get_tag_table();
    const before = all(b);
    const code = table.lookup('code');
    r.updateColors(Object.assign({}, colors, { red: '#123456', background: '#ffffff', foreground: '#000000' }));
    eq(code.foreground_rgba.to_string(), 'rgb(18,52,86)', 'theme change mutates tag in place');
    check(hasTag(b, off(b, 'code') - 1, 'code'), 'tags kept after theme change');
    eq(table.lookup('code'), code, 'same tag object after theme change');

    // Moods: custom mood, removal does not leak tags, >= 11 colours work
    const many = Array.from({ length: 12 }, (_, i) => `#${(i * 20).toString(16).padStart(2, '0')}8040`);
    r.setMoodConfig({ custom: { colors: many }, fire: { colors: ['#FF4500', '#FFD700'] } });
    r.renderNow(true);
    const tagNames = () => {
        const names = [];
        table.foreach(t => names.push(t.name || ''));
        return names;
    };
    check(tagNames().some(n => n.startsWith('gradient-custom-h1-')), '12-colour custom mood renders h1');
    check(tagNames().some(n => n.startsWith('gradient-fire-h2-')), 'second mood renders h2');
    r.setMoodConfig({ fire: { colors: ['#FF4500', '#FFD700'] } });
    r.renderNow(true);
    check(!tagNames().some(n => n.startsWith('gradient-custom-')), 'removed mood leaves no tags');
    check(hasTag(b, off(b, 'Title'), 'gradient-fire-h1-*'), 'headings re-rendered with remaining mood');
    r.setMoodConfig({});
    r.renderNow(true);
    check(hasTag(b, off(b, 'Title'), 'gradient-metal-h1-*'), 'empty mood config -> default moods');
    r.setMoodConfig({ nope: { colors: [] } });
    r.renderNow(true);
    check(hasTag(b, off(b, 'Title'), 'gradient-metal-h1-*'), 'invalid mood config -> default moods');

    // Zoom: hanging-indent tags are updated in place, not multiplied
    const indentTags = () => tagNames().filter(n => n.startsWith('md-indent-'));
    const count = indentTags().length;
    const indentAt = (o) => b.get_iter_at_offset(o).get_tags().find(t => (t.name || '').startsWith('md-indent-'));
    const t1 = indentAt(off(b, 'item'));
    const w1 = t1.indent;
    for (const px of [10, 20, 30, 40, 15, 25]) r.setZoom(px);
    r.setZoom(30);
    eq(indentTags().length, count, 'zoom does not create indent tags');
    check(indentAt(off(b, 'item')).indent < w1, 'indent grows (more negative) with font size');
    eq(all(b), before, 'text unchanged by theme/mood/zoom');
    r.destroy();
    win.destroy();
}

// --- Hanging indent aligns wrapped lines with the item text ------------------------
{
    const long = 'word '.repeat(60);
    const { b, r, win, tv } = make(`- ${long}\n  - [ ] ${long}\n1. ${long}`, { show: true, width: 400 });
    // Same font setup as the app's CSS (font-family + pixel font-size)
    const css = new Gtk.CssProvider();
    css.load_from_data('textview.jot-test { font-family: monospace; font-size: 15px; }', -1);
    Gtk.StyleContext.add_provider_for_display(tv.get_display(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    tv.add_css_class('jot-test');
    spin(100);
    r.setZoom(15);
    spin(400);
    r.renderNow(true);
    spin(200);
    for (const [prefix, lineNo] of [['- ', 0], ['  - [ ] ', 1], ['1. ', 2]]) {
        const lineStart = b.get_iter_at_line(lineNo)[1];
        const content = lineStart.copy();
        content.forward_chars(prefix.length);
        const contentX = tv.get_iter_location(content).x;
        // first character on the second display line
        const it = lineStart.copy();
        tv.forward_display_line(it);
        const wrappedX = tv.get_iter_location(it).x;
        check(it.get_line() === lineNo, `line ${lineNo} wraps`);
        check(Math.abs(wrappedX - contentX) <= 2,
            `wrapped line aligned with content for ${JSON.stringify(prefix)} (content x=${contentX}, wrapped x=${wrappedX})`);
    }
    r.destroy();
    win.destroy();
}

// --- Robustness -----------------------------------------------------------------------
{
    const { b, r, win } = make('a **b**\nc');
    // A failing parse must not wedge rendering
    const orig = Parser.parseLine;
    Parser.parseLine = () => {
        throw new Error('boom');
    };
    const before = loggedErrors;
    b.insert(b.get_end_iter(), ' *x*', -1);
    r.renderNow(true);
    Parser.parseLine = orig;
    check(loggedErrors > before, 'parse error was logged');
    b.insert(b.get_end_iter(), ' **y**', -1);
    place(b, 0);
    r.renderNow(true);
    check(hasTag(b, off(b, 'y'), 'bold'), 'rendering continues after an error');
    // CRLF text and many edits keep line bookkeeping in sync
    b.set_text('a\r\n**b**\r\n# c', -1);
    r.renderNow(true);
    check(hasTag(b, off(b, 'b'), 'bold'), 'CRLF lines');
    check(hasTag(b, off(b, 'c'), 'gradient-*'), 'CRLF heading');
    // Undo is unaffected by tagging
    b.set_text('', -1);
    b.begin_user_action();
    b.insert_at_cursor('**z**', -1);
    b.end_user_action();
    r.renderNow(true);
    b.undo();
    r.renderNow(true);
    eq(all(b), '', 'undo restores text');
    // Destroy disconnects everything
    r.destroy();
    b.set_text('**after destroy**', -1);
    spin(20);
    check(!hasTag(b, 3, 'bold'), 'no rendering after destroy');
    win.destroy();
}

// --- Random edits match a fresh render ---------------------------------------------
{
    const pieces = ['```\n', '~~~\n', '**b** ', '*i* ', '\n', '# h ', '- ', '* ', '[ ] ', '-> ', '<!--\n', '-->\n',
        '`c` ', '[l](u) ', '😀', 'text ', '> ', '1. ', '---\n'];
    let seed = 12345;
    const rand = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };
    const { b, r, win } = make('start\n');
    for (let step = 0; step < 300; step++) {
        const len = b.get_char_count();
        if (rand(4) === 0 && len > 2) {
            const s = rand(len);
            const e = Math.min(len, s + 1 + rand(6));
            b.delete(b.get_iter_at_offset(s), b.get_iter_at_offset(e));
        } else {
            b.insert(b.get_iter_at_offset(rand(len + 1)), pieces[rand(pieces.length)], -1);
        }
        place(b, rand(b.get_char_count() + 1));
        if (rand(3) === 0) r.renderNow();
    }
    place(b, 0);
    r.renderNow(true);
    const snapshot = (buf) => {
        const out = [];
        for (let i = 0; i < buf.get_char_count(); i++) out.push(tags(buf, i).filter(n => !n.startsWith('md-indent-')).sort().join(','));
        return out;
    };
    const fresh = make(all(b));
    const a1 = snapshot(b), a2 = snapshot(fresh.b);
    const firstDiff = a1.findIndex((v, i) => v !== a2[i]);
    check(firstDiff < 0, `incremental render equals fresh render (first diff at ${firstDiff}: ${a1[firstDiff]} vs ${a2[firstDiff]})`);
    eq(r._texts.length, b.get_line_count(), 'line bookkeeping matches buffer');
    fresh.r.destroy();
    fresh.win.destroy();
    r.destroy();
    win.destroy();
}

globalThis.logError = origLogError;
print(`${passes} passed, ${failures} failed`);
if (failures > 0) imports.system.exit(1);
