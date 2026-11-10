imports.gi.versions.Gtk = '4.0';
const { Gio, GLib, Gtk } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Theme Manager
// ============================================================================

var ThemeManager = class ThemeManager {
    constructor() {
        this.colors = this._loadColors();
        this.monitor = null;
        this.currentMonitor = null;
        this._reloadSourceId = 0;
    }

    _getThemePath() {
        const homeDir = GLib.get_home_dir();
        const themePath = GLib.build_filenamev([homeDir, ...Constants.THEME_PATH]);
        if (Gio.File.new_for_path(themePath).query_exists(null)) {
            return themePath;
        }
        return GLib.build_filenamev([homeDir, ...Constants.LEGACY_THEME_PATH]);
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
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(e, 'Jotite: failed to load theme');
            return this._getDefaultColors();
        }
    }

    _parseTomlColors(text) {
        const colors = {};
        let fontFamily = null;
        const lines = text.split('\n');
        let currentSection = '';

        for (const line of lines) {
            // Check for [font] section
            if (line.match(/^\[font\]/)) {
                currentSection = 'font';
                continue;
            }
            
            const sectionMatch = line.match(/^\[colors\.(\w+)\]/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                continue;
            }

            // Parse font family from [font] section
            if (currentSection === 'font') {
                const fontMatch = line.match(/normal\s*=\s*\{\s*family\s*=\s*"([^"]+)"/);
                if (fontMatch) {
                    fontFamily = fontMatch[1];
                }
            }

            const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
            if (match && (currentSection === 'normal' || currentSection === 'primary')) {
                const [, key, value] = match;
                // Convert 0xRRGGBB to #RRGGBB for GTK CSS compatibility
                colors[key] = value.replace(/^0x/, '#');
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
            font: fontFamily || 'monospace',
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
            font: 'monospace',
        };
    }

    // Watch the Omarchy theme. Omarchy replaces the whole theme directory on a
    // switch, which fires a burst of events; they are coalesced into a single
    // reload + callback().
    setupMonitor(callback) {
        if (this.monitor)
            return;
        this._callback = callback;
        const schedule = () => {
            if (this._reloadSourceId)
                GLib.source_remove(this._reloadSourceId);
            this._reloadSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._reloadSourceId = 0;
                this.colors = this._loadColors();
                this._callback?.();
                return GLib.SOURCE_REMOVE;
            });
        };
        try {
            const file = Gio.File.new_for_path(this._getThemePath());
            this.monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorHandler = this.monitor.connect('changed', schedule);

            // Watch the stable parent of the theme directory so subsequent
            // switches keep reloading.
            const currentDir = file.get_parent().get_parent();
            if (currentDir.query_exists(null)) {
                this.currentMonitor = currentDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                this._currentMonitorHandler = this.currentMonitor.connect('changed', (_monitor, changedFile) => {
                    if (changedFile.get_basename() === 'theme')
                        schedule();
                });
            }
        } catch (e) {
            logError(e, 'Jotite: failed to watch theme');
        }
    }

    destroy() {
        if (this._reloadSourceId) {
            GLib.source_remove(this._reloadSourceId);
            this._reloadSourceId = 0;
        }
        for (const [m, h] of [['monitor', '_monitorHandler'], ['currentMonitor', '_currentMonitorHandler']]) {
            if (this[m]) {
                if (this[h])
                    this[m].disconnect(this[h]);
                this[m].cancel();
                this[m] = null;
            }
        }
        this._callback = null;
    }

    // CSS for Jotite's own widgets. Everything is scoped to .jot-window so
    // other dialogs (file chooser etc.) keep the system style.
    generateCSS() {
        const c = this.colors;
        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };
        const font = String(c.font).replace(/['\\]/g, '');

        return `
            window.jot-window {
                background: ${c.background};
            }

            .jot-window .jot-textview,
            .jot-window .jot-textview > text {
                background: transparent;
                color: ${c.foreground};
            }

            .jot-window .jot-textview {
                font-size: 15px;
                font-family: '${font}', monospace;
                caret-color: ${c.white};
            }

            .jot-window .jot-textview selection {
                background-color: ${c.blue};
                color: ${c.white};
            }

            .jot-window .jot-statusbar {
                border-top: 1px solid ${hexToRgba(c.white, 0.2)};
                padding-top: 4px;
            }

            .jot-window .status-label {
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
            }

            .jot-window .status-label:hover {
                opacity: 0.5;
            }

            .jot-window .status-label.status-error {
                color: ${c.red};
                opacity: 0.9;
            }

            .jot-window .status-button {
                padding: 0px 4px;
                margin: 0px;
                border: none;
                background: transparent;
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
                font-weight: 400;
                min-width: 0;
                min-height: 0;
            }

            .jot-window .status-button > * {
                margin: 0;
                padding: 0;
            }

            .jot-window .status-settings-button {
                padding: 0px 2px;
            }

            .jot-window .status-button:hover {
                opacity: 0.6;
                background: transparent;
            }

            .jot-window searchbar {
                background: transparent;
                background-image: none;
                border-bottom: 1px solid ${hexToRgba(c.white, 0.2)};
                padding: 0;
            }

            .jot-window searchbar > revealer > box {
                background: transparent;
            }

            .jot-window .search-entry {
                background: transparent;
                color: ${c.white};
                border: 1px solid ${hexToRgba(c.white, 0.2)};
                border-radius: 0;
                padding: 4px 6px;
                min-width: 200px;
                font-size: 12px;
                min-height: 0;
                outline: none;
                box-shadow: none;
            }

            .jot-window .search-entry:focus-within {
                border-color: ${hexToRgba(c.white, 0.4)};
                outline: none;
            }

            .jot-window .search-button {
                padding: 0px 6px;
                margin: 0px;
                border: 1px solid ${hexToRgba(c.white, 0.1)};
                border-radius: 0;
                background: transparent;
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
                font-weight: 400;
                min-width: 0;
                min-height: 0;
            }

            .jot-window .search-button:hover {
                opacity: 0.6;
                background: transparent;
            }

            .jot-window button.search-button:checked {
                border: 1px solid ${c.white};
                opacity: 1.0;
            }

            .jot-window .search-match-label {
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
                margin: 0;
                padding: 0;
                min-width: 0;
            }
        `;
    }
};

// One display-wide provider carries the theme CSS for all Jotite windows
// (its selectors only match .jot-window). Windows call applyThemeCss() on
// theme changes; the last window to close calls releaseThemeCss().
let _themeProvider = null;
let _themeCssText = null;
let _themeUsers = 0;

function acquireThemeCss(display, css) {
    _themeUsers++;
    applyThemeCss(display, css);
}

function applyThemeCss(display, css) {
    if (!_themeProvider) {
        _themeProvider = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(display, _themeProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
    if (_themeCssText !== css) {
        _themeCssText = css;
        _themeProvider.load_from_string(css);
    }
}

function releaseThemeCss(display) {
    _themeUsers = Math.max(0, _themeUsers - 1);
    if (_themeUsers === 0 && _themeProvider) {
        Gtk.StyleContext.remove_provider_for_display(display, _themeProvider);
        _themeProvider = null;
        _themeCssText = null;
    }
}

var ThemeCss = { acquire: acquireThemeCss, apply: applyThemeCss, release: releaseThemeCss };
