const { Gtk, Gdk } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Search Bar Component
// ============================================================================

var SearchBarComponent = class SearchBarComponent {
    constructor(window, textView, markdownRenderer) {
        this.window = window;
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        
        this.searchBar = null;
        this.searchEntry = null;
        this.matchCountLabel = null;
        this.caseSensitiveButton = null;
        this.searchMatches = [];
        this.currentMatchIndex = -1;
    }

    create() {
        // Create search bar (initially hidden)
        this.searchBar = new Gtk.SearchBar({
            search_mode_enabled: false,
        });
        
        // Create search box layout (match status bar styling)
        const searchBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            halign: Gtk.Align.CENTER,
            height_request: 20,
            margin_start: 0,
            margin_end: 0,
            margin_top: 0,
            margin_bottom: 0,
        });
        
        // Create search entry
        this.searchEntry = new Gtk.SearchEntry({
            placeholder_text: 'Search...',
            hexpand: false,
        });
        this.searchEntry.add_css_class('search-entry');
        
        // Connect search entry signals
        this.searchEntry.connect('search-changed', () => {
            this.performSearch();
        });
        
        // Handle Enter key using both methods for compatibility
        // Method 1: activate signal (standard way for SearchEntry)
        this.searchEntry.connect('activate', () => {
            this.findNextKeepFocus(); // Stay in search box
        });
        
        // Method 2: Key controller for Shift+Enter
        const searchKeyController = new Gtk.EventControllerKey();
        searchKeyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            if ((keyval === Constants.KEY_ENTER || keyval === Constants.KEY_KP_ENTER) && (state & Constants.SHIFT_MASK)) {
                this.findPreviousKeepFocus(); // Stay in search box
                return true;
            }
            return false;
        });
        this.searchEntry.add_controller(searchKeyController);
        
        this.searchEntry.connect('stop-search', () => {
            this.hide();
        });
        
        // Previous button
        const prevButton = new Gtk.Button({
            label: '↑',
            tooltip_text: 'Previous match (Shift+Enter)',
        });
        prevButton.add_css_class('search-button');
        prevButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        prevButton.connect('clicked', () => this.findPreviousKeepFocus());
        
        // Next button
        const nextButton = new Gtk.Button({
            label: '↓',
            tooltip_text: 'Next match (Enter)',
        });
        nextButton.add_css_class('search-button');
        nextButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        nextButton.connect('clicked', () => this.findNextKeepFocus());
        
        // Match count label
        this.matchCountLabel = new Gtk.Label({
            label: '',
            margin_start: 0,
            margin_end: 0,
            hexpand: false,
            vexpand: false,
            xalign: 0,
            visible: false, // Hide initially until we have search results
        });
        this.matchCountLabel.add_css_class('search-match-label');
        
        // Case sensitive toggle
        this.caseSensitiveButton = new Gtk.ToggleButton({
            label: 'Aa',
            tooltip_text: 'Case sensitive',
        });
        this.caseSensitiveButton.add_css_class('search-button');
        this.caseSensitiveButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        this.caseSensitiveButton.connect('toggled', () => {
            this.performSearch();
        });
        
        // Close button
        const closeButton = new Gtk.Button({
            label: '×',
            tooltip_text: 'Close (Escape)',
        });
        closeButton.add_css_class('search-button');
        closeButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        closeButton.connect('clicked', () => this.hide());
        
        // Add widgets to search box
        searchBox.append(this.searchEntry);
        searchBox.append(prevButton);
        searchBox.append(nextButton);
        searchBox.append(this.matchCountLabel);
        searchBox.append(this.caseSensitiveButton);
        searchBox.append(closeButton);
        
        this.searchBar.set_child(searchBox);
        this.searchBar.set_key_capture_widget(this.window);
        
        // Connect the search entry to the search bar (fixes GTK warning)
        this.searchBar.connect_entry(this.searchEntry);
        
        return this.searchBar;
    }

    show() {
        // Check if search is already open
        const alreadyOpen = this.searchBar.get_search_mode();
        
        // Enable search mode in markdown renderer to prevent interference
        if (this.markdownRenderer) {
            this.markdownRenderer._searchMode = true;
        }
        
        this.searchBar.set_search_mode(true);
        this.searchEntry.grab_focus();
        
        if (alreadyOpen) {
            // If search is already open, just select all text in search box
            this.searchEntry.select_region(0, -1);
        } else {
            // If opening fresh, check if there's selected text to use as search term
            const buffer = this.textView.get_buffer();
            const [hasSelection, selStart, selEnd] = buffer.get_selection_bounds();
            if (hasSelection) {
                const selectedText = buffer.get_text(selStart, selEnd, false);
                if (selectedText && selectedText.indexOf('\n') === -1) { // Only if single line
                    this.searchEntry.set_text(selectedText);
                    this.searchEntry.select_region(0, -1); // Select all text in entry
                }
            }
            
            this.performSearch();
        }
    }
    
    hide() {
        // Disable search mode in markdown renderer
        if (this.markdownRenderer) {
            this.markdownRenderer._searchMode = false;
        }
        
        this.searchBar.set_search_mode(false);
        this.clearHighlights();
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        this.matchCountLabel.set_visible(false);
        this.textView.grab_focus();
    }

    isOpen() {
        return this.searchBar.get_search_mode();
    }
    
    performSearch() {
        const searchText = this.searchEntry.get_text();
        const buffer = this.textView.get_buffer();
        
        // Clear previous highlights
        this.clearHighlights();
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        
        if (!searchText) {
            this.matchCountLabel.set_label('');
            this.matchCountLabel.set_visible(false);
            return;
        }
        
        // Get search flags
        const caseSensitive = this.caseSensitiveButton.get_active();
        let flags = Gtk.TextSearchFlags.VISIBLE_ONLY | Gtk.TextSearchFlags.TEXT_ONLY;
        if (!caseSensitive) {
            flags |= Gtk.TextSearchFlags.CASE_INSENSITIVE;
        }
        
        // Find all matches
        const [start, end] = buffer.get_bounds();
        let searchIter = start.copy();
        
        while (true) {
            const result = searchIter.forward_search(searchText, flags, end);
            
            // forward_search returns [found, match_start, match_end] where found is boolean
            if (!result || !result[0]) break;
            
            const matchStart = result[1];
            const matchEnd = result[2];
            
            if (!matchStart || !matchEnd) break;
            
            this.searchMatches.push({
                start: matchStart.get_offset(),
                end: matchEnd.get_offset()
            });
            
            // Highlight this match
            buffer.apply_tag_by_name('search-highlight', matchStart, matchEnd);
            
            // Move search iter forward
            searchIter = matchEnd.copy();
        }
        
        // Update match count
        if (this.searchMatches.length > 0) {
            this.currentMatchIndex = 0;
            this.highlightCurrentMatch(false); // Don't grab focus during search
            this.matchCountLabel.set_visible(true);
            this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);
        } else {
            this.matchCountLabel.set_visible(true);
            this.matchCountLabel.set_label('No matches');
        }
    }
    
    findNext() {
        if (this.searchMatches.length === 0) return;
        
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
        this.highlightCurrentMatch(true); // Grab focus when navigating
        this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);
    }
    
    findPrevious() {
        if (this.searchMatches.length === 0) return;
        
        this.currentMatchIndex = (this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
        this.highlightCurrentMatch(true); // Grab focus when navigating
        this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);
    }
    
    findNextKeepFocus() {
        if (this.searchMatches.length === 0) return;
        
        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
        this.highlightCurrentMatch(false); // Don't grab focus - stay in search box
        this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);
    }
    
    findPreviousKeepFocus() {
        if (this.searchMatches.length === 0) return;
        
        this.currentMatchIndex = (this.currentMatchIndex - 1 + this.searchMatches.length) % this.searchMatches.length;
        this.highlightCurrentMatch(false); // Don't grab focus - stay in search box
        this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);
    }
    
    highlightCurrentMatch(grabFocus = false) {
        if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.searchMatches.length) return;
        
        const buffer = this.textView.get_buffer();
        
        // Remove current match highlight from all matches
        for (const match of this.searchMatches) {
            const matchStart = buffer.get_iter_at_offset(match.start);
            const matchEnd = buffer.get_iter_at_offset(match.end);
            buffer.remove_tag_by_name('search-current', matchStart, matchEnd);
        }
        
        // Highlight and SELECT current match
        const currentMatch = this.searchMatches[this.currentMatchIndex];
        const matchStart = buffer.get_iter_at_offset(currentMatch.start);
        const matchEnd = buffer.get_iter_at_offset(currentMatch.end);
        buffer.apply_tag_by_name('search-current', matchStart, matchEnd);
        
        // Create selection using buffer.select_range
        buffer.select_range(matchStart, matchEnd);
        
        // Scroll to make the match visible
        this.textView.scroll_to_iter(matchStart, 0.0, true, 0.5, 0.5);
        
        // Give focus to textview so selection is visible (only when explicitly requested)
        if (grabFocus) {
            this.textView.grab_focus();
        }
    }
    
    clearHighlights() {
        const buffer = this.textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        buffer.remove_tag_by_name('search-highlight', start, end);
        buffer.remove_tag_by_name('search-current', start, end);
    }
}

