// Pure markdown parser tests (no display needed).
// Run from the repository root: gjs tests/markdown_parser.js
const { GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
const P = imports.markdown.parser;
const Moods = imports.markdown.moods;
const { Kind } = P;

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

// Rendered view of a line with the cursor away (col = -1) or at col:
// returns {tagName: [substrings]} for every applied tag
function render(text, col = -1, fenceIn = '') {
    const m = P.parseLine(text, fenceIn);
    const cps = Array.from(text);
    const out = {};
    const add = (t, s, e) => {
        (out[t] = out[t] || []).push(cps.slice(s, e).join(''));
    };
    for (const s of m.spans) add(s.t, s.s, s.e);
    for (const k of m.marks) {
        const on = col >= 0 && col >= k.gs && col <= k.ge;
        const t = on ? k.on : k.off;
        if (t) add(t, k.s, k.e);
    }
    return out;
}
// Text that stays visible with the cursor away from the line
function visible(text) {
    const m = P.parseLine(text);
    const cps = Array.from(text);
    const hidden = new Array(cps.length).fill(false);
    for (const k of m.marks) {
        if (k.off === 'invisible') for (let i = k.s; i < k.e; i++) hidden[i] = true;
    }
    return cps.filter((c, i) => !hidden[i]).join('');
}
const has = (r, tag, s) => (r[tag] || []).includes(s);
const lacks = (r, tag) => !r[tag];

// --- Code spans take precedence --------------------------------------------
{
    const r = render('`code with **bold** inside`');
    eq(r.code, ['`code with **bold** inside`'], 'code span covers whole span');
    check(lacks(r, 'bold'), 'no bold inside code span');
    eq(visible('`code with **bold** inside`'), 'code with **bold** inside', 'code markup hidden, content verbatim');

    const r2 = render('`a*b*c` and `[x](y)` and `[ ]`');
    check(lacks(r2, 'italic') && lacks(r2, 'link') && lacks(r2, 'todo-unchecked'), 'no italic/link/checkbox in code');
    eq(r2.code.length, 3, 'three code spans');

    eq(render('`` a`b ``').code, ['`` a`b ``'], 'double backtick code span containing a backtick');
    eq(render('```x``` inline').code, ['```x```'], 'triple backticks on one line = code span');
    check(lacks(render('`unclosed code'), 'code'), 'unclosed backtick is literal');
    eq(render('`code`text`code`').code, ['`code`', '`code`'], 'adjacent code spans');
    eq(render('a -> b `->` c').arrow, ['->'], 'no arrow inside code span');
    eq(render('`code`**bold**`code`').bold, ['**bold**'], 'bold between code spans');
}

// --- Links -------------------------------------------------------------------
{
    const t = '- [ ] read [docs](https://example.com) today';
    const r = render(t);
    eq(r.link, ['docs'], 'link text after checkbox');
    eq(r['todo-unchecked'], ['[ ]'], 'checkbox still rendered');
    eq(P.parseLine(t).links.map(l => l.url), ['https://example.com'], 'link url');

    const w = 'see [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) ok';
    eq(P.parseLine(w).links.map(l => l.url), ['https://en.wikipedia.org/wiki/Foo_(bar)'], 'balanced parens in URL');
    eq(visible(w), 'see wiki ok', 'link syntax hidden');

    eq(P.parseLine('[a](url "title")').links.map(l => l.url), ['url'], 'title is not part of URL');
    eq(visible('[a](url "title")'), 'a', 'title hidden');
    eq(P.parseLine("[a](<my url> 'x')").links.map(l => l.url), ['my url'], 'angle-bracket destination');
    eq(render('[a](u)', 2)['link-url'], ['u'], 'url revealed with cursor inside');

    eq(render('![alt text](a.png)').link, ['alt text'], 'image renders alt text as link');
    eq(visible('![alt text](a.png)'), 'alt text', 'image marker hidden');

    eq(P.parseLine('<https://example.com>').links.map(l => l.url), ['https://example.com'], 'autolink');
    eq(render('<https://example.com>').link, ['https://example.com'], 'autolink styled');
    eq(visible('<https://example.com>'), 'https://example.com', 'autolink brackets hidden');
    eq(P.parseLine('mail <me@example.com>').links.map(l => l.url), ['mailto:me@example.com'], 'email autolink');
    eq(P.parseLine('go to https://example.com/a_b_c. now').links.map(l => l.url),
        ['https://example.com/a_b_c'], 'bare URL, trailing period trimmed');
    eq(P.parseLine('(see https://x.org/a)').links.map(l => l.url), ['https://x.org/a'], 'bare URL, unbalanced paren trimmed');
    eq(P.parseLine('https://en.wikipedia.org/wiki/Foo_(bar)').links.map(l => l.url),
        ['https://en.wikipedia.org/wiki/Foo_(bar)'], 'bare URL keeps balanced paren');
    check(lacks(render('https://example.com/a_b_c'), 'italic'), 'no emphasis inside bare URL');
    eq(render('a https://x.org/*y* b').link, ['https://x.org/*y'], 'bare URL, trailing * trimmed (GFM)');
    check(lacks(render('a https://x.org/*y* b'), 'italic'), 'bare URL is opaque to emphasis');
    check(has(render('[link with **bold**](https://e.com)'), 'bold', '**bold**'), 'bold inside link text');
    eq(P.parseLine('[link with [nested]](u)').links.length, 0, 'nested brackets: no link (documented)');
    eq(P.parseLine('[a [b](c)').links.map(l => l.url), ['c'], 'innermost bracket opens the link');
    eq(render('[unclosed link](https://example.com').link, ['https://example.com'],
        'unclosed link: only the bare URL is a link');
    eq(P.parseLine('[link](unclosed url').links.length, 0, 'unclosed url');
    eq(P.parseLine('`[x](y)`').links.length, 0, 'no link in code');
    eq(P.parseLine('a [b](c) d [e](f)').links.map(l => l.url), ['c', 'f'], 'two links');
    eq(P.parseLine('[empty link url]()').links.map(l => l.url), [''], 'empty destination is a link with empty url');
    eq(P.parseLine('\\[not](link)').links.length, 0, 'escaped bracket is not a link');
}

// --- Tasks -------------------------------------------------------------------
{
    check(lacks(render('matrix[x] value'), 'todo-checked'), 'matrix[x] is not a checkbox');
    check(lacks(render('see [ ] here'), 'todo-unchecked'), 'mid-line [ ] is not a checkbox');
    for (const t of ['- [ ] a', '* [x] a', '+ [X] a', '1. [ ] a', '2) [x] a', '  - [ ] nested', '[ ] line start', '[x]', '> - [ ] quoted']) {
        const m = P.parseLine(t);
        check(m.task !== null, `task recognised: ${JSON.stringify(t)}`);
    }
    eq(render('- [x] done thing')['todo-checked-text'], ['done thing'], 'checked text struck through');
    eq(render('- [x] done')['todo-checked'], ['[x]'], 'checked box');
    eq(render('- [ ] a', 3)['todo-unchecked-inside'], ['[ ]'], 'box revealed with cursor in it');
    eq(render('- [ ] a', 3).dim, ['[', ' ', ']'], 'box chars dimmed with cursor in it');
    check(P.parseLine('- [] Empty').task === null, '[] is not a task');
    check(P.parseLine('- [ ]x').task === null, 'task box must be followed by space');
    eq(visible('- [ ] read'), '-   read', 'brackets hidden (middle char kept as box)');
}

// --- Emphasis (CommonMark delimiter runs) ----------------------------------
{
    const r = render('***bold italic***');
    eq(r.bold, ['**bold italic**'], '*** -> bold inside');
    eq(r.italic, ['***bold italic***'], '*** -> italic outside');
    eq(visible('***bold italic***'), 'bold italic', '*** markers hidden');

    check(lacks(render('foo__init__bar'), 'bold'), 'intraword __ is not bold');
    check(lacks(render('snake_case_word'), 'italic'), 'intraword _ is not italic');
    eq(render('snake_case and _ital_').italic, ['_ital_'], '_ital_ is italic');
    check(lacks(render('** not bold **'), 'bold'), '** not bold ** (flanking)');
    check(lacks(render('**   **'), 'bold'), 'empty bold');
    check(lacks(render('* italic *'), 'italic'), '* italic * not italic');

    const n = render('**bold *and italic***');
    eq(n.bold, ['**bold *and italic***'], 'nested: bold');
    eq(n.italic, ['*and italic*'], 'nested: italic');

    eq(render('**bold**text**bold**').bold, ['**bold**', '**bold**'], 'adjacent bolds');
    eq(render('*italic* and **bold**').italic, ['*italic*'], 'italic and bold');
    eq(render('__bold__ and _it_').bold, ['__bold__'], 'underscore bold');
    eq(render('*bold**').italic, ['*bold*'], 'mismatched *bold** -> italic + literal *');
    eq(render('**bold with *italic* inside**').italic, ['*italic*'], 'italic inside bold');
    eq(render('*a **b** c*').bold, ['**b**'], 'bold inside italic');
    eq(render('**_bold and italic_**').italic, ['_bold and italic_'], '**_x_**');
    check(lacks(render('2 * 3 * 4'), 'italic'), 'arithmetic stars');
    check(lacks(render('**unclosed bold'), 'bold'), 'unclosed bold');

    eq(render('~~strike~~').strikethrough, ['~~strike~~'], 'strikethrough');
    check(lacks(render('~approx~ 5'), 'strikethrough'), 'single tilde not strikethrough');
    eq(render('~~strikethrough with **bold**~~').bold, ['**bold**'], 'bold inside strike');
    check(lacks(render('++underline++'), 'underline'), '++underline++ removed');
    eq(visible('++underline++'), '++underline++', '++ stays literal');
}

// --- Backslash escapes --------------------------------------------------------
{
    const r = render('\\*not italic\\*');
    check(lacks(r, 'italic'), 'escaped stars not italic');
    eq(r.invisible, ['\\', '\\'], 'backslashes hidden');
    eq(visible('\\*not italic\\*'), '*not italic*', 'escaped text visible');
    eq(render('\\*a\\*', 1).dim, ['\\'], 'backslash dimmed near cursor');
    eq(render('a \\-> b').arrow, undefined, 'escaped arrow is not an arrow');
    eq(render('C:\\path').invisible, undefined, 'backslash before letter is literal');
}

// --- Headings ---------------------------------------------------------------------
{
    for (let level = 1; level <= 6; level++) {
        const m = P.parseLine('#'.repeat(level) + ' Title');
        eq(m.kind, Kind.HEADING, `h${level} kind`);
        eq(m.heading.level, level, `h${level} level`);
    }
    eq(P.parseLine('####### Seven').kind, Kind.TEXT, '7 hashes is not a heading');
    eq(P.parseLine('#No space').kind, Kind.TEXT, '#No space');
    eq(P.parseLine('#\tTab heading').kind, Kind.HEADING, 'tab after hashes');
    eq(P.parseLine('# ').kind, Kind.TEXT, 'empty heading renders as text');
    const m = P.parseLine('# Title #');
    eq([m.heading.contentStart, m.heading.contentEnd], [2, 7], 'closing sequence excluded from content');
    eq(visible('# Title #'), 'Title', 'heading markers hidden');
    eq(render('## Head', 0)['dim-h2'], ['## '], 'heading marker dimmed when cursor on line');
    eq(render('## Head', 6)['dim-h2'], ['## '], 'heading marker revealed anywhere on line');
    eq(render('# Heading with **bold** and *italic*').bold, ['**bold**'], 'inline in heading');
    eq(P.parseLine('   # Indented').kind, Kind.HEADING, 'up to 3 spaces before #');
}

// --- Thematic breaks ----------------------------------------------------------
{
    for (const t of ['---', '***', '___', '* * *', '- - -', '----------', '   ---   ', '_ _ _ _']) {
        eq(P.parseLine(t).kind, Kind.HR, `hr: ${JSON.stringify(t)}`);
    }
    for (const t of ['--', '---text', '--- (should match)', '-- -x']) {
        check(P.parseLine(t).kind !== Kind.HR, `not hr: ${JSON.stringify(t)}`);
    }
    check(P.parseLine('* * *').list === null, 'hr takes priority over list');
    eq(render('---')['hr-line'], ['---'], 'hr line tag');
    eq(render('---', 1)['hr-line-dim'], ['---'], 'hr dim with cursor');
}

// --- Lists and quotes -------------------------------------------------------------
{
    eq(P.parseLine('- item').list.type, 'dash', 'dash bullet');
    eq(P.parseLine('* item').list.type, 'star', 'star bullet');
    eq(P.parseLine('+ item').list.type, 'plus', 'plus bullet');
    eq(P.parseLine('12. item').list.type, 'ordered', 'ordered');
    eq(P.parseLine('3) item').list.type, 'ordered', 'ordered paren');
    check(P.parseLine('-no space').list === null, 'bullet needs space');
    check(P.parseLine('*bold* text').list === null, '*bold* is not a bullet');
    check(P.parseLine('1.Numbered').list === null, 'ordered needs space');
    eq(render('* star')['bullet-star'], ['*'], 'star dot when cursor away');
    eq(render('* star', 0)['bullet-star-near'], ['*'], 'star revealed when cursor adjacent');
    eq(render('* star', 1)['bullet-star-near'], ['*'], 'star revealed right after it');
    eq(render('* star', 4)['bullet-star'], ['*'], 'star hidden when cursor further away');
    eq(render('1. item')['numbered-list-number'], ['1.'], 'number dimmed');
    eq(P.parseLine('    - deep').prefix.text, '    - ', 'prefix keeps actual indentation');
    eq(P.parseLine('  - [ ] todo').prefix.text, '  - [ ] ', 'prefix includes task box');
    eq(P.parseLine('  - [ ] todo').prefix.box, 4, 'box index in prefix');
    eq(P.parseLine('1. x').prefix.text, '1. ', 'ordered prefix');
    check(P.parseLine('plain').prefix === null, 'no prefix on paragraphs');

    const q = render('> quote');
    eq(q['quote-marker'], ['>'], 'quote marker');
    eq(q.blockquote, ['quote'], 'quote content');
    eq(P.parseLine('> > nested').quote.depth, 2, 'nested quote');
    eq(P.parseLine('>> nested').quote.depth, 2, 'nested quote without space');
    eq(render('> - item')['bullet-dash'], ['-'], 'list inside quote');
}

// --- Arrows (visual only) ------------------------------------------------------
{
    eq(render('a -> b <- c <-> d').arrow, ['->', '<-', '<->'], 'arrows');
    eq(render('Text->arrow->text').arrow, ['->', '->'], 'arrows inside words');
    eq(render('-> at start').arrow, ['->'], 'arrow at line start (not a bullet)');
    check(P.parseLine('-> at start').list === null, '-> is not a bullet');
    eq(render('a <!-- -> --> b').arrow, undefined, 'no arrow inside HTML comment');
    eq(render('a <!-- x --> b').comment, ['<!-- x -->'], 'inline comment');
    eq(render('a -> b', 2).arrow, undefined, 'arrow raw when cursor at its start');
    eq(render('a -> b', 4).arrow, undefined, 'arrow raw when cursor right after it');
    eq(render('a -> b', 5).arrow, ['->'], 'arrow drawn when cursor away');
    eq(render('[x](a->b)').arrow, undefined, 'no arrow in link destination');
    eq(render('Function: `test() -> result`').arrow, undefined, 'no arrow in code');
    eq(render('code', -1, '`3').arrow, undefined, 'no arrow in fence');
}

// --- Block state: fences and HTML comments --------------------------------------
{
    const doc = (text) => P.classifyLines(P.splitLines(text)).kinds;
    eq(doc('```\ncode\n```\ntext'), [Kind.FENCE_OPEN, Kind.CODE, Kind.FENCE_CLOSE, Kind.TEXT], 'basic fence');
    eq(doc('~~~\n**x**\n~~~'), [Kind.FENCE_OPEN, Kind.CODE, Kind.FENCE_CLOSE], 'tilde fence');
    eq(doc('````\n```\ninside\n```\n````\nafter'),
        [Kind.FENCE_OPEN, Kind.CODE, Kind.CODE, Kind.CODE, Kind.FENCE_CLOSE, Kind.TEXT], 'shorter fence does not close');
    eq(doc('```js\ncode\n```js\nstill\n```'),
        [Kind.FENCE_OPEN, Kind.CODE, Kind.CODE, Kind.CODE, Kind.FENCE_CLOSE], 'closing fence cannot have info string');
    eq(doc('```\ncode\n~~~\n```'), [Kind.FENCE_OPEN, Kind.CODE, Kind.CODE, Kind.FENCE_CLOSE], 'closing fence must use same char');
    eq(doc('```code```\n**x**'), [Kind.TEXT, Kind.TEXT], 'single-line ```code``` is inline code');
    eq(doc('```\nunclosed\nrest'), [Kind.FENCE_OPEN, Kind.CODE, Kind.CODE], 'unclosed fence runs to the end');
    eq(doc('   ```\nx\n   ```'), [Kind.FENCE_OPEN, Kind.CODE, Kind.FENCE_CLOSE], 'fence indented 3 spaces');
    eq(doc('    ```\nx'), [Kind.TEXT, Kind.TEXT], 'fence indented 4 spaces is not a fence');
    eq(doc('```\n```  '), [Kind.FENCE_OPEN, Kind.FENCE_CLOSE], 'closing fence trailing spaces');
    eq(doc('<!--\n-> **x**\n-->\nafter'), [Kind.HTML, Kind.HTML, Kind.HTML, Kind.TEXT], 'multi-line HTML comment');
    eq(doc('<!-- one line -->\n**b**'), [Kind.HTML, Kind.TEXT], 'single-line HTML comment block');
    check(lacks(render('**x**', -1, '`3'), 'bold'), 'no inline markdown inside fence');
}

// --- Emoji / astral characters: offsets are code points ------------------------
{
    const t = '😀😀😀 **bold**';
    const m = P.parseLine(t);
    const bold = m.spans.find(s => s.t === 'bold');
    eq([bold.s, bold.e], [4, 12], 'bold offsets after emoji are code points');
    eq(render(t).bold, ['**bold**'], 'bold text after emoji');

    const l = P.parseLine('🎉 [link emoji](url) 🎉 -> x');
    const link = l.spans.find(s => s.t === 'link');
    eq([link.s, link.e], [3, 13], 'link offsets after emoji');
    eq(l.links[0].s, 2, 'link source start after emoji');
    eq(render('🎉 [link emoji](url) 🎉 -> x').arrow, ['->'], 'arrow after emoji');
    eq(render('# 🎉 Heading').invisible, ['# '], 'heading marker with emoji');
    const h = P.parseLine('###### Heading 6 with multiple emojis 🚀🔥💯');
    eq(h.heading.contentEnd, Array.from('###### Heading 6 with multiple emojis 🚀🔥💯').length, 'heading end in code points');
    eq(render('- [ ] 🎉 Todo with emoji **b**').bold, ['**b**'], 'task + emoji + bold');
    eq(render('`🎉 code emoji` x').code, ['`🎉 code emoji`'], 'code span with emoji');
    eq(render('**🎉 bold emoji**').bold, ['**🎉 bold emoji**'], 'bold starting with emoji');
}

// --- Moods -------------------------------------------------------------------------
{
    eq(Moods.normalizeMoods(null).length, Object.keys(Moods.DEFAULT_MOODS).length, 'null -> default moods');
    eq(Moods.normalizeMoods({}).length, Object.keys(Moods.DEFAULT_MOODS).length, 'empty -> default moods');
    eq(Moods.normalizeMoods({ bad: { colors: ['nope'] } }).length, Object.keys(Moods.DEFAULT_MOODS).length,
        'invalid colours -> default moods');
    const one = Moods.normalizeMoods({ solid: ['#FF0000'] });
    eq(one.map(m => m.name), ['solid'], 'array form accepted');
    eq(one[0].gradient, ['#ff0000'], 'single colour gradient');
    eq(Moods.buildGradient(['#000000', '#ffffff']).length, 20, 'two colours: 20 steps');
    const many = Array.from({ length: 15 }, (_, i) => '#' + (i * 16).toString(16).padStart(2, '0') + '0000');
    const g = Moods.buildGradient(many);
    check(g.length >= 15, `15-colour mood has >= 15 steps (got ${g.length})`);
    check(g.every(c => /^#[0-9a-f]{6}$/.test(c)), 'gradient colours valid');
    eq(Moods.normalizeMoods({ rgb: { colors: ['#F00', '#0F0', '#00F'] } })[0].gradient[0], '#ff0000', '#RGB colours');
    const keep = Moods.normalizeMoods({ a: ['#111111'], b: [], c: ['#222222'] });
    eq(keep.map(m => m.name), ['a', 'c'], 'moods without colours dropped, order kept');
}

// --- The corner-case document parses without errors and sensibly ------------
{
    const [, bytes] = GLib.file_get_contents('tests/markdown-corner-cases.md');
    const lines = P.splitLines(new TextDecoder().decode(bytes));
    const { kinds, fenceOut } = P.classifyLines(lines);
    let ok = true;
    for (let i = 0; i < lines.length; i++) {
        try {
            const m = P.parseLine(lines[i], i > 0 ? fenceOut[i - 1] : '');
            const n = Array.from(lines[i]).length;
            for (const s of m.spans.concat(m.marks)) {
                if (!(s.s >= 0 && s.e <= n && s.s < s.e)) {
                    ok = false;
                    print(`bad range on line ${i + 1}: ${JSON.stringify(s)}`);
                }
            }
        } catch (e) {
            ok = false;
            print(`line ${i + 1} threw: ${e}`);
        }
    }
    check(ok, 'corner-case document: all ranges valid');
    const kindOf = (text) => kinds[lines.indexOf(text)];
    eq(kindOf('code block with **bold** (should not render)'), Kind.CODE, 'corner: code block content');
    // The document's "unclosed" fence is closed by the next fence line, so
    // later fences pair up differently (CommonMark behaviour)
    eq(kindOf('closed code block'), Kind.TEXT, 'corner: fence pairing per CommonMark');
    eq(kindOf('four backticks code block'), Kind.TEXT, 'corner: ```` closes a ``` fence');
    eq(kindOf('```triple backticks```'), Kind.TEXT, 'corner: inline triple backticks');
    eq(kindOf('# Heading 1 with **bold** and *italic*'), Kind.HEADING, 'corner: heading');
    eq(kindOf('####### Heading 7 (should cap at 6)'), Kind.TEXT, 'corner: 7 hashes is text (CommonMark)');
    eq(P.parseLine('--- (should match)').kind, Kind.TEXT, 'corner: --- followed by text is not hr');
    check(lacks(render('| **Bold Header** | *Italic Header* | `Code Header` |'), 'table-pipe'), 'corner: no table styling');
    eq(render('Text with →← arrows (Unicode)').arrow, undefined, 'corner: unicode arrows untouched');
}

print(`${passes} passed, ${failures} failed`);
if (failures > 0) imports.system.exit(1);

