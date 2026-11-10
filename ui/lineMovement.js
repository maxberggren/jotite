const { TextUtils } = imports.util.text;

// ============================================================================
// Line Movement Component (Ctrl+Up / Ctrl+Down)
// ============================================================================
//
// Moves the cursor line, or every line touched by the selection, one line up
// or down. Only the lines involved are read and rewritten, the cursor and
// selection follow the moved text, and each move is a single undo step.

var LineMovement = class LineMovement {
    constructor(textView, markdownRenderer) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
    }

    moveLineUp() {
        return this._move(-1);
    }

    moveLineDown() {
        return this._move(+1);
    }

    // Lines [first, last] to move. A selection ending at column 0 of a line
    // does not include that line.
    _blockLines() {
        const [hasSel, s, e] = this.buffer.get_selection_bounds();
        if (!hasSel) {
            const l = this.buffer.get_iter_at_mark(this.buffer.get_insert()).get_line();
            return [l, l];
        }
        let last = e.get_line();
        if (e.get_line_offset() === 0 && last > s.get_line())
            last--;
        return [s.get_line(), last];
    }

    _move(direction) {
        const [first, last] = this._blockLines();
        const lastLine = this.buffer.get_line_count() - 1;
        if (direction < 0 && first === 0)
            return false;
        if (direction > 0 && last >= lastLine)
            return false;

        // Region = the block plus the neighbour line it swaps with; the final
        // line terminator of the region is left untouched, so a last line
        // without a trailing newline is handled naturally.
        const regionFirst = direction < 0 ? first - 1 : first;
        const regionLast = direction < 0 ? last : last + 1;
        const start = TextUtils.lineBounds(this.buffer, regionFirst)[0];
        const end = TextUtils.lineBounds(this.buffer, regionLast)[1];
        // Split with GtkTextIter line boundaries (they understand \n, \r\n,
        // \r and U+2029). Line contents move; each line terminator stays in
        // its position, so line endings are preserved.
        const lines = [];
        const terminators = [];
        for (let l = regionFirst; l <= regionLast; l++) {
            const [ls, le] = TextUtils.lineBounds(this.buffer, l);
            lines.push(this.buffer.get_text(ls, le, true));
            if (l < regionLast)
                terminators.push(this.buffer.get_text(le, TextUtils.lineBounds(this.buffer, l + 1)[0], true));
        }

        let reordered;
        if (direction < 0)
            reordered = [...lines.slice(1), lines[0]];
        else
            reordered = [lines[lines.length - 1], ...lines.slice(0, -1)];

        // Remember the cursor and selection bound as (line, column).
        const ins = this.buffer.get_iter_at_mark(this.buffer.get_insert());
        const bound = this.buffer.get_iter_at_mark(this.buffer.get_selection_bound());
        const saved = [ins, bound].map(it => ({ line: it.get_line(), col: it.get_line_offset() }));

        this.buffer.begin_user_action();
        try {
            this.buffer.delete(start, end);
            const at = TextUtils.lineBounds(this.buffer, regionFirst)[0];
            this.buffer.insert(at, reordered.map((t, k) => t + (terminators[k] || '')).join(''), -1);

            // Every remembered position is inside the block, or is the selection
            // end at column 0 just past it; either way it moves with the block.
            const iters = saved.map(({ line, col }) =>
                TextUtils.iterAtLineOffset(this.buffer, line + direction, col));
            this.buffer.select_range(iters[0], iters[1]);
        } finally {
            this.buffer.end_user_action();
        }

        const r = this.markdownRenderer;
        if (r && typeof r.renderNow === 'function')
            r.renderNow();
        this.textView.scroll_mark_onscreen(this.buffer.get_insert());
        return true;
    }
};
