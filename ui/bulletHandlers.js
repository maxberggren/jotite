const { Gtk } = imports.gi;
const { Constants } = imports.constants;
const { TextUtils } = imports.util.text;
const { MarkdownList } = imports.util.markdownList;

// ============================================================================
// List / editing key handlers
// ============================================================================
//
// Enter continues lists, Tab/Shift+Tab nest and un-nest list items (or change
// header level), Ctrl+T toggles a task checkbox, Ctrl+X without a selection
// cuts the whole line, Ctrl+Up/Down move lines.
//
// Rules:
//  - every command is exactly one undo step (begin/end_user_action around all
//    of its edits, including renumbering);
//  - only the affected lines are read/edited (no full-buffer get_text);
//  - nothing happens inside fenced code blocks.

const KEY_TAB = 65289;
const KEY_ISO_LEFT_TAB = 65056;
const KEY_KP_TAB = 65417;
const MOD_MASK = Constants.CTRL_MASK | Constants.SHIFT_MASK | Constants.ALT_MASK;

const { parseListItem, sameListType, indentWidth, leadingWhitespace, parseHeader } = MarkdownList;

var BulletHandlers = class BulletHandlers {
    constructor(textView, markdownRenderer, lineMovement) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        this.lineMovement = lineMovement;
        this._keyController = null;
    }

    setup() {
        this._keyController = new Gtk.EventControllerKey();
        this._keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            return this.handleKeyPress(keyval, state);
        });
        this.textView.add_controller(this._keyController);
    }

    destroy() {
        if (this._keyController) {
            this.textView.remove_controller(this._keyController);
            this._keyController = null;
        }
    }

    // Returns true when the key was handled (the default action is suppressed).
    handleKeyPress(keyval, state) {
        const mods = state & MOD_MASK;
        const ctrl = mods === Constants.CTRL_MASK;

        if (ctrl && keyval === Constants.KEY_T)
            return this.toggleTodo();

        if ((keyval === Constants.KEY_ENTER || keyval === Constants.KEY_KP_ENTER) && mods === 0)
            return this.handleEnter();

        if ((keyval === KEY_TAB || keyval === KEY_KP_TAB) && mods === 0)
            return this.indent();

        if (keyval === KEY_ISO_LEFT_TAB ||
            ((keyval === KEY_TAB || keyval === KEY_KP_TAB) && mods === Constants.SHIFT_MASK))
            return (mods & ~Constants.SHIFT_MASK) === 0 ? this.outdent() : false;

        if (ctrl && keyval === Constants.KEY_X)
            return this.cutLine();

        if (ctrl && keyval === Constants.KEY_UP && this.lineMovement) {
            this.lineMovement.moveLineUp();
            return true;
        }
        if (ctrl && keyval === Constants.KEY_DOWN && this.lineMovement) {
            this.lineMovement.moveLineDown();
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    _isCodeLine(line) {
        const r = this.markdownRenderer;
        return !!(r && typeof r.isInCodeBlock === 'function' && r.isInCodeBlock(line));
    }

    _isCodeSpan(iter) {
        const r = this.markdownRenderer;
        return !!(r && typeof r.isInCodeSpan === 'function' && r.isInCodeSpan(iter));
    }

    _render() {
        const r = this.markdownRenderer;
        if (r && typeof r.renderNow === 'function')
            r.renderNow();
    }

    _cursorIter() {
        return this.buffer.get_iter_at_mark(this.buffer.get_insert());
    }

    _lineCount() {
        return this.buffer.get_line_count();
    }

    _lineText(line) {
        return TextUtils.lineText(this.buffer, line);
    }

    // Iterator at UTF-16 index `index` of line `line` whose text is `text`.
    _iterAt(line, text, index) {
        return TextUtils.iterAtLineOffset(this.buffer, line, TextUtils.offsetAt(text, index));
    }

    // Replace [startIdx, endIdx) (UTF-16 indices into `text`, the current text
    // of `line`) with `replacement`. Must be called inside a user action.
    _replaceInLine(line, text, startIdx, endIdx, replacement) {
        if (endIdx > startIdx) {
            const s = this._iterAt(line, text, startIdx);
            const e = this._iterAt(line, text, endIdx);
            this.buffer.delete(s, e);
        }
        if (replacement.length > 0) {
            const at = this._iterAt(line, text, startIdx);
            this.buffer.insert(at, replacement, -1);
        }
    }

    // ------------------------------------------------------------------
    // List structure
    // ------------------------------------------------------------------

    // Contiguous region of lines that can belong to the list block around
    // [fromLine, toLine]: list items, blank lines and indented lines.
    _listBlockRange(fromLine, toLine) {
        const isPart = (l) => {
            const t = this._lineText(l);
            if (t.trim() === '')
                return true;
            if (this._isCodeLine(l))
                return /^[ \t]/.test(t);
            return /^[ \t]/.test(t) || parseListItem(t) !== null;
        };
        let a = fromLine;
        while (a > 0 && isPart(a - 1))
            a--;
        let b = toLine;
        const last = this._lineCount() - 1;
        while (b < last && isPart(b + 1))
            b++;
        return [a, b];
    }

    // Build the lists in [a, b]. Each list: { items: [{line, item}], parent }.
    _scanLists(a, b) {
        const lists = [];
        const stack = [];
        for (let l = a; l <= b; l++) {
            const text = this._lineText(l);
            if (text.trim() === '')
                continue;
            const item = this._isCodeLine(l) ? null : parseListItem(text);
            if (item) {
                const w = item.indentWidth;
                while (stack.length && w < stack[stack.length - 1].indentWidth)
                    stack.pop();
                let top = stack[stack.length - 1];
                if (top && w < top.contentColumn) {
                    if (sameListType(top.items[0].item, item)) {
                        top.items.push({ line: l, item });
                        top.contentColumn = item.contentColumn;
                        continue;
                    }
                    stack.pop();
                    top = stack[stack.length - 1];
                }
                const parent = top ? top.items[top.items.length - 1] : null;
                const list = {
                    indentWidth: w,
                    contentColumn: item.contentColumn,
                    items: [{ line: l, item }],
                    parent,
                };
                lists.push(list);
                stack.push(list);
            } else {
                const iw = indentWidth(leadingWhitespace(text));
                while (stack.length && iw < stack[stack.length - 1].contentColumn)
                    stack.pop();
            }
        }
        return lists;
    }

    _listOfLine(lists, line) {
        for (const list of lists) {
            const idx = list.items.findIndex(it => it.line === line);
            if (idx >= 0)
                return [list, idx];
        }
        return [null, -1];
    }

    // Renumber the ordered lists (in the block around [from, to]) that contain
    // any line of `lines`. `moved` lines starting a list restart it at 1;
    // `fresh` lines are ignored when detecting lazy "1. 1. 1." numbering.
    _renumber(from, to, lines, moved = new Set(), fresh = new Set()) {
        const [a, b] = this._listBlockRange(from, to);
        const lists = this._scanLists(a, b);
        for (const list of lists) {
            if (!list.items[0].item.ordered)
                continue;
            if (!list.items.some(it => lines.has(it.line)))
                continue;

            const first = list.items[0];
            const start = moved.has(first.line) ? 1 : first.item.number;
            const others = list.items.filter(it => !fresh.has(it.line) && !moved.has(it.line));
            const lazy = others.length >= 2 &&
                others.every(it => it.item.number === others[0].item.number);

            list.items.forEach((it, idx) => {
                const expected = lazy ? others[0].item.number : start + idx;
                if (it.item.number === expected)
                    return;
                const text = this._lineText(it.line);
                const item = parseListItem(text);
                if (!item || !item.ordered)
                    return;
                this._replaceInLine(it.line, text, item.markerStart,
                    item.markerStart + item.digits.length, String(expected));
            });
        }
    }

    // ------------------------------------------------------------------
    // Enter
    // ------------------------------------------------------------------

    handleEnter() {
        if (this.buffer.get_has_selection())
            return false;
        const iter = this._cursorIter();
        const line = iter.get_line();
        if (this._isCodeLine(line))
            return false;
        const text = this._lineText(line);
        const item = parseListItem(text);
        if (!item || item.spacing.length === 0)
            return false;

        const cursorIdx = TextUtils.indexAt(text, iter.get_line_offset());
        if (cursorIdx < item.contentStart)
            return false;

        this.buffer.begin_user_action();
        try {
            if (item.content.trim() === '') {
                // Empty item: leave the list (clear the marker).
                this._replaceInLine(line, text, 0, text.length, '');
            } else {
                const after = text.slice(cursorIdx);
                const leadingAfter = after.length - after.replace(/^[ \t]+/, '').length;
                const before = text.slice(item.contentStart, cursorIdx);
                const trailingBefore = before.length - before.replace(/[ \t]+$/, '').length;

                const marker = item.ordered ? `${item.number + 1}${item.delimiter}` : item.bullet;
                const spacing = item.spacing.includes('\t') ? item.spacing : ' ';
                const prefix = item.indent + marker + spacing + (item.checkbox ? '[ ] ' : '');

                const delStart = cursorIdx - trailingBefore;
                const delEnd = cursorIdx + leadingAfter;
                this._replaceInLine(line, text, delStart, delEnd, '\n' + prefix);

                const newCursor = TextUtils.iterAtLineOffset(this.buffer, line + 1,
                    TextUtils.charLength(prefix));
                this.buffer.place_cursor(newCursor);

                if (item.ordered) {
                    const fresh = new Set([line + 1]);
                    this._renumber(line, line + 1, fresh, new Set(), fresh);
                }
            }
        } finally {
            this.buffer.end_user_action();
        }
        this._render();
        this.textView.scroll_mark_onscreen(this.buffer.get_insert());
        return true;
    }

    // ------------------------------------------------------------------
    // Tab / Shift+Tab
    // ------------------------------------------------------------------

    // Lines [first, last] touched by the selection (or the cursor line).
    _targetLines() {
        const [hasSel, s, e] = this.buffer.get_selection_bounds();
        if (!hasSel) {
            const l = this._cursorIter().get_line();
            return [l, l, false];
        }
        let last = e.get_line();
        if (e.get_line_offset() === 0 && last > s.get_line())
            last--;
        return [s.get_line(), last, true];
    }

    indent() {
        return this._shiftLines(+1);
    }

    outdent() {
        return this._shiftLines(-1);
    }

    _shiftLines(direction) {
        const [first, last, hasSel] = this._targetLines();

        // Single line header: Tab adds a '#', Shift+Tab removes one.
        if (!hasSel && !this._isCodeLine(first)) {
            const text = this._lineText(first);
            const header = parseHeader(text);
            if (header && parseListItem(text) === null)
                return this._shiftHeader(first, text, header, direction);
        }

        // Collect list items in the range (outside code blocks).
        const targets = [];
        for (let l = first; l <= last; l++) {
            if (this._isCodeLine(l))
                continue;
            const item = parseListItem(this._lineText(l));
            if (item)
                targets.push({ line: l, item });
        }
        if (targets.length === 0)
            return false; // default Tab behaviour on non-list lines

        // Compute the new indentation of every item from the structure before
        // the edit, so a block moves consistently.
        const [a, b] = this._listBlockRange(first, last);
        const before = this._scanLists(a, b);
        const sourceLines = new Set();
        for (const t of targets) {
            const [list, idx] = this._listOfLine(before, t.line);
            const w = t.item.indentWidth;
            if (direction > 0) {
                t.target = list && idx > 0
                    ? list.items[idx - 1].item.contentColumn
                    : t.item.contentColumn;
            } else {
                t.target = list && list.parent ? list.parent.item.indentWidth : 0;
                if (t.target > w)
                    t.target = 0;
            }
            if (list)
                list.items.forEach(it => sourceLines.add(it.line));
        }
        if (direction < 0 && targets.every(t => t.item.indentWidth === 0))
            return true; // nothing to outdent; swallow so focus doesn't move

        const marks = this._saveSelection();
        const deltas = new Map();

        this.buffer.begin_user_action();
        try {
            for (const t of targets) {
                const text = this._lineText(t.line);
                const oldLen = t.item.indent.length;
                const newIndent = ' '.repeat(t.target);
                if (newIndent === t.item.indent)
                    continue;
                if (/^ *$/.test(t.item.indent) && t.target > oldLen)
                    this._replaceInLine(t.line, text, 0, 0, ' '.repeat(t.target - oldLen));
                else if (/^ *$/.test(t.item.indent))
                    this._replaceInLine(t.line, text, t.target, oldLen, '');
                else
                    this._replaceInLine(t.line, text, 0, oldLen, newIndent);
                deltas.set(t.line, { oldLen, newLen: t.target });
            }

            const moved = new Set(targets.map(t => t.line));
            const all = new Set([...moved, ...sourceLines]);
            this._renumber(first, last, all, moved);
            this._restoreSelection(marks, deltas);
        } finally {
            this.buffer.end_user_action();
        }
        this._render();
        this.textView.scroll_mark_onscreen(this.buffer.get_insert());
        return true;
    }

    _shiftHeader(line, text, header, direction) {
        if (direction > 0 && header.hashes.length >= 6)
            return true;
        if (direction < 0 && header.hashes.length <= 1)
            return true;
        const cursor = this._cursorIter().get_line_offset();
        this.buffer.begin_user_action();
        try {
            if (direction > 0)
                this._replaceInLine(line, text, 0, 0, '#');
            else
                this._replaceInLine(line, text, 0, 1, '');
            const col = Math.max(0, cursor + direction);
            this.buffer.place_cursor(TextUtils.iterAtLineOffset(this.buffer, line, col));
        } finally {
            this.buffer.end_user_action();
        }
        this._render();
        return true;
    }

    _saveSelection() {
        const ins = this.buffer.get_iter_at_mark(this.buffer.get_insert());
        const bound = this.buffer.get_iter_at_mark(this.buffer.get_selection_bound());
        return [
            { line: ins.get_line(), col: ins.get_line_offset() },
            { line: bound.get_line(), col: bound.get_line_offset() },
        ];
    }

    _restoreSelection(marks, deltas) {
        const iters = marks.map(({ line, col }) => {
            const d = deltas.get(line);
            let newCol = col;
            if (d && col > 0) {
                if (col >= d.oldLen)
                    newCol = col + d.newLen - d.oldLen;
                else
                    newCol = Math.min(col, d.newLen);
            }
            return TextUtils.iterAtLineOffset(this.buffer, line, newCol);
        });
        this.buffer.select_range(iters[0], iters[1]);
    }

    // ------------------------------------------------------------------
    // Ctrl+T: toggle the task checkbox of the cursor line
    // ------------------------------------------------------------------

    toggleTodo() {
        const line = this._cursorIter().get_line();
        return this.toggleTodoOnLine(line);
    }

    // Toggle the checkbox of the task item on `line`. Returns false when the
    // line is not a task list item (or is inside code).
    toggleTodoOnLine(line) {
        if (this._isCodeLine(line))
            return false;
        const text = this._lineText(line);
        const item = parseListItem(text);
        if (!item || !item.checkbox)
            return false;
        const charIdx = item.checkbox.index + 1;
        if (this._isCodeSpan(this._iterAt(line, text, item.checkbox.index)))
            return false;

        const marks = this._saveSelection();
        this.buffer.begin_user_action();
        try {
            this._replaceInLine(line, text, charIdx, charIdx + 1, item.checkbox.checked ? ' ' : 'X');
            this._restoreSelection(marks, new Map());
        } finally {
            this.buffer.end_user_action();
        }
        this._render();
        return true;
    }

    // ------------------------------------------------------------------
    // Ctrl+X without selection: cut the whole line
    // ------------------------------------------------------------------

    cutLine() {
        if (this.buffer.get_has_selection())
            return false; // default cut of the selection

        const line = this._cursorIter().get_line();
        const [lineStart, lineEnd] = TextUtils.lineBounds(this.buffer, line);
        const text = this.buffer.get_text(lineStart, lineEnd, true);
        const isLast = line === this._lineCount() - 1;
        if (isLast && line === 0 && text.length === 0)
            return true; // empty buffer: nothing to cut

        let delStart = lineStart;
        let delEnd = lineEnd.copy();
        if (!isLast) {
            delEnd.forward_line(); // include the line terminator
        } else if (line > 0) {
            // Last line without trailing newline: remove the preceding newline
            // so no empty line is left behind.
            delStart = lineStart.copy();
            delStart.backward_char();
        }

        this.textView.get_clipboard().set(text + '\n');

        this.buffer.begin_user_action();
        try {
            this.buffer.delete(delStart, delEnd);
            if (isLast && line > 0) {
                const it = TextUtils.iterAtLineOffset(this.buffer, line - 1, 0);
                this.buffer.place_cursor(it);
            }
        } finally {
            this.buffer.end_user_action();
        }
        this._render();
        return true;
    }
};
