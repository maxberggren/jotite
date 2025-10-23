const { Gtk, GLib } = imports.gi;

// ============================================================================
// TODO Handlers Component
// ============================================================================

var TodoHandlers = class TodoHandlers {
    constructor(textView, markdownRenderer) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        
        // Track click state for double-click detection
        this.clickState = {
            lastClickTime: 0,
            lastClickOffset: -1,
            timeoutId: null
        };
    }

    setup() {
        const clickGesture = new Gtk.GestureClick();
        
        clickGesture.connect('pressed', (gesture, n_press, x, y) => {
            this._handleClick(gesture, x, y);
        });
        
        this.textView.add_controller(clickGesture);
        print('TODO double-click handler installed');
    }

    _handleClick(gesture, x, y) {
        // Convert window coordinates to buffer coordinates
        const [bufferX, bufferY] = this.textView.window_to_buffer_coords(
            Gtk.TextWindowType.WIDGET, x, y
        );
        
        // Get the iter at the click position
        const [isInside, iter] = this.textView.get_iter_at_location(bufferX, bufferY);
        if (!isInside) {
            return;
        }
        
        const clickOffset = iter.get_offset();
        const currentTime = Date.now();
        
        // Find if we clicked on a TODO box
        const [start, end] = this.buffer.get_bounds();
        const text = this.buffer.get_text(start, end, false);
        
        // Find all TODO patterns in the text
        const todoPattern = /\[([ Xx])\]/g;
        let match;
        let clickedTodo = null;
        
        let lineStart = 0;
        const lines = text.split('\n');
        
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const lineEnd = lineStart + line.length;
            
            // Check if click is within this line
            if (clickOffset >= lineStart && clickOffset <= lineEnd) {
                // Search for TODO patterns in this line
                todoPattern.lastIndex = 0;
                while ((match = todoPattern.exec(line)) !== null) {
                    const todoStart = lineStart + match.index;
                    const todoEnd = todoStart + 3; // Length of [ ] or [X]
                    
                    // Check if click is within this TODO box
                    if (clickOffset >= todoStart && clickOffset <= todoEnd) {
                        clickedTodo = {
                            start: todoStart,
                            end: todoEnd,
                            isChecked: match[1] === 'X' || match[1] === 'x',
                            checkChar: match[1]
                        };
                        break;
                    }
                }
                break;
            }
            
            lineStart = lineEnd + 1; // +1 for newline
        }
        
        // If we clicked on a TODO box
        if (clickedTodo) {
            const timeSinceLastClick = currentTime - this.clickState.lastClickTime;
            const isSameTodo = clickedTodo.start === this.clickState.lastClickOffset;
            
            // Check if this is a double-click (within 400ms on the same TODO)
            if (isSameTodo && timeSinceLastClick < 400) {
                // Double-click detected - toggle the TODO status
                print(`Double-click detected on TODO at offset ${clickedTodo.start}`);
                
                // Cancel the single-click timeout if it exists
                if (this.clickState.timeoutId) {
                    GLib.source_remove(this.clickState.timeoutId);
                    this.clickState.timeoutId = null;
                }
                
                // Toggle the TODO status
                this.buffer.begin_user_action();
                
                const startIter = this.buffer.get_iter_at_offset(clickedTodo.start);
                const endIter = this.buffer.get_iter_at_offset(clickedTodo.end);
                
                // Delete the old TODO
                this.buffer.delete(startIter, endIter);
                
                // Insert the new TODO with toggled status
                const newStartIter = this.buffer.get_iter_at_offset(clickedTodo.start);
                const newTodo = clickedTodo.isChecked ? '[ ]' : '[X]';
                this.buffer.insert(newStartIter, newTodo, -1);
                
                this.buffer.end_user_action();
                
                // Move cursor away from the TODO box to prevent it from showing the markdown
                const lineStartIter = this.buffer.get_iter_at_offset(clickedTodo.start);
                lineStartIter.set_line_offset(0);
                const lineEndIter = lineStartIter.copy();
                if (!lineEndIter.ends_line()) {
                    lineEndIter.forward_to_line_end();
                }
                
                // Place cursor at end of line, ensuring no selection
                this.buffer.place_cursor(lineEndIter);
                
                // Force immediate re-render
                if (this.markdownRenderer) {
                    this.markdownRenderer._updateSyntaxVisibility();
                }
                
                // Reset click state
                this.clickState.lastClickTime = 0;
                this.clickState.lastClickOffset = -1;
                
                // Prevent default behavior
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            } else {
                // First click - record it and wait for potential second click
                print(`First click on TODO at offset ${clickedTodo.start}`);
                
                this.clickState.lastClickTime = currentTime;
                this.clickState.lastClickOffset = clickedTodo.start;
                
                // Set up a timeout to allow normal behavior if no second click comes
                if (this.clickState.timeoutId) {
                    GLib.source_remove(this.clickState.timeoutId);
                }
                
                this.clickState.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    // Timeout expired - let the normal single-click behavior happen
                    print('Single-click timeout - showing markdown');
                    this.clickState.timeoutId = null;
                    
                    // Place cursor at the clicked position to show the markdown
                    const cursorIter = this.buffer.get_iter_at_offset(clickOffset);
                    this.buffer.place_cursor(cursorIter);
                    
                    return false; // Don't repeat
                });
                
                // Prevent immediate cursor placement to wait for double-click
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            }
        } else {
            // Clicked somewhere else - reset state and allow normal behavior
            this.clickState.lastClickTime = 0;
            this.clickState.lastClickOffset = -1;
            
            if (this.clickState.timeoutId) {
                GLib.source_remove(this.clickState.timeoutId);
                this.clickState.timeoutId = null;
            }
        }
    }
};

