// Run from the repository root: gjs tests/edit_handlers.js
// Gtk-level tests for list editing, todo toggling, line movement and cut-line:
// exact buffer text, cursor/selection, and undo/redo (one step per command).
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();

const H = imports.tests.editHarness;
const { TextUtils } = imports.util.text;
const { MarkdownList } = imports.util.markdownList;
const { BulletHandlers } = imports.ui.bulletHandlers;
const { LineMovement } = imports.ui.lineMovement;
const { TodoHandlers } = imports.ui.todoHandlers;

const ENTER = 65293, TAB = 65289, LEFT_TAB = 65056, UP = 65362, DOWN = 65364;
const KEY_T = 116, KEY_X = 120;
const CTRL = 4, SHIFT = 1;

// Wire up the handlers exactly like ui/window.js does.
const { tv, b } = H.newView();
const renderer = new H.StubRenderer(b);
const lineMovement = new LineMovement(tv, renderer);
const bullets = new BulletHandlers(tv, renderer, lineMovement);
bullets.setup();
const todos = new TodoHandlers(tv, renderer);
todos.setup();

// Press a key: our handler first, otherwise GtkTextView's default for the
// keys whose default inserts text.
function press(keyval, state = 0) {
    if (bullets.handleKeyPress(keyval, state))
        return;
    if (state & CTRL)
        return;
    if (keyval === ENTER)
        H.type(b, '\n');
    else if (keyval === TAB)
        H.type(b, '\t');
}

function strip(spec) {
    return spec.replace(/[|⟨⟩]/g, '');
}

// Load `before`, run `action`, expect `after` (with cursor/selection marks).
// Then: exactly one undo restores `before`'s text, redo re-applies `after`.
function cmd(name, before, action, after, { undoable = true } = {}) {
    H.load(b, before);
    action();
    H.assertEq(`${name}: result`, H.state(b), after);
    if (!undoable || strip(before) === strip(after))
        return;
    H.assertEq(`${name}: can undo`, b.get_can_undo(), true);
    b.undo();
    H.assertEq(`${name}: one undo restores`, H.text(b), strip(before));
    H.assertEq(`${name}: exactly one undo step`, b.get_can_undo(), false);
    H.assertEq(`${name}: can redo`, b.get_can_redo(), true);
    b.redo();
    H.assertEq(`${name}: redo`, H.text(b), strip(after));
}

const enter = () => press(ENTER);
const tab = () => press(TAB);
const shiftTab = () => press(LEFT_TAB, SHIFT);

// ---------------------------------------------------------------- util/text
H.assertEq('charLength ascii', TextUtils.charLength('abc'), 3);
H.assertEq('charLength emoji', TextUtils.charLength('a😀b'), 3);
H.assertEq('indexAt emoji', TextUtils.indexAt('😀😀x', 2), 4);
H.assertEq('indexAt clamp', TextUtils.indexAt('ab', 9), 2);
H.assertEq('offsetAt emoji', TextUtils.offsetAt('😀😀x', 4), 2);
H.assertEq('offsetAt inside pair rounds down', TextUtils.offsetAt('😀x', 1), 0);
H.assertEq('offsetsAt', JSON.stringify(TextUtils.offsetsAt('a😀b😀c', [0, 1, 3, 4, 6])), '[0,1,2,3,4]');
H.assertEq('roundtrip', TextUtils.offsetAt('x😀y😀', TextUtils.indexAt('x😀y😀', 3)), 3);

// -------------------------------------------------------- util/markdownList
const P = MarkdownList.parseListItem;
H.assertEq('parse bullet', P('- a').bullet, '-');
H.assertEq('parse *bold* is not a list', P('*bold* text'), null);
H.assertEq('parse 3.14 is not a list', P('3.14 is pi'), null);
H.assertEq('parse -1 is not a list', P('-1 degrees'), null);
H.assertEq('parse hr is not a list', P('* * *'), null);
H.assertEq('parse ordered', P('  12) x').number, 12);
H.assertEq('parse content column', P('1. x').contentColumn, 3);
H.assertEq('parse checkbox', P('- [x] t').checkbox.checked, true);
H.assertEq('parse not checkbox', P('- [x]t').checkbox, null);
H.assertEq('parse CRLF', P('1. a\r').content, 'a');
H.assertEq('parse 10 digits rejected', P('1234567890. x'), null);

// ------------------------------------------------------------------- Enter
cmd('enter numbered end', '1. a|', enter, '1. a\n2. |');
cmd('enter numbered renumber (H1)', '1. a|\n2. b', enter, '1. a\n2. |\n3. b');
cmd('enter numbered mid-item (H2)', '1. hello| world', enter, '1. hello\n2. |world');
cmd('enter numbered mid-item renumber', '1. hello| world\n2. next\n3. last', enter,
    '1. hello\n2. |world\n3. next\n4. last');
cmd('enter numbered mid-item trailing space', '1. hello |world', enter, '1. hello\n2. |world');
cmd('enter bullet mid-item', '- a|b', enter, '- a\n- |b');
cmd('enter bullet end', '- a|', enter, '- a\n- |');
cmd('enter star bullet', '* item|', enter, '* item\n* |');
cmd('enter plus bullet', '+ item|', enter, '+ item\n+ |');
cmd('enter todo mid-item', '- [ ] a|b', enter, '- [ ] a\n- [ ] |b');
cmd('enter checked todo', '- [x] done|', enter, '- [x] done\n- [ ] |');
cmd('enter numbered todo', '1. [ ] a|\n2. [ ] b', enter, '1. [ ] a\n2. [ ] |\n3. [ ] b');
cmd('enter paren delimiter', '1) a|\n2) b', enter, '1) a\n2) |\n3) b');
cmd('enter keeps start number', '5. a|\n6. b', enter, '5. a\n6. |\n7. b');
cmd('enter lazy numbering', '1. a|\n1. b', enter, '1. a\n1. |\n1. b');
cmd('enter nested numbered', '1. a\n   1. x|\n2. b', enter, '1. a\n   1. x\n   2. |\n2. b');
cmd('enter nested bullet', '- a\n  - x|', enter, '- a\n  - x\n  - |');
cmd('enter 9 -> 10', '9. a|', enter, '9. a\n10. |');
cmd('enter at content start', '- |abc', enter, '- \n- |abc');
cmd('enter exit empty bullet', '- a\n- |', enter, '- a\n|');
cmd('enter exit empty numbered', '1. a\n2. |', enter, '1. a\n|');
cmd('enter exit empty todo', '- [ ] |', enter, '|');
cmd('enter inside marker is plain', '|- a', enter, '\n|- a');
cmd('enter in fenced code', '```\n- a|\n```', enter, '```\n- a\n|\n```');
cmd('enter in ~~~ code', '~~~\n1. a|\n~~~', enter, '~~~\n1. a\n|\n~~~');
cmd('enter *bold* is plain', '*bold* text|', enter, '*bold* text\n|');
cmd('enter 3.14 is plain', '3.14 is pi|', enter, '3.14 is pi\n|');
cmd('enter year is plain', '2023.|', enter, '2023.\n|');
cmd('enter emoji bullet', '- 😀 a|b', enter, '- 😀 a\n- |b');
cmd('enter emoji numbered', '1. 😀😀 x|y\n2. z', enter, '1. 😀😀 x\n2. |y\n3. z');
cmd('enter emoji before cursor end', '- [ ] 😀|', enter, '- [ ] 😀\n- [ ] |');
cmd('enter stops renumber at paragraph', '1. a|\n2. b\n\npara\n\n1. c', enter,
    '1. a\n2. |\n3. b\n\npara\n\n1. c');
cmd('enter with selection is default', '- ⟨ab⟩', () => {
    if (!bullets.handleKeyPress(ENTER, 0)) H.type(b, '\n');
}, '- \n|');
// CRLF lines (the file layer normally normalises; be robust anyway)
H.load(b, '1. a|\r\n2. b\r\n3. c');
enter();
H.assertEq('enter CRLF renumbers', H.text(b), '1. a\n2. \r\n3. b\r\n4. c');

// Typing then Enter: Enter is its own undo step, typing is kept.
H.load(b, '1. a|\n2. b');
H.type(b, 'x');
enter();
H.assertEq('type+enter result', H.state(b), '1. ax\n2. |\n3. b');
b.undo();
H.assertEq('type+enter undo once', H.text(b), '1. ax\n2. b');
b.redo();
H.assertEq('type+enter redo', H.text(b), '1. ax\n2. \n3. b');
b.undo();
b.undo();
H.assertEq('type+enter undo twice', H.text(b), '1. a\n2. b');
// Enter, then type, undo the typing, redo works (no hidden edits clear redo).
H.load(b, '- a|');
enter();
H.type(b, 'b');
b.undo();
H.assertEq('redo intact after undo', b.get_can_redo(), true);
b.redo();
H.assertEq('redo after enter+type', H.text(b), '- a\n- b');

// GtkTextView's own undo/redo actions (bound to Ctrl+Z / Ctrl+Shift+Z /
// Ctrl+Y) see the same single steps; Ctrl+Z is not intercepted by us.
H.load(b, '1. a|\n2. b');
enter();
H.assertEq('ctrl-z not intercepted', bullets.handleKeyPress(122, CTRL), false);
tv.activate_action('text.undo', null);
H.assertEq('text.undo', H.text(b), '1. a\n2. b');
tv.activate_action('text.redo', null);
H.assertEq('text.redo', H.text(b), '1. a\n2. \n3. b');

// --------------------------------------------------------------------- Tab
cmd('tab bullet', '- a\n- b|', tab, '- a\n  - b|');
cmd('shift-tab bullet', '- a\n  - b|', shiftTab, '- a\n- b|');
cmd('shift-tab via Tab+Shift', '- a\n  - b|', () => press(TAB, SHIFT), '- a\n- b|');
cmd('tab numbered renumbers both levels (M8)', '1. a\n2. b|\n3. c', tab, '1. a\n   1. b|\n2. c');
cmd('outdent numbered renumbers (M8)', '1. a\n   1. b|\n2. c', shiftTab, '1. a\n2. b|\n3. c');
cmd('tab joins existing nested list', '1. a\n   1. x\n2. b|\n3. c', tab, '1. a\n   1. x\n   2. b|\n2. c');
cmd('tab keeps paren delimiter', '1) a\n2) b|\n3) c', tab, '1) a\n   1) b|\n2) c');
cmd('tab under wide marker', '10. a\n11. b|', tab, '10. a\n    1. b|');
cmd('tab bullet under numbered', '1. a\n- b|', tab, '1. a\n  - b|');
cmd('tab todo', '- [ ] a\n- [ ] b|', tab, '- [ ] a\n  - [ ] b|');
cmd('tab cursor mid-line', '- a\n- b|c', tab, '- a\n  - b|c');
cmd('tab cursor at line start', '- a\n|- b', tab, '- a\n|  - b');
cmd('tab *bold* is plain (M7)', '*bold* text|', tab, '*bold* text\t|');
cmd('tab 3.14 is plain (M7)', '3.14 is pi|', tab, '3.14 is pi\t|');
cmd('tab plain line', 'hello|', tab, 'hello\t|');
cmd('tab in code block is plain', '```\n- a\n- b|\n```', tab, '```\n- a\n- b\t|\n```');
cmd('tab header', '# h|', tab, '## h|');
cmd('shift-tab header', '## h|', shiftTab, '# h|');
cmd('tab emoji item', '- a\n- 😀 b|', tab, '- a\n  - 😀 b|');
cmd('multi tab bullets', '- a\n⟨- b\n- c⟩', tab, '- a\n⟨  - b\n  - c⟩');
cmd('multi tab ordered', '1. a\n⟨2. b\n3. c⟩\n4. d', tab, '1. a\n⟨   1. b\n   2. c⟩\n2. d');
cmd('multi outdent ordered', '1. a\n⟨   1. b\n   2. c⟩\n2. d', shiftTab, '1. a\n⟨2. b\n3. c⟩\n4. d');
cmd('multi tab with children', '- a\n⟨- b\n  - b1\n- c⟩', tab, '- a\n⟨  - b\n    - b1\n  - c⟩');
cmd('multi tab partial selection', '- a\n- b⟨b\n- c⟩c', tab, '- a\n  - b⟨b\n  - c⟩c');
cmd('multi tab skips non-list lines', '- a\n⟨text\n- b⟩', tab, '- a\n⟨text\n  - b⟩');
cmd('multi tab selection ends at col 0', '- a\n⟨- b\n⟩- c', tab, '- a\n⟨  - b\n⟩- c');
cmd('multi tab emoji', '- a\n⟨- 😀\n- 😀😀⟩', tab, '- a\n⟨  - 😀\n  - 😀😀⟩');
cmd('shift-tab at top level is a no-op', '- a|', shiftTab, '- a|', { undoable: false });
H.assertEq('shift-tab at top level adds no undo step', b.get_can_undo(), false);
cmd('tab with tab indent outdent', '- a\n\t- b|', shiftTab, '- a\n- b|');
// Tab then Shift+Tab: two separate single steps.
H.load(b, '1. a\n2. b|\n3. c');
tab();
shiftTab();
H.assertEq('tab+shift-tab roundtrip', H.state(b), '1. a\n2. b|\n3. c');
b.undo();
H.assertEq('tab+shift-tab undo 1', H.text(b), '1. a\n   1. b\n2. c');
b.undo();
H.assertEq('tab+shift-tab undo 2', H.text(b), '1. a\n2. b\n3. c');
H.assertEq('tab+shift-tab no more undo', b.get_can_undo(), false);

// ------------------------------------------------------------------ Ctrl+T
const ctrlT = () => press(KEY_T, CTRL);
cmd('ctrl-t check', '- [ ] task|', ctrlT, '- [X] task|');
cmd('ctrl-t uncheck', '- [x] task|', ctrlT, '- [ ] task|');
cmd('ctrl-t cursor at start kept', '|- [ ] t', ctrlT, '|- [X] t');
cmd('ctrl-t cursor on box kept', '- [| ] t', ctrlT, '- [|X] t');
cmd('ctrl-t numbered', '1. [ ] t|', ctrlT, '1. [X] t|');
cmd('ctrl-t emoji', '- [ ] 😀|', ctrlT, '- [X] 😀|');
cmd('ctrl-t not a task', 'see [ ] here|', ctrlT, 'see [ ] here|', { undoable: false });
cmd('ctrl-t in fenced code', '```\n- [ ] a|\n```', ctrlT, '```\n- [ ] a|\n```', { undoable: false });
cmd('ctrl-t only first box', '- [ ] a [ ] b|', ctrlT, '- [X] a [ ] b|');

// ---------------------------------------------- double-click checkbox (M6)
function dbl(offset) {
    return () => todos.toggleAtIter(b.get_iter_at_offset(offset));
}
cmd('dblclick on [', '- [ ] a|', dbl(2), '- [X] a|');
cmd('dblclick on space', '- [ ] a', dbl(3), '- [X] a|');
cmd('dblclick on ]', '- [x] a', dbl(4), '- [ ] a|');
H.load(b, '- [ ] word|');
H.assertEq('dblclick on word not claimed', todos.toggleAtIter(b.get_iter_at_offset(7)), false);
H.assertEq('dblclick on marker not claimed', todos.toggleAtIter(b.get_iter_at_offset(0)), false);
H.load(b, 'text [ ] x|');
H.assertEq('dblclick non-task [ ] not claimed', todos.toggleAtIter(b.get_iter_at_offset(6)), false);
H.load(b, '```\n- [ ] a\n```');
H.assertEq('dblclick in fence not claimed', todos.toggleAtIter(b.get_iter_at_offset(7)), false);
H.assertEq('dblclick in fence text unchanged', H.text(b), '```\n- [ ] a\n```');
cmd('dblclick emoji line', 'x😀\n- [ ] 😀 a', dbl(6), 'x😀\n- [X] 😀 a|');
cmd('dblclick nested', '- a\n  - [ ] b', dbl(9), '- a\n  - [X] b|');

// ------------------------------------------------------------ line movement
const up = () => press(UP, CTRL);
const down = () => press(DOWN, CTRL);
cmd('move up', 'a\nb|\nc', up, 'b|\na\nc');
cmd('move down', 'a|\nb\nc', down, 'b\na|\nc');
cmd('move up at start no-op', 'a|\nb', up, 'a|\nb', { undoable: false });
cmd('move down at end no-op', 'a\nb|', down, 'a\nb|', { undoable: false });
cmd('move up last line no newline', 'a\nb|', up, 'b|\na');
cmd('move down onto last line no newline', 'a|\nb', down, 'b\na|');
cmd('move down with trailing newline', 'a|\nb\n', down, 'b\na|\n');
cmd('move down into trailing empty line', 'a\nb|\n', down, 'a\n\nb|');
cmd('move keeps column', 'xx\nab|cd', up, 'ab|cd\nxx');
cmd('move block down', '⟨a\nb⟩\nc', down, 'c\n⟨a\nb⟩');
cmd('move block up', 'c\n⟨a\nb⟩', up, '⟨a\nb⟩\nc');
cmd('move block sel ends col 0', '⟨a\n⟩b\nc', down, 'b\n⟨a\n⟩c');
cmd('move block at end no-op', 'c\n⟨a\nb⟩', down, 'c\n⟨a\nb⟩', { undoable: false });
cmd('move emoji', 'x\n😀😀|', up, '😀😀|\nx');
cmd('move emoji mid', '😀a\n😀|b', up, '😀|b\n😀a');
cmd('ctrl-shift-up is not move', 'a\nb|', () => {
    H.assertEq('ctrl-shift-up not handled', bullets.handleKeyPress(UP, CTRL | SHIFT), false);
}, 'a\nb|', { undoable: false });

// ------------------------------------------------------------ Ctrl+X line cut
function readClipboard() {
    let out = null;
    tv.get_clipboard().read_text_async(null, (cb, res) => {
        out = cb.read_text_finish(res);
    });
    for (let i = 0; i < 50 && out === null; i++)
        H.spin(20);
    return out;
}
const ctrlX = () => press(KEY_X, CTRL);
cmd('cut middle line', 'a\nb|b\nc', ctrlX, 'a\n|c');
H.assertEq('cut middle clipboard', readClipboard(), 'bb\n');
cmd('cut last line no newline', 'a\nb|', ctrlX, '|a');
H.assertEq('cut last clipboard', readClipboard(), 'b\n');
cmd('cut only line', 'ab|c', ctrlX, '|');
H.assertEq('cut only clipboard', readClipboard(), 'abc\n');
cmd('cut first line', 'a|\nb', ctrlX, '|b');
cmd('cut emoji line', '😀\n😀😀|\nx', ctrlX, '😀\n|x');
H.assertEq('cut emoji clipboard', readClipboard(), '😀😀\n');
H.load(b, 'a⟨b⟩c');
H.assertEq('cut with selection is default', bullets.handleKeyPress(KEY_X, CTRL), false);

// --------------------------------------------------- performance smoke test
{
    const lines = [];
    for (let i = 0; i < 10000; i++)
        lines.push(`para ${i} some text`);
    H.load(b, lines.join('\n') + '\n- a|');
    const t0 = GLib.get_monotonic_time();
    for (let i = 0; i < 50; i++)
        bullets.handleKeyPress(97, 0); // 'a': not ours, must be cheap
    const dt = (GLib.get_monotonic_time() - t0) / 1000;
    H.assertEq(`plain key on 10k-line doc is cheap (${dt.toFixed(1)} ms / 50)`, dt < 50, true);
}

bullets.destroy();
todos.destroy();
H.finish('edit_handlers');
