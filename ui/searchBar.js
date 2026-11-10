const { Gtk, Gdk, GLib } = imports.gi;
const { Constants } = imports.constants;
const { TextUtils } = imports.util.text;

// ============================================================================
// Search Bar Component
// ============================================================================
//
// Searches the raw buffer text (case-insensitive unless "Aa" is active).
// Matches are buffer offsets (code points) and are recomputed, debounced,
// whenever the buffer changes while the bar is open, so highlights and
// next/previous never go stale. Highlighting uses the bar's own tags.

const MAX_HIGHLIGHTS = 2000;     // matches beyond this are counted, not tinted
const REFRESH_DELAY_MS = 150;    // debounce for re-searching after edits
const MATCH_TAG = 'jotite-search-match';
const CURRENT_TAG = 'jotite-search-current';

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rgba(hex, alpha) {
    const c = new Gdk.RGBA();
    if (!hex || !c.parse(hex))
        c.parse('#888888');
    c.alpha = alpha;
    return c;
}

var SearchBarComponent = class SearchBarComponent {
    constructor(window, textView, markdownRenderer, colors = null) {
        this.window = window;
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.buffer = textView.get_buffer();
        this._colors = colors || (window && window._themeManager ? window._themeManager.colors : null);
        this._matchTag = null;
        this._currentTag = null;
        this._currentRange = null;   // [start, end] offsets carrying CURRENT_TAG
        this._anchorMark = null;     // start of the current match; follows edits
        this._refreshId = 0;
        this._changedId = this.buffer.connect('changed', () => this._scheduleRefresh());

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
        const alreadyOpen = this.isOpen();

        this.searchBar.set_search_mode(true);
        this.searchEntry.grab_focus();

        if (alreadyOpen) {
            this.searchEntry.select_region(0, -1);
            return;
        }
        // Opening fresh: a single-line selection becomes the search term.
        const [hasSelection, selStart, selEnd] = this.buffer.get_selection_bounds();
        if (hasSelection) {
            const selectedText = this.buffer.get_text(selStart, selEnd, true);
            if (selectedText && selectedText.indexOf('\n') === -1) {
                this.searchEntry.set_text(selectedText);
                this.searchEntry.select_region(0, -1);
            }
        }
        this.performSearch();
    }

    hide() {
        this.searchBar.set_search_mode(false);
        this._cancelRefresh();
        this.clearHighlights();
        this.searchMatches = [];
        this.currentMatchIndex = -1;
        this.matchCountLabel.set_visible(false);
        this.textView.grab_focus();
    }

    isOpen() {
        return !!this.searchBar && this.searchBar.get_search_mode();
    }

    // Theme change: recolor the highlight tags.
    updateColors(colors) {
        this._colors = colors;
        if (this._matchTag)
            this._matchTag.background_rgba = rgba(colors && colors.yellow, 0.3);
        if (this._currentTag)
            this._currentTag.background_rgba = rgba(colors && colors.blue, 0.5);
    }

    destroy() {
        this._cancelRefresh();
        if (this._changedId) {
            this.buffer.disconnect(this._changedId);
            this._changedId = 0;
        }
        if (this._anchorMark) {
            this.buffer.delete_mark(this._anchorMark);
            this._anchorMark = null;
        }
    }

    _ensureTags() {
        if (this._matchTag)
            return;
        // Created lazily (after the renderer's tags) so they take priority.
        const table = this.buffer.get_tag_table();
        this._matchTag = table.lookup(MATCH_TAG);
        if (!this._matchTag) {
            this._matchTag = new Gtk.TextTag({ name: MATCH_TAG });
            table.add(this._matchTag);
        }
        this._currentTag = table.lookup(CURRENT_TAG);
        if (!this._currentTag) {
            this._currentTag = new Gtk.TextTag({ name: CURRENT_TAG });
            table.add(this._currentTag);
        }
        this.updateColors(this._colors);
    }

    _scheduleRefresh() {
        if (!this.isOpen() || !this.searchEntry.get_text())
            return;
        this._cancelRefresh();
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, REFRESH_DELAY_MS, () => {
            this._refreshId = 0;
            this._refresh(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelRefresh() {
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
    }

    // Run a pending post-edit refresh now (before navigating).
    _flushRefresh() {
        if (this._refreshId) {
            this._cancelRefresh();
            this._refresh(false);
        }
    }

    // All matches of `searchText` as [{start, end}] buffer (code point) offsets.
    findMatches(searchText, caseSensitive) {
        if (!searchText)
            return [];
        const [start, end] = this.buffer.get_bounds();
        const text = this.buffer.get_text(start, end, true);
        const re = new RegExp(escapeRegExp(searchText), caseSensitive ? 'gu' : 'giu');
        const indices = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) {
                re.lastIndex++;
                continue;
            }
            indices.push(m.index, m.index + m[0].length);
        }
        const offsets = TextUtils.offsetsAt(text, indices);
        const matches = [];
        for (let i = 0; i < offsets.length; i += 2)
            matches.push({ start: offsets[i], end: offsets[i + 1] });
        return matches;
    }

    // Recompute matches. With `select`, the first match at/after the cursor
    // becomes current and is selected (typing in the entry); otherwise the
    // current match stays where it was (buffer edits) and nothing moves.
    _refresh(select) {
        this.clearHighlights();
        const searchText = this.searchEntry.get_text();
        this.searchMatches = this.findMatches(searchText, this.caseSensitiveButton.get_active());
        this.currentMatchIndex = -1;

        if (!searchText) {
            this.matchCountLabel.set_label('');
            this.matchCountLabel.set_visible(false);
            return;
        }
        this.matchCountLabel.set_visible(true);
        if (this.searchMatches.length === 0) {
            this.matchCountLabel.set_label('No matches');
            return;
        }

        this._ensureTags();
        const n = Math.min(this.searchMatches.length, MAX_HIGHLIGHTS);
        for (let i = 0; i < n; i++) {
            const m = this.searchMatches[i];
            this.buffer.apply_tag(this._matchTag,
                this.buffer.get_iter_at_offset(m.start), this.buffer.get_iter_at_offset(m.end));
        }

        let anchor;
        if (select) {
            const [hasSel, selStart] = this.buffer.get_selection_bounds();
            anchor = hasSel ? selStart.get_offset()
                : this.buffer.get_iter_at_mark(this.buffer.get_insert()).get_offset();
        } else {
            anchor = this._anchorMark ? this.buffer.get_iter_at_mark(this._anchorMark).get_offset() : 0;
        }
        const idx = this._firstMatchAtOrAfter(anchor);
        this.currentMatchIndex = idx < 0 ? 0 : idx;
        this._showCurrent(select, false);
    }

    _firstMatchAtOrAfter(offset) {
        let lo = 0, hi = this.searchMatches.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.searchMatches[mid].start < offset)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo < this.searchMatches.length ? lo : -1;
    }

    performSearch() {
        this._cancelRefresh();
        this._refresh(true);
    }

    _step(delta, grabFocus) {
        this._flushRefresh();
        const count = this.searchMatches.length;
        if (count === 0)
            return;
        this.currentMatchIndex = (this.currentMatchIndex + delta + count) % count;
        this.highlightCurrentMatch(grabFocus);
    }

    findNext() {
        this._step(1, true);
    }

    findPrevious() {
        this._step(-1, true);
    }

    findNextKeepFocus() {
        this._step(1, false);
    }

    findPreviousKeepFocus() {
        this._step(-1, false);
    }

    highlightCurrentMatch(grabFocus = false) {
        this._showCurrent(true, grabFocus);
    }

    // Move the "current" tint from the previous current match to the new one
    // (O(1), not O(matches)); optionally select and scroll to it.
    _showCurrent(select, grabFocus) {
        if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.searchMatches.length)
            return;
        this._ensureTags();
        const buffer = this.buffer;
        if (this._currentRange) {
            buffer.remove_tag(this._currentTag,
                buffer.get_iter_at_offset(this._currentRange[0]),
                buffer.get_iter_at_offset(this._currentRange[1]));
        }
        const match = this.searchMatches[this.currentMatchIndex];
        const matchStart = buffer.get_iter_at_offset(match.start);
        const matchEnd = buffer.get_iter_at_offset(match.end);
        buffer.apply_tag(this._currentTag, matchStart, matchEnd);
        this._currentRange = [match.start, match.end];

        if (this._anchorMark)
            buffer.move_mark(this._anchorMark, matchStart);
        else
            this._anchorMark = buffer.create_mark(null, matchStart, true);

        this.matchCountLabel.set_label(`${this.currentMatchIndex + 1} of ${this.searchMatches.length}`);

        if (select) {
            buffer.select_range(matchStart, matchEnd);
            this.textView.scroll_to_iter(matchStart, 0.0, true, 0.5, 0.5);
            if (grabFocus)
                this.textView.grab_focus();
        }
    }

    clearHighlights() {
        const [start, end] = this.buffer.get_bounds();
        if (this._matchTag)
            this.buffer.remove_tag(this._matchTag, start, end);
        if (this._currentTag)
            this.buffer.remove_tag(this._currentTag, start, end);
        this._currentRange = null;
    }
};
