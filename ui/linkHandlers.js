const { Gtk, GLib, Gio, Gdk } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Link Handlers Component
// ============================================================================

var LinkHandlers = class LinkHandlers {
    constructor(textView, markdownRenderer, window) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.window = window;
        this.buffer = textView.get_buffer();
        this._currentCursor = null;
    }

    setup() {
        const clickGesture = new Gtk.GestureClick();
        
        clickGesture.connect('pressed', (gesture, n_press, x, y) => {
            this._handleClick(gesture, x, y);
        });
        
        this.textView.add_controller(clickGesture);
        
        // Add motion controller to detect hover and change cursor
        const motionController = new Gtk.EventControllerMotion();
        motionController.connect('motion', (controller, x, y) => {
            this._handleMotion(controller, x, y);
        });
        motionController.connect('leave', () => {
            this._resetCursor();
        });
        
        this.textView.add_controller(motionController);
        
    }

    _handleMotion(controller, x, y) {
        // Check if Ctrl is pressed
        const event = controller.get_current_event();
        if (!event) {
            this._resetCursor();
            return;
        }
        
        const state = event.get_modifier_state();
        if (!(state & Constants.CTRL_MASK)) {
            this._resetCursor();
            return;
        }
        
        // Convert window coordinates to buffer coordinates
        const [bufferX, bufferY] = this.textView.window_to_buffer_coords(
            Gtk.TextWindowType.WIDGET, x, y
        );
        
        // Get the iter at the mouse position
        const [isInside, iter] = this.textView.get_iter_at_location(bufferX, bufferY);
        if (!isInside) {
            this._resetCursor();
            return;
        }
        
        // Check if mouse is over link text (not link-url)
        const tagTable = this.buffer.get_tag_table();
        const linkTag = tagTable.lookup('link');
        
        if (linkTag && iter.has_tag(linkTag)) {
            // Set pointer cursor
            if (!this._currentCursor) {
                const cursor = Gdk.Cursor.new_from_name('pointer', null);
                this.textView.set_cursor(cursor);
                this._currentCursor = cursor;
            }
        } else {
            this._resetCursor();
        }
    }
    
    _resetCursor() {
        if (this._currentCursor) {
            const defaultCursor = Gdk.Cursor.new_from_name('text', null);
            this.textView.set_cursor(defaultCursor);
            this._currentCursor = null;
        }
    }

    _handleClick(gesture, x, y) {
        // Check if Ctrl is pressed
        const event = gesture.get_current_event();
        if (!event) return;
        
        const state = event.get_modifier_state();
        if (!(state & Constants.CTRL_MASK)) {
            return; // Not Ctrl+click, ignore
        }
        
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
        
        // Check if clicked position has link tag (only the text part, not link-url)
        const tagTable = this.buffer.get_tag_table();
        const linkTag = tagTable.lookup('link');
        
        if (!linkTag || !iter.has_tag(linkTag)) {
            return; // Not clicking on link text
        }
        
        // Extract the URL from the markdown link pattern
        const url = this._extractUrlAtPosition(clickOffset);
        if (!url) {
            return;
        }
        
        // Determine if it's a URL or file path and open accordingly
        this._openLink(url);
        
        // Prevent default behavior
        gesture.set_state(Gtk.EventSequenceState.CLAIMED);
    }
    
    _extractUrlAtPosition(clickOffset) {
        // Get all text
        const [start, end] = this.buffer.get_bounds();
        const text = this.buffer.get_text(start, end, false);
        
        // Find the link pattern that contains this position
        const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        
        while ((match = linkPattern.exec(text)) !== null) {
            const [fullMatch, linkText, url] = match;
            const matchStart = match.index;
            const textStart = matchStart + 1; // After opening bracket
            const textEnd = textStart + linkText.length; // End of link text
            const matchEnd = matchStart + fullMatch.length;
            
            // Check if click position is within the link text part (not the URL part)
            if (clickOffset >= textStart && clickOffset <= textEnd) {
                return url;
            }
        }
        
        return null;
    }
    
    _openLink(url) {
        // Check if it's a URL (starts with http://, https://, ftp://, etc.)
        const urlPattern = /^(https?|ftp|file):\/\//i;
        const isUrl = urlPattern.test(url);
        
        if (isUrl) {
            // Open URL in browser
            try {
                GLib.spawn_command_line_async(`xdg-open "${url}"`);
                } catch (e) {
                    // Error opening URL
                }
        } else {
            // Treat as file path
            // Resolve relative paths relative to current file's directory
            let filePath = url;
            
            // If it's a relative path and we have a current file, resolve it
            if (this.window._currentFilePath && !GLib.path_is_absolute(filePath)) {
                const currentDir = GLib.path_get_dirname(this.window._currentFilePath);
                filePath = GLib.build_filenamev([currentDir, filePath]);
            }
            
            // Check if file exists
            const file = Gio.File.new_for_path(filePath);
            if (!file.query_exists(null)) {
                return;
            }
            
            // Open file in the app
            try {
                this.window.loadFile(file);
            } catch (e) {
                // Error opening file
            }
        }
    }
};

