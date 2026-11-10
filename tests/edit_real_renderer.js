// Run from the repository root: gjs tests/edit_real_renderer.js
// Editing handlers (bullets/Enter, Ctrl+T, double-click todos, line
// movement, search) attached to the REAL MarkdownRenderer: what renders as
// a task is exactly what Ctrl+T and double-click toggle and what Enter
// continues; fenced code and HTML comments are left alone.
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();

const H = imports.tests.editHarness;
const Parser = imports.markdown.parser;
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { MarkdownTextView } = imports.ui.markdownTextView;
const { BulletHandlers } = imports.ui.bulletHandlers;
const { TodoHandlers } = imports.ui.todoHandlers;
const { LineMovement } = imports.ui.lineMovement;
const { SearchBarComponent } = imports.ui.searchBar;
const { Constants } = imports.constants;

const colors = {
    background: '#0d1117', foreground: '#e6edf3', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', font: 'monospace',
};

const tv = new MarkdownTextView({ wrap_mode: Gtk.WrapMode.WORD_CHAR });
const win = new Gtk.Window({ default_width: 700, default_height: 500 });
win.set_child(new Gtk.ScrolledWindow({ child: tv }));
const b = tv.get_buffer();
const r = new MarkdownRenderer(tv, colors, null);
const lm = new LineMovement(tv, r);
const bh = new BulletHandlers(tv, r, lm);
const th = new TodoHandlers(tv, r);

function load(spec) {
    H.load(b, spec);
    r.renderNow(true);
}
function ctrlT() {
    return bh.handleKeyPress(Constants.KEY_T, Constants.CTRL_MASK);
}
function enter() {
    return bh.handleKeyPress(Constants.KEY_ENTER, 0);
}
function lineText(l) {
    return H.text(b).split('\n')[l];
}
// Whether the renderer draws a task box at code point column col of line l
function renderedBox(l, col) {
    const [, it] = b.get_iter_at_line_offset(l, col);
    return it.get_tags().some(t => t.name === 'todo-unchecked' || t.name === 'todo-checked');
}

// --- M1 table: render-as-task == Ctrl+T toggles == double-click toggles
const TASKS = [
    ['[ ] bare task', '[X] bare task'],
    ['  [ ] indented bare', '  [X] indented bare'],
    ['> - [ ] quoted task', '> - [X] quoted task'],
    ['> [ ] quoted bare', '> [X] quoted bare'],
    ['- [ ]', '- [X]'],
    ['1) [x] paren', '1) [ ] paren'],
    ['* [X] star', '* [ ] star'],
    ['    - [ ] deep', '    - [X] deep'],
    ['> > 2. [ ] nested quote', '> > 2. [X] nested quote'],
];
for (const [line, toggled] of TASKS) {
    const box = line.indexOf('[');
    // Cursor on the next line so the box is rendered (not revealed)
    load(`${line}\n|other`);
    H.assertEq(`renders as task: ${line}`, renderedBox(0, box + 1), true);

    b.place_cursor(b.get_iter_at_offset(0));
    H.assertEq(`Ctrl+T handled: ${line}`, ctrlT(), true);
    H.assertEq(`Ctrl+T result: ${line}`, lineText(0), toggled);
    b.undo();
    H.assertEq(`Ctrl+T one undo step: ${line}`, lineText(0), line);

    load(`${line}\n|other`);
    H.assertEq(`double-click toggles: ${line}`, th.toggleAtIter(b.get_iter_at_offset(box + 1)), true);
    H.assertEq(`double-click result: ${line}`, lineText(0), toggled);
}

// Lines that look like tasks but are not rendered as tasks: none of the
// commands may touch them
const NOT_TASKS = [
    ['```\n- [ ] in fence\n```', 1],
    ['~~~\n[ ] bare in fence\n~~~', 1],
    ['<!--\n- [ ] in comment\n-->', 1],
    ['<!-- one line - [ ] -->', 0],
    ['`[ ] code span`', 0],
    ['text [ ] not at start', 0],
    ['-[ ] no space', 0],
    ['[] empty', 0],
];
for (const [doc, l] of NOT_TASKS) {
    const docLine = doc.split('\n')[l];
    const box = docLine.indexOf('[');
    load(`${doc}\n|end`);
    H.assertEq(`not rendered as task: ${docLine}`, renderedBox(l, box + 1), false);
    const [, it] = b.get_iter_at_line(l);
    b.place_cursor(it);
    H.assertEq(`Ctrl+T ignores: ${docLine}`, ctrlT(), false);
    H.assertEq(`double-click ignores: ${docLine}`, th.toggleAtIter(b.get_iter_at_line_offset(l, box + 1)[1]), false);
    H.assertEq(`unchanged: ${docLine}`, lineText(l), docLine);
}

// --- Enter continuation (same detector)
const ENTER = [
    ['> - a|', '> - a\n> - |'],
    ['> - |', '> |'],
    ['> > * a|', '> > * a\n> > * |'],
    ['> 1. a|', '> 1. a\n> 2. |'],
    ['> - [x] done|', '> - [x] done\n> - [ ] |'],
    ['[ ] a|', '[ ] a\n[ ] |'],
    ['  [x] a|', '  [x] a\n  [ ] |'],
    ['> [ ] q|', '> [ ] q\n> [ ] |'],
    ['[ ] |', '|'],
    ['> [ ] |', '> |'],
    ['- a|', '- a\n- |'],
    ['- |', '|'],
];
for (const [before, after] of ENTER) {
    load(before);
    H.assertEq(`Enter handled: ${before}`, enter(), true);
    H.assertEq(`Enter: ${before}`, H.state(b), after);
}
for (const spec of ['```\n- a|\n```', '<!--\n- a|\n-->', '> plain quote|']) {
    load(spec);
    H.assertEq(`Enter not handled: ${JSON.stringify(spec)}`, enter(), false);
}

// --- Quoted lists: Enter renumbers, Tab / Shift+Tab nest, one undo step each
function undoOnce() {
    tv.activate_action('text.undo', null);
}
const QUOTED = [
    // [label, spec, action, expected]
    ['Enter renumbers quoted list', '> 1. a|\n> 2. b\n> 3. c', enter, '> 1. a\n> 2. |\n> 3. b\n> 4. c'],
    ['Enter splits quoted item', '> 1. hello| world\n> 2. b', enter, '> 1. hello\n> 2. |world\n> 3. b'],
    ['Enter in nested quote renumbers', '> > 1. a|\n> > 2. b', enter, '> > 1. a\n> > 2. |\n> > 3. b'],
    ['Enter leaves outer list alone', '1. x\n> 1. a|\n> 2. b\n2. y', enter, '1. x\n> 1. a\n> 2. |\n> 3. b\n2. y'],
    ['Tab nests quoted bullet', '> - a\n> - |b', () => bh.indent(), '> - a\n>   - |b'],
    ['Shift+Tab un-nests quoted bullet', '> - a\n>   - |b', () => bh.outdent(), '> - a\n> - |b'],
    ['Tab nests quoted number and renumbers', '> 1. a\n> 2. |b\n> 3. c', () => bh.indent(),
        '> 1. a\n>    1. |b\n> 2. c'],
    ['Shift+Tab un-nests quoted number', '> 1. a\n>    1. |b\n> 2. c', () => bh.outdent(),
        '> 1. a\n> 2. |b\n> 3. c'],
    ['Tab on multi-line quoted selection', '> - a\n> - ⟨b\n> - c⟩', () => bh.indent(),
        '> - a\n>   - ⟨b\n>   - c⟩'],
];
for (const [label, spec, action, expected] of QUOTED) {
    load(spec);
    const before = H.text(b);
    H.assertEq(`${label}: handled`, action(), true);
    H.assertEq(label, H.state(b), expected);
    undoOnce();
    H.assertEq(`${label}: one undo step`, H.text(b), before);
}
load('> - a\n> - b|');
H.assertEq('Tab key on quoted item handled', bh.handleKeyPress(65289, 0), true);
H.assertEq('Tab key keeps the quote', H.text(b), '> - a\n>   - b');

// --- Tab does not nest list items inside code / comments
load('<!--\n- a|\n- b\n-->');
H.assertEq('Tab in comment not handled', bh.handleKeyPress(65289, 0), false);

// --- Line movement keeps the renderer's block state right
function checkKinds(label) {
    r.renderNow(true);
    const exp = Parser.classifyLines(Parser.splitLines(H.text(b))).kinds;
    const fence = [Parser.Kind.FENCE_OPEN, Parser.Kind.FENCE_CLOSE, Parser.Kind.CODE];
    const got = exp.map((_, l) => r.isInCodeBlock(l));
    H.assertEq(label, JSON.stringify(got), JSON.stringify(exp.map(k => fence.includes(k))));
}
load('```\na\n|```\nx\n- y');
lm.moveLineDown();
checkKinds('move closing fence down');
lm.moveLineDown();
checkKinds('move closing fence down twice');
H.assertEq('fence moved', H.text(b), '```\na\nx\n- y\n```');
load('|```\ncode\n```\n<!--\nc\n-->\nend');
lm.moveLineDown();
checkKinds('move opening fence down');
b.place_cursor(b.get_iter_at_line(4)[1]);
lm.moveLineUp();
checkKinds('move comment opener up');
b.undo();
b.undo();
checkKinds('undo line moves');
H.assertEq('undo restores', H.text(b), '```\ncode\n```\n<!--\nc\n-->\nend');
// CRLF line endings stay intact
load('a\r\n|b\r\nc');
lm.moveLineUp();
H.assertEq('move up keeps CRLF', H.text(b), 'b\r\na\r\nc');
lm.moveLineDown();
H.assertEq('move down keeps CRLF', H.text(b), 'a\r\nb\r\nc');

// --- Search with the real renderer: highlighting does not disturb
// rendering, matches inside code are found
const search = new SearchBarComponent(win, tv, r, colors);
search.create();
load('|# Head\n```\nfoo in code\n```\n- [ ] foo task\nfoo');
search.show();
search.searchEntry.set_text('foo');
H.spin(250);
search.performSearch();
H.assertEq('search count', search.searchMatches.length, 3);
r.renderNow(true);
H.assertEq('code still code', r.isInCodeBlock(2), true);
H.assertEq('task still rendered', renderedBox(4, 3), true);
search.hide();
r.renderNow(true);
H.assertEq('task rendered after search', renderedBox(4, 3), true);

H.finish('edit_real_renderer');
