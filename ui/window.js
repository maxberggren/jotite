const { Gtk, Gio, GLib, Adw, GObject, Gdk } = imports.gi;
const { Constants } = imports.constants;
const { SettingsManager } = imports.settings.settingsManager;
const { ThemeManager } = imports.theme.themeManager;
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { FileManager } = imports.file.fileManager;
const { SearchBarComponent } = imports.ui.searchBar;
const { BulletHandlers } = imports.ui.bulletHandlers;
const { TodoHandlers } = imports.ui.todoHandlers;
const { LinkHandlers } = imports.ui.linkHandlers;
const { LineMovement } = imports.ui.lineMovement;
const { StatusBarComponent } = imports.ui.statusBar;

// ============================================================================
// Main Window
// ============================================================================

var JotWindow = GObject.registerClass(
class JotWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({
            application,
            title: 'Jotite',
            default_width: 700,
            default_height: 500,
        });

        this._currentFilename = 'untitled.md';
        this._currentFilePath = null; // Track the full path of opened file
        this._settingsManager = new SettingsManager();
        this._themeManager = new ThemeManager();
        this._zoomLevel = 100; // Zoom level percentage (default 100%)
        this._zoomTimeoutId = null; // Track zoom indicator timeout
        this._filenameUpdateTimeoutId = null; // Track filename update debouncing
        this._markdownRenderer = null; // Will be initialized after textview is created
        this._lineMovePending = false; // Throttle line move operations
        this._hasUnsavedChanges = false; // Track if file has unsaved changes
        this._savedContent = ''; // Track last saved content

        this._buildUI();
        this._setupTheme();
        this._setupSettings();
        this._setupKeyboardShortcuts();
        this._setupCloseHandler();

        if (!this._loadExistingDefaultNote()) {
            this._newFile();
        }

        this._textView.grab_focus();
    }

    _buildUI() {
        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        // Create text view first (needed for search bar component)
        const textViewWidget = this._createTextView();
        
        // Create search bar component (needs textView and markdownRenderer)
        this._searchBarComponent = new SearchBarComponent(this, this._textView, this._markdownRenderer);
        this._searchBar = this._searchBarComponent.create();
        
        mainBox.append(this._searchBar);
        mainBox.append(textViewWidget);
        
        // Create status bar component
        this._statusBarComponent = new StatusBarComponent(this, this._settingsManager, this._currentFilename);
        this._statusBar = this._statusBarComponent.create();
        this._pathLabel = this._statusBarComponent.getLabel();
        
        mainBox.append(this._statusBar);

        this.set_content(mainBox);
    }

    _createTextView() {
        this._textView = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            vexpand: true,
            hexpand: true,
            left_margin: 20,
            right_margin: 20,
            top_margin: 20,
            bottom_margin: 20,
        });
        this._textView.add_css_class('jot-textview');

        // Initialize markdown renderer with mood config from settings
        const moodConfig = this._getMoodConfig();
        this._markdownRenderer = new MarkdownRenderer(
            this._textView,
            this._themeManager.colors,
            moodConfig
        );

        // Connect to buffer changes to update filename with debouncing (200ms delay)
        const buffer = this._textView.get_buffer();
        buffer.connect('changed', () => {
            // Mark as having unsaved changes
            const [start, end] = buffer.get_bounds();
            const currentContent = buffer.get_text(start, end, false);
            this._hasUnsavedChanges = (currentContent !== this._savedContent);
            
            // Cancel previous timeout if exists
            if (this._filenameUpdateTimeoutId) {
                GLib.source_remove(this._filenameUpdateTimeoutId);
            }
            // Schedule new filename update
            this._filenameUpdateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 200, () => {
                this._updateFilenameDisplay();
                this._filenameUpdateTimeoutId = null;
                return false;
            });
        });

        // Setup line movement first (needed by bullet handlers)
        this._lineMovement = new LineMovement(this._textView, this._markdownRenderer);
        
        // Setup bullet list keyboard handlers
        this._bulletHandlers = new BulletHandlers(this._textView, this._markdownRenderer, this._lineMovement);
        this._bulletHandlers.setup();
        
        // Setup TODO box double-click handler
        this._todoHandlers = new TodoHandlers(this._textView, this._markdownRenderer);
        this._todoHandlers.setup();
        
        // Setup link Ctrl+click handler
        this._linkHandlers = new LinkHandlers(this._textView, this._markdownRenderer, this);
        this._linkHandlers.setup();

        // Wrap in ScrolledWindow for scrolling
        const scrolledWindow = new Gtk.ScrolledWindow({
            child: this._textView,
            vexpand: true,
            hexpand: true,
        });

        // Make bottom margin viewport-aware
        const updateBottomMargin = () => {
            const height = scrolledWindow.get_height();
            if (height > 0) {
                // Set bottom margin to viewport height minus a small buffer
                this._textView.bottom_margin = Math.max(height - 40, 100);
            }
        };
        
        // Monitor vadjustment to detect viewport changes
        scrolledWindow.connect('notify::vadjustment', updateBottomMargin);
        
        // Also watch for when vadjustment properties change
        const vadj = scrolledWindow.get_vadjustment();
        if (vadj) {
            vadj.connect('changed', updateBottomMargin);
            vadj.connect('notify::page-size', updateBottomMargin);
        }
        
        // Initial update after a short delay to ensure window is sized
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
            updateBottomMargin();
            return false;
        });
        
        return scrolledWindow;
    }

    _createButtonBox() {
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
        });

        const openButton = new Gtk.Button({
            label: 'Open',
        });
        openButton.add_css_class('jot-open-button');
        openButton.connect('clicked', () => this._handleOpenFile());

        const cancelButton = new Gtk.Button({ label: 'Cancel' });
        cancelButton.add_css_class('jot-button');
        cancelButton.connect('clicked', () => this.close());

        const saveButton = new Gtk.Button({ label: 'Save' });
        saveButton.add_css_class('jot-button');
        saveButton.add_css_class('jot-button-save');
        
        // Add gesture click controller to detect Alt+click
        const gesture = new Gtk.GestureClick();
        gesture.connect('pressed', (gesture, n_press, x, y) => {
            const event = gesture.get_current_event();
            const state = event.get_modifier_state();
            
            if (state & Constants.ALT_MASK) {
                // Alt+click: show Save As dialog
                this._showSaveAsDialog();
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            } else {
                // Normal click: regular save
                this._saveNote();
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            }
        });
        saveButton.add_controller(gesture);

        buttonBox.append(openButton);
        buttonBox.append(cancelButton);
        buttonBox.append(saveButton);

        return buttonBox;
    }

    _setupTheme() {
        this._applyCSS();
        this._themeManager.setupMonitor(() => {
            this._reloadTheme();
        });
        
        // Also monitor GTK theme changes from the system
        const gtkSettings = Gtk.Settings.get_default();
        if (gtkSettings) {
            let reloadTimeout = null;
            
            // Monitor when GTK theme name changes
            gtkSettings.connect('notify::gtk-theme-name', () => {
                if (reloadTimeout) GLib.source_remove(reloadTimeout);
                reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._reloadTheme();
                    reloadTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            });
            
            // Monitor dark mode preference changes
            gtkSettings.connect('notify::gtk-application-prefer-dark-theme', () => {
                if (reloadTimeout) GLib.source_remove(reloadTimeout);
                reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._reloadTheme();
                    reloadTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            });
            
        }
    }
    
    _reloadTheme() {
        // Reload colors from file
        const oldBackground = this._themeManager.colors.background;
        this._themeManager.colors = this._themeManager._loadColors();
        const newBackground = this._themeManager.colors.background;
        // Apply new CSS
        this._applyCSS();
        // Force a full redraw
        this.queue_draw();
        if (this._textView) {
            this._textView.queue_draw();
        }
    }
    
    _setupSettings() {
        // Setup settings file monitor
        this._settingsManager.setupMonitor(() => {
            this._applySettings();
        });
    }
    
    _getDefaultMoodsStatic() {
        return {
            metal: { colors: ['#4A5568', '#CBD5E0'] },
            cobalt: { colors: ['#1B4BC7', '#B7329E', '#C7A27E'] },
            fire: { colors: ['#FF4500', '#FFD700'] },
            forest: { colors: ['#228B22', '#90EE90'] },
            lava: { colors: ['#8B0000', '#FF4500'] },
            mint: { colors: ['#00C9A7', '#C7FFED'] },
            amber: { colors: ['#FF8C00', '#FFE4B5'] },
            ocean: { colors: ['#006994', '#63B8FF'] },
            solar: { colors: ['#FF6E3D', '#9C6ADE', '#A0E0C4'] },
            cryo: { colors: ['#8DF6F7', '#FF3A20', '#737E7D'] },
            stone: { colors: ['#708090', '#B0B8C0'] },
            ice: { colors: ['#00CED1', '#E0FFFF'] },
            purple: { colors: ['#6A0DAD', '#DA70D6'] },
            sunset: { colors: ['#FF6B6B', '#FFA07A'] },
            royal: { colors: ['#4169E1', '#B0C4DE'] },
            aurora: { colors: ['#08F7FE', '#FF477E', '#35012C'] },
            sunken: { colors: ['#4E9A8A', '#C97B28', '#1C2431'] },
            ghost: { colors: ['#B9F3E4', '#8B4970', '#5C4B3A'] },
            sulfur: { colors: ['#E5D300', '#2A2A2A', '#3D2B6D'] },
            velvet: { colors: ['#C8FF00', '#3F0038', '#A77D62'] },
            cicada: { colors: ['#C6B89E', '#73663F', '#7FD4D9'] },
            lunar: { colors: ['#C1440E', '#D6D0C8', '#193B69'] },
            tonic: { colors: ['#A1C349', '#A65A52', '#4E5861'] },
            ectoplasm: { colors: ['#8FF7A7', '#FF8F8F', '#4D4F59'] },
            polar: { colors: ['#CFE9F1', '#FF5A1F', '#442C23'] },
            chiaroscuro: { colors: ['#005466', '#D8785F', '#A58CA0'] },
            vanta: { colors: ['#0A0A0A', '#00FFD1', '#FF2F92'] },
            toxicvelvet: { colors: ['#C0FF04', '#5D001E', '#C49B66'] },
            bruise: { colors: ['#3E8E9D', '#472F62', '#F6B48F'] },
            bismuth: { colors: ['#F15BB5', '#333333', '#3E9EFF'] },
            ultralich: { colors: ['#58FF8C', '#4400A1', '#E7DEC2'] },
            paradox: { colors: ['#FF9C82', '#1D1A1A', '#D0FF45'] },
            hazmat: { colors: ['#F3FF00', '#EB3AC5', '#0B3B4F'] },
            feral: { colors: ['#FF9D00', '#36006C', '#6C775C'] },
        };
    }
    
    _getMoodConfig() {
        // Build mood configuration from settings
        const defaultMoods = this._getDefaultMoodsStatic();
        const headerMoods = this._settingsManager.get('headerMoods') || Object.keys(defaultMoods);
        const customMoods = this._settingsManager.get('customMoods') || {};
        
        // Filter out example/comment entries from customMoods
        const filteredCustomMoods = {};
        for (const [key, value] of Object.entries(customMoods)) {
            if (!key.startsWith('_') && Array.isArray(value)) {
                filteredCustomMoods[key] = { colors: value };
            }
        }
        
        // Merge default moods with custom moods
        const allMoods = Object.assign({}, defaultMoods, filteredCustomMoods);
        
        // Filter to only include moods listed in headerMoods
        const moodConfig = {};
        for (const moodName of headerMoods) {
            if (allMoods[moodName]) {
                moodConfig[moodName] = allMoods[moodName];
            }
        }
        
        return moodConfig;
    }
    
    _applySettings() {
        // Reload settings and apply to renderer
        if (this._markdownRenderer) {
            const moodConfig = this._getMoodConfig();
            this.moodConfig = moodConfig;
            
            // Update moods and force a complete re-render with cursor context
            this._markdownRenderer.moodConfig = moodConfig;
            this._markdownRenderer._initTags();
            this._markdownRenderer._updateSyntaxVisibility();
        }
        // Can add more settings application here (fontSize, fontFamily, etc.)
    }

    _applyCSS() {
        // Remove old CSS provider if it exists
        if (this._cssProvider) {
            Gtk.StyleContext.remove_provider_for_display(
                this.get_display(),
                this._cssProvider
            );
        }
        
        // Create and apply new CSS provider
        this._cssProvider = new Gtk.CssProvider();
        const css = this._themeManager.generateCSS(this._zoomLevel);
        this._cssProvider.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            this.get_display(),
            this._cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1  // Higher priority to override system theme
        );
        
        // Update markdown renderer colors
        if (this._markdownRenderer) {
            this._markdownRenderer.updateColors(this._themeManager.colors);
        }
    }

    _showSearch() {
        this._searchBarComponent.show();
    }
    
    _hideSearch() {
        this._searchBarComponent.hide();
    }
    
    _performSearch() {
        this._searchBarComponent.performSearch();
    }
    
    _findNext() {
        this._searchBarComponent.findNext();
    }
    
    _findPrevious() {
        this._searchBarComponent.findPrevious();
    }
    
    _findNextKeepFocus() {
        this._searchBarComponent.findNextKeepFocus();
    }
    
    _findPreviousKeepFocus() {
        this._searchBarComponent.findPreviousKeepFocus();
    }
    
    _highlightCurrentMatch(grabFocus = false) {
        this._searchBarComponent.highlightCurrentMatch(grabFocus);
    }
    
    _clearSearchHighlights() {
        this._searchBarComponent.clearHighlights();
    }

    _setupKeyboardShortcuts() {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            // Ctrl+F: Show search
            if (keyval === Constants.KEY_F && (state & Constants.CTRL_MASK)) {
                this._showSearch();
                return true;
            }
            // Escape: Hide search (if search is active)
            if (keyval === Constants.KEY_ESCAPE && this._searchBar.get_search_mode()) {
                this._hideSearch();
                return true;
            }
            // Ctrl+G or F3: Find next
            if ((keyval === Constants.KEY_G && (state & Constants.CTRL_MASK) && !(state & Constants.SHIFT_MASK)) || keyval === 65470) {
                if (this._searchBar.get_search_mode()) {
                    this._findNext();
                    return true;
                }
            }
            // Ctrl+Shift+G or Shift+F3: Find previous
            if ((keyval === Constants.KEY_G && (state & Constants.CTRL_MASK) && (state & Constants.SHIFT_MASK)) || (keyval === 65470 && (state & Constants.SHIFT_MASK))) {
                if (this._searchBar.get_search_mode()) {
                    this._findPrevious();
                    return true;
                }
            }
            if ((keyval === Constants.KEY_ENTER || keyval === Constants.KEY_S) && (state & Constants.CTRL_MASK) && !(state & Constants.SHIFT_MASK)) {
                this._saveNote();
                return true;
            }
            if ((keyval === Constants.KEY_S_UPPER || keyval === Constants.KEY_S) && (state & Constants.CTRL_MASK) && (state & Constants.SHIFT_MASK)) {
                this._showSaveAsDialog();
                return true;
            }
            if (keyval === Constants.KEY_N && (state & Constants.CTRL_MASK)) {
                this._handleNewFile();
                return true;
            }
            if (keyval === Constants.KEY_O && (state & Constants.CTRL_MASK)) {
                this._handleOpenFile();
                return true;
            }
            // Zoom in: Ctrl + or Ctrl = (multiple keycodes for compatibility)
            if ((keyval === Constants.KEY_PLUS || keyval === 43 || keyval === 61 || keyval === 65451 || keyval === 65455) && (state & Constants.CTRL_MASK)) {
                this._zoomIn();
                return true;
            }
            // Zoom out: Ctrl - (multiple keycodes for compatibility)
            if ((keyval === Constants.KEY_MINUS || keyval === 45 || keyval === 95 || keyval === 65109 || keyval === 65453) && (state & Constants.CTRL_MASK)) {
                this._zoomOut();
                return true;
            }
            // Reset zoom: Ctrl 0
            if (keyval === Constants.KEY_0 && (state & Constants.CTRL_MASK)) {
                this._zoomReset();
                return true;
            }
            // Move line up: Ctrl+Up
            if (keyval === Constants.KEY_UP && (state & Constants.CTRL_MASK)) {
                this._moveLineUp();
                return true;
            }
            // Move line down: Ctrl+Down
            if (keyval === Constants.KEY_DOWN && (state & Constants.CTRL_MASK)) {
                this._moveLineDown();
                return true;
            }
            return false;
        });
        this.add_controller(keyController);
    }

    _setupCloseHandler() {
        this.connect('close-request', () => {
            if (this._hasUnsavedChanges) {
                this._showUnsavedChangesDialog(() => {
                    // User chose to discard, proceed with close
                    this.destroy();
                }, () => {
                    // User chose to save
                    this._saveNote();
                    // Close after save completes
                    this.destroy();
                });
                return true; // Prevent close
            }
            return false; // Allow close
        });
    }

    _showUnsavedChangesDialog(onDiscard, onSave) {
        const dialog = new Adw.AlertDialog({
            heading: 'Unsaved Changes',
            body: 'You have unsaved changes. Do you want to save before closing?',
        });

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('discard', 'Discard');
        dialog.add_response('save', 'Save');

        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

        dialog.set_default_response('save');
        dialog.set_close_response('cancel');

        dialog.connect('response', (dialog, response) => {
            if (response === 'discard' && onDiscard) {
                onDiscard();
            } else if (response === 'save' && onSave) {
                onSave();
            }
            // If cancel, do nothing
        });

        dialog.present(this);
    }

    _extractTitleFromContent() {
            const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const content = buffer.get_text(start, end, false);
        
        // Look for first H1 header
        const lines = content.split('\n');
        for (const line of lines) {
            const headerMatch = line.match(/^#\s+(.+)$/);
            if (headerMatch) {
                return headerMatch[1].trim();
            }
        }
        
        return '';
    }

    _updateFilenameDisplay() {
        // If a file is already opened, update the label but don't change filename
        if (this._currentFilePath) {
            const prefix = this._hasUnsavedChanges ? '● ' : '';
            this._pathLabel.set_label(prefix + this._currentFilePath);
            this._pathLabel.set_tooltip_text(this._hasUnsavedChanges ? 'File not saved' : this._currentFilePath);
            return;
        }

        const title = this._extractTitleFromContent();
        this._currentFilename = FileManager.generateFilename(title);

        const jotDir = FileManager.getJotDirectory(this._settingsManager);
        const fullPath = GLib.build_filenamev([jotDir, this._currentFilename]);
        const prefix = this._hasUnsavedChanges ? '● ' : '';
        this._pathLabel.set_label(prefix + fullPath);
        this._pathLabel.set_tooltip_text(this._hasUnsavedChanges ? 'File not saved' : fullPath);
    }

    _loadExistingDefaultNote() {
        try {
            FileManager.ensureJotDirectoryExists();
            const jotDir = FileManager.getJotDirectory();
            const now = GLib.DateTime.new_now_local();
            const todayDate = now.format('%Y-%m-%d');
            const targetFilename = FileManager.generateFilename(todayDate);
            const targetPath = GLib.build_filenamev([jotDir, targetFilename]);
            const file = Gio.File.new_for_path(targetPath);

            if (file.query_exists(null)) {
                this.loadFile(file);
                return true;
            }
        } catch (e) {
            print(`Error loading default note: ${e.message}`);
        }

        return false;
    }

    _handleNewFile() {
        if (this._hasUnsavedChanges) {
            this._showUnsavedChangesDialog(() => {
                // User chose to discard
                this._newFile();
            }, () => {
                // User chose to save
                this._saveNote();
                // Create new file after save
                this._newFile();
            });
        } else {
            this._newFile();
        }
    }

    _handleOpenFile() {
        if (this._hasUnsavedChanges) {
            this._showUnsavedChangesDialog(() => {
                // User chose to discard
                this._openFileDialog();
            }, () => {
                // User chose to save
                this._saveNote();
                // Open file dialog after save
                this._openFileDialog();
            });
        } else {
            this._openFileDialog();
        }
    }

    _newFile() {
        // Clear the current file path to start fresh
        this._currentFilePath = null;
        this._currentFilename = 'untitled.md';
        
        // Set buffer with default header (today's date)
        const buffer = this._textView.get_buffer();
        const now = GLib.DateTime.new_now_local();
        const todayDate = now.format('%Y-%m-%d');
        const initialText = `# ${todayDate}`;
        buffer.set_text(initialText, -1);
        
        // Reset saved content tracking
        this._savedContent = initialText;
        this._hasUnsavedChanges = false;
        
        // Position cursor at the end
        const iter = buffer.get_iter_at_offset(initialText.length);
        buffer.place_cursor(iter);
        
        // Update filename display and focus
        this._updateFilenameDisplay();
        this._textView.grab_focus();
    }

    _saveNote() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const content = buffer.get_text(start, end, false);

        if (!content.trim()) {
            this._showFeedback('⚠ Nothing to save');
            return;
        }
        
        // If file exists, just save directly
        if (this._currentFilePath) {
            const file = Gio.File.new_for_path(this._currentFilePath);
            this._saveToFile(file, content);
            return;
        }
        
        // Show "Save As" dialog for new files
        this._showSaveAsDialog(content);
    }
    
    _showSaveAsDialog(content) {
        // Get content from buffer if not provided
        if (!content) {
            const buffer = this._textView.get_buffer();
            const [start, end] = buffer.get_bounds();
            content = buffer.get_text(start, end, false);
        }
        
        if (!content.trim()) {
            this._showFeedback('⚠ Nothing to save');
            return;
        }
        
        const title = this._extractTitleFromContent();
        
        // Create file save dialog using FileChooserNative
        const dialog = new Gtk.FileChooserNative({
            title: 'Save File',
            action: Gtk.FileChooserAction.SAVE,
            transient_for: this,
            modal: true,
        });
        
        // Set up file filter for text files
        const filter = new Gtk.FileFilter();
        Constants.FILE_PATTERNS.forEach(pattern => filter.add_pattern(pattern));
        filter.set_name(Constants.FILE_FILTER_NAME);
        dialog.add_filter(filter);
        
        // Set initial folder to Jotite directory
        FileManager.ensureJotDirectoryExists(this._settingsManager);
        const jotDir = FileManager.getJotDirectory(this._settingsManager);
        dialog.set_current_folder(Gio.File.new_for_path(jotDir));
        
        // Suggest a filename
        const suggestedFilename = this._currentFilename || FileManager.generateFilename(title);
        dialog.set_current_name(suggestedFilename);
        
        // Show the save dialog
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dialog.get_file();
                if (file) {
                    this._saveToFile(file, content);
                }
            }
            dialog.destroy();
        });
        
        dialog.show();
    }
    
    _saveToFile(file, content) {
        try {
            // Save content as-is (it already contains the markdown with header)
            const outputStream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            outputStream.write_all(content, null);
            outputStream.close(null);
            
            // Update current file info
            this._currentFilePath = file.get_path();
            this._currentFilename = file.get_basename();
            this._savedContent = content;
            this._hasUnsavedChanges = false;
            this._pathLabel.set_label(this._currentFilePath);
            
            this._showFeedback(`✓ Saved: ${this._currentFilename}`);
        } catch (e) {
            print(`Error writing file: ${e.message}`);
            this._showFeedback(`✗ Error: ${e.message}`);
        }
    }

    _showFeedback(message) {
        // Cancel any pending zoom timeout
        if (this._zoomTimeoutId) {
            GLib.source_remove(this._zoomTimeoutId);
            this._zoomTimeoutId = null;
        }
        
        this._pathLabel.set_label(message);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, Constants.FEEDBACK_TIMEOUT_MS, () => {
            // Restore to actual path, not captured label
            const actualPath = this._currentFilePath || 
                               GLib.build_filenamev([FileManager.getJotDirectory(this._settingsManager), this._currentFilename]);
            this._pathLabel.set_label(actualPath);
            return false;
        });
    }

    _zoomIn() {
        this._zoomLevel = Math.min(this._zoomLevel + 10, 300); // Max 300%
        this._applyCSS();
        // Trigger markdown re-render to update styling after zoom
        if (this._markdownRenderer) {
            this._markdownRenderer._updateSyntaxVisibility();
        }
        this._showZoomLevel();
    }

    _zoomOut() {
        this._zoomLevel = Math.max(this._zoomLevel - 10, 50); // Min 50%
        this._applyCSS();
        // Trigger markdown re-render to update styling after zoom
        if (this._markdownRenderer) {
            this._markdownRenderer._updateSyntaxVisibility();
        }
        this._showZoomLevel();
    }

    _zoomReset() {
        this._zoomLevel = 100;
        this._applyCSS();
        // Trigger markdown re-render to update styling after zoom
        if (this._markdownRenderer) {
            this._markdownRenderer._updateSyntaxVisibility();
        }
        this._showZoomLevel();
    }

    _showZoomLevel() {
        // Cancel any existing zoom timeout
        if (this._zoomTimeoutId) {
            GLib.source_remove(this._zoomTimeoutId);
            this._zoomTimeoutId = null;
        }
        
        // Show zoom level
        this._pathLabel.set_label(`Zoom: ${this._zoomLevel}%`);

        // Set timeout to restore the actual path
        this._zoomTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            // Get the actual current path to restore
            const actualPath = this._currentFilePath || 
                               GLib.build_filenamev([FileManager.getJotDirectory(this._settingsManager), this._currentFilename]);
            this._pathLabel.set_label(actualPath);
            this._zoomTimeoutId = null;
            return false;
        });
    }

    _moveLineUp() {
        this._lineMovement.moveLineUp();
    }

    _moveLineDown() {
        this._lineMovement.moveLineDown();
    }
    _openFileDialog() {
        const dialog = new Gtk.FileDialog();

        const filter = new Gtk.FileFilter();
        Constants.FILE_PATTERNS.forEach(pattern => filter.add_pattern(pattern));
        filter.set_name(Constants.FILE_FILTER_NAME);

        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);
        dialog.set_filters(filters);

        const jotDir = FileManager.getJotDirectory(this._settingsManager);
        const jotFile = Gio.File.new_for_path(jotDir);
        dialog.set_initial_folder(jotFile);

        dialog.open(this, null, (source, result) => {
            try {
                const file = dialog.open_finish(result);
                if (file) {
                    this.loadFile(file);
                }
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                    const errorMsg = e.message || String(e);
                    print(`Error opening file: ${errorMsg}`);
                }
            }
        });
    }

    loadFile(file) {
        try {
            const [success, contents] = file.load_contents(null);
            if (!success) {
                throw new Error('Failed to load file');
            }

            const text = new TextDecoder().decode(contents);
            const buffer = this._textView.get_buffer();
            buffer.set_text(text, -1);

            this._currentFilename = file.get_basename();
            this._currentFilePath = file.get_path();
            this._savedContent = text;
            this._hasUnsavedChanges = false;
            this._pathLabel.set_label(this._currentFilePath);

        } catch (e) {
            const errorMsg = e.message || String(e);
            print(`Error loading file: ${errorMsg}`);
        }
    }

    _openSettings() {
        try {
            const configDir = this._settingsManager._ensureConfigDirectory();
            const settingsPath = GLib.build_filenamev([configDir, 'settings.json']);
            const settingsFile = Gio.File.new_for_path(settingsPath);
            
            // Create default settings file if it doesn't exist
            if (!settingsFile.query_exists(null)) {
                const defaultSettings = JSON.stringify({
                    _comment: "Jotite Settings - Changes to this file are applied immediately",
                    theme: 'default',
                    fontSize: 15,
                    fontFamily: 'monospace',
                    autoSave: false,
                    headerMoods: [
                        "metal", "cobalt", "fire", "forest", "lava", "mint",
                        "amber", "ocean", "solar", "cryo", "stone", "ice",
                        "purple", "sunset", "royal", "aurora", "sunken", "ghost",
                        "sulfur", "velvet", "cicada", "lunar", "tonic", "ectoplasm",
                        "polar", "chiaroscuro", "vanta", "toxicvelvet", "bruise",
                        "bismuth", "ultralich", "paradox", "hazmat", "feral"
                    ],
                    _headerMoodsComment: "Header moods determine the color gradient for each heading level. # uses the first mood, ## uses the second, etc. Reorder this array to customize which colors appear for each heading level.",
                    customMoods: {
                        _example: "Add your own custom mood gradients here. Example format below:",
                        _exampleMood: ["#FF0000", "#00FF00", "#0000FF"]
                    },
                    _customMoodsComment: "Custom moods can have any number of colors for the gradient (1 or more). Add them here and reference them in headerMoods array."
                }, null, 2);
                
                settingsFile.replace_contents(defaultSettings, null, false, 
                    Gio.FileCreateFlags.NONE, null);
            }
            
            // Open in a new window
            this.application.vfunc_open([settingsFile], '');
        } catch (e) {
            print(`Error opening settings: ${e.message}`);
            this._showFeedback(`✗ Error opening settings: ${e.message}`);
        }
    }

    _openFAQ() {
        try {
            const configDir = this._settingsManager._ensureConfigDirectory();
            const faqPath = GLib.build_filenamev([configDir, 'FAQ.md']);
            const faqFile = Gio.File.new_for_path(faqPath);
            
            // Create default FAQ file if it doesn't exist
            if (!faqFile.query_exists(null)) {
                const defaultFAQ = `# Jotite FAQ

## What is Jotite?

Jotite is a minimalist markdown note-taking application with live rendering.

## Keyboard Shortcuts

- **Ctrl+S** or **Ctrl+Enter**: Save note
- **Ctrl+Shift+S**: Save As
- **Ctrl+N**: New note
- **Ctrl+O**: Open note
- **Ctrl+F**: Find/Search
- **Ctrl+G** or **F3**: Find next
- **Ctrl+Shift+G** or **Shift+F3**: Find previous
- **Escape**: Close search
- **Ctrl+Plus**: Zoom in
- **Ctrl+Minus**: Zoom out
- **Ctrl+0**: Reset zoom
- **Ctrl+X**: Cut line (when no selection)
- **Ctrl+Up/Down**: Move line up/down
- **Tab**: Indent bullet point
- **Shift+Tab**: Outdent bullet point

## Markdown Syntax

- **Headers**: # H1, ## H2, ### H3, etc.
- **Bold**: **text** or __text__
- **Italic**: *text* or _text_
- **Code**: \`code\`
- **Code block**: \`\`\`code\`\`\`
- **Strikethrough**: ~~text~~
- **Underline**: ++text++
- **Links**: [text](url)
- **Bullets**: - item or * item
- **Todos**: [ ] unchecked or [X] checked

## Where are my notes saved?

By default, notes are saved in: ~/Documents/Jotite/

You can change this location by editing the settings.json file (click the ⚙ icon) and modifying the "notesPath" setting.

## How do I customize the theme?

Jotite follows the Alacritty theme at: ~/.config/omarchy/current/theme/alacritty.toml

## Questions?

Edit this FAQ.md file to add your own questions and answers!
`;
                
                faqFile.replace_contents(defaultFAQ, null, false, 
                    Gio.FileCreateFlags.NONE, null);
            }
            
            // Open in a new window
            this.application.vfunc_open([faqFile], '');
        } catch (e) {
            print(`Error opening FAQ: ${e.message}`);
            this._showFeedback(`✗ Error opening FAQ: ${e.message}`);
        }
    }

    _openFileLocation() {
        try {
            let fileToShow = null;
            
            if (this._currentFilePath) {
                // If file is saved, show it in the file browser
                fileToShow = this._currentFilePath;
            } else {
                // If not saved, show the Jotite directory
                fileToShow = FileManager.getJotDirectory(this._settingsManager);
            }
            
            // Try to open with file manager showing the file selected
            // First try using dbus to call the file manager with ShowItems
            try {
                const file = Gio.File.new_for_path(fileToShow);
                const uri = file.get_uri();
                
                // Try org.freedesktop.FileManager1 interface (works with most file managers)
                GLib.spawn_command_line_async(`dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 --type=method_call /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems array:string:"${uri}" string:""`);
            } catch (e) {
                // Fallback: just open the parent directory
                print(`DBus method failed, using fallback: ${e.message}`);
                const file = Gio.File.new_for_path(fileToShow);
                let dirToOpen;
                
                if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
                    dirToOpen = fileToShow;
                } else {
                    dirToOpen = GLib.path_get_dirname(fileToShow);
                }
                
                GLib.spawn_command_line_async(`xdg-open "${dirToOpen}"`);
            }
        } catch (e) {
            print(`Error opening file location: ${e.message}`);
            this._showFeedback(`✗ Error: ${e.message}`);
        }
    }
});
