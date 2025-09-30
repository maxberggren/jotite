#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gtk, Gio, GLib, Adw, GObject } = imports.gi;

// Constants
const APP_ID = 'com.github.jot';
const JOT_DIR = 'Jot';
const THEME_PATH = ['.config', 'omarchy', 'current', 'theme', 'alacritty.toml'];
const FEEDBACK_TIMEOUT_MS = 3000;

// Keyboard constants
const KEY_ESCAPE = 65307;
const KEY_ENTER = 65293;
const KEY_S = 115;
const CTRL_MASK = 4;

// File patterns
const FILE_PATTERNS = ['*.md', '*.txt'];
const FILE_FILTER_NAME = 'Text files (*.md, *.txt)';

// ============================================================================
// Theme Manager
// ============================================================================

class ThemeManager {
    constructor() {
        this.colors = this._loadColors();
        this.monitor = null;
    }

    _getThemePath() {
        const homeDir = GLib.get_home_dir();
        return GLib.build_filenamev([homeDir, ...THEME_PATH]);
    }

    _loadColors() {
        try {
            const themePath = this._getThemePath();
            const file = Gio.File.new_for_path(themePath);
            const [success, contents] = file.load_contents(null);

            if (!success) {
                return this._getDefaultColors();
            }

            return this._parseTomlColors(new TextDecoder().decode(contents));
        } catch (e) {
            print(`Failed to load theme: ${e.message}`);
            return this._getDefaultColors();
        }
    }

    _parseTomlColors(text) {
        const colors = {};
        const lines = text.split('\n');
        let currentSection = '';

        for (const line of lines) {
            const sectionMatch = line.match(/^\[colors\.(\w+)\]/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                continue;
            }

            const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
            if (match && (currentSection === 'normal' || currentSection === 'primary')) {
                const [, key, value] = match;
                colors[key] = value;
            }
        }

        return {
            background: colors.background || '#0A0E1A',
            foreground: colors.foreground || '#a5bfd8',
            cursor: colors.cursor || '#a5bfd8',
            black: colors.black || '#0A0E1A',
            red: colors.red || '#B4445D',
            green: colors.green || '#335788',
            yellow: colors.yellow || '#384F97',
            blue: colors.blue || '#3A669B',
            magenta: colors.magenta || '#4A689C',
            cyan: colors.cyan || '#D55F8D',
            white: colors.white || '#a5bfd8',
        };
    }

    _getDefaultColors() {
        return {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#e6edf3',
            black: '#0d1117',
            red: '#ff7b72',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39c5cf',
            white: '#e6edf3',
        };
    }

    setupMonitor(callback) {
        try {
            const themePath = this._getThemePath();
            const file = Gio.File.new_for_path(themePath);
            this.monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this.monitor.connect('changed', () => {
                this.colors = this._loadColors();
                callback();
            });
        } catch (e) {
            print(`Failed to setup theme monitor: ${e.message}`);
        }
    }

    generateCSS() {
        const c = this.colors;
        return `
            window {
                background: ${c.black};
            }

            .jot-textview {
                background: ${c.black};
                color: ${c.white};
                font-size: 15px;
                caret-color: ${c.white};
            }

            .jot-textview text {
                background: ${c.black};
                color: ${c.white};
            }

            .jot-textview selection {
                background-color: ${c.blue};
                color: ${c.white};
            }

            .jot-button {
                padding: 4px 12px;
                border-radius: 0;
                border: 1px solid ${c.white};
                background: ${c.black};
                color: ${c.white};
                font-weight: 500;
                font-size: 11px;
            }

            .jot-button:hover {
                background: ${c.white};
                color: ${c.black};
            }

            .jot-button-save {
                background: ${c.green};
                border-color: ${c.green};
                color: ${c.black};
            }

            .jot-button-save:hover {
                background: ${c.blue};
                border-color: ${c.blue};
            }

            .jot-statusbar {
                border-top: 1px solid ${c.white};
                padding-top: 10px;
            }

            .status-label {
                color: ${c.white};
                font-size: 12px;
            }

            .jot-hash {
                color: ${c.white};
                font-size: 18px;
                font-weight: bold;
                margin-right: 8px;
            }

            .jot-title {
                background: transparent;
                border: none;
                color: ${c.white};
                font-size: 18px;
                font-weight: bold;
                padding: 0;
                box-shadow: none;
                outline: none;
            }

            .jot-title:focus {
                outline: none;
                box-shadow: none;
                border: none;
            }

            entry {
                outline: none;
                box-shadow: none;
            }

            entry:focus {
                outline: none;
                box-shadow: none;
                border: none;
            }

            .jot-open-button {
                padding: 2px 6px;
                border-radius: 7px;
                border: 1px solid ${c.white};
                background: ${c.black};
                color: ${c.white};
                font-weight: bold;
                font-size: 10px;
                margin-left: 12px;
            }

            .jot-open-button:hover {
                background: ${c.white};
                color: ${c.black};
            }
        `;
    }
}

// ============================================================================
// File Manager
// ============================================================================

class FileManager {
    static getJotDirectory() {
        const homeDir = GLib.get_home_dir();
        return GLib.build_filenamev([homeDir, JOT_DIR]);
    }

    static ensureJotDirectoryExists() {
        const jotDir = this.getJotDirectory();
        const jotDirFile = Gio.File.new_for_path(jotDir);

        try {
            jotDirFile.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                print(`Error creating directory: ${e.message}`);
                throw e;
            }
        }
    }

    static normalizeFilename(title) {
        let normalized = title.trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9-_]/g, '')
            .toLowerCase();

        if (normalized.length > 50) {
            normalized = normalized.substring(0, 50);
        }

        return normalized;
    }

    static generateFilename(title) {
        if (title) {
            const normalized = this.normalizeFilename(title);
            if (normalized) {
                return `${normalized}.md`;
            }
        }

        const now = GLib.DateTime.new_now_local();
        return `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
    }

    static saveNote(title, content) {
        this.ensureJotDirectoryExists();

        const filename = this.generateFilename(title);
        const filePath = GLib.build_filenamev([this.getJotDirectory(), filename]);
        const now = GLib.DateTime.new_now_local();
        const timestamp = now.format('%Y-%m-%d %H:%M:%S');

        let fileContent = '';
        if (title) {
            fileContent = `# ${title}\n\n`;
        }
        fileContent += `*Created: ${timestamp}*\n\n${content}\n`;

        const file = Gio.File.new_for_path(filePath);
        const outputStream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        outputStream.write_all(fileContent, null);
        outputStream.close(null);

        print(`Note saved to ${filePath}`);
        return filename;
    }

    static loadFile(file) {
        const [success, contents] = file.load_contents(null);
        if (!success) {
            throw new Error('Failed to load file');
        }

        const text = new TextDecoder().decode(contents);
        return this.parseFileContent(text, file);
    }

    static parseFileContent(text, file) {
        const lines = text.split('\n');
        let title = '';
        let contentStart = 0;

        // Check if first line is a markdown title
        if (lines[0]?.startsWith('# ')) {
            title = lines[0].substring(2).trim();
            contentStart = 1;

            // Skip empty lines after title
            while (contentStart < lines.length && !lines[contentStart].trim()) {
                contentStart++;
            }

            // Skip timestamp line if present
            if (lines[contentStart]?.startsWith('*Created:')) {
                contentStart++;
                while (contentStart < lines.length && !lines[contentStart].trim()) {
                    contentStart++;
                }
            }
        }

        return {
            title,
            content: lines.slice(contentStart).join('\n'),
            filePath: file.get_path(),
            filename: file.get_basename(),
        };
    }
}

// ============================================================================
// Application
// ============================================================================

const JotApplication = GObject.registerClass(
class JotApplication extends Adw.Application {
    _init() {
        super._init({
            application_id: APP_ID,
            flags: Gio.ApplicationFlags.HANDLES_OPEN,
        });
        this._fileToOpen = null;
    }

    vfunc_activate() {
        let window = this.active_window;
        if (!window) {
            window = new JotWindow(this);
        }

        if (this._fileToOpen) {
            window.loadFile(this._fileToOpen);
            this._fileToOpen = null;
        }

        window.present();
    }

    vfunc_open(files, hint) {
        if (files.length > 0) {
            this._fileToOpen = files[0];
        }
        this.activate();
    }
});

// ============================================================================
// Main Window
// ============================================================================

const JotWindow = GObject.registerClass(
class JotWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({
            application,
            title: 'Jot',
            default_width: 700,
            default_height: 500,
        });

        this._currentFilename = 'untitled.md';
        this._themeManager = new ThemeManager();

        this._buildUI();
        this._setupTheme();
        this._setupKeyboardShortcuts();

        this._titleEntry.grab_focus();
    }

    _buildUI() {
        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        mainBox.append(this._createTitleBar());
        mainBox.append(this._createTextView());
        mainBox.append(this._createStatusBar());

        this.set_content(mainBox);
    }

    _createTitleBar() {
        const titleBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
            margin_start: 20,
            margin_end: 20,
            margin_top: 20,
            margin_bottom: 0,
        });

        const hashLabel = new Gtk.Label({ label: '#', halign: Gtk.Align.START });
        hashLabel.add_css_class('jot-hash');

        this._titleEntry = new Gtk.Entry({
            placeholder_text: 'Title',
            hexpand: true,
        });
        this._titleEntry.add_css_class('jot-title');
        this._titleEntry.connect('changed', () => this._updateFilenameDisplay());

        const openButton = new Gtk.Button({
            label: '+',
            halign: Gtk.Align.END,
        });
        openButton.add_css_class('jot-open-button');
        openButton.connect('clicked', () => this._openFileDialog());

        titleBox.append(hashLabel);
        titleBox.append(this._titleEntry);
        titleBox.append(openButton);

        return titleBox;
    }

    _createTextView() {
        this._textView = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            vexpand: true,
            hexpand: true,
            left_margin: 20,
            right_margin: 20,
            top_margin: 12,
            bottom_margin: 20,
        });
        this._textView.add_css_class('jot-textview');

        const buffer = this._textView.get_buffer();
        buffer.connect('changed', () => this._updateStatusCounts());

        return this._textView;
    }

    _createStatusBar() {
        this._statusBar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 16,
            height_request: 36,
            margin_start: 16,
            margin_end: 16,
            margin_top: 8,
            margin_bottom: 8,
        });
        this._statusBar.add_css_class('jot-statusbar');

        this._charCountLabel = new Gtk.Label({
            label: '0 characters',
            halign: Gtk.Align.START,
        });
        this._charCountLabel.add_css_class('status-label');

        this._wordCountLabel = new Gtk.Label({
            label: '0 words',
            halign: Gtk.Align.START,
        });
        this._wordCountLabel.add_css_class('status-label');

        const jotDir = FileManager.getJotDirectory();
        this._pathLabel = new Gtk.Label({
            label: GLib.build_filenamev([jotDir, this._currentFilename]),
            halign: Gtk.Align.START,
            hexpand: true,
            ellipsize: 3,
        });
        this._pathLabel.add_css_class('status-label');

        const buttonBox = this._createButtonBox();

        this._statusBar.append(this._charCountLabel);
        this._statusBar.append(this._wordCountLabel);
        this._statusBar.append(this._pathLabel);
        this._statusBar.append(buttonBox);

        return this._statusBar;
    }

    _createButtonBox() {
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
        });

        const cancelButton = new Gtk.Button({ label: 'Cancel' });
        cancelButton.add_css_class('jot-button');
        cancelButton.connect('clicked', () => this.close());

        const saveButton = new Gtk.Button({ label: 'Save' });
        saveButton.add_css_class('jot-button');
        saveButton.add_css_class('jot-button-save');
        saveButton.connect('clicked', () => this._saveNote());

        buttonBox.append(cancelButton);
        buttonBox.append(saveButton);

        return buttonBox;
    }

    _setupTheme() {
        this._applyCSS();
        this._themeManager.setupMonitor(() => this._applyCSS());
    }

    _applyCSS() {
        const cssProvider = new Gtk.CssProvider();
        const css = this._themeManager.generateCSS();
        cssProvider.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            this.get_display(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    }

    _setupKeyboardShortcuts() {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            if (keyval === KEY_ESCAPE) {
                this.close();
                return true;
            }
            if ((keyval === KEY_ENTER || keyval === KEY_S) && (state & CTRL_MASK)) {
                this._saveNote();
                return true;
            }
            return false;
        });
        this.add_controller(keyController);
    }

    _updateFilenameDisplay() {
        const title = this._titleEntry.get_text();
        this._currentFilename = FileManager.generateFilename(title);

        const jotDir = FileManager.getJotDirectory();
        this._pathLabel.set_label(GLib.build_filenamev([jotDir, this._currentFilename]));
    }

    _updateStatusCounts() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const text = buffer.get_text(start, end, false);

        const charCount = text.length;
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

        this._charCountLabel.set_label(`${charCount} characters`);
        this._wordCountLabel.set_label(`${wordCount} words`);
    }

    _saveNote() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const content = buffer.get_text(start, end, false);

        if (!content.trim()) {
            this.close();
            return;
        }

        try {
            const title = this._titleEntry.get_text().trim();
            const filename = FileManager.saveNote(title, content);
            this._showFeedback(`✓ Saved: ${filename}`);
        } catch (e) {
            print(`Error saving note: ${e.message}`);
            this._showFeedback(`✗ Error: ${e.message}`);
        }
    }

    _showFeedback(message) {
        const originalLabel = this._pathLabel.get_label();
        this._pathLabel.set_label(message);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, FEEDBACK_TIMEOUT_MS, () => {
            this._pathLabel.set_label(originalLabel);
            return false;
        });
    }

    _openFileDialog() {
        const dialog = new Gtk.FileDialog();

        const filter = new Gtk.FileFilter();
        FILE_PATTERNS.forEach(pattern => filter.add_pattern(pattern));
        filter.set_name(FILE_FILTER_NAME);

        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);
        dialog.set_filters(filters);

        const jotDir = FileManager.getJotDirectory();
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
                    print(`Error opening file: ${e.message}`);
                }
            }
        });
    }

    loadFile(file) {
        try {
            const { title, content, filePath, filename } = FileManager.loadFile(file);

            this._titleEntry.set_text(title);
            const buffer = this._textView.get_buffer();
            buffer.set_text(content, -1);

            this._currentFilename = filename;
            this._pathLabel.set_label(filePath);

            print(`Loaded file: ${filePath}`);
        } catch (e) {
            print(`Error loading file: ${e.message}`);
        }
    }
});

// ============================================================================
// Entry Point
// ============================================================================

const app = new JotApplication();
app.run([imports.system.programInvocationName].concat(ARGV));
