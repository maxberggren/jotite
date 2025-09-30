#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gtk, Gio, GLib, Adw, GObject } = imports.gi;

const JotApplication = GObject.registerClass(
class JotApplication extends Adw.Application {
    _init() {
        super._init({
            application_id: 'com.github.jot',
            flags: Gio.ApplicationFlags.FLAGS_NONE,
        });
    }

    vfunc_activate() {
        let window = this.active_window;
        if (!window) {
            window = new JotWindow(this);
        }
        window.present();
    }
});

const JotWindow = GObject.registerClass(
class JotWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({
            application,
            title: 'Jot',
            default_width: 700,
            default_height: 500,
        });

        // Load custom CSS from theme file
        this._themeColors = this._loadThemeColors();
        this._loadCSS();
        this._setupThemeMonitor();

        // Create the main box
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        // Title box with open button
        const titleBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
            margin_start: 20,
            margin_end: 20,
            margin_top: 20,
            margin_bottom: 0,
        });

        const hashLabel = new Gtk.Label({
            label: '#',
            halign: Gtk.Align.START,
        });
        hashLabel.add_css_class('jot-hash');

        // Title entry
        this._titleEntry = new Gtk.Entry({
            placeholder_text: 'Title'
            hexpand: true,
        });
        this._titleEntry.add_css_class('jot-title');
        this._titleEntry.connect('changed', () => this._updateFilename());

        // Open file button
        const openButton = new Gtk.Button({
            label: '+',
            halign: Gtk.Align.END,
        });
        openButton.add_css_class('jot-open-button');
        openButton.connect('clicked', () => this._openFile());

        titleBox.append(hashLabel);
        titleBox.append(this._titleEntry);
        titleBox.append(openButton);

        // Create text view
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

        // Connect to buffer changes to update character count
        const buffer = this._textView.get_buffer();
        buffer.connect('changed', () => this._updateStatus());

        // Status bar
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

        // Status labels
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

        const homeDir = GLib.get_home_dir();
        const jotDir = GLib.build_filenamev([homeDir, 'Jot']);
        this._currentFilename = 'untitled.md';
        this._pathLabel = new Gtk.Label({
            label: GLib.build_filenamev([jotDir, this._currentFilename]),
            halign: Gtk.Align.START,
            hexpand: true,
            ellipsize: 3, // PANGO_ELLIPSIZE_END
        });
        this._pathLabel.add_css_class('status-label');

        // Create button box inside status bar
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            halign: Gtk.Align.END,
        });

        // Cancel button
        const cancelButton = new Gtk.Button({
            label: 'Cancel',
        });
        cancelButton.add_css_class('jot-button');
        cancelButton.connect('clicked', () => this.close());

        // Save button
        const saveButton = new Gtk.Button({
            label: 'Save',
        });
        saveButton.add_css_class('jot-button');
        saveButton.add_css_class('jot-button-save');
        saveButton.connect('clicked', () => this._saveNote());

        buttonBox.append(cancelButton);
        buttonBox.append(saveButton);

        this._statusBar.append(this._charCountLabel);
        this._statusBar.append(this._wordCountLabel);
        this._statusBar.append(this._pathLabel);
        this._statusBar.append(buttonBox);

        box.append(titleBox);
        box.append(this._textView);
        box.append(this._statusBar);

        this.set_content(box);

        // Set up keyboard shortcuts
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            if (keyval === 65307) { // Escape key
                this.close();
                return true;
            }
            if (keyval === 65293 && (state & 4)) { // Enter key with Ctrl
                this._saveNote();
                return true;
            }
            return false;
        });
        this.add_controller(keyController);

        // Focus the title entry
        this._titleEntry.grab_focus();
    }

    _normalizeFilename(title) {
        // Remove leading/trailing whitespace
        let normalized = title.trim();

        // Replace spaces with hyphens
        normalized = normalized.replace(/\s+/g, '-');

        // Remove special characters, keep only alphanumeric, hyphens, and underscores
        normalized = normalized.replace(/[^a-zA-Z0-9-_]/g, '');

        // Convert to lowercase
        normalized = normalized.toLowerCase();

        // Limit length
        if (normalized.length > 50) {
            normalized = normalized.substring(0, 50);
        }

        return normalized;
    }

    _updateFilename() {
        const title = this._titleEntry.get_text();
        const homeDir = GLib.get_home_dir();
        const jotDir = GLib.build_filenamev([homeDir, 'Jot']);

        if (title.trim()) {
            const normalized = this._normalizeFilename(title);
            if (normalized) {
                this._currentFilename = `${normalized}.md`;
            } else {
                // Fallback if normalization results in empty string
                const now = GLib.DateTime.new_now_local();
                this._currentFilename = `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
            }
        } else {
            const now = GLib.DateTime.new_now_local();
            this._currentFilename = `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
        }

        this._pathLabel.set_label(GLib.build_filenamev([jotDir, this._currentFilename]));
    }

    _updateStatus() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const text = buffer.get_text(start, end, false);

        const charCount = text.length;
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

        this._charCountLabel.set_label(`${charCount} characters`);
        this._wordCountLabel.set_label(`${wordCount} words`);
    }

    _loadThemeColors() {
        const homeDir = GLib.get_home_dir();
        const themePath = GLib.build_filenamev([homeDir, '.config', 'omarchy', 'current', 'theme', 'alacritty.toml']);

        try {
            const file = Gio.File.new_for_path(themePath);
            const [success, contents] = file.load_contents(null);

            if (!success) {
                print('Failed to load theme file');
                return this._getDefaultColors();
            }

            const text = new TextDecoder().decode(contents);
            const colors = {};

            // Parse TOML - track current section
            const lines = text.split('\n');
            let currentSection = '';

            for (const line of lines) {
                // Check for section headers like [colors.normal]
                const sectionMatch = line.match(/^\[colors\.(\w+)\]/);
                if (sectionMatch) {
                    currentSection = sectionMatch[1];
                    continue;
                }

                // Match key = "value" patterns
                const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
                if (match) {
                    const [, key, value] = match;
                    // For colors.normal section, use the color name directly
                    if (currentSection === 'normal' || currentSection === 'primary') {
                        colors[key] = value;
                    }
                }
            }

            const result = {
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

            print(`Loaded theme colors: bg=${result.background}, fg=${result.foreground}, black=${result.black}, white=${result.white}, green=${result.green}`);
            return result;
        } catch (e) {
            print(`Failed to load theme: ${e.message}`);
            return this._getDefaultColors();
        }
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

    _setupThemeMonitor() {
        const homeDir = GLib.get_home_dir();
        const themePath = GLib.build_filenamev([homeDir, '.config', 'omarchy', 'current', 'theme', 'alacritty.toml']);

        try {
            const file = Gio.File.new_for_path(themePath);
            this._themeMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._themeMonitor.connect('changed', () => {
                print('Theme file changed, reloading...');
                this._themeColors = this._loadThemeColors();
                this._loadCSS();
            });
        } catch (e) {
            print(`Failed to setup theme monitor: ${e.message}`);
        }
    }

    _loadCSS() {
        const c = this._themeColors;
        const cssProvider = new Gtk.CssProvider();
        const css = `
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

        cssProvider.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            this.get_display(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    }

    _saveNote() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const text = buffer.get_text(start, end, false);

        if (!text.trim()) {
            this.close();
            return;
        }

        // Get the jot directory path
        const homeDir = GLib.get_home_dir();
        const jotDir = GLib.build_filenamev([homeDir, 'Jot']);

        // Create directory if it doesn't exist
        const jotDirFile = Gio.File.new_for_path(jotDir);
        try {
            jotDirFile.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                print(`Error creating directory: ${e.message}`);
                return;
            }
        }

        // Determine filename
        const title = this._titleEntry.get_text().trim();
        let filename;

        if (title) {
            const normalized = this._normalizeFilename(title);
            if (normalized) {
                filename = `${normalized}.md`;
            } else {
                const now = GLib.DateTime.new_now_local();
                filename = `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
            }
        } else {
            const now = GLib.DateTime.new_now_local();
            filename = `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
        }

        const filePath = GLib.build_filenamev([jotDir, filename]);

        // Get current timestamp
        const now = GLib.DateTime.new_now_local();
        const timestamp = now.format('%Y-%m-%d %H:%M:%S');

        // Format the note content
        let content = '';
        if (title) {
            content = `# ${title}\n\n`;
        }
        content += `*Created: ${timestamp}*\n\n${text}\n`;

        // Write to file
        const file = Gio.File.new_for_path(filePath);
        try {
            const outputStream = file.replace(
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );
            outputStream.write_all(content, null);
            outputStream.close(null);

            print(`Note saved to ${filePath}`);
            this._showSaveFeedback(filename);
        } catch (e) {
            print(`Error saving note: ${e.message}`);
            this._showSaveFeedback(`Error: ${e.message}`, true);
        }
    }

    _showSaveFeedback(message, isError = false) {
        const originalLabel = this._pathLabel.get_label();

        if (isError) {
            this._pathLabel.set_label(`✗ ${message}`);
        } else {
            this._pathLabel.set_label(`✓ Saved: ${message}`);
        }

        // Restore original label after 3 seconds
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            this._pathLabel.set_label(originalLabel);
            return false;
        });
    }

    _openFile() {
        const dialog = new Gtk.FileDialog();

        // Set up file filter for .md and .txt files
        const filter = new Gtk.FileFilter();
        filter.add_pattern('*.md');
        filter.add_pattern('*.txt');
        filter.set_name('Text files (*.md, *.txt)');

        const filters = Gio.ListStore.new(Gtk.FileFilter);
        filters.append(filter);
        dialog.set_filters(filters);

        // Set default folder to ~/Jot
        const homeDir = GLib.get_home_dir();
        const jotDir = GLib.build_filenamev([homeDir, 'Jot']);
        const jotFile = Gio.File.new_for_path(jotDir);
        dialog.set_initial_folder(jotFile);

        dialog.open(this, null, (source, result) => {
            try {
                const file = dialog.open_finish(result);
                if (file) {
                    this._loadFile(file);
                }
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)) {
                    print(`Error opening file: ${e.message}`);
                }
            }
        });
    }

    _loadFile(file) {
        try {
            const [success, contents] = file.load_contents(null);
            if (!success) {
                print('Failed to load file');
                return;
            }

            const text = new TextDecoder().decode(contents);
            const filePath = file.get_path();

            // Extract title and content
            const lines = text.split('\n');
            let title = '';
            let contentStart = 0;

            // Check if first line is a markdown title
            if (lines[0] && lines[0].startsWith('# ')) {
                title = lines[0].substring(2).trim();
                contentStart = 1;

                // Skip empty lines after title
                while (contentStart < lines.length && !lines[contentStart].trim()) {
                    contentStart++;
                }

                // Skip timestamp line if present
                if (lines[contentStart] && lines[contentStart].startsWith('*Created:')) {
                    contentStart++;
                    // Skip empty line after timestamp
                    while (contentStart < lines.length && !lines[contentStart].trim()) {
                        contentStart++;
                    }
                }
            }

            // Set title
            this._titleEntry.set_text(title);

            // Set content (skip title and metadata)
            const content = lines.slice(contentStart).join('\n');
            const buffer = this._textView.get_buffer();
            buffer.set_text(content, -1);

            // Update path label
            this._currentFilename = file.get_basename();
            this._pathLabel.set_label(filePath);

            print(`Loaded file: ${filePath}`);
        } catch (e) {
            print(`Error loading file: ${e.message}`);
        }
    }
});

// Run the application
const app = new JotApplication();
app.run([imports.system.programInvocationName].concat(ARGV));
