// Run from the repository root: gjs tests/search.js
// Search bar: matching (case, emoji offsets), staleness after edits,
// current-match navigation, isOpen(), and that highlighting never touches
// undo/redo history.
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, GLib } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());
Gtk.init();

const H = imports.tests.editHarness;
const { SearchBarComponent } = imports.ui.searchBar;

const { tv, win, b } = H.newView();
const renderer = new H.StubRenderer(b);
const colors = { yellow: '#d29922', blue: '#58a6ff' };
const search = new SearchBarComponent(win, tv, renderer, colors);
search.create();

function selected() {
    const [has, s, e] = b.get_selection_bounds();
    return has ? b.get_text(s, e, true) : null;
}
function selStart() {
    const [has, s] = b.get_selection_bounds();
    return has ? s.get_offset() : -1;
}
function tagged(name) {
    const tag = b.get_tag_table().lookup(name);
    const out = [];
    const it = b.get_start_iter();
    if (!tag)
        return out;
    do {
        if (it.starts_tag(tag)) {
            const e = it.copy();
            e.forward_to_tag_toggle(tag);
            out.push([it.get_offset(), e.get_offset()]);
        }
    } while (it.forward_to_tag_toggle(tag));
    return JSON.stringify(out);
}
// Type a query the way the user does: the entry's delayed 'search-changed'
// runs the search.
function setQuery(q) {
    const cursor = b.get_iter_at_mark(b.get_insert()).get_offset();
    search.searchEntry.set_text(q);
    H.spin(250);
    // ensure it ran from the loaded cursor even if the text was unchanged
    b.place_cursor(b.get_iter_at_offset(cursor));
    search.performSearch();
}
function label() {
    return search.matchCountLabel.get_label();
}

// --- basic, case-insensitive by default
H.load(b, '|Foo foo FOO bar');
H.assertEq('closed initially', search.isOpen(), false);
search.show();
H.assertEq('isOpen after show', search.isOpen(), true);
setQuery('foo');
H.assertEq('case-insensitive count', search.searchMatches.length, 3);
H.assertEq('label', label(), '1 of 3');
H.assertEq('first match selected', selStart(), 0);
search.findNextKeepFocus();
H.assertEq('next', selStart(), 4);
H.assertEq('current tag moves', tagged('jotite-search-current'), '[[4,7]]');
search.findPreviousKeepFocus();
search.findPreviousKeepFocus();
H.assertEq('previous wraps', selStart(), 8);
H.assertEq('label after wrap', label(), '3 of 3');

search.caseSensitiveButton.set_active(true); // triggers performSearch
H.assertEq('case-sensitive count', search.searchMatches.length, 1);
search.caseSensitiveButton.set_active(false);

// --- regex metacharacters are literal
H.load(b, '|a.b axb (x) [y]');
setQuery('a.b');
H.assertEq('literal dot', search.searchMatches.length, 1);
setQuery('[y]');
H.assertEq('literal brackets', JSON.stringify(search.searchMatches), '[{"start":12,"end":15}]');

// --- emoji / astral offsets
H.load(b, '|😀 cat 😀😀 cat\n🐱cat');
setQuery('cat');
H.assertEq('emoji offsets', JSON.stringify(search.searchMatches.map(m => m.start)), '[2,9,14]');
search.findNextKeepFocus();
H.assertEq('emoji select text', selected(), 'cat');
H.assertEq('emoji select offset', selStart(), 9);
setQuery('😀');
H.assertEq('search emoji itself', JSON.stringify(search.searchMatches), '[{"start":0,"end":1},{"start":6,"end":7},{"start":7,"end":8}]');

// --- starts at the cursor
H.load(b, 'x x x| x');
setQuery('x');
H.assertEq('first match at/after cursor', selStart(), 6);

// --- matches follow buffer edits (M4)
H.load(b, '|one two one two');
setQuery('two');
search.findNextKeepFocus(); // current = second "two" @12
H.assertEq('before edit', selStart(), 12);
b.place_cursor(b.get_start_iter());
H.type(b, '😀😀 ');
H.spin(300); // debounce
H.assertEq('matches shifted after edit', JSON.stringify(search.searchMatches.map(m => m.start)), '[7,15]');
H.assertEq('current kept after edit', search.currentMatchIndex, 1);
H.assertEq('highlights follow edit', tagged('jotite-search-match'), '[[7,10],[15,18]]');
H.assertEq('cursor not moved by refresh', b.get_iter_at_mark(b.get_insert()).get_offset(), 3);
// navigation right after an edit (before the debounce) is still correct
b.place_cursor(b.get_start_iter());
H.type(b, 'two ');
search.findNextKeepFocus();
H.assertEq('next right after edit', selected(), 'two');
H.assertEq('count right after edit', search.searchMatches.length, 3);
// deleting a match
b.begin_user_action();
b.delete(b.get_start_iter(), b.get_iter_at_offset(4));
b.end_user_action();
H.spin(300);
H.assertEq('count after delete', search.searchMatches.length, 2);

// --- highlighting does not touch undo/redo history
H.load(b, '|abc abc');
H.type(b, 'z');
b.undo();
H.assertEq('redo available', b.get_can_redo(), true);
setQuery('abc');
search.findNextKeepFocus();
H.assertEq('redo survives search highlighting', b.get_can_redo(), true);
b.redo();
H.assertEq('redo after search', H.text(b), 'zabc abc');

// --- hide clears, refresh stops
search.hide();
H.assertEq('isOpen after hide', search.isOpen(), false);
H.assertEq('highlights cleared', tagged('jotite-search-match'), '[]');
H.type(b, 'abc');
H.spin(300);
H.assertEq('no refresh while closed', tagged('jotite-search-match'), '[]');

// --- big document: search + edits stay fast
{
    const lines = [];
    for (let i = 0; i < 10000; i++)
        lines.push(`line ${i} with some words and the letter e`);
    H.load(b, '|' + lines.join('\n'));
    search.show();
    setQuery('e');
    let t0 = GLib.get_monotonic_time();
    search.performSearch();
    let dt = (GLib.get_monotonic_time() - t0) / 1000;
    H.assertEq(`10k-line search count`, search.searchMatches.length > 50000, true);
    H.assertEq(`10k-line search < 1500 ms (${dt.toFixed(0)} ms)`, dt < 1500, true);
    t0 = GLib.get_monotonic_time();
    for (let i = 0; i < 20; i++)
        H.type(b, 'q');
    dt = (GLib.get_monotonic_time() - t0) / 1000;
    H.assertEq(`typing while search open is not blocked (${dt.toFixed(1)} ms / 20 keys)`, dt < 200, true);
    t0 = GLib.get_monotonic_time();
    for (let i = 0; i < 20; i++)
        search.findNextKeepFocus();
    dt = (GLib.get_monotonic_time() - t0) / 1000;
    H.assertEq(`find-next is O(1)-ish (${dt.toFixed(1)} ms / 20)`, dt < 2000, true);
    search.hide();
}

search.destroy();
H.finish('search');
