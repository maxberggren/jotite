const { Gtk, GLib } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Bullet List Handlers Component
// ============================================================================

var BulletHandlers = class BulletHandlers {
    constructor(textView, markdownRenderer, lineMovement) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        this.lineMovement = lineMovement;
    }

    setup() {
        const keyController = new Gtk.EventControllerKey();
        
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            return this._handleKeyPress(keyval, keycode, state);
        });
        
        this.textView.add_controller(keyController);
        print('Bullet list handlers installed');
    }

    _handleKeyPress(keyval, keycode, state) {
        // Detect undo/redo operations (Ctrl+Z and Ctrl+Shift+Z)
        if (keyval === 122 && (state & Constants.CTRL_MASK)) {
            if (this.markdownRenderer) {
                this.markdownRenderer._isUndoRedoOperation = true;
            }
            return false;
        }
        
        // Get current position and line
        const cursor = this.buffer.get_insert();
        const iter = this.buffer.get_iter_at_mark(cursor);
        const cursorOffset = iter.get_offset();
        
        const currentLineIter = iter.copy();
        const currentLineNum = currentLineIter.get_line();
        
        const lineStart = currentLineIter.copy();
        lineStart.set_line_offset(0);
        const lineStartOffset = lineStart.get_offset();
        
        const lineEnd = currentLineIter.copy();
        lineEnd.set_line_offset(0);
        if (!lineEnd.ends_line()) {
            lineEnd.forward_to_line_end();
        }
        const lineEndOffset = lineEnd.get_offset();
        
        const lineText = this.buffer.get_text(lineStart, lineEnd, false);
        
        const [start, end] = this.buffer.get_bounds();
        const allText = this.buffer.get_text(start, end, false);
        const lines = allText.split('\n');
        
        // Handle Ctrl+T: Toggle TODO checkbox on current line
        if (keyval === Constants.KEY_T && (state & Constants.CTRL_MASK)) {
            return this._handleToggleTodo(lineText, lineStartOffset, cursorOffset);
        }
        
        // Handle Enter key
        if ((keyval === Constants.KEY_ENTER || keyval === Constants.KEY_KP_ENTER) && !(state & Constants.CTRL_MASK)) {
            return this._handleEnter(lineText, iter);
        }
        
        // Handle Tab key
        if (keyval === 65289 && !(state & Constants.CTRL_MASK)) {
            return this._handleTab(lineText, lines, currentLineNum, lineStartOffset, lineEndOffset, iter);
        }
        
        // Handle Shift+Tab key
        if (keyval === 65056) {
            return this._handleShiftTab(lineText, lines, currentLineNum, lineStartOffset, lineEndOffset, iter);
        }
        
        // Handle Ctrl+X: Cut entire line if no text is selected
        if (keyval === Constants.KEY_X && (state & Constants.CTRL_MASK)) {
            return this._handleCutLine();
        }
        
        // Handle Ctrl+Up: Move line up
        if (keyval === Constants.KEY_UP && (state & Constants.CTRL_MASK) && this.lineMovement) {
            this.lineMovement.moveLineUp();
            return true;
        }
        
        // Handle Ctrl+Down: Move line down
        if (keyval === Constants.KEY_DOWN && (state & Constants.CTRL_MASK) && this.lineMovement) {
            this.lineMovement.moveLineDown();
            return true;
        }
        
        return false;
    }

    _handleToggleTodo(lineText, lineStartOffset, cursorOffset) {
        print('Ctrl+T detected - attempting to toggle TODO');
        
        const todoMatch = lineText.match(/\[([ Xx])\]/);
        if (todoMatch) {
            const isChecked = todoMatch[1] === 'X' || todoMatch[1] === 'x';
            const todoStart = lineStartOffset + todoMatch.index;
            const todoEnd = todoStart + 3;
            
            print(`Found TODO at offset ${todoStart}, isChecked: ${isChecked}`);
            
            const savedCursorOffset = cursorOffset;
            
            this.buffer.begin_user_action();
            
            const startIter = this.buffer.get_iter_at_offset(todoStart);
            const endIter = this.buffer.get_iter_at_offset(todoEnd);
            this.buffer.delete(startIter, endIter);
            
            const newStartIter = this.buffer.get_iter_at_offset(todoStart);
            const newTodo = isChecked ? '[ ]' : '[X]';
            this.buffer.insert(newStartIter, newTodo, -1);
            
            this.buffer.end_user_action();
            
            const restoredIter = this.buffer.get_iter_at_offset(savedCursorOffset);
            this.buffer.place_cursor(restoredIter);
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            print('TODO toggled successfully');
            return true;
        } else {
            print('No TODO found on current line');
        }
        return false;
    }

    _handleEnter(lineText, iter) {
        print('Enter key detected on bullet list handler');
        
        // Check for numbered list first (e.g., "1. item" or "  1. item")
        const numberedMatch = lineText.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
            print('Numbered list line detected!');
            return this._handleNumberedListEnter(lineText, iter, numberedMatch);
        }
        
        // Check for regular bullet list
        const bulletMatch = lineText.match(/^(\s*)([-*])\s+(.*)$/);
        if (bulletMatch) {
            print('Bullet line detected!');
            const [, indent, bullet, content] = bulletMatch;
            
            const cursorLineOffset = iter.get_line_offset();
            const lineLength = lineText.length;
            const isCursorAtEnd = cursorLineOffset === lineLength;
            
            print(`Cursor position: ${cursorLineOffset}, Line length: ${lineLength}, At end: ${isCursorAtEnd}`);
            
            if (!isCursorAtEnd) {
                print('Cursor not at end of line, allowing default Enter behavior');
                return false;
            }
            
            const hasTodo = content.match(/^\[([ Xx])\]\s*/);
            
            if (!content.trim() || (hasTodo && !content.slice(hasTodo[0].length).trim())) {
                print('Empty bullet, removing');
                
                this.buffer.begin_user_action();
                
                const cursorIter = this.buffer.get_iter_at_mark(this.buffer.get_insert());
                const lineStart = cursorIter.copy();
                lineStart.set_line_offset(0);
                const lineEnd = cursorIter.copy();
                lineEnd.set_line_offset(0);
                if (!lineEnd.ends_line()) {
                    lineEnd.forward_to_line_end();
                }
                
                this.buffer.delete(lineStart, lineEnd);
                
                this.buffer.end_user_action();
                
                if (this.markdownRenderer) {
                    this.markdownRenderer._updateSyntaxVisibility();
                }
                
                return true;
            }
            
            print('Adding new bullet');
            let newBullet;
            if (hasTodo) {
                newBullet = `\n${indent}${bullet} [ ] `;
            } else {
                newBullet = `\n${indent}${bullet} `;
            }
            this.buffer.insert_at_cursor(newBullet, -1);
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        return false;
    }

    _handleNumberedListEnter(lineText, iter, numberedMatch) {
        const [, indent, number, content] = numberedMatch;
        
        const cursorLineOffset = iter.get_line_offset();
        const lineLength = lineText.length;
        const isCursorAtEnd = cursorLineOffset === lineLength;
        
        print(`Numbered list - Cursor position: ${cursorLineOffset}, Line length: ${lineLength}, At end: ${isCursorAtEnd}`);
        
        if (!isCursorAtEnd) {
            print('Cursor not at end of line, need to insert item in middle');
            // When inserting in middle, add new item and renumber
            this.buffer.begin_user_action();
            
            const cursorIter = this.buffer.get_iter_at_mark(this.buffer.get_insert());
            const currentLineNum = cursorIter.get_line();
            
            // Split the current line at cursor position
            const beforeCursor = lineText.substring(0, cursorLineOffset);
            const afterCursor = lineText.substring(cursorLineOffset);
            
            // Get next number
            const nextNum = parseInt(number) + 1;
            const newLine = `\n${indent}${nextNum}. ${afterCursor}`;
            
            this.buffer.insert_at_cursor(newLine, -1);
            
            this.buffer.end_user_action();
            
            // Renumber all subsequent items
            this._renumberListFrom(currentLineNum + 1, nextNum);
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        
        const hasTodo = content.match(/^\[([ Xx])\]\s*/);
        
        if (!content.trim() || (hasTodo && !content.slice(hasTodo[0].length).trim())) {
            print('Empty numbered item, removing');
            
            this.buffer.begin_user_action();
            
            const cursorIter = this.buffer.get_iter_at_mark(this.buffer.get_insert());
            const lineStart = cursorIter.copy();
            lineStart.set_line_offset(0);
            const lineEnd = cursorIter.copy();
            lineEnd.set_line_offset(0);
            if (!lineEnd.ends_line()) {
                lineEnd.forward_to_line_end();
            }
            
            this.buffer.delete(lineStart, lineEnd);
            
            this.buffer.end_user_action();
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        
        print('Adding new numbered item at end');
        const cursorIter = this.buffer.get_iter_at_mark(this.buffer.get_insert());
        const currentLineNum = cursorIter.get_line();
        const nextNum = parseInt(number) + 1;
        let newItem;
        if (hasTodo) {
            newItem = `\n${indent}${nextNum}. [ ] `;
        } else {
            newItem = `\n${indent}${nextNum}. `;
        }
        
        this.buffer.begin_user_action();
        this.buffer.insert_at_cursor(newItem, -1);
        this.buffer.end_user_action();
        
        // Renumber all subsequent items starting from the newly inserted line
        this._renumberListFrom(currentLineNum + 1, nextNum);
        
        if (this.markdownRenderer) {
            this.markdownRenderer._updateSyntaxVisibility();
        }
        
        return true;
    }

    _renumberListFrom(startLineNum, startNumber) {
        // Get all text to analyze the list
        const [start, end] = this.buffer.get_bounds();
        const allText = this.buffer.get_text(start, end, false);
        const lines = allText.split('\n');
        
        if (startLineNum >= lines.length) {
            return;
        }
        
        // Get the indent level of the starting line
        const startLine = lines[startLineNum];
        const startMatch = startLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (!startMatch) {
            return;
        }
        const baseIndent = startMatch[1];
        
        let currentNumber = startNumber;
        let lineOffset = 0;
        
        // Calculate offset to startLineNum
        for (let i = 0; i < startLineNum; i++) {
            lineOffset += lines[i].length + 1; // +1 for newline
        }
        
        this.buffer.begin_user_action();
        
        for (let i = startLineNum; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
            
            if (!match) {
                // Not a numbered list item, stop renumbering
                break;
            }
            
            const [, indent, oldNum, content] = match;
            
            // If indent level changed, stop renumbering
            if (indent.length !== baseIndent.length) {
                break;
            }
            
            // If the number is already correct, we can stop
            if (parseInt(oldNum) === currentNumber) {
                currentNumber++;
                lineOffset += line.length + 1;
                continue;
            }
            
            // Replace the number
            const newLine = `${indent}${currentNumber}. ${content}`;
            
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            this.buffer.delete(lineStart, lineEnd);
            
            const insertIter = this.buffer.get_iter_at_offset(lineOffset);
            this.buffer.insert(insertIter, newLine, -1);
            
            lineOffset += newLine.length + 1;
            currentNumber++;
        }
        
        this.buffer.end_user_action();
    }

    _handleTab(lineText, lines, currentLineNum, lineStartOffset, lineEndOffset, iter) {
        print('===== TAB KEY PRESSED =====');
        print(`Current line number: ${currentLineNum}`);
        print(`Current line text: "${lineText}"`);
        
        // Check if we're on a header line first
        const headerMatch = lineText.match(/^(#{1,})(\s+)(.+)$/);
        if (headerMatch) {
            return this._indentHeader(headerMatch, iter, lineStartOffset);
        }
        
        // Check if there's a selection
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        print(`Has selection: ${hasSelection}`);
        
        if (hasSelection) {
            return this._indentMultipleLines(lines, selStart, selEnd);
        } else {
            return this._indentSingleLine(lineText, lineStartOffset, lineEndOffset, currentLineNum);
        }
    }

    _indentHeader(headerMatch, iter, lineStartOffset) {
        print('Increasing header level');
        const [, hashes, spaces, content] = headerMatch;
        const newLine = `#${hashes}${spaces}${content}`;
        
        this.buffer.begin_user_action();
        
        const cursorLineOffset = iter.get_line_offset();
        const lineStart = iter.copy();
        lineStart.set_line_offset(0);
        const lineEnd = iter.copy();
        lineEnd.set_line_offset(0);
        if (!lineEnd.ends_line()) {
            lineEnd.forward_to_line_end();
        }
        
        this.buffer.delete(lineStart, lineEnd);
        const insertIter = this.buffer.get_iter_at_offset(lineStartOffset);
        this.buffer.insert(insertIter, newLine, -1);
        
        const newCursorIter = this.buffer.get_iter_at_offset(lineStartOffset + cursorLineOffset + 1);
        this.buffer.place_cursor(newCursorIter);
        this.buffer.end_user_action();
        
        if (this.markdownRenderer) {
            this.markdownRenderer._updateSyntaxVisibility();
        }
        
        return true;
    }

    _indentMultipleLines(lines, selStart, selEnd) {
        const selStartOffset = selStart.get_offset();
        const selEndOffset = selEnd.get_offset();
        
        let offset = 0;
        let firstLineNum = -1;
        let lastLineNum = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length;
            const lineEndOffset = offset + lineLength;
            
            if (selStartOffset < lineEndOffset && selEndOffset > offset) {
                if (firstLineNum === -1) firstLineNum = i;
                lastLineNum = i;
            }
            
            offset += lineLength + 1;
        }
        
        if (firstLineNum !== -1 && lastLineNum !== -1) {
            let anyListItems = false;
            for (let i = firstLineNum; i <= lastLineNum; i++) {
                if (lines[i].match(/^(\s*)([-*])(\s*.*)$/) || lines[i].match(/^(\s*)(\d+)\.(\s*.*)$/)) {
                    anyListItems = true;
                    break;
                }
            }
            
            if (anyListItems) {
                print(`Indenting ${lastLineNum - firstLineNum + 1} lines`);
                
                let selStartLineNum = -1;
                let lineOffset = 0;
                for (let i = 0; i < lines.length; i++) {
                    const lineEnd = lineOffset + lines[i].length;
                    if (selStartOffset >= lineOffset && selStartOffset <= lineEnd) {
                        selStartLineNum = i;
                        break;
                    }
                    lineOffset += lines[i].length + 1;
                }
                
                const newLines = [];
                let spacesAddedAtOrBeforeSelStart = 0;
                let totalSpacesAdded = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    if (i >= firstLineNum && i <= lastLineNum) {
                        // Check for numbered list
                        const numberedMatch = lines[i].match(/^(\s*)(\d+)\.(\s*.*)$/);
                        if (numberedMatch) {
                            const [, indent, number, rest] = numberedMatch;
                            newLines.push(`   ${indent}${number}.${rest}`);  // 3 spaces for numbered lists
                            
                            if (i <= selStartLineNum) {
                                spacesAddedAtOrBeforeSelStart += 3;
                            }
                            totalSpacesAdded += 3;
                        } else {
                            // Check for bullet list
                            const bulletMatch = lines[i].match(/^(\s*)([-*])(\s*.*)$/);
                            if (bulletMatch) {
                                const [, indent, bullet, rest] = bulletMatch;
                                newLines.push(`  ${indent}${bullet}${rest}`);
                                
                                if (i <= selStartLineNum) {
                                    spacesAddedAtOrBeforeSelStart += 2;
                                }
                                totalSpacesAdded += 2;
                            } else {
                                newLines.push(lines[i]);
                            }
                        }
                    } else {
                        newLines.push(lines[i]);
                    }
                }
                
                this.buffer.begin_user_action();
                const [bufStart, bufEnd] = this.buffer.get_bounds();
                this.buffer.delete(bufStart, bufEnd);
                this.buffer.insert(bufStart, newLines.join('\n'), -1);
                
                const newSelStart = this.buffer.get_iter_at_offset(selStartOffset + spacesAddedAtOrBeforeSelStart);
                const newSelEnd = this.buffer.get_iter_at_offset(selEndOffset + totalSpacesAdded);
                this.buffer.select_range(newSelStart, newSelEnd);
                this.buffer.end_user_action();
                
                this.textView.scroll_to_mark(this.buffer.get_insert(), 0.0, false, 0.0, 0.0);
                
                if (this.markdownRenderer) {
                    this.markdownRenderer._updateSyntaxVisibility();
                }
                
                return true;
            }
        }
        return false;
    }

    _indentSingleLine(lineText, lineStartOffset, lineEndOffset, currentLineNum) {
        // Check for numbered list first
        const numberedMatch = lineText.match(/^(\s*)(\d+)\.(\s*.*)$/);
        if (numberedMatch) {
            print('===== TAB INDENT NUMBERED LIST =====');
            const [, indent, number, rest] = numberedMatch;
            const newLine = `   ${indent}${number}.${rest}`;  // 3 spaces for numbered lists
            
            this.buffer.begin_user_action();
            
            const deleteStart = this.buffer.get_iter_at_offset(lineStartOffset);
            const deleteEnd = this.buffer.get_iter_at_offset(lineEndOffset);
            
            this.buffer.delete(deleteStart, deleteEnd);
            this.buffer.insert(deleteStart, newLine, -1);
            
            this.buffer.end_user_action();
            
            // Renumber the list starting from 1 at the new indent level
            this._renumberListFrom(currentLineNum, 1);
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        
        // Check for bullet list
        const bulletMatch = lineText.match(/^(\s*)([-*])(\s*.*)$/);
        if (bulletMatch) {
            print('===== TAB INDENT DEBUG =====');
            const [, indent, bullet, rest] = bulletMatch;
            const newLine = `  ${indent}${bullet}${rest}`;
            
            this.buffer.begin_user_action();
            
            const deleteStart = this.buffer.get_iter_at_offset(lineStartOffset);
            const deleteEnd = this.buffer.get_iter_at_offset(lineEndOffset);
            
            this.buffer.delete(deleteStart, deleteEnd);
            this.buffer.insert(deleteStart, newLine, -1);
            
            this.buffer.end_user_action();
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        return false;
    }

    _handleShiftTab(lineText, lines, currentLineNum, lineStartOffset, lineEndOffset, iter) {
        print('Shift+Tab detected');
        
        // Check if we're on a header line first
        const headerMatch = lineText.match(/^(#{2,})(\s+)(.+)$/);
        if (headerMatch) {
            return this._outdentHeader(headerMatch, iter, lineStartOffset);
        }
        
        // Check if there's a selection
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        
        if (hasSelection) {
            return this._outdentMultipleLines(lines, selStart, selEnd);
        } else {
            return this._outdentSingleLine(lineText, lineStartOffset, lineEndOffset, currentLineNum);
        }
    }

    _outdentHeader(headerMatch, iter, lineStartOffset) {
        print('Decreasing header level');
        const [, hashes, spaces, content] = headerMatch;
        const newLine = `${hashes.substring(1)}${spaces}${content}`;
        
        this.buffer.begin_user_action();
        
        const cursorLineOffset = iter.get_line_offset();
        const lineStart = iter.copy();
        lineStart.set_line_offset(0);
        const lineEnd = iter.copy();
        lineEnd.set_line_offset(0);
        if (!lineEnd.ends_line()) {
            lineEnd.forward_to_line_end();
        }
        
        this.buffer.delete(lineStart, lineEnd);
        const insertIter = this.buffer.get_iter_at_offset(lineStartOffset);
        this.buffer.insert(insertIter, newLine, -1);
        
        const newCursorIter = this.buffer.get_iter_at_offset(lineStartOffset + Math.max(0, cursorLineOffset - 1));
        this.buffer.place_cursor(newCursorIter);
        this.buffer.end_user_action();
        
        if (this.markdownRenderer) {
            this.markdownRenderer._updateSyntaxVisibility();
        }
        
        return true;
    }

    _outdentMultipleLines(lines, selStart, selEnd) {
        const selStartOffset = selStart.get_offset();
        const selEndOffset = selEnd.get_offset();
        
        let offset = 0;
        let firstLineNum = -1;
        let lastLineNum = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length;
            const lineEndOffset = offset + lineLength;
            
            if (selStartOffset < lineEndOffset && selEndOffset > offset) {
                if (firstLineNum === -1) firstLineNum = i;
                lastLineNum = i;
            }
            
            offset += lineLength + 1;
        }
        
        if (firstLineNum !== -1 && lastLineNum !== -1) {
            let anyIndentedItems = false;
            for (let i = firstLineNum; i <= lastLineNum; i++) {
                if (lines[i].match(/^(\s+)([-*])(\s*.*)$/) || lines[i].match(/^(\s+)(\d+)\.(\s*.*)$/)) {
                    anyIndentedItems = true;
                    break;
                }
            }
            
            if (anyIndentedItems) {
                print(`Outdenting ${lastLineNum - firstLineNum + 1} lines`);
                
                let selStartLineNum = -1;
                let lineOffset = 0;
                for (let i = 0; i < lines.length; i++) {
                    const lineEnd = lineOffset + lines[i].length;
                    if (selStartOffset >= lineOffset && selStartOffset <= lineEnd) {
                        selStartLineNum = i;
                        break;
                    }
                    lineOffset += lines[i].length + 1;
                }
                
                const newLines = [];
                let spacesRemovedAtOrBeforeSelStart = 0;
                let totalSpacesRemoved = 0;
                
                for (let i = 0; i < lines.length; i++) {
                    if (i >= firstLineNum && i <= lastLineNum) {
                        // Check for numbered list
                        const numberedMatch = lines[i].match(/^(\s+)(\d+)\.(\s*.*)$/);
                        if (numberedMatch) {
                            const [, indent, number, rest] = numberedMatch;
                            const spacesRemoved = Math.min(3, indent.length);  // Remove 3 spaces for numbered lists
                            const newIndent = indent.substring(spacesRemoved);
                            newLines.push(`${newIndent}${number}.${rest}`);
                            
                            if (i <= selStartLineNum) {
                                spacesRemovedAtOrBeforeSelStart += spacesRemoved;
                            }
                            totalSpacesRemoved += spacesRemoved;
                        } else {
                            // Check for bullet list
                            const bulletMatch = lines[i].match(/^(\s+)([-*])(\s*.*)$/);
                            if (bulletMatch) {
                                const [, indent, bullet, rest] = bulletMatch;
                                const spacesRemoved = Math.min(2, indent.length);
                                const newIndent = indent.substring(spacesRemoved);
                                newLines.push(`${newIndent}${bullet}${rest}`);
                                
                                if (i <= selStartLineNum) {
                                    spacesRemovedAtOrBeforeSelStart += spacesRemoved;
                                }
                                totalSpacesRemoved += spacesRemoved;
                            } else {
                                newLines.push(lines[i]);
                            }
                        }
                    } else {
                        newLines.push(lines[i]);
                    }
                }
                
                this.buffer.begin_user_action();
                const [bufStart, bufEnd] = this.buffer.get_bounds();
                this.buffer.delete(bufStart, bufEnd);
                this.buffer.insert(bufStart, newLines.join('\n'), -1);
                
                const newSelStart = this.buffer.get_iter_at_offset(Math.max(0, selStartOffset - spacesRemovedAtOrBeforeSelStart));
                const newSelEnd = this.buffer.get_iter_at_offset(Math.max(0, selEndOffset - totalSpacesRemoved));
                this.buffer.select_range(newSelStart, newSelEnd);
                this.buffer.end_user_action();
                
                this.textView.scroll_to_mark(this.buffer.get_insert(), 0.0, false, 0.0, 0.0);
                
                if (this.markdownRenderer) {
                    this.markdownRenderer._updateSyntaxVisibility();
                }
                
                return true;
            }
        }
        return false;
    }

    _outdentSingleLine(lineText, lineStartOffset, lineEndOffset, currentLineNum) {
        // Check for numbered list first
        const numberedMatch = lineText.match(/^(\s+)(\d+)\.(\s*.*)$/);
        if (numberedMatch) {
            print('===== SHIFT+TAB OUTDENT NUMBERED LIST =====');
            const [, indent, number, rest] = numberedMatch;
            const newIndent = indent.length >= 3 ? indent.substring(3) : '';  // Remove 3 spaces for numbered lists
            const newLine = `${newIndent}${number}.${rest}`;
            
            this.buffer.begin_user_action();
            
            const deleteStart = this.buffer.get_iter_at_offset(lineStartOffset);
            const deleteEnd = this.buffer.get_iter_at_offset(lineEndOffset);
            
            this.buffer.delete(deleteStart, deleteEnd);
            this.buffer.insert(deleteStart, newLine, -1);
            
            this.buffer.end_user_action();
            
            // Renumber the list starting from 1 at the new indent level
            this._renumberListFrom(currentLineNum, 1);
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        
        // Check for bullet list
        const bulletMatch = lineText.match(/^(\s+)([-*])(\s*.*)$/);
        if (bulletMatch) {
            print('===== SHIFT+TAB OUTDENT DEBUG =====');
            const [, indent, bullet, rest] = bulletMatch;
            const newIndent = indent.length >= 2 ? indent.substring(2) : '';
            const newLine = `${newIndent}${bullet}${rest}`;
            
            this.buffer.begin_user_action();
            
            const deleteStart = this.buffer.get_iter_at_offset(lineStartOffset);
            const deleteEnd = this.buffer.get_iter_at_offset(lineEndOffset);
            
            this.buffer.delete(deleteStart, deleteEnd);
            this.buffer.insert(deleteStart, newLine, -1);
            
            this.buffer.end_user_action();
            
            if (this.markdownRenderer) {
                this.markdownRenderer._updateSyntaxVisibility();
            }
            
            return true;
        }
        return false;
    }

    _handleCutLine() {
        print('Ctrl+X detected in textview handler');
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        
        if (!hasSelection) {
            print('No selection - cutting entire line');
            const cursor = this.buffer.get_insert();
            const iter = this.buffer.get_iter_at_mark(cursor);
            
            const lineStart = iter.copy();
            lineStart.set_line_offset(0);
            
            const lineEnd = iter.copy();
            if (!lineEnd.ends_line()) {
                lineEnd.forward_to_line_end();
            }
            if (!lineEnd.is_end()) {
                lineEnd.forward_char();
            }
            
            const clipboard = this.textView.get_clipboard();
            const lineText = this.buffer.get_text(lineStart, lineEnd, false);
            clipboard.set(lineText);
            
            this.buffer.delete(lineStart, lineEnd);
            
            print('Line cut to clipboard');
            return true;
        }
        print('Selection exists - using default cut');
        return false;
    }
};

