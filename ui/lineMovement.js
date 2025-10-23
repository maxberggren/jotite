const { GLib } = imports.gi;

// ============================================================================
// Line Movement Component
// ============================================================================

var LineMovement = class LineMovement {
    constructor(textView, markdownRenderer) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        this.lineMovePending = false;
    }

    moveLineUp() {
        // Throttle to prevent overwhelming the UI when holding down the key
        if (this.lineMovePending) {
            return;
        }
        this.lineMovePending = true;
        
        // Get all text and split into lines
        const [bufStart, bufEnd] = this.buffer.get_bounds();
        const allText = this.buffer.get_text(bufStart, bufEnd, false);
        const lines = allText.split('\n');
        
        // Check if there's a selection
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        
        let firstLineNum, lastLineNum, cursorOffset, wasSelection;
        
        if (hasSelection) {
            // Get the line numbers of the selection bounds
            firstLineNum = selStart.get_line();
            lastLineNum = selEnd.get_line();
            
            // If selection end is at the start of a line (offset 0), don't include that line
            if (selEnd.get_line_offset() === 0 && lastLineNum > firstLineNum) {
                lastLineNum--;
            }
            
            wasSelection = true;
        } else {
            // No selection, just move current line
            const cursor = this.buffer.get_insert();
            const iter = this.buffer.get_iter_at_mark(cursor);
            firstLineNum = iter.get_line();
            lastLineNum = firstLineNum;
            cursorOffset = iter.get_line_offset();
            wasSelection = false;
        }
        
        // Can't move if first line is already at the top
        if (firstLineNum === 0) {
            this.lineMovePending = false;
            return;
        }
        
        // Build new lines for the affected region only
        const targetLineNum = firstLineNum - 1;
        const targetLine = lines[targetLineNum];
        const selectedLines = lines.slice(firstLineNum, lastLineNum + 1);
        
        // Create the reordered text for this region
        const reorderedLines = [...selectedLines, targetLine];
        const reorderedText = reorderedLines.join('\n');
        
        // Use GTK's line-based API to avoid UTF-8 byte offset issues
        const deleteStart = this.buffer.get_start_iter();
        for (let i = 0; i < targetLineNum; i++) {
            deleteStart.forward_line();
        }
        
        const deleteEnd = this.buffer.get_start_iter();
        for (let i = 0; i < lastLineNum; i++) {
            deleteEnd.forward_line();
        }
        if (!deleteEnd.ends_line()) {
            deleteEnd.forward_to_line_end();
        }
        if (lastLineNum < lines.length - 1) {
            deleteEnd.forward_char();
        }
        
        const deleteStartOffset = deleteStart.get_offset();
        
        // Replace with reordered lines
        const needsTrailingNewline = lastLineNum < lines.length - 1;
        const textToInsert = needsTrailingNewline ? reorderedText + '\n' : reorderedText;
        
        this.buffer.begin_user_action();
        
        const insertMark = this.buffer.create_mark(null, deleteStart, false);
        
        this.buffer.delete(deleteStart, deleteEnd);
        
        const insertIter = this.buffer.get_iter_at_mark(insertMark);
        this.buffer.insert(insertIter, textToInsert, -1);
        
        this.buffer.delete_mark(insertMark);
        
        // Calculate new cursor position
        if (wasSelection) {
            const newSelStartOffset = deleteStartOffset;
            
            let selectionLength = 0;
            for (let i = 0; i < selectedLines.length; i++) {
                selectionLength += selectedLines[i].length;
                if (i < selectedLines.length - 1) {
                    selectionLength += 1; // newline
                }
            }
            
            const newSelStart = this.buffer.get_iter_at_offset(newSelStartOffset);
            const newSelEndIter = this.buffer.get_iter_at_offset(newSelStartOffset + selectionLength);
            this.buffer.select_range(newSelStart, newSelEndIter);
        } else {
            const newCursorOffset = deleteStartOffset + Math.min(cursorOffset, selectedLines[0].length);
            const newCursorIter = this.buffer.get_iter_at_offset(newCursorOffset);
            this.buffer.place_cursor(newCursorIter);
        }
        
        this.buffer.end_user_action();
        
        // Cancel any pending debounced renders and trigger immediate re-render
        if (this.markdownRenderer) {
            if (this.markdownRenderer._renderTimeoutId) {
                GLib.source_remove(this.markdownRenderer._renderTimeoutId);
                this.markdownRenderer._renderTimeoutId = null;
            }
            if (this.markdownRenderer._cursorTimeoutId) {
                GLib.source_remove(this.markdownRenderer._cursorTimeoutId);
                this.markdownRenderer._cursorTimeoutId = null;
            }
            this.markdownRenderer._textJustChanged = false;
            this.markdownRenderer._updateSyntaxVisibility();
        }
        
        // Reset throttle flag after a short delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            this.lineMovePending = false;
            return false;
        });
    }

    moveLineDown() {
        // Throttle to prevent overwhelming the UI when holding down the key
        if (this.lineMovePending) {
            return;
        }
        this.lineMovePending = true;
        
        // Get all text and split into lines
        const [bufStart, bufEnd] = this.buffer.get_bounds();
        const allText = this.buffer.get_text(bufStart, bufEnd, false);
        const lines = allText.split('\n');
        
        // Check if there's a selection
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        
        let firstLineNum, lastLineNum, cursorOffset, wasSelection;
        
        if (hasSelection) {
            firstLineNum = selStart.get_line();
            lastLineNum = selEnd.get_line();
            
            if (selEnd.get_line_offset() === 0 && lastLineNum > firstLineNum) {
                lastLineNum--;
            }
            
            wasSelection = true;
        } else {
            const cursor = this.buffer.get_insert();
            const iter = this.buffer.get_iter_at_mark(cursor);
            firstLineNum = iter.get_line();
            lastLineNum = firstLineNum;
            cursorOffset = iter.get_line_offset();
            wasSelection = false;
        }
        
        // Can't move if last line is already at the bottom
        if (lastLineNum >= lines.length - 1) {
            this.lineMovePending = false;
            return;
        }
        
        // Build new lines for the affected region only
        const targetLineNum = lastLineNum + 1;
        const targetLine = lines[targetLineNum];
        const selectedLines = lines.slice(firstLineNum, lastLineNum + 1);
        
        // Create the reordered text for this region
        const reorderedLines = [targetLine, ...selectedLines];
        const reorderedText = reorderedLines.join('\n');
        
        // Use GTK's line-based API
        const deleteStart = this.buffer.get_start_iter();
        for (let i = 0; i < firstLineNum; i++) {
            deleteStart.forward_line();
        }
        
        const deleteEnd = this.buffer.get_start_iter();
        for (let i = 0; i < targetLineNum; i++) {
            deleteEnd.forward_line();
        }
        if (!deleteEnd.ends_line()) {
            deleteEnd.forward_to_line_end();
        }
        if (targetLineNum < lines.length - 1) {
            deleteEnd.forward_char();
        }
        
        const deleteStartOffset = deleteStart.get_offset();
        
        // Replace with reordered lines
        const needsTrailingNewline = targetLineNum < lines.length - 1;
        const textToInsert = needsTrailingNewline ? reorderedText + '\n' : reorderedText;
        
        this.buffer.begin_user_action();
        
        const insertMark = this.buffer.create_mark(null, deleteStart, false);
        
        this.buffer.delete(deleteStart, deleteEnd);
        
        const insertIter = this.buffer.get_iter_at_mark(insertMark);
        this.buffer.insert(insertIter, textToInsert, -1);
        
        this.buffer.delete_mark(insertMark);
        
        // Calculate new cursor position (one line down from original)
        const newSelStartOffset = deleteStartOffset + targetLine.length + 1;
        
        if (wasSelection) {
            let selectionLength = 0;
            for (let i = 0; i < selectedLines.length; i++) {
                selectionLength += selectedLines[i].length;
                if (i < selectedLines.length - 1) {
                    selectionLength += 1;
                }
            }
            
            const newSelStart = this.buffer.get_iter_at_offset(newSelStartOffset);
            const newSelEndIter = this.buffer.get_iter_at_offset(newSelStartOffset + selectionLength);
            this.buffer.select_range(newSelStart, newSelEndIter);
        } else {
            const newCursorOffset = newSelStartOffset + Math.min(cursorOffset, selectedLines[0].length);
            const newCursorIter = this.buffer.get_iter_at_offset(newCursorOffset);
            this.buffer.place_cursor(newCursorIter);
        }
        
        this.buffer.end_user_action();
        
        // Cancel any pending debounced renders and trigger immediate re-render
        if (this.markdownRenderer) {
            if (this.markdownRenderer._renderTimeoutId) {
                GLib.source_remove(this.markdownRenderer._renderTimeoutId);
                this.markdownRenderer._renderTimeoutId = null;
            }
            if (this.markdownRenderer._cursorTimeoutId) {
                GLib.source_remove(this.markdownRenderer._cursorTimeoutId);
                this.markdownRenderer._cursorTimeoutId = null;
            }
            this.markdownRenderer._textJustChanged = false;
            this.markdownRenderer._updateSyntaxVisibility();
        }
        
        // Reset throttle flag after a short delay
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            this.lineMovePending = false;
            return false;
        });
    }
};

