const { Gtk } = imports.gi;
const { TextUtils } = imports.util.text;
const { MarkdownList } = imports.util.markdownList;

// ============================================================================
// TODO Handlers Component
// ============================================================================
//
// Double-clicking the checkbox ("[ ]" / "[x]") of a task list item toggles it.
// Only a double-click that lands on the three checkbox characters of a real
// task (list item or bare "[ ]" box, also inside block quotes; never in code
// or HTML comments) is claimed; every other
// click — single clicks, drags, shift-clicks, double-clicks on words — is left
// entirely to GtkTextView.

var TodoHandlers = class TodoHandlers {
    constructor(textView, markdownRenderer) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        this._gesture = null;
    }

    setup() {
        this._gesture = new Gtk.GestureClick({ button: 1 });
        // Capture phase: decide before GtkTextView's own gesture selects a word.
        this._gesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        this._gesture.connect('pressed', (gesture, nPress, x, y) => {
            if (nPress !== 2)
                return;
            const iter = this._iterAtPoint(x, y);
            if (iter && this.toggleAtIter(iter))
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        });
        this.textView.add_controller(this._gesture);
    }

    destroy() {
        if (this._gesture) {
            this.textView.remove_controller(this._gesture);
            this._gesture = null;
        }
    }

    _iterAtPoint(x, y) {
        const [bx, by] = this.textView.window_to_buffer_coords(Gtk.TextWindowType.WIDGET, x, y);
        const [inside, iter] = this.textView.get_iter_at_location(bx, by);
        return inside ? iter : null;
    }

    // Returns the checkbox position of the task item at `iter` when iter is on
    // one of its three checkbox characters, otherwise null.
    checkboxAtIter(iter) {
        const line = iter.get_line();
        const r = this.markdownRenderer;
        if (r && typeof r.isLiteralLine === 'function' ? r.isLiteralLine(line)
            : (r && typeof r.isInCodeBlock === 'function' && r.isInCodeBlock(line)))
            return null;
        const text = TextUtils.lineText(this.buffer, line);
        // Same detector as the renderer and Ctrl+T
        const pre = MarkdownList.parseLinePrefix(text);
        if (!pre || !pre.checkbox)
            return null;
        const checkbox = pre.checkbox;
        const start = TextUtils.offsetAt(text, checkbox.index);
        const col = iter.get_line_offset();
        if (col < start || col > start + 2)
            return null;
        const boxIter = TextUtils.iterAtLineOffset(this.buffer, line, start);
        if (r && typeof r.isInCodeSpan === 'function' && r.isInCodeSpan(boxIter))
            return null;
        return { line, start, checked: checkbox.checked };
    }

    // Toggle the checkbox under `iter`. One undo step. Returns true if toggled.
    toggleAtIter(iter) {
        if (!this.textView.get_editable())
            return false;
        const box = this.checkboxAtIter(iter);
        if (!box)
            return false;

        this.buffer.begin_user_action();
        try {
            const s = TextUtils.iterAtLineOffset(this.buffer, box.line, box.start + 1);
            const e = TextUtils.iterAtLineOffset(this.buffer, box.line, box.start + 2);
            this.buffer.delete(s, e);
            const at = TextUtils.iterAtLineOffset(this.buffer, box.line, box.start + 1);
            this.buffer.insert(at, box.checked ? ' ' : 'X', -1);
            // Park the cursor at the end of the line so the rendered checkbox
            // stays rendered instead of revealing its raw markdown.
            this.buffer.place_cursor(TextUtils.lineBounds(this.buffer, box.line)[1]);
        } finally {
            this.buffer.end_user_action();
        }
        const r = this.markdownRenderer;
        if (r && typeof r.renderNow === 'function')
            r.renderNow();
        return true;
    }
};
