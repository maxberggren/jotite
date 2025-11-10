const { Gio, GLib, Gdk } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Theme Manager
// ============================================================================

var ThemeManager = class ThemeManager {
    constructor() {
        this.colors = this._loadColors();
        this.monitor = null;
    }

    _getThemePath() {
        const homeDir = GLib.get_home_dir();
        return GLib.build_filenamev([homeDir, ...Constants.THEME_PATH]);
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

    setupMonitor(callback) {
        try {
            // Monitor Alacritty theme file
            const themePath = this._getThemePath();
            const file = Gio.File.new_for_path(themePath);
            this.monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this.monitor.connect('changed', () => {
                this.colors = this._loadColors();
                callback();
            });
            
            // Also monitor GTK CSS file if it exists
            const homeDir = GLib.get_home_dir();
            const gtkCssPath = GLib.build_filenamev([homeDir, '.config', 'gtk-4.0', 'gtk.css']);
            const gtkCssFile = Gio.File.new_for_path(gtkCssPath);
            
            if (gtkCssFile.query_exists(null)) {
                this.gtkMonitor = gtkCssFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
                this.gtkMonitor.connect('changed', () => {
                    this.colors = this._loadColors();
                    callback();
                });
            }
        } catch (e) {
            print(`Failed to setup theme monitor: ${e.message}`);
        }
    }

    generateCSS(zoomLevel = 100) {
        const c = this.colors;
        const zoom = zoomLevel / 100;
        
        // Helper to convert hex to rgba
        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };
        
        return `
            window {
                background: ${c.background};
            }

            .jot-textview {
                background: transparent;
                color: ${c.foreground};
                font-size: ${15 * zoom}px;
                font-family: '${c.font}', monospace;
                caret-color: ${c.white};
            }

            .jot-textview text {
                background: transparent;
                color: ${c.foreground};
            }
            
            textview {
                background: transparent;
                color: ${c.foreground};
            }
            
            textview > text {
                background: transparent;
                color: ${c.foreground};
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
                border-top: 1px solid ${hexToRgba(c.white, 0.2)};
                padding-top: 4px;
            }

            .status-label {
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
            }
            
            .status-label:hover {
                opacity: 0.5;
            }

            .status-button {
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
                line-height: 1;
            }

            .status-button > * {
                margin: 0;
                padding: 0;
            }

            .status-button:hover {
                opacity: 0.6;
                background: transparent;
            }

            .status-button-large {
                font-size: 20px;
                line-height: 0.8;
                padding: 0px;
            }

            .jot-hash {
                color: ${c.white};
                font-size: ${18 * zoom}px;
                font-weight: bold;
                font-family: '${c.font}', monospace;
                margin-right: 8px;
            }

            .jot-title {
                background: transparent;
                border: none;
                color: ${c.white};
                font-size: ${18 * zoom}px;
                font-weight: bold;
                font-family: '${c.font}', monospace;
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
                padding: 4px 12px;
                border-radius: 0;
                border: 1px solid ${c.white};
                background: ${c.black};
                color: ${c.white};
                font-weight: 500;
                font-size: 11px;
            }

            .jot-open-button:hover {
                background: ${c.white};
                color: ${c.black};
            }

            /* Dialog and FileChooser styling */
            dialog, window.dialog {
                background: ${c.background};
                color: ${c.foreground};
            }

            dialog > box {
                background: ${c.background};
            }

            filechooser, .filechooser {
                background: ${c.background};
                color: ${c.foreground};
            }

            filechooser > box {
                background: ${c.background};
            }

            filechooser button {
                background: ${c.black};
                color: ${c.foreground};
                border: 1px solid ${c.white};
            }

            filechooser button:hover {
                background: ${c.white};
                color: ${c.black};
            }

            filechooser entry {
                background: ${c.black};
                color: ${c.foreground};
                border: 1px solid ${c.white};
            }

            filechooser treeview, filechooser listview {
                background: ${c.background};
                color: ${c.foreground};
            }

            filechooser scrolledwindow {
                background: ${c.background};
            }

            /* Sidebar styling */
            .sidebar, sidebar {
                background: ${c.black};
                color: ${c.foreground};
            }

            .sidebar row, sidebar row {
                background: ${c.black};
                color: ${c.foreground};
            }

            .sidebar row:selected, sidebar row:selected {
                background: ${c.blue};
                color: ${c.foreground};
            }

            /* Pathbar styling */
            .pathbar, pathbar {
                background: ${c.black};
                color: ${c.foreground};
            }

            /* List and tree view styling */
            treeview, listview, list {
                background: ${c.background};
                color: ${c.foreground};
            }

            treeview:selected, listview:selected, list row:selected {
                background: ${c.blue};
                color: ${c.foreground};
            }

            /* Popover styling */
            popover, .popover {
                background: ${c.background};
                color: ${c.foreground};
                border: 1px solid ${c.white};
            }

            popover > contents {
                background: ${c.background};
            }

            /* Menu styling */
            menu, .menu {
                background: ${c.background};
                color: ${c.foreground};
                border: 1px solid ${c.white};
            }

            menuitem {
                color: ${c.foreground};
            }

            menuitem:hover {
                background: ${c.blue};
            }

            /* Search bar styling - match status bar */
            searchbar {
                background: transparent;
                background-color: transparent;
                background-image: none;
                border-bottom: 1px solid ${hexToRgba(c.white, 0.2)};
                padding: 0;
            }
            
            searchbar > revealer > box {
                background: transparent;
                background-color: transparent;
            }

            .search-entry {
                background: transparent;
                color: ${c.white};
                border: 1px solid ${hexToRgba(c.white, 0.2)};
                border-radius: 0;
                padding: 4px 6px;
                min-width: 200px;
                font-size: 12px;
                min-height: 0;
            }

            .search-entry:focus {
                border-color: ${hexToRgba(c.white, 0.4)};
                outline: none;
            }

            .search-button {
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

            .search-button:hover {
                opacity: 0.6;
                background: transparent;
            }
            
            button.search-button:checked {
                border: 1px solid ${c.white};
                opacity: 1.0;
            }

            .search-match-label {
                color: ${c.white};
                opacity: 0.3;
                font-size: 12px;
                margin: 0;
                padding: 0;
                min-width: 0;
            }
            
            .search-match-label:empty {
                min-width: 0;
                padding: 0;
                margin: 0;
            }

            .search-match-highlight {
                background: ${hexToRgba(c.yellow, 0.3)};
            }

            .search-current-match {
                background: ${hexToRgba(c.blue, 0.5)};
            }
        `;
    }
}

