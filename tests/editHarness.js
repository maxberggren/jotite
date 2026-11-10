// Shared helpers for tests/edit_handlers.js and tests/search.js.
// Not a test itself. Imported as imports.tests.editHarness.
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
const { Gtk, GLib } = imports.gi;

// Minimal renderer implementing the public contract used by the handlers.
var StubRenderer = class StubRenderer {
    constructor(buffer) {
        this.buffer = buffer;
        this.renders = 0;
    }

    renderNow() {
        this.renders++;
    }

    _line(l) {
        const [, s] = this.buffer.get_iter_at_line(l);
        const e = s.copy();
        if (!e.ends_line())
            e.forward_to_line_end();
        return this.buffer.get_text(s, e, true);
    }

    isInCodeBlock(lineNumber) {
        let fence = null;
        for (let l = 0; l <= lineNumber; l++) {
            const m = /^ {0,3}(`{3,}|~{3,})/.exec(this._line(l));
            if (fence === null) {
                if (m) {
                    fence = m[1];
                    if (l === lineNumber)
                        return true;
                }
            } else {
                if (l === lineNumber)
                    return true;
                if (m && m[1][0] === fence[0] && m[1].length >= fence.length)
                    fence = null;
            }
        }
        return false;
    }

    isInCodeSpan(iter) {
        const s = iter.copy();
        s.set_line_offset(0);
        const before = this.buffer.get_text(s, iter, true);
        return ((before.match(/`/g) || []).length % 2) === 1;
    }

    destroy() {}
};

var results = { pass: 0, fail: 0 };

var assertEq = function (name, actual, expected) {
    if (actual === expected) {
        results.pass++;
    } else {
        results.fail++;
        print(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    }
};

var text = function (b) {
    const [s, e] = b.get_bounds();
    return b.get_text(s, e, true);
};

// Text with '|' at the cursor; a selection is shown as ⟨…⟩ (bound, insert
// order normalised: ⟨ = start, ⟩ = end).
var state = function (b) {
    const chars = Array.from(text(b));
    const [hasSel, s, e] = b.get_selection_bounds();
    if (hasSel) {
        chars.splice(e.get_offset(), 0, '⟩');
        chars.splice(s.get_offset(), 0, '⟨');
    } else {
        chars.splice(b.get_iter_at_mark(b.get_insert()).get_offset(), 0, '|');
    }
    return chars.join('');
};

// Load `spec` (text with '|' cursor or ⟨…⟩ selection) as a non-undoable
// baseline, like opening a file.
var load = function (b, spec) {
    const chars = Array.from(spec);
    let cursor = -1, selStart = -1, selEnd = -1;
    const out = [];
    for (const ch of chars) {
        if (ch === '|') cursor = out.length;
        else if (ch === '⟨') selStart = out.length;
        else if (ch === '⟩') selEnd = out.length;
        else out.push(ch);
    }
    b.begin_irreversible_action();
    b.set_text(out.join(''), -1);
    b.end_irreversible_action();
    if (selStart >= 0)
        b.select_range(b.get_iter_at_offset(selEnd), b.get_iter_at_offset(selStart));
    else
        b.place_cursor(b.get_iter_at_offset(cursor >= 0 ? cursor : out.length));
};

// Type like GtkTextView does: each character is its own user action.
var type = function (b, str) {
    for (const ch of Array.from(str)) {
        b.begin_user_action();
        b.delete_selection(true, true);
        b.insert_interactive_at_cursor(ch, -1, true);
        b.end_user_action();
    }
};

var spin = function (ms) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_LOW, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
};

var newView = function () {
    const tv = new Gtk.TextView();
    const win = new Gtk.Window({ default_width: 600, default_height: 400 });
    win.set_child(new Gtk.ScrolledWindow({ child: tv }));
    return { tv, win, b: tv.get_buffer() };
};

var finish = function (label) {
    print(`${label}: ${results.pass} passed, ${results.fail} failed`);
    if (results.fail > 0)
        imports.system.exit(1);
};
