const { Gtk, Gio, GLib, Adw, GObject, Gdk } = imports.gi;
const { Constants } = imports.constants;
const { SettingsManager } = imports.settings.settingsManager;
const { buildMoodConfig } = imports.settings.moods;
const { ThemeManager, ThemeCss } = imports.theme.themeManager;
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
const { MarkdownTextView } = imports.ui.markdownTextView;
const { FileManager } = imports.file.fileManager;
const { FileIO } = imports.file.fileIO;
const { Drafts } = imports.file.drafts;
const { SearchBarComponent } = imports.ui.searchBar;
const { BulletHandlers } = imports.ui.bulletHandlers;
const { TodoHandlers } = imports.ui.todoHandlers;
const { LinkHandlers } = imports.ui.linkHandlers;
const { LineMovement } = imports.ui.lineMovement;
const { StatusBarComponent } = imports.ui.statusBar;

const BASE_FONT_PX = 15;
const AUTOSAVE_DELAY_MS = 1500;
const DRAFT_DELAY_MS = 1500;
const LABEL_DELAY_MS = 200;
const EXTERNAL_CHANGE_DELAY_MS = 250;
const TITLE_SCAN_LINES = 200;

const MODS = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK | Gdk.ModifierType.ALT_MASK;

let _windowSerial = 0;

// ============================================================================
// Main Window
// ============================================================================
//
// Document state:
//   _file / _etag / _format   the file the buffer is bound to (null = untitled),
//                             its etag at the last load/save and its on-disk
//                             format (BOM, line ending)
//   buffer.get_modified()     dirty flag (cleared on load/save; undo back to the
//                             saved state clears it too)
// Saving is promise based: save()/confirmClose() resolve true only after the
// text is safely on disk (or the user chose to discard), so close/quit/new/
// open only continue when nothing would be lost.

var JotWindow = GObject.registerClass(
class JotWindow extends Adw.ApplicationWindow {
    // options: { file: Gio.File, draft: {id, text, modified} }
    _init(application, options = {}) {
        super._init({
            application,
            title: 'Jotite',
            default_width: 700,
            default_height: 500,
        });

        this._serial = ++_windowSerial;
        this.add_css_class('jot-window');
        this.add_css_class(`jot-win-${this._serial}`);

        this._sources = new Map();
        this._bufferHandlers = [];
        this._file = null;
        this._etag = null;
        this._format = { bom: false, eol: '\n' };
        this._suggestedName = 'untitled.md';
        this._zoomLevel = 100;
        this._zoomProvider = null;
        this._drafts = new Drafts();
        this._draftId = null;
        this._conflict = false;
        this._autosaveFailed = false;
        this._closeAllowed = false;
        this._busy = false;
        this._savePromise = null;
        this._resolvePromise = null;
        this._loading = false;
        this._monitorsReady = false;
        this._fileMonitor = null;
        this._destroyed = false;

        this._settingsManager = new SettingsManager();
        this._themeManager = new ThemeManager();

        this._buildUI();
        ThemeCss.acquire(this.get_display(), this._themeManager.generateCSS());

        this._setupKeyboardShortcuts();
        this.connect('close-request', () => this._onCloseRequest());
        this.connect('notify::is-active', () => {
            if (!this.is_active)
                this._flushPending();
        });
        this.connect('destroy', () => this._teardown());

        if (options.file)
            this._loadInitialFile(options.file);
        else if (options.draft)
            this.restoreDraft(options.draft);
        else
            this._loadTodayOrNew();

        if (this._settingsManager.error)
            this._statusBar.refresh();

        // Non-essential setup after the first frame
        this._addSource('setup', GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._sources.delete('setup');
            this._setupMonitors();
            return GLib.SOURCE_REMOVE;
        }));

        this._textView.grab_focus();
    }

    // ------------------------------------------------------------------
    // Source tracking
    // ------------------------------------------------------------------

    _addSource(key, id) {
        this._cancel(key);
        this._sources.set(key, id);
    }

    _timeout(key, ms, fn) {
        this._addSource(key, GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sources.delete(key);
            fn();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _cancel(key) {
        const id = this._sources.get(key);
        if (id) {
            GLib.source_remove(id);
            this._sources.delete(key);
        }
    }

    _pending(key) {
        return this._sources.has(key);
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    _buildUI() {
        const mainBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

        const textViewWidget = this._createTextView();

        this._searchBarComponent = new SearchBarComponent(this, this._textView, this._markdownRenderer,
            this._themeManager.colors);
        this._searchBar = this._searchBarComponent.create();

        this._conflictBanner = new Adw.Banner({ button_label: 'Reload', revealed: false });
        this._conflictBanner.connect('button-clicked', () => this._reloadFromDisk());

        this._statusBar = new StatusBarComponent({
            getState: () => this._statusState(),
            onPathClicked: () => this._openFileLocation(),
            onFaq: () => this._openFAQ(),
            onSettings: () => this._openSettings(),
        });
        const statusWidget = this._statusBar.create();
        this._pathLabel = this._statusBar.getLabel();

        mainBox.append(this._conflictBanner);
        mainBox.append(this._searchBar);
        mainBox.append(textViewWidget);
        mainBox.append(statusWidget);

        this._toastOverlay = new Adw.ToastOverlay({ child: mainBox });
        this.set_content(this._toastOverlay);
    }

    _createTextView() {
        this._textView = new MarkdownTextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            vexpand: true,
            hexpand: true,
            left_margin: 20,
            right_margin: 20,
            top_margin: 20,
            bottom_margin: 20,
        });
        this._textView.add_css_class('jot-textview');

        this._markdownRenderer = new MarkdownRenderer(
            this._textView,
            this._themeManager.colors,
            buildMoodConfig(this._settingsManager)
        );

        const buffer = this._textView.get_buffer();
        this._buffer = buffer;
        this._bufferHandlers.push(
            // After the default handler, which sets the modified flag
            buffer.connect_after('changed', () => this._onBufferChanged()),
            buffer.connect('modified-changed', () => this._statusBar?.refresh())
        );

        this._lineMovement = new LineMovement(this._textView, this._markdownRenderer);
        this._bulletHandlers = new BulletHandlers(this._textView, this._markdownRenderer, this._lineMovement);
        this._bulletHandlers.setup();
        this._todoHandlers = new TodoHandlers(this._textView, this._markdownRenderer);
        this._todoHandlers.setup();
        this._linkHandlers = new LinkHandlers(this._textView, this._markdownRenderer, this);
        this._linkHandlers.setup();

        const scrolledWindow = new Gtk.ScrolledWindow({
            child: this._textView,
            vexpand: true,
            hexpand: true,
        });

        // Bottom margin of roughly one viewport so the last line can scroll up
        const vadj = scrolledWindow.get_vadjustment();
        vadj.connect('notify::page-size', () => {
            const height = vadj.get_page_size();
            if (height > 0)
                this._textView.bottom_margin = Math.max(Math.round(height) - 40, 100);
        });

        return scrolledWindow;
    }

    _setupMonitors() {
        if (this._destroyed)
            return;
        this._monitorsReady = true;
        this._themeManager.setupMonitor(() => this._onThemeChanged());
        this._settingsManager.setupMonitor(() => this._applySettings());
        this._watchFile();
    }

    _onThemeChanged() {
        ThemeCss.apply(this.get_display(), this._themeManager.generateCSS());
        this._markdownRenderer.updateColors(this._themeManager.colors);
        this._searchBarComponent.updateColors(this._themeManager.colors);
    }

    _applySettings() {
        this._markdownRenderer.setMoodConfig(buildMoodConfig(this._settingsManager));
        if (!this._autosaveEnabled())
            this._cancel('autosave');
        this._updateSuggestedName();
        this._statusBar.refresh();
        if (this._settingsManager.error)
            this.showError(this._settingsManager.error);
    }

    _autosaveEnabled() {
        return this._settingsManager.get('autosave') !== false;
    }

    // ------------------------------------------------------------------
    // Status bar
    // ------------------------------------------------------------------

    _statusState() {
        const dirty = this._buffer.get_modified();
        if (this._settingsManager.error)
            return { warning: this._settingsManager.error, dirty };
        if (this._file) {
            const path = this._file.get_path() ?? this._file.get_uri();
            return { text: path, tooltip: dirty ? `${path} (unsaved changes)` : path, dirty };
        }
        const path = GLib.build_filenamev([FileManager.getJotDirectory(this._settingsManager), this._suggestedName]);
        return { text: path, tooltip: 'Not saved yet', dirty };
    }

    _flash(message, options) {
        this._statusBar.flash(message, options);
    }

    // Show an error to the user (toast + status bar), and log it.
    showError(message) {
        printerr(`Jotite: ${message}`);
        if (this._destroyed)
            return;
        this._toastOverlay.add_toast(new Adw.Toast({ title: message, timeout: 8, use_markup: false }));
        this._flash(`✗ ${message}`, { error: true, timeout: 8000 });
    }

    getFilePath() {
        return this._file ? this._file.get_path() : null;
    }

    get hasUnsavedChanges() {
        return this._buffer.get_modified();
    }

    // ------------------------------------------------------------------
    // Buffer change tracking: label, autosave, drafts
    // ------------------------------------------------------------------

    _onBufferChanged() {
        if (this._loading)
            return;
        if (!this._file)
            this._timeout('label', LABEL_DELAY_MS, () => {
                this._updateSuggestedName();
                this._statusBar.refresh();
            });
        if (!this._buffer.get_modified())
            return;
        if (this._file) {
            if (this._autosaveEnabled() && !this._conflict)
                this._timeout('autosave', AUTOSAVE_DELAY_MS, () => this._autosave());
        } else {
            this._timeout('draft', DRAFT_DELAY_MS, () => this._writeDraft());
        }
    }

    // Run pending autosave/draft writes now (focus loss, before closing).
    _flushPending() {
        if (this._pending('autosave')) {
            this._cancel('autosave');
            this._autosave();
        }
        if (this._pending('draft')) {
            this._cancel('draft');
            this._writeDraft();
        }
    }

    _autosave() {
        if (!this._file || !this._buffer.get_modified() || this._conflict ||
            this._savePromise || !this._autosaveEnabled())
            return;
        this._writeTo(this._file, { interactive: false }).catch(logError);
    }

    _writeDraft() {
        if (this._file || !this._buffer.get_modified() || this._destroyed)
            return;
        try {
            if (!this._draftId)
                this._draftId = this._drafts.newId();
            this._drafts.write(this._draftId, this._getText());
        } catch (e) {
            if (!this._draftErrorShown) {
                this._draftErrorShown = true;
                this.showError(`Could not write recovery draft: ${e.message}`);
            }
        }
    }

    _removeDraft() {
        this._cancel('draft');
        if (this._draftId) {
            this._drafts.remove(this._draftId);
            this._draftId = null;
        }
    }

    // Restore a recovery draft (from a crashed session) into this window as an
    // unsaved, untitled note.
    restoreDraft(draft) {
        this._newFile();
        this._loading = true;
        try {
            this._buffer.set_text(draft.text, -1);
        } finally {
            this._loading = false;
        }
        this._buffer.place_cursor(this._buffer.get_end_iter());
        this._buffer.set_modified(true);
        this._markdownRenderer.invalidateAll();
        // Re-own the draft under this process
        this._draftId = null;
        this._writeDraft();
        this._drafts.remove(draft.id);
        this._updateSuggestedName();
        const when = draft.modified ? draft.modified.to_local().format('%Y-%m-%d %H:%M') : 'a previous session';
        this._flash(`↺ Recovered unsaved note from ${when}`, { timeout: 8000 });
    }

    // ------------------------------------------------------------------
    // Titles / suggested filenames for untitled notes
    // ------------------------------------------------------------------

    // Full buffer text, including any text hidden by rendering tags
    _getText() {
        const [start, end] = this._buffer.get_bounds();
        return this._buffer.get_text(start, end, true);
    }

    // First "# Title" within the first lines, read line by line.
    _extractTitleFromContent() {
        const lines = Math.min(this._buffer.get_line_count(), TITLE_SCAN_LINES);
        for (let i = 0; i < lines; i++) {
            const [ok, start] = this._buffer.get_iter_at_line(i);
            if (!ok)
                break;
            const end = start.copy();
            if (!end.ends_line())
                end.forward_to_line_end();
            const m = this._buffer.get_text(start, end, true).match(/^#\s+(.+?)\s*#*\s*$/);
            if (m)
                return m[1].trim();
        }
        return '';
    }

    _updateSuggestedName() {
        if (!this._file)
            this._suggestedName = FileManager.generateFilename(this._extractTitleFromContent());
    }

    // ------------------------------------------------------------------
    // Keyboard
    // ------------------------------------------------------------------

    _setupKeyboardShortcuts() {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) =>
            this._onKeyPressed(Gdk.keyval_to_lower(keyval), state & MODS));
        this.add_controller(keyController);

        // Ctrl+Enter saves. GtkTextView consumes Ctrl+Return itself (inserts
        // a newline) before a bubble-phase window controller sees it, so
        // this one runs in the capture phase, ahead of the text view.
        const saveKeys = new Gtk.EventControllerKey();
        saveKeys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        saveKeys.connect('key-pressed', (controller, keyval, keycode, state) => {
            if ((state & MODS) !== Gdk.ModifierType.CONTROL_MASK)
                return false;
            if (keyval !== Gdk.KEY_Return && keyval !== Gdk.KEY_KP_Enter && keyval !== Gdk.KEY_ISO_Enter)
                return false;
            if (this.get_visible_dialog?.())
                return false;
            this.save().catch(logError);
            return true;
        });
        this.add_controller(saveKeys);
        this._saveKeyController = saveKeys;
    }

    _onKeyPressed(key, mods) {
        const CTRL = Gdk.ModifierType.CONTROL_MASK;
        const SHIFT = Gdk.ModifierType.SHIFT_MASK;
        const ctrl = mods === CTRL;
        const ctrlShift = mods === (CTRL | SHIFT);
        const search = this._searchBarComponent;

        if (key === Gdk.KEY_Escape && mods === 0) {
            if (this.get_visible_dialog?.())
                return false;
            if (search.isOpen())
                search.hide();
            else
                this.close();
            return true;
        }
        if (ctrl && key === Gdk.KEY_f) {
            search.show();
            return true;
        }
        if ((ctrlShift && key === Gdk.KEY_g) || (mods === SHIFT && key === Gdk.KEY_F3)) {
            if (search.isOpen()) {
                search.findPrevious();
                return true;
            }
            return false;
        }
        if ((ctrl && key === Gdk.KEY_g) || (mods === 0 && key === Gdk.KEY_F3)) {
            if (search.isOpen()) {
                search.findNext();
                return true;
            }
            return false;
        }
        if (ctrl && key === Gdk.KEY_s) {
            this.save().catch(logError);
            return true;
        }
        if (ctrlShift && key === Gdk.KEY_s) {
            this.save({ saveAs: true }).catch(logError);
            return true;
        }
        if (ctrl && key === Gdk.KEY_n) {
            this._exclusive(() => this._handleNewFile());
            return true;
        }
        if (ctrl && key === Gdk.KEY_o) {
            this._exclusive(() => this._handleOpenFile());
            return true;
        }
        if ((ctrl || ctrlShift) && (key === Gdk.KEY_plus || key === Gdk.KEY_equal || key === Gdk.KEY_KP_Add)) {
            this._setZoom(Math.min(this._zoomLevel + 10, 300));
            return true;
        }
        if ((ctrl || ctrlShift) && (key === Gdk.KEY_minus || key === Gdk.KEY_underscore || key === Gdk.KEY_KP_Subtract)) {
            this._setZoom(Math.max(this._zoomLevel - 10, 50));
            return true;
        }
        if (ctrl && (key === Gdk.KEY_0 || key === Gdk.KEY_KP_0)) {
            this._setZoom(100);
            return true;
        }
        return false;
    }

    // Run a dialog-driven action unless one is already running (prevents
    // e.g. two Open dialogs from Ctrl+O pressed twice).
    _exclusive(fn) {
        if (this._busy)
            return;
        this._busy = true;
        Promise.resolve().then(fn).catch(logError).finally(() => {
            this._busy = false;
        });
    }

    // ------------------------------------------------------------------
    // Zoom (per window)
    // ------------------------------------------------------------------

    _setZoom(level) {
        this._zoomLevel = level;
        const px = Math.round(BASE_FONT_PX * level) / 100;
        if (!this._zoomProvider) {
            this._zoomProvider = new Gtk.CssProvider();
            Gtk.StyleContext.add_provider_for_display(this.get_display(), this._zoomProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
        }
        this._zoomProvider.load_from_string(
            `window.jot-win-${this._serial} .jot-textview { font-size: ${px}px; }`);
        this._markdownRenderer.setZoom(px);
        this._flash(`Zoom: ${level}%`, { timeout: 1000 });
    }

    // ------------------------------------------------------------------
    // Dialogs
    // ------------------------------------------------------------------

    // Present an Adw.AlertDialog; resolves with the chosen response id.
    _ask({ heading, body, responses, defaultResponse, closeResponse = 'cancel', appearances = {} }) {
        return new Promise(resolve => {
            const dialog = new Adw.AlertDialog({ heading, body });
            for (const [id, label] of responses)
                dialog.add_response(id, label);
            for (const [id, appearance] of Object.entries(appearances))
                dialog.set_response_appearance(id, appearance);
            if (defaultResponse)
                dialog.set_default_response(defaultResponse);
            dialog.set_close_response(closeResponse);
            dialog.connect('response', (_d, response) => resolve(response));
            dialog.present(this);
        });
    }

    _displayName() {
        return this._file ? this._file.get_basename() : 'Untitled note';
    }

    // Make sure unsaved changes are saved or explicitly discarded before the
    // buffer goes away. Resolves true when it is safe to continue.
    _resolveUnsaved(purpose) {
        if (this._resolvePromise)
            return this._resolvePromise;
        this._resolvePromise = this._doResolveUnsaved(purpose).finally(() => {
            this._resolvePromise = null;
        });
        return this._resolvePromise;
    }

    async _doResolveUnsaved(purpose) {
        if (this._savePromise)
            await this._savePromise;
        if (!this._buffer.get_modified()) {
            this._removeDraft();
            return true;
        }
        // Files with a path are simply saved when autosave is on
        if (this._file && this._autosaveEnabled() && !this._conflict) {
            this._cancel('autosave');
            if (await this._writeTo(this._file, { interactive: true }))
                return true;
            if (!this._buffer.get_modified())
                return true;
        }
        this.present();
        const response = await this._ask({
            heading: 'Unsaved Changes',
            body: `Save changes to “${this._displayName()}” before ${purpose}?`,
            responses: [['cancel', 'Cancel'], ['discard', 'Discard'], ['save', 'Save']],
            defaultResponse: 'save',
            appearances: {
                discard: Adw.ResponseAppearance.DESTRUCTIVE,
                save: Adw.ResponseAppearance.SUGGESTED,
            },
        });
        if (response === 'save')
            return this.save();
        if (response === 'discard') {
            this._removeDraft();
            return true;
        }
        return false;
    }

    // Public: resolves true when the window may close without losing data.
    confirmClose() {
        return this._resolveUnsaved('closing');
    }

    // Close without prompting (after confirmClose resolved true).
    forceClose() {
        this._closeAllowed = true;
        this.close();
    }

    _onCloseRequest() {
        if (this._closeAllowed) {
            // GTK only disposes the window once JS drops its wrapper, so
            // release sources, monitors and providers right away.
            this._teardown();
            return false;
        }
        this.confirmClose().then(ok => {
            if (ok && !this._destroyed)
                this.forceClose();
        }).catch(logError);
        return true;
    }

    // ------------------------------------------------------------------
    // New / open / load
    // ------------------------------------------------------------------

    async _handleNewFile() {
        if (await this._resolveUnsaved('creating a new note'))
            this._newFile();
    }

    async _handleOpenFile() {
        if (!(await this._resolveUnsaved('opening another file')))
            return;
        const file = await this._chooseOpenFile();
        if (file)
            this.loadFile(file);
    }

    // Open a file in this window through the unsaved-changes guard (used for
    // Ctrl+click on local links).
    openFile(file) {
        this._exclusive(async () => {
            if (await this._resolveUnsaved('opening another file'))
                this.loadFile(file);
        });
    }

    _loadTodayOrNew() {
        const path = FileManager.todayNotePath(this._settingsManager);
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null) && this.loadFile(file))
            return;
        this._newFile();
    }

    _loadInitialFile(file) {
        if (!this.loadFile(file))
            this._newFile();
    }

    _newFile() {
        this._removeDraft();
        this._setFile(null, null);
        this._format = { bom: false, eol: '\n' };
        this._conflict = false;
        this._conflictBanner.set_revealed(false);

        const today = GLib.DateTime.new_now_local().format('%Y-%m-%d');
        this._loading = true;
        try {
            this._buffer.set_text(`# ${today}`, -1);
        } finally {
            this._loading = false;
        }
        this._buffer.set_modified(false);
        this._buffer.place_cursor(this._buffer.get_end_iter());
        this._markdownRenderer.invalidateAll();
        this._updateSuggestedName();
        this._statusBar.refresh();
        this._textView.grab_focus();
    }

    // Load file into the buffer without any unsaved-changes check. A missing
    // file gives an empty buffer bound to the path (created on first save).
    // Returns false (and shows the error) when the file cannot be opened.
    loadFile(file, { keepCursor = false } = {}) {
        let result;
        try {
            result = FileIO.readFile(file);
        } catch (e) {
            this.showError(`Cannot open ${file.get_path() ?? file.get_uri()}: ${FileIO.describeError(e)}`);
            return false;
        }

        let line = 0, lineOffset = 0;
        if (keepCursor) {
            const cursor = this._buffer.get_iter_at_mark(this._buffer.get_insert());
            line = cursor.get_line();
            lineOffset = cursor.get_line_offset();
        }

        this._cancel('autosave');
        this._removeDraft();
        this._loading = true;
        try {
            this._buffer.set_text(result.text, -1);
        } finally {
            this._loading = false;
        }
        this._buffer.set_modified(false);

        if (keepCursor) {
            const [, iter] = this._buffer.get_iter_at_line(Math.min(line, this._buffer.get_line_count() - 1));
            const max = iter.get_chars_in_line();
            iter.set_line_offset(Math.min(lineOffset, Math.max(0, iter.ends_line() ? max : max - 1)));
            this._buffer.place_cursor(iter);
        } else {
            this._buffer.place_cursor(this._buffer.get_start_iter());
        }

        this._format = result.format;
        this._setFile(file, result.etag);
        this._conflict = false;
        this._autosaveFailed = false;
        this._conflictBanner.set_revealed(false);
        this._markdownRenderer.invalidateAll();
        this._statusBar.refresh();
        if (!result.exists)
            this._flash('New file — it will be created when you save');
        if (keepCursor)
            this._textView.scroll_mark_onscreen(this._buffer.get_insert());
        return true;
    }

    _reloadFromDisk() {
        if (this._file && this.loadFile(this._file, { keepCursor: true }))
            this._flash('↻ Reloaded from disk');
    }

    _setFile(file, etag) {
        const changed = !(file && this._file && file.equal(this._file)) && (file || this._file);
        this._file = file;
        this._etag = etag;
        if (changed)
            this._watchFile();
    }

    // ------------------------------------------------------------------
    // External modification detection
    // ------------------------------------------------------------------

    _unwatchFile() {
        this._cancel('external');
        if (this._fileMonitor) {
            this._fileMonitor.disconnect(this._fileMonitorId);
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
    }

    _watchFile() {
        this._unwatchFile();
        if (!this._file || !this._monitorsReady || this._destroyed)
            return;
        try {
            this._fileMonitor = this._file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._fileMonitorId = this._fileMonitor.connect('changed', () =>
                this._timeout('external', EXTERNAL_CHANGE_DELAY_MS, () => this._checkExternalChange()));
        } catch (e) {
            logError(e, 'Jotite: cannot watch file');
        }
    }

    _checkExternalChange() {
        if (!this._file || this._savePromise)
            return;
        let etag;
        try {
            etag = FileIO.queryEtag(this._file);
        } catch (e) {
            return;
        }
        if (etag === this._etag)
            return;
        if (etag === null) {
            // Deleted or moved away; the next save recreates it
            this._etag = null;
            this._flash(`${this._file.get_basename()} was deleted on disk — save to recreate it`, { timeout: 6000 });
            return;
        }
        if (!this._buffer.get_modified()) {
            this._reloadFromDisk();
            return;
        }
        this._showConflict();
    }

    _showConflict() {
        this._conflict = true;
        this._cancel('autosave');
        this._conflictBanner.set_title(
            `“${this._file.get_basename()}” changed on disk. Autosave paused — Ctrl+S to overwrite, or reload.`);
        this._conflictBanner.set_revealed(true);
    }

    // ------------------------------------------------------------------
    // Saving
    // ------------------------------------------------------------------

    // Save (Save As for untitled notes or with saveAs). Resolves true only
    // after the text was written successfully; false on cancel or failure.
    save({ saveAs = false } = {}) {
        if (this._savePromise)
            return this._savePromise;
        this._savePromise = this._doSave(saveAs).finally(() => {
            this._savePromise = null;
        });
        return this._savePromise;
    }

    async _doSave(saveAs) {
        this._cancel('autosave');
        let file = this._file;
        if (saveAs || !file) {
            if (!file && !this._getText().trim()) {
                this._removeDraft();
                this._flash('⚠ Nothing to save');
                return true;
            }
            file = await this._chooseSaveFile();
            if (!file)
                return false;
        }
        return this._writeTo(file, { interactive: true });
    }

    // Write the buffer to file. interactive: ask on conflicts and report
    // success; otherwise (autosave) conflicts pause autosave silently.
    async _writeTo(file, { interactive, force = false }) {
        const sameFile = !!this._file && file.equal(this._file);
        const expectedEtag = sameFile && !force ? this._etag : null;
        try {
            const etag = FileIO.writeFile(file, this._getText(), this._format, expectedEtag);
            this._setFile(file, etag);
            this._buffer.set_modified(false);
            this._removeDraft();
            this._conflict = false;
            this._autosaveFailed = false;
            this._conflictBanner.set_revealed(false);
            if (interactive)
                this._flash(`✓ Saved: ${file.get_basename()}`);
            this._statusBar.refresh();
            return true;
        } catch (e) {
            if (FileIO.isWrongEtag(e)) {
                if (!interactive) {
                    this._showConflict();
                    return false;
                }
                const response = await this._ask({
                    heading: 'File Changed on Disk',
                    body: `“${file.get_basename()}” was modified by another program. Overwrite it with your version, or reload it and lose your changes?`,
                    responses: [['cancel', 'Cancel'], ['reload', 'Reload'], ['overwrite', 'Overwrite']],
                    defaultResponse: 'cancel',
                    appearances: {
                        reload: Adw.ResponseAppearance.DESTRUCTIVE,
                        overwrite: Adw.ResponseAppearance.DESTRUCTIVE,
                    },
                });
                if (response === 'overwrite')
                    return this._writeTo(file, { interactive, force: true });
                if (response === 'reload')
                    this._reloadFromDisk();
                return false;
            }
            if (interactive || !this._autosaveFailed)
                this.showError(`Could not save ${file.get_path()}: ${FileIO.describeError(e)}`);
            if (!interactive)
                this._autosaveFailed = true;
            return false;
        }
    }

    _fileFilters() {
        const filter = new Gtk.FileFilter();
        Constants.FILE_PATTERNS.forEach(pattern => filter.add_pattern(pattern));
        filter.set_name(Constants.FILE_FILTER_NAME);
        const all = new Gtk.FileFilter();
        all.add_pattern('*');
        all.set_name('All files');
        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);
        filters.append(all);
        return filters;
    }

    _chooseSaveFile() {
        const dialog = new Gtk.FileDialog({ title: 'Save Note', modal: true, filters: this._fileFilters() });
        if (this._file) {
            dialog.set_initial_file(this._file);
        } else {
            let dir;
            try {
                dir = FileManager.ensureJotDirectoryExists(this._settingsManager);
            } catch (e) {
                this.showError(`Cannot create notes folder: ${e.message}`);
                dir = GLib.get_home_dir();
            }
            this._updateSuggestedName();
            dialog.set_initial_folder(Gio.File.new_for_path(dir));
            dialog.set_initial_name(FileManager.uniqueFilename(dir, this._suggestedName));
        }
        return new Promise(resolve => {
            dialog.save(this, null, (d, result) => {
                try {
                    resolve(d.save_finish(result));
                } catch (e) {
                    if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        this.showError(`Save dialog failed: ${e.message}`);
                    resolve(null);
                }
            });
        });
    }

    _chooseOpenFile() {
        const dialog = new Gtk.FileDialog({ title: 'Open Note', modal: true, filters: this._fileFilters() });
        const dir = this._file ? this._file.get_parent() : Gio.File.new_for_path(FileManager.getJotDirectory(this._settingsManager));
        if (dir && dir.query_exists(null))
            dialog.set_initial_folder(dir);
        return new Promise(resolve => {
            dialog.open(this, null, (d, result) => {
                try {
                    resolve(d.open_finish(result));
                } catch (e) {
                    if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        this.showError(`Open dialog failed: ${e.message}`);
                    resolve(null);
                }
            });
        });
    }

    // ------------------------------------------------------------------
    // Settings / FAQ / file location
    // ------------------------------------------------------------------

    _openConfigFile(name) {
        try {
            const configDir = this._settingsManager._ensureConfigDirectory();
            const file = Gio.File.new_for_path(GLib.build_filenamev([configDir, name]));
            if (!file.query_exists(null))
                throw new Error(`${file.get_path()} does not exist`);
            this.application.open([file], '');
        } catch (e) {
            this.showError(`Cannot open ${name}: ${e.message}`);
        }
    }

    _openSettings() {
        this._openConfigFile('settings.json');
    }

    _openFAQ() {
        this._openConfigFile('FAQ.md');
    }

    _openFileLocation() {
        if (this._settingsManager.error) {
            this._openSettings();
            return;
        }
        const done = (launcher, result, method) => {
            try {
                launcher[method](result);
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this.showError(`Cannot open file manager: ${e.message}`);
            }
        };
        if (this._file && this._file.query_exists(null)) {
            new Gtk.FileLauncher({ file: this._file }).open_containing_folder(this, null,
                (l, r) => done(l, r, 'open_containing_folder_finish'));
            return;
        }
        const dir = this._file ? this._file.get_parent()
            : Gio.File.new_for_path(FileManager.getJotDirectory(this._settingsManager));
        if (!dir || !dir.query_exists(null)) {
            this._flash('The notes folder does not exist yet — it is created on first save');
            return;
        }
        new Gtk.FileLauncher({ file: dir }).launch(this, null, (l, r) => done(l, r, 'launch_finish'));
    }

    // ------------------------------------------------------------------
    // Teardown
    // ------------------------------------------------------------------

    _teardown() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const id of this._sources.values())
            GLib.source_remove(id);
        this._sources.clear();
        this._unwatchFile();
        for (const id of this._bufferHandlers)
            this._buffer.disconnect(id);
        this._bufferHandlers = [];
        this._linkHandlers.destroy();
        this._bulletHandlers.destroy();
        this._todoHandlers.destroy();
        this._searchBarComponent.destroy();
        this._markdownRenderer.destroy();
        this._statusBar.destroy();
        this._settingsManager.destroy();
        this._themeManager.destroy();
        const display = this.get_display();
        if (this._zoomProvider) {
            Gtk.StyleContext.remove_provider_for_display(display, this._zoomProvider);
            this._zoomProvider = null;
        }
        ThemeCss.release(display);
    }
});
