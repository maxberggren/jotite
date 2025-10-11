#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gtk, Gio, GLib, Adw, GObject, Gdk } = imports.gi;

// Constants
const APP_ID = 'com.github.jot';
const JOT_DIR = ['Documents', 'Jot'];
const THEME_PATH = ['.config', 'omarchy', 'current', 'theme', 'alacritty.toml'];
const FEEDBACK_TIMEOUT_MS = 3000;

// Keyboard constants
const KEY_ENTER = 65293;
const KEY_S = 115;
const KEY_S_UPPER = 83;  // 'S' key (with shift)
const KEY_N = 110;       // 'n' key
const KEY_O = 111;       // 'o' key
const KEY_X = 120;       // 'x' key
const KEY_PLUS = 61;     // '+' key (also '=' key without shift)
const KEY_MINUS = 45;    // '-' key
const KEY_0 = 48;        // '0' key
const KEY_UP = 65362;    // Up arrow key
const KEY_DOWN = 65364;  // Down arrow key
const CTRL_MASK = 4;
const SHIFT_MASK = 1;
const ALT_MASK = 8;

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
                print('Alacritty theme file changed, reloading...');
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
                    print('GTK CSS file changed, reloading...');
                    this.colors = this._loadColors();
                    callback();
                });
                print('Monitoring GTK CSS file for changes');
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
        `;
    }
}

// ============================================================================
// Markdown Renderer
// ============================================================================

class MarkdownRenderer {
    constructor(textView, colors) {
        this.textView = textView;
        this.buffer = textView.get_buffer();
        this.colors = colors;
        this.updating = false;
        this.lastCursorPosition = -1;
        this._previousCursorPosition = -1; // Track position from previous update for arrow direction
        this._renderTimeoutId = null;
        this._cursorTimeoutId = null;
        this._textJustChanged = false; // Track if text was recently changed
        this._appliedTags = new Set(); // Track which tags we actually applied (Optimization #1)
        
        this._initTags();
        this._setupSignals();
    }
    
    _lightenColor(color, percent = 10) {
        // Parse hex color
        const hex = color.replace('#', '');
        let r = parseInt(hex.substr(0, 2), 16);
        let g = parseInt(hex.substr(2, 2), 16);
        let b = parseInt(hex.substr(4, 2), 16);
        
        // Lighten by adding to each channel
        r = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
        g = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
        b = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
        
        // Convert back to hex
        return '#' + 
            r.toString(16).padStart(2, '0') + 
            g.toString(16).padStart(2, '0') + 
            b.toString(16).padStart(2, '0');
    }
    
    _colorWithOpacity(color, opacity) {
        // Parse hex color and convert to RGBA with opacity
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16) / 255;
        const g = parseInt(hex.substr(2, 2), 16) / 255;
        const b = parseInt(hex.substr(4, 2), 16) / 255;
        
        // Return GdkRGBA object
        const rgba = new Gdk.RGBA();
        rgba.red = r;
        rgba.green = g;
        rgba.blue = b;
        rgba.alpha = opacity;
        return rgba;
    }
    
    _initTags() {
        const tagTable = this.buffer.get_tag_table();
        
        // Remove existing tags if they exist
        const tagsToRemove = ['bold', 'italic', 'code', 'code-block', 'strikethrough', 'underline', 'link', 'link-url', 
         'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
         'bullet', 'bullet-char', 'bullet-dash', 'bullet-dot', 'bullet-star-raw', 'bullet-star', 'bullet-star-near', 
         'bullet-margin', 'sub-bullet-margin', 'dim', 'invisible', 'todo-unchecked', 'todo-checked',
         'todo-unchecked-inside', 'todo-checked-inside', 'todo-checked-text',
         'dim-h1', 'dim-h2', 'dim-h3', 'dim-h4', 'dim-h5', 'dim-h6',
         'table-pipe', 'table-separator', 'table-header', 'table-cell'];
        
        // Add gradient background tags to removal list for all moods
        const moodNames = ['stone', 'metal', 'fire', 'ice', 'purple', 'forest', 'sunset', 'ocean', 'lava', 'mint', 'amber', 'royal',
                          'aurora', 'sunken', 'ghost', 'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'cobalt', 'ectoplasm', 'polar', 'chiaroscuro',
                          'vanta', 'toxicvelvet', 'bruise', 'bismuth', 'solar', 'ultralich', 'paradox', 'cryo', 'hazmat', 'feral'];
        for (const moodName of moodNames) {
            for (let level = 1; level <= 6; level++) {
                for (let i = 0; i < 30; i++) {
                    tagsToRemove.push(`gradient-${moodName}-h${level}-${i}`);
                }
            }
        }
        
        tagsToRemove.forEach(name => {
            const existing = tagTable.lookup(name);
            if (existing) tagTable.remove(existing);
        });
        
        // Bold: **text** or __text__
        const boldTag = new Gtk.TextTag({ name: 'bold', weight: 700 });
        tagTable.add(boldTag);
        
        // Italic: *text* or _text_
        const italicTag = new Gtk.TextTag({ name: 'italic', style: 2 }); // Pango.Style.ITALIC
        tagTable.add(italicTag);
        
        // Code: `code` - Slack-style with subtle background (slightly lighter than main bg)
        const codeTag = new Gtk.TextTag({ 
            name: 'code',
            family: 'monospace',
            foreground: this.colors.red,
            background: this._lightenColor(this.colors.background, 8),  // 8% lighter than background
            scale: 0.95,  // Slightly smaller but keeps line height consistent
            weight: 500,
            rise: -200,  // Slight vertical adjustment for visual balance
        });
        tagTable.add(codeTag);
        
        // Code block: ```code block``` (slightly lighter than main bg)
        const codeBlockTag = new Gtk.TextTag({ 
            name: 'code-block',
            family: 'monospace',
            foreground: this.colors.red,
            paragraph_background: this._lightenColor(this.colors.background, 8),  // 8% lighter than background
            scale: 0.95,
            weight: 500,
        });
        tagTable.add(codeBlockTag);
        
        // Strikethrough: ~~text~~
        const strikeTag = new Gtk.TextTag({
            name: 'strikethrough',
            strikethrough: true,
        });
        tagTable.add(strikeTag);
        
        // Underline: ++text++
        const underlineTag = new Gtk.TextTag({
            name: 'underline',
            underline: 1,  // Pango.Underline.SINGLE
        });
        tagTable.add(underlineTag);
        
        // Links: [text](url)
        const linkTag = new Gtk.TextTag({
            name: 'link',
            foreground: this.colors.blue,
            underline: 1, // Pango.Underline.SINGLE
        });
        tagTable.add(linkTag);
        
        const linkUrlTag = new Gtk.TextTag({
            name: 'link-url',
            foreground: this.colors.magenta,
            scale: 0.85,
        });
        tagTable.add(linkUrlTag);
        
        // Headers: # Header (base styles without background, background applied per-character for gradient)
        const scales = [5.4, 4.5, 3.6, 3.3, 3.15, 3.0];
        for (let i = 1; i <= 6; i++) {
            const tag = new Gtk.TextTag({
                name: `heading${i}`,
                scale: scales[i-1],
                weight: 400,
                family: 'pxlxxl',
            });
            tagTable.add(tag);
        }
        
        // Define color moods with gradient palettes (2 or 3 colors) - in custom order
        const moods = {
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
        
        this.moodNames = Object.keys(moods);
        this.moodGradients = {};
        
        // Helper function to parse hex color
        const parseColor = (hex) => {
            return {
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16)
            };
        };
        
        // Helper function to create hex from RGB
        const toHex = (r, g, b) => {
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        };
        
        // Generate gradient steps for each mood that loops smoothly
        // Optimization #2: Reduced to 8 steps for blocky aesthetic
        const steps = 20;
        for (const [moodName, moodData] of Object.entries(moods)) {
            const gradientColors = [];
            const palette = moodData.colors.map(parseColor);
            
            if (palette.length === 2) {
                // 2-color gradient: there and back
                const halfSteps = Math.floor(steps / 2);
                
                // First half: color 0 to color 1
                for (let i = 0; i < halfSteps; i++) {
                    const ratio = i / (halfSteps - 1);
                    const r = Math.round(palette[0].r + (palette[1].r - palette[0].r) * ratio);
                    const g = Math.round(palette[0].g + (palette[1].g - palette[0].g) * ratio);
                    const b = Math.round(palette[0].b + (palette[1].b - palette[0].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
                
                // Second half: color 1 back to color 0
                for (let i = 0; i < halfSteps; i++) {
                    const ratio = i / (halfSteps - 1);
                    const r = Math.round(palette[1].r + (palette[0].r - palette[1].r) * ratio);
                    const g = Math.round(palette[1].g + (palette[0].g - palette[1].g) * ratio);
                    const b = Math.round(palette[1].b + (palette[0].b - palette[1].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
            } else if (palette.length === 3) {
                // 3-color gradient: 0->1->2->1->0 for smooth looping
                const segmentSteps = Math.floor(steps / 4);
                
                // Segment 1: color 0 to color 1
                for (let i = 0; i < segmentSteps; i++) {
                    const ratio = i / (segmentSteps - 1 || 1);
                    const r = Math.round(palette[0].r + (palette[1].r - palette[0].r) * ratio);
                    const g = Math.round(palette[0].g + (palette[1].g - palette[0].g) * ratio);
                    const b = Math.round(palette[0].b + (palette[1].b - palette[0].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
                
                // Segment 2: color 1 to color 2
                for (let i = 0; i < segmentSteps; i++) {
                    const ratio = i / (segmentSteps - 1 || 1);
                    const r = Math.round(palette[1].r + (palette[2].r - palette[1].r) * ratio);
                    const g = Math.round(palette[1].g + (palette[2].g - palette[1].g) * ratio);
                    const b = Math.round(palette[1].b + (palette[2].b - palette[1].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
                
                // Segment 3: color 2 back to color 1
                for (let i = 0; i < segmentSteps; i++) {
                    const ratio = i / (segmentSteps - 1 || 1);
                    const r = Math.round(palette[2].r + (palette[1].r - palette[2].r) * ratio);
                    const g = Math.round(palette[2].g + (palette[1].g - palette[2].g) * ratio);
                    const b = Math.round(palette[2].b + (palette[1].b - palette[2].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
                
                // Segment 4: color 1 back to color 0
                for (let i = 0; i < segmentSteps; i++) {
                    const ratio = i / (segmentSteps - 1 || 1);
                    const r = Math.round(palette[1].r + (palette[0].r - palette[1].r) * ratio);
                    const g = Math.round(palette[1].g + (palette[0].g - palette[1].g) * ratio);
                    const b = Math.round(palette[1].b + (palette[0].b - palette[1].b) * ratio);
                    gradientColors.push(toHex(r, g, b));
                }
            }
            
            this.moodGradients[moodName] = gradientColors;
        }
        
        // Create gradient foreground color tags for each mood, heading level, and color step
        for (const moodName of this.moodNames) {
            const gradientColors = this.moodGradients[moodName];
            for (let level = 1; level <= 6; level++) {
                for (let i = 0; i < gradientColors.length; i++) {
                    const tag = new Gtk.TextTag({
                        name: `gradient-${moodName}-h${level}-${i}`,
                        scale: scales[level-1],
                        weight: 400,
                        family: 'pxlxxl',
                        foreground: gradientColors[i],
                    });
                    tagTable.add(tag);
                }
            }
        }
        
        // Bullet character styling for dash "-" (with reduced opacity, same weight)
        const bulletDashTag = new Gtk.TextTag({
            name: 'bullet-dash',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.5),
        });
        tagTable.add(bulletDashTag);
        
        // Bullet character styling for asterisk "*" when cursor is far (faint like dash)
        const bulletStarTag = new Gtk.TextTag({
            name: 'bullet-star',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.5),
        });
        tagTable.add(bulletStarTag);
        
        // Bullet character styling for asterisk "*" when cursor is nearby (visible, dimmed)
        const bulletStarNearTag = new Gtk.TextTag({
            name: 'bullet-star-near',
            foreground: this.colors.cyan,
        });
        tagTable.add(bulletStarNearTag);
        
        // Bullet line margins: persistent margins for main bullets
        const bulletMarginTag = new Gtk.TextTag({
            name: 'bullet-margin',
            pixels_above_lines: 1,  // Margin above main bullet items
            pixels_below_lines: 1,  // Margin below main bullet items
        });
        tagTable.add(bulletMarginTag);
        
        // Sub-bullet line margins: persistent margins for indented bullets
        const subBulletMarginTag = new Gtk.TextTag({
            name: 'sub-bullet-margin',
            pixels_above_lines: 1,  // Margin above sub-bullet items
            pixels_below_lines: 1,  // Margin below sub-bullet items
        });
        tagTable.add(subBulletMarginTag);
        
        // Todo checkboxes: [ ] and [X]
        // Style to create a box appearance - when cursor is outside, only middle character visible
        const todoUncheckedTag = new Gtk.TextTag({
            name: 'todo-unchecked',
            foreground: this.colors.cyan,
            background: this._lightenColor(this.colors.background, 12),
            scale: 0.7,  // Smaller font to create room at top and bottom
            weight: 400,
            family: 'monospace',  // Monospace for consistent box appearance
            pixels_above_lines: 3,  // Add padding at top
            pixels_below_lines: 0,  // Add padding at bottom
            letter_spacing: 4000,  // Add horizontal spacing (in Pango units: 1024 = 1pt, so 4096 = 4pt)
        });
        tagTable.add(todoUncheckedTag);
        
        const todoCheckedTag = new Gtk.TextTag({
            name: 'todo-checked',
            foreground: this.colors.green,  // Keep foreground green for the X character
            background: this.colors.green,  // Use green as background to create a filled box appearance
            scale: 0.7,  // Smaller font to create room at top and bottom
            weight: 700,  // Bold for checked items  
            family: 'monospace',  // Monospace for consistent box appearance
            pixels_above_lines: 3,  // Add padding at top
            pixels_below_lines: 0,  // Add padding at bottom
            letter_spacing: 4000,  // Add horizontal spacing (in Pango units: 1024 = 1pt, so 4096 = 4pt)
        });
        tagTable.add(todoCheckedTag);
        
        // Tags for when cursor is inside (no background)
        const todoUncheckedInsideTag = new Gtk.TextTag({
            name: 'todo-unchecked-inside',
            foreground: this.colors.cyan,
            scale: 1.2,
            weight: 400,
            family: 'monospace',
        });
        tagTable.add(todoUncheckedInsideTag);
        
        const todoCheckedInsideTag = new Gtk.TextTag({
            name: 'todo-checked-inside',
            foreground: this.colors.green,
            scale: 1.2,
            weight: 400,
            family: 'monospace',
        });
        tagTable.add(todoCheckedInsideTag);
        
        // Tag for checked todo text (strikethrough and dimmed)
        const todoCheckedTextTag = new Gtk.TextTag({
            name: 'todo-checked-text',
            strikethrough: true,
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.3),
        });
        tagTable.add(todoCheckedTextTag);
        
        // Dim tag for markdown syntax (when cursor is inside)
        const dimTag = new Gtk.TextTag({
            name: 'dim',
            foreground: this.colors.cyan,
            scale: 0.8,
        });
        tagTable.add(dimTag);
        
        // Dim tags for each heading level (matching header scale)
        for (let i = 1; i <= 6; i++) {
            const dimHeadingTag = new Gtk.TextTag({
                name: `dim-h${i}`,
                foreground: this.colors.cyan,
                scale: scales[i-1],
                family: 'pxlxxl',
            });
            tagTable.add(dimHeadingTag);
        }
        
        // Invisible tag for markdown syntax (when cursor is outside)
        const invisibleTag = new Gtk.TextTag({
            name: 'invisible',
            foreground: this.colors.background,
            scale: 0.01,
        });
        tagTable.add(invisibleTag);
        
        // Table tags
        const tablePipeTag = new Gtk.TextTag({
            name: 'table-pipe',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.25),
        });
        tagTable.add(tablePipeTag);
        
        const tableSeparatorTag = new Gtk.TextTag({
            name: 'table-separator',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.25),
        });
        tagTable.add(tableSeparatorTag);
        
        const tableHeaderTag = new Gtk.TextTag({
            name: 'table-header',
            weight: 700,
            foreground: this.colors.blue,
        });
        tagTable.add(tableHeaderTag);
        
        const tableCellTag = new Gtk.TextTag({
            name: 'table-cell',
        });
        tagTable.add(tableCellTag);
    }
    
    _setupSignals() {
        // Update on text changes with debouncing (50ms delay, or immediate for headers)
        this.buffer.connect('changed', () => {
            if (!this.updating) {
                // Mark that text just changed to prevent cursor flicker
                this._textJustChanged = true;
                
                // Check if cursor is on a header line
                const cursor = this.buffer.get_insert();
                const cursorIter = this.buffer.get_iter_at_mark(cursor);
                const lineStart = cursorIter.copy();
                lineStart.set_line_offset(0);
                const lineEnd = cursorIter.copy();
                if (!lineEnd.ends_line()) {
                    lineEnd.forward_to_line_end();
                }
                const lineText = this.buffer.get_text(lineStart, lineEnd, false);
                const isHeader = /^#{1,}\s+/.test(lineText);
                
                // Cancel previous timeout if exists
                if (this._renderTimeoutId) {
                    GLib.source_remove(this._renderTimeoutId);
                }
                
                if (isHeader) {
                    // For headers, render immediately
                    this._updateSyntaxVisibility();
                    this._renderTimeoutId = null;
                    // Reset the flag after a short delay to allow cursor updates again
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                        this._textJustChanged = false;
                        return false;
                    });
                } else {
                    // For other content, use debouncing
                    this._renderTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
                        this._updateSyntaxVisibility();
                        this._renderTimeoutId = null;
                        // Reset the flag after a short delay to allow cursor updates again
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                            this._textJustChanged = false;
                            return false;
                        });
                        return false;
                    });
                }
            }
        });
        
        // Update on cursor movement to show/hide syntax with debouncing (30ms delay)
        this.buffer.connect('notify::cursor-position', () => {
            if (!this.updating && !this._textJustChanged) {
                // Cancel previous timeout if exists
                if (this._cursorTimeoutId) {
                    GLib.source_remove(this._cursorTimeoutId);
                }
                // Schedule new cursor update
                this._cursorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 30, () => {
                    this._adjustCursorPosition();
                    this._updateSyntaxVisibility();
                    this._cursorTimeoutId = null;
                    return false;
                });
            }
        });
    }
    
    updateColors(colors) {
        this.colors = colors;
        this._initTags();
        this._applyMarkdown();
    }
    
    // Helper to apply tag and track it (Optimization #1)
    _applyTag(tagName, start, end) {
        this.buffer.apply_tag_by_name(tagName, start, end);
        this._appliedTags.add(tagName);
    }
    
    _adjustCursorPosition() {
        if (this.updating) return;
        
        const cursor = this.buffer.get_insert();
        const cursorIter = this.buffer.get_iter_at_mark(cursor);
        const cursorOffset = cursorIter.get_offset();
        
        // Track movement direction
        const movingForward = cursorOffset > this.lastCursorPosition;
        const movingBackward = cursorOffset < this.lastCursorPosition;
        const lastPos = this.lastCursorPosition;
        
        // Save previous position before updating for arrow direction tracking
        this._previousCursorPosition = this.lastCursorPosition;
        this.lastCursorPosition = cursorOffset;
        
        // Don't adjust if we just adjusted or if cursor hasn't moved
        if (lastPos === -1 || cursorOffset === lastPos) {
            return;
        }
        
        const [start, end] = this.buffer.get_bounds();
        const text = this.buffer.get_text(start, end, false);
        
        // Check if we're on a markdown syntax character and need to adjust
        const adjustment = this._findCursorAdjustment(text, cursorOffset, movingForward);
        
        // Only adjust if:
        // 1. There's an adjustment to make
        // 2. We're moving in a direction that makes sense (not trying to exit)
        if (adjustment !== 0) {
            // Don't adjust if we're trying to move backward but adjustment wants us forward
            if (movingBackward && adjustment > 0) {
                return;
            }
            // Don't adjust if we're trying to move forward but adjustment wants us backward
            if (movingForward && adjustment < 0) {
                return;
            }
            
            this.updating = true;
            const newIter = this.buffer.get_iter_at_offset(cursorOffset + adjustment);
            this.buffer.place_cursor(newIter);
            this.lastCursorPosition = cursorOffset + adjustment;
            this.updating = false;
        }
    }
    
    _findCursorAdjustment(text, cursorOffset, movingForward) {
        const lines = text.split('\n');
        let lineStart = 0;
        
        for (const line of lines) {
            const lineEnd = lineStart + line.length;
            
            if (cursorOffset >= lineStart && cursorOffset <= lineEnd) {
                const posInLine = cursorOffset - lineStart;
                
                // Check inline patterns: bold, italic, code, strikethrough, underline, links, todos
                const patterns = [
                    { regex: /`([^`]+?)`/g, openLen: 1, closeLen: 1 },           // code
                    { regex: /(\*\*|__)(.+?)\1/g, openLen: 2, closeLen: 2 },    // bold
                    { regex: /\*([^\*]+?)\*/g, openLen: 1, closeLen: 1 },       // italic *
                    { regex: /_([^_]+?)_/g, openLen: 1, closeLen: 1 },          // italic _
                    { regex: /~~(.+?)~~/g, openLen: 2, closeLen: 2 },           // strikethrough
                    { regex: /\+\+(.+?)\+\+/g, openLen: 2, closeLen: 2 },       // underline
                    { regex: /\[([ Xx])\]/g, openLen: 1, closeLen: 1 },         // todos
                    { regex: /\[(.+?)\]\((.+?)\)/g, openLen: 1, closeLen: 0 },  // links (special)
                ];
                
                for (const pattern of patterns) {
                    let match;
                    pattern.regex.lastIndex = 0;
                    
                    while ((match = pattern.regex.exec(line)) !== null) {
                        const matchStart = match.index;
                        const matchEnd = matchStart + match[0].length;
                        
                        // Special handling for links (they have 2 capture groups)
                        if (pattern.regex.source.includes('\\[') && match[2] !== undefined) {
                            const textStart = matchStart + 1;
                            const textEnd = textStart + match[1].length;
                            const urlStart = textEnd + 2;
                            const urlEnd = urlStart + match[2].length;
                            
                            // Only adjust if exactly on opening bracket when moving forward
                            if (posInLine === matchStart && movingForward) {
                                return textStart - posInLine;
                            }
                            // If on ]( characters, jump to url start
                            if ((posInLine === textEnd || posInLine === textEnd + 1) && movingForward) {
                                return urlStart - posInLine;
                            }
                        } else {
                            const contentStart = matchStart + pattern.openLen;
                            const contentEnd = matchEnd - pattern.closeLen;
                            
                            // Only adjust when landing exactly on opening/closing syntax
                            if (posInLine >= matchStart && posInLine < contentStart) {
                                // On opening syntax, only jump forward if moving forward
                                if (movingForward) {
                                    return contentStart - posInLine;
                                }
                            } else if (posInLine > contentEnd && posInLine <= matchEnd) {
                                // On closing syntax, only jump backward if moving backward
                                if (!movingForward) {
                                    return contentEnd - posInLine;
                                }
                            }
                        }
                    }
                }
                
                // Check for headers at line start - only when moving forward
                const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
                if (headerMatch && posInLine <= headerMatch[1].length && movingForward) {
                    // Jump past the hashes and space
                    return (headerMatch[1].length + 1) - posInLine;
                }
                
                // Check for code block markers - skip over them when moving forward
                const codeBlockMatch = line.match(/^```/);
                if (codeBlockMatch && posInLine < 3 && movingForward) {
                    // Jump past the backticks and to the next line
                    return (line.length + 1) - posInLine;
                }
                
                break;
            }
            
            lineStart = lineEnd + 1; // +1 for newline
        }
        
        return 0;
    }
    
    _applyMarkdown() {
        if (this.updating) return;
        
        this.updating = true;
        const [start, end] = this.buffer.get_bounds();
        
        // Remove syntax tags but preserve margin tags
        const tagsToRemove = ['bold', 'italic', 'code', 'code-block', 'strikethrough', 'underline', 'link', 'link-url', 
         'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
         'dim', 'invisible', 'todo-unchecked', 'todo-checked', 'todo-checked-text', 'bullet-char', 'bullet-dash', 'bullet-star', 'bullet-star-near',
         'dim-h1', 'dim-h2', 'dim-h3', 'dim-h4', 'dim-h5', 'dim-h6',
         'table-pipe', 'table-separator', 'table-header', 'table-cell'];
        
        // Add gradient background tags to removal list for all moods
        const moodNames = ['stone', 'metal', 'fire', 'ice', 'purple', 'forest', 'sunset', 'ocean', 'lava', 'mint', 'amber', 'royal',
                          'aurora', 'sunken', 'ghost', 'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'cobalt', 'ectoplasm', 'polar', 'chiaroscuro',
                          'vanta', 'toxicvelvet', 'bruise', 'bismuth', 'solar', 'ultralich', 'paradox', 'cryo', 'hazmat', 'feral'];
        for (const moodName of moodNames) {
            for (let level = 1; level <= 6; level++) {
                for (let i = 0; i < 30; i++) {
                    tagsToRemove.push(`gradient-${moodName}-h${level}-${i}`);
                }
            }
        }
        
        // Remove only syntax tags, preserve margin tags (bullet, sub-bullet)
        tagsToRemove.forEach(tagName => {
            const tag = this.buffer.get_tag_table().lookup(tagName);
            if (tag) {
                this.buffer.remove_tag(tag, start, end);
            }
        });
        
        // Iterate using TextIter to get correct byte offsets (handles multi-byte chars like emojis)
        let iter = this.buffer.get_start_iter();
        let inCodeBlock = false;
        let codeBlockStart = -1;
        let lineNum = 0;
        
        do {
            const lineStart = iter.copy();
            
            // Move to end of line
            if (!iter.ends_line()) {
                iter.forward_to_line_end();
            }
            const lineEnd = iter.copy();
            
            // Get line text and byte offset
            const lineText = this.buffer.get_text(lineStart, lineEnd, false);
            const lineOffset = lineStart.get_offset();
            
            // Check for code block markers
            if (lineText.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true;
                    codeBlockStart = lineOffset;
                } else {
                    // Ending a code block
                    const blockStart = this.buffer.get_iter_at_offset(codeBlockStart);
                    this._applyTag('code-block', blockStart, lineEnd);
                    
                    // Dim the backticks on start line
                    const codeBlockStartIter = this.buffer.get_iter_at_offset(codeBlockStart);
                    const codeBlockStartEnd = codeBlockStartIter.copy();
                    if (!codeBlockStartEnd.ends_line()) {
                        codeBlockStartEnd.forward_to_line_end();
                    }
                    this._applyTag('dim', codeBlockStartIter, codeBlockStartEnd);
                    
                    // Dim the backticks on end line
                    this._applyTag('dim', lineStart, lineEnd);
                    
                    inCodeBlock = false;
                    codeBlockStart = -1;
                }
            } else if (inCodeBlock) {
                // Inside code block, will be styled when block ends
            } else {
                // Normal line processing
                this._applyLineMarkdown(lineText, lineOffset, lineNum);
            }
            
            lineNum++;
        } while (iter.forward_line());
        
        this.updating = false;
    }
    
    _applyLineMarkdown(line, lineOffset, lineNum) {
        // Headers (must be at start of line) - support any number of hashes
        const headerMatch = line.match(/^(#{1,})\s+(.+)$/);
        if (headerMatch) {
            const [, hashes, content] = headerMatch;
            const actualLevel = hashes.length; // Actual number of hashes
            const styleLevel = Math.min(actualLevel, 6); // Cap at level 6 for styling
            const start = this.buffer.get_iter_at_offset(lineOffset);
            
            // Hide the hashes by default (will be shown when cursor is on line)
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + 1); // +1 to include the space
            this._applyTag('invisible', start, hashEnd);
            
            // Assign mood based on header level (# gets color 0, ## gets color 1, etc.)
            const moodIndex = (actualLevel - 1) % this.moodNames.length;
            const mood = this.moodNames[moodIndex];
            const gradientColors = this.moodGradients[mood];
            
            // Apply gradient with 45-degree diagonal pattern
            const contentStart = lineOffset + hashes.length + 1;
            for (let i = 0; i < content.length; i++) {
                const charStart = this.buffer.get_iter_at_offset(contentStart + i);
                const charEnd = this.buffer.get_iter_at_offset(contentStart + i + 1);
                // 45-degree diagonal: color based on (charPos + actualLevel) for diagonal stripes
                const gradientIndex = (i + (actualLevel * 2)) % gradientColors.length;
                this._applyTag(`gradient-${mood}-h${styleLevel}-${gradientIndex}`, charStart, charEnd);
            }
            // Don't return - continue to apply inline formatting to header content
        }
        
        // Bullet points (must be at start of line or after whitespace)
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
        if (bulletMatch) {
            const [, indent, bullet] = bulletMatch;
            const bulletStart = this.buffer.get_iter_at_offset(lineOffset + indent.length);
            const bulletEnd = this.buffer.get_iter_at_offset(lineOffset + indent.length + 1);
            
            // Apply bullet character styling
            this._applyTag('bullet-char', bulletStart, bulletEnd);
            
            // Apply margin styling to the entire line (only if not already applied)
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            if (indent.length >= 2) {
                // Apply sub-bullet margin for indented bullets (2+ spaces)
                this._applyTag('sub-bullet-margin', lineStart, lineEnd);
            } else {
                // Apply bullet margin for main bullets (0-1 spaces)
                this._applyTag('bullet-margin', lineStart, lineEnd);
            }
        }
        
        // Todo items: apply pattern for [ ] and [X] (but styling happens in cursor-aware version)
        this._applyTodoPattern(line, lineOffset);
        
        // Table rows: detect and style pipes and cells
        this._applyTablePattern(line, lineOffset);
        
        // Process patterns in order: bold first, then italic, then code, then strikethrough
        // Bold: **text** or __text__
        this._applyPattern(line, lineOffset, /\*\*(.+?)\*\*/g, 'bold');
        this._applyPattern(line, lineOffset, /__(.+?)__/g, 'bold');
        
        // Code: `code`
        this._applyPattern(line, lineOffset, /`([^`]+?)`/g, 'code');
        
        // Italic: handled specially to avoid matching **
        this._applyItalicPatternSimple(line, lineOffset);
        
        // Strikethrough: ~~text~~
        this._applyPattern(line, lineOffset, /~~(.+?)~~/g, 'strikethrough');
        
        // Underline: ++text++
        this._applyPattern(line, lineOffset, /\+\+(.+?)\+\+/g, 'underline');
        
        // Links: [text](url)
        this._applyLinkPattern(line, lineOffset);
    }
    
    _applyItalicPatternSimple(line, lineOffset) {
        // Match italic with * or _, but avoid matching ** or __
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '*' && line[i+1] !== '*' && (i === 0 || line[i-1] !== '*')) {
                // Found a potential opening *
                for (let j = i + 1; j < line.length; j++) {
                    if (line[j] === '*' && (j === line.length - 1 || line[j+1] !== '*') && line[j-1] !== '*') {
                        // Found closing *
                        const matchStart = lineOffset + i;
                        const matchEnd = lineOffset + j + 1;
                        const contentStart = matchStart + 1;
                        const contentEnd = matchEnd - 1;
                        
                        const start = this.buffer.get_iter_at_offset(matchStart);
                        const end = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('italic', start, end);
                        
                        const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                        const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                        this._applyTag('invisible', syntaxStart1, syntaxEnd1);
                        
                        const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                        const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('invisible', syntaxStart2, syntaxEnd2);
                        break;
                    }
                }
            } else if (line[i] === '_' && line[i+1] !== '_' && (i === 0 || line[i-1] !== '_')) {
                // Found a potential opening _
                for (let j = i + 1; j < line.length; j++) {
                    if (line[j] === '_' && (j === line.length - 1 || line[j+1] !== '_') && line[j-1] !== '_') {
                        // Found closing _
                        const matchStart = lineOffset + i;
                        const matchEnd = lineOffset + j + 1;
                        const contentStart = matchStart + 1;
                        const contentEnd = matchEnd - 1;
                        
                        const start = this.buffer.get_iter_at_offset(matchStart);
                        const end = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('italic', start, end);
                        
                        const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                        const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                        this._applyTag('invisible', syntaxStart1, syntaxEnd1);
                        
                        const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                        const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('invisible', syntaxStart2, syntaxEnd2);
                        break;
                    }
                }
            }
        }
    }
    
    _applyPattern(line, lineOffset, regex, tagName) {
        let match;
        regex.lastIndex = 0;
        
        while ((match = regex.exec(line)) !== null) {
            const matchStart = match.index;
            const matchEnd = matchStart + match[0].length;
            const contentStart = matchStart + match[0].indexOf(match[match.length - 1]);
            const contentEnd = contentStart + match[match.length - 1].length;
            
            // Apply tag to entire match
            const start = this.buffer.get_iter_at_offset(lineOffset + matchStart);
            const end = this.buffer.get_iter_at_offset(lineOffset + matchEnd);
            this._applyTag(tagName, start, end);
            
            // Dim the syntax markers
            const syntaxStart1 = this.buffer.get_iter_at_offset(lineOffset + matchStart);
            const syntaxEnd1 = this.buffer.get_iter_at_offset(lineOffset + contentStart);
            this._applyTag('dim', syntaxStart1, syntaxEnd1);
            
            const syntaxStart2 = this.buffer.get_iter_at_offset(lineOffset + contentEnd);
            const syntaxEnd2 = this.buffer.get_iter_at_offset(lineOffset + matchEnd);
            this._applyTag('dim', syntaxStart2, syntaxEnd2);
        }
    }
    
    _applyLinkPattern(line, lineOffset) {
        const regex = /\[(.+?)\]\((.+?)\)/g;
        let match;
        
        while ((match = regex.exec(line)) !== null) {
            const [fullMatch, text, url] = match;
            const matchStart = match.index;
            const textStart = matchStart + 1;
            const textEnd = textStart + text.length;
            const urlStart = textEnd + 2;
            const urlEnd = urlStart + url.length;
            
            // Apply link tag to text
            const linkStart = this.buffer.get_iter_at_offset(lineOffset + textStart);
            const linkEnd = this.buffer.get_iter_at_offset(lineOffset + textEnd);
            this._applyTag('link', linkStart, linkEnd);
            
            // Apply link-url tag to URL
            const urlStartIter = this.buffer.get_iter_at_offset(lineOffset + urlStart);
            const urlEndIter = this.buffer.get_iter_at_offset(lineOffset + urlEnd);
            this._applyTag('link-url', urlStartIter, urlEndIter);
            
            // Dim the brackets and parentheses
            const bracket1 = this.buffer.get_iter_at_offset(lineOffset + matchStart);
            const bracket2 = this.buffer.get_iter_at_offset(lineOffset + matchStart + 1);
            this._applyTag('dim', bracket1, bracket2);
            
            const bracket3 = this.buffer.get_iter_at_offset(lineOffset + textEnd);
            const bracket4 = this.buffer.get_iter_at_offset(lineOffset + textEnd + 1);
            this._applyTag('dim', bracket3, bracket4);
            
            const paren1 = this.buffer.get_iter_at_offset(lineOffset + urlStart - 1);
            const paren2 = this.buffer.get_iter_at_offset(lineOffset + urlStart);
            this._applyTag('dim', paren1, paren2);
            
            const paren3 = this.buffer.get_iter_at_offset(lineOffset + urlEnd);
            const paren4 = this.buffer.get_iter_at_offset(lineOffset + urlEnd + 1);
            this._applyTag('dim', paren3, paren4);
        }
    }
    
    _applyTodoPattern(line, lineOffset) {
        // Match [ ] for unchecked or [X] for checked (also [x] lowercase)
        const regex = /\[([ Xx])\]/g;
        let match;
        
        while ((match = regex.exec(line)) !== null) {
            const matchStart = lineOffset + match.index;
            const matchEnd = matchStart + 3; // Length of [ ] or [X]
            const checkChar = match[1];
            const isChecked = checkChar === 'X' || checkChar === 'x';
            
            // Apply the appropriate tag
            const start = this.buffer.get_iter_at_offset(matchStart);
            const end = this.buffer.get_iter_at_offset(matchEnd);
            this._applyTag(isChecked ? 'todo-checked' : 'todo-unchecked', start, end);
            
            // Dim the brackets (will be overridden by invisible in cursor-aware version)
            const bracket1 = this.buffer.get_iter_at_offset(matchStart);
            const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
            this._applyTag('dim', bracket1, bracket2);
            
            const bracket3 = this.buffer.get_iter_at_offset(matchEnd - 1);
            const bracket4 = this.buffer.get_iter_at_offset(matchEnd);
            this._applyTag('dim', bracket3, bracket4);
            
            // If checked, apply strikethrough and dimming to the text after the checkbox
            if (isChecked) {
                // Find text after the checkbox (skip any spaces after the checkbox)
                const textAfterCheckbox = line.substring(match.index + 3); // Everything after [X]
                const textMatch = textAfterCheckbox.match(/^\s*/); // Find leading spaces
                const spacesLength = textMatch ? textMatch[0].length : 0;
                const textStart = matchEnd + spacesLength;
                const textEnd = lineOffset + line.length;
                
                // Apply strikethrough and dimming to the text after the checkbox
                if (textStart < textEnd) {
                    const textStartIter = this.buffer.get_iter_at_offset(textStart);
                    const textEndIter = this.buffer.get_iter_at_offset(textEnd);
                    this._applyTag('todo-checked-text', textStartIter, textEndIter);
                }
            }
        }
    }
    
    _handleArrowTransformations(text, cursorOffset) {
        // Track cursor movement direction using previous position
        const movingRight = cursorOffset > this._previousCursorPosition;
        const movingLeft = cursorOffset < this._previousCursorPosition;
        
        // Find all arrows (both ASCII and Unicode) and transform based on cursor position
        const transformations = []; // [{offset, length, replacement, cursorPos}]
        
        // Find all -> and check if cursor is near
        let index = 0;
        while ((index = text.indexOf('->', index)) !== -1) {
            const arrowStart = index;
            const arrowEnd = index + 2;
            const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
            
            if (!cursorNear) {
                // Cursor is away, replace -> with →
                transformations.push({
                    offset: arrowStart,
                    length: 2,
                    replacement: '→',
                    cursorPos: null
                });
            }
            index = arrowEnd;
        }
        
        // Find all <- and check if cursor is near
        index = 0;
        while ((index = text.indexOf('<-', index)) !== -1) {
            const arrowStart = index;
            const arrowEnd = index + 2;
            const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
            
            if (!cursorNear) {
                // Cursor is away, replace <- with ←
                transformations.push({
                    offset: arrowStart,
                    length: 2,
                    replacement: '←',
                    cursorPos: null
                });
            }
            index = arrowEnd;
        }
        
        // Find all → and check if cursor is near
        index = 0;
        while ((index = text.indexOf('→', index)) !== -1) {
            const arrowStart = index;
            const arrowEnd = index + 1;
            const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
            
            if (cursorNear) {
                // Cursor is near, replace → with ->
                // Position cursor based on entry direction
                let newCursorPos;
                if (movingRight) {
                    // Entered from left, put cursor at start of arrow (offset 0 in "->")
                    newCursorPos = arrowStart;
                } else if (movingLeft) {
                    // Entered from right, put cursor at end of arrow (offset 2 in "->")
                    newCursorPos = arrowStart + 2;
                } else {
                    // No movement or clicked, put cursor at current position
                    newCursorPos = arrowStart + (cursorOffset - arrowStart);
                }
                
                transformations.push({
                    offset: arrowStart,
                    length: 1,
                    replacement: '->',
                    cursorPos: newCursorPos
                });
            }
            index = arrowEnd;
        }
        
        // Find all ← and check if cursor is near
        index = 0;
        while ((index = text.indexOf('←', index)) !== -1) {
            const arrowStart = index;
            const arrowEnd = index + 1;
            const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
            
            if (cursorNear) {
                // Cursor is near, replace ← with <-
                // Position cursor based on entry direction
                let newCursorPos;
                if (movingRight) {
                    // Entered from left, put cursor at start of arrow (offset 0 in "<-")
                    newCursorPos = arrowStart;
                } else if (movingLeft) {
                    // Entered from right, put cursor at end of arrow (offset 2 in "<-")
                    newCursorPos = arrowStart + 2;
                } else {
                    // No movement or clicked, put cursor at current position
                    newCursorPos = arrowStart + (cursorOffset - arrowStart);
                }
                
                transformations.push({
                    offset: arrowStart,
                    length: 1,
                    replacement: '<-',
                    cursorPos: newCursorPos
                });
            }
            index = arrowEnd;
        }
        
        // Apply transformations in reverse order to maintain offsets
        transformations.sort((a, b) => b.offset - a.offset);
        
        for (const transform of transformations) {
            const startIter = this.buffer.get_iter_at_offset(transform.offset);
            const endIter = this.buffer.get_iter_at_offset(transform.offset + transform.length);
            this.buffer.delete(startIter, endIter);
            
            const insertIter = this.buffer.get_iter_at_offset(transform.offset);
            this.buffer.insert(insertIter, transform.replacement, -1);
            
            // Set cursor position if specified
            if (transform.cursorPos !== null) {
                const newCursorIter = this.buffer.get_iter_at_offset(transform.cursorPos);
                this.buffer.place_cursor(newCursorIter);
            }
        }
    }
    
    _updateSyntaxVisibility() {
        if (this.updating) return;
        
        this.updating = true;
        
        // Get cursor position
        const cursor = this.buffer.get_insert();
        const cursorIter = this.buffer.get_iter_at_mark(cursor);
        const cursorOffset = cursorIter.get_offset();
        
        print(`_updateSyntaxVisibility called, cursor at offset: ${cursorOffset}`);
        
        // Get all text
        const [start, end] = this.buffer.get_bounds();
        const text = this.buffer.get_text(start, end, false);
        
        // Handle arrow transformations based on cursor position
        this._handleArrowTransformations(text, cursorOffset);
        
        // Get updated text after arrow transformations
        const [start2, end2] = this.buffer.get_bounds();
        const updatedText = this.buffer.get_text(start2, end2, false);
        
        // Update cursor offset if text length changed
        const cursor2 = this.buffer.get_insert();
        const cursorIter2 = this.buffer.get_iter_at_mark(cursor2);
        const updatedCursorOffset = cursorIter2.get_offset();
        
        // Remove only tags that were actually applied (Optimization #1)
        this._appliedTags.forEach(tagName => {
            const tag = this.buffer.get_tag_table().lookup(tagName);
            if (tag) {
                this.buffer.remove_tag(tag, start2, end2);
            }
        });
        this._appliedTags.clear(); // Clear for next render
        
        // Find all markdown patterns and apply them
        // Show syntax markers only when cursor is inside the pattern
        this._applyMarkdownWithCursorContext(updatedText, updatedCursorOffset);
        
        this.updating = false;
    }
    
    _applyMarkdownWithCursorContext(text, cursorOffset) {
        // Iterate using TextIter to get correct byte offsets (handles multi-byte chars like emojis)
        let iter = this.buffer.get_start_iter();
        let inCodeBlock = false;
        let codeBlockStart = -1;
        let codeBlockStartIter = null;
        let lineNum = 0;
        
        do {
            const lineStart = iter.copy();
            
            // Move to end of line
            if (!iter.ends_line()) {
                iter.forward_to_line_end();
            }
            const lineEnd = iter.copy();
            
            // Get line text and byte offset
            const lineText = this.buffer.get_text(lineStart, lineEnd, false);
            const lineOffset = lineStart.get_offset();
            const lineEndOffset = lineEnd.get_offset();
            
            // Check if cursor is on this line
            const cursorOnLine = cursorOffset >= lineOffset && cursorOffset <= lineEndOffset;
            
            // Check for code block markers
            if (lineText.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true;
                    codeBlockStart = lineOffset;
                    codeBlockStartIter = lineStart.copy();
                } else {
                    // Ending a code block
                    const cursorInBlock = cursorOffset >= codeBlockStart && cursorOffset <= lineEndOffset;
                    
                    const blockStart = this.buffer.get_iter_at_offset(codeBlockStart);
                    this._applyTag('code-block', blockStart, lineEnd);
                    
                    // Dim or hide the backticks based on cursor position
                    if (cursorInBlock) {
                        // Show backticks when cursor is in the block
                        const codeBlockStartEnd = codeBlockStartIter.copy();
                        if (!codeBlockStartEnd.ends_line()) {
                            codeBlockStartEnd.forward_to_line_end();
                        }
                        this._applyTag('dim', codeBlockStartIter, codeBlockStartEnd);
                        this._applyTag('dim', lineStart, lineEnd);
                    } else {
                        // Hide backticks when cursor is outside
                        const codeBlockStartEnd = codeBlockStartIter.copy();
                        if (!codeBlockStartEnd.ends_line()) {
                            codeBlockStartEnd.forward_to_line_end();
                        }
                        this._applyTag('invisible', codeBlockStartIter, codeBlockStartEnd);
                        this._applyTag('invisible', lineStart, lineEnd);
                    }
                    
                    inCodeBlock = false;
                    codeBlockStart = -1;
                    codeBlockStartIter = null;
                }
            } else if (inCodeBlock) {
                // Inside code block, will be styled when block ends
            } else {
                // Normal line processing
                this._applyLineMarkdownWithCursor(lineText, lineOffset, cursorOffset, cursorOnLine, lineNum);
            }
            
            lineNum++;
        } while (iter.forward_line());
    }
    
    _applyLineMarkdownWithCursor(line, lineOffset, cursorOffset, cursorOnLine, lineNum) {
        // Headers (must be at start of line) - support any number of hashes
        const headerMatch = line.match(/^(#{1,})\s+(.+)$/);
        if (headerMatch) {
            const [, hashes, content] = headerMatch;
            const actualLevel = hashes.length; // Actual number of hashes
            const styleLevel = Math.min(actualLevel, 6); // Cap at level 6 for styling
            const start = this.buffer.get_iter_at_offset(lineOffset);
            
            // Show/hide the hashes based on cursor position
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + 1); // +1 to include the space after #
            if (cursorOnLine) {
                // Cursor is on this line - show hashes with level-specific dim tag
                this._applyTag(`dim-h${styleLevel}`, start, hashEnd);
            } else {
                // Cursor is on a different line - hide the hashes
                this._applyTag('invisible', start, hashEnd);
            }
            
            // Assign mood based on header level (# gets color 0, ## gets color 1, etc.)
            const moodIndex = (actualLevel - 1) % this.moodNames.length;
            const mood = this.moodNames[moodIndex];
            const gradientColors = this.moodGradients[mood];
            
            // Apply gradient with 45-degree diagonal pattern
            const contentStart = lineOffset + hashes.length + 1;
            for (let i = 0; i < content.length; i++) {
                const charStart = this.buffer.get_iter_at_offset(contentStart + i);
                const charEnd = this.buffer.get_iter_at_offset(contentStart + i + 1);
                // 45-degree diagonal: color based on (charPos + actualLevel) for diagonal stripes
                const gradientIndex = (i + (actualLevel * 2)) % gradientColors.length;
                this._applyTag(`gradient-${mood}-h${styleLevel}-${gradientIndex}`, charStart, charEnd);
            }
            // Don't return - continue to apply inline formatting to header content
        }
        
        // Bullet points - handle * and - bullets
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
        if (bulletMatch) {
            const [, indent, bullet] = bulletMatch;
            const bulletPos = lineOffset + indent.length;
            const bulletStart = this.buffer.get_iter_at_offset(bulletPos);
            const bulletEnd = this.buffer.get_iter_at_offset(bulletPos + 1);
            
            // Check if cursor is right next to the bullet (at or adjacent to bullet position)
            const cursorNearBullet = cursorOffset >= bulletPos && cursorOffset <= bulletPos + 2;
            
            // Apply styling ONLY - never modify buffer content
            if (bullet === '-') {
                // Dash bullet: always show with reduced opacity
                this._applyTag('bullet-dash', bulletStart, bulletEnd);
            } else if (bullet === '*') {
                // Asterisk bullet: style based on cursor proximity
                if (cursorNearBullet) {
                    // Show visible asterisk when cursor is right next to the bullet
                    this._applyTag('bullet-star-near', bulletStart, bulletEnd);
                } else {
                    // Show faint asterisk when cursor is away
                    this._applyTag('bullet-star', bulletStart, bulletEnd);
                }
            }
            
            // Apply margin styling to the entire line
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            if (indent.length >= 2) {
                // Apply sub-bullet margin for indented bullets (2+ spaces)
                this._applyTag('sub-bullet-margin', lineStart, lineEnd);
            } else {
                // Apply bullet margin for main bullets (0-1 spaces)
                this._applyTag('bullet-margin', lineStart, lineEnd);
            }
        }
        
        // Todo items with cursor awareness
        this._applyTodoPatternWithCursor(line, lineOffset, cursorOffset);
        
        // Table rows: detect and style pipes and cells with cursor awareness
        this._applyTablePatternWithCursor(line, lineOffset, cursorOffset);
        
        // For inline patterns, check if cursor is inside each pattern
        // Process bold first, then italic, then code, then strikethrough
        // Bold takes priority so we process it before italic
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /\*\*(.+?)\*\*/g, 'bold');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /__(.+?)__/g, 'bold');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /`([^`]+?)`/g, 'code');
        // For italic, we need to avoid matching ** by checking the character isn't an asterisk
        this._applyItalicPattern(line, lineOffset, cursorOffset);
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /~~(.+?)~~/g, 'strikethrough');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /\+\+(.+?)\+\+/g, 'underline');
        this._applyLinkPatternWithCursor(line, lineOffset, cursorOffset);
    }
    
    _applyItalicPattern(line, lineOffset, cursorOffset) {
        // Match italic with * or _, but avoid matching ** or __
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '*' && line[i+1] !== '*' && (i === 0 || line[i-1] !== '*')) {
                // Found a potential opening *
                for (let j = i + 1; j < line.length; j++) {
                    if (line[j] === '*' && (j === line.length - 1 || line[j+1] !== '*') && line[j-1] !== '*') {
                        // Found closing *
                        const matchStart = lineOffset + i;
                        const matchEnd = lineOffset + j + 1;
                        const contentStart = matchStart + 1;
                        const contentEnd = matchEnd - 1;
                        
                        const cursorInside = cursorOffset >= matchStart && cursorOffset <= matchEnd;
                        
                        const start = this.buffer.get_iter_at_offset(matchStart);
                        const end = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('italic', start, end);
                        
                        if (cursorInside) {
                            const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                            const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                            this._applyTag('dim', syntaxStart1, syntaxEnd1);
                            
                            const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                            const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                            this._applyTag('dim', syntaxStart2, syntaxEnd2);
                        } else {
                            const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                            const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                            this._applyTag('invisible', syntaxStart1, syntaxEnd1);
                            
                            const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                            const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                            this._applyTag('invisible', syntaxStart2, syntaxEnd2);
                        }
                        break;
                    }
                }
            } else if (line[i] === '_' && line[i+1] !== '_' && (i === 0 || line[i-1] !== '_')) {
                // Found a potential opening _
                for (let j = i + 1; j < line.length; j++) {
                    if (line[j] === '_' && (j === line.length - 1 || line[j+1] !== '_') && line[j-1] !== '_') {
                        // Found closing _
                        const matchStart = lineOffset + i;
                        const matchEnd = lineOffset + j + 1;
                        const contentStart = matchStart + 1;
                        const contentEnd = matchEnd - 1;
                        
                        const cursorInside = cursorOffset >= matchStart && cursorOffset <= matchEnd;
                        
                        const start = this.buffer.get_iter_at_offset(matchStart);
                        const end = this.buffer.get_iter_at_offset(matchEnd);
                        this._applyTag('italic', start, end);
                        
                        if (cursorInside) {
                            const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                            const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                            this._applyTag('dim', syntaxStart1, syntaxEnd1);
                            
                            const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                            const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                            this._applyTag('dim', syntaxStart2, syntaxEnd2);
                        } else {
                            const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                            const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                            this._applyTag('invisible', syntaxStart1, syntaxEnd1);
                            
                            const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                            const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                            this._applyTag('invisible', syntaxStart2, syntaxEnd2);
                        }
                        break;
                    }
                }
            }
        }
    }
    
    _applyPatternWithCursor(line, lineOffset, cursorOffset, regex, tagName) {
        let match;
        regex.lastIndex = 0;
        
        while ((match = regex.exec(line)) !== null) {
            const matchStart = lineOffset + match.index;
            const matchEnd = matchStart + match[0].length;
            const contentStart = matchStart + match[0].indexOf(match[match.length - 1]);
            const contentEnd = contentStart + match[match.length - 1].length;
            
            // Check if cursor is inside this pattern
            const cursorInside = cursorOffset >= matchStart && cursorOffset <= matchEnd;
            
            // Apply formatting tag to entire match
            const start = this.buffer.get_iter_at_offset(matchStart);
            const end = this.buffer.get_iter_at_offset(matchEnd);
            this._applyTag(tagName, start, end);
            
            // Show syntax markers only when cursor is inside
            if (cursorInside) {
                // Dim the syntax markers (visible but subtle)
                const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                this._applyTag('dim', syntaxStart1, syntaxEnd1);
                
                const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                this._applyTag('dim', syntaxStart2, syntaxEnd2);
            } else {
                // Cursor is outside - make syntax invisible
                const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                this._applyTag('invisible', syntaxStart1, syntaxEnd1);
                
                const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                this._applyTag('invisible', syntaxStart2, syntaxEnd2);
            }
        }
    }
    
    _applyLinkPatternWithCursor(line, lineOffset, cursorOffset) {
        const regex = /\[(.+?)\]\((.+?)\)/g;
        let match;
        
        while ((match = regex.exec(line)) !== null) {
            const [fullMatch, text, url] = match;
            const matchStart = lineOffset + match.index;
            const textStart = matchStart + 1;
            const textEnd = textStart + text.length;
            const urlStart = textEnd + 2;
            const urlEnd = urlStart + url.length;
            const matchEnd = urlEnd + 1;
            
            const cursorInside = cursorOffset >= matchStart && cursorOffset <= matchEnd;
            
            // Apply link tag to text
            const linkStart = this.buffer.get_iter_at_offset(textStart);
            const linkEnd = this.buffer.get_iter_at_offset(textEnd);
            this._applyTag('link', linkStart, linkEnd);
            
            // Show URL and syntax when cursor is inside
            if (cursorInside) {
                // Apply link-url tag to URL (visible)
                const urlStartIter = this.buffer.get_iter_at_offset(urlStart);
                const urlEndIter = this.buffer.get_iter_at_offset(urlEnd);
                this._applyTag('link-url', urlStartIter, urlEndIter);
                
                // Dim the brackets and parentheses
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this._applyTag('dim', bracket1, bracket2);
                
                const bracket3 = this.buffer.get_iter_at_offset(textEnd);
                const bracket4 = this.buffer.get_iter_at_offset(textEnd + 1);
                this._applyTag('dim', bracket3, bracket4);
                
                const paren1 = this.buffer.get_iter_at_offset(urlStart - 1);
                const paren2 = this.buffer.get_iter_at_offset(urlStart);
                this._applyTag('dim', paren1, paren2);
                
                const paren3 = this.buffer.get_iter_at_offset(urlEnd);
                const paren4 = this.buffer.get_iter_at_offset(urlEnd + 1);
                this._applyTag('dim', paren3, paren4);
            } else {
                // Hide URL and syntax when cursor is outside
                const urlStartIter = this.buffer.get_iter_at_offset(urlStart);
                const urlEndIter = this.buffer.get_iter_at_offset(urlEnd);
                this._applyTag('invisible', urlStartIter, urlEndIter);
                
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this._applyTag('invisible', bracket1, bracket2);
                
                const bracket3 = this.buffer.get_iter_at_offset(textEnd);
                const bracket4 = this.buffer.get_iter_at_offset(textEnd + 1);
                this._applyTag('invisible', bracket3, bracket4);
                
                const paren1 = this.buffer.get_iter_at_offset(urlStart - 1);
                const paren2 = this.buffer.get_iter_at_offset(urlStart);
                this._applyTag('invisible', paren1, paren2);
                
                const paren3 = this.buffer.get_iter_at_offset(urlEnd);
                const paren4 = this.buffer.get_iter_at_offset(urlEnd + 1);
                this._applyTag('invisible', paren3, paren4);
            }
        }
    }
    
    _applyTodoPatternWithCursor(line, lineOffset, cursorOffset) {
        // Match [ ] for unchecked or [X] for checked (also [x] lowercase)
        const regex = /\[([ Xx])\]/g;
        let match;
        
        while ((match = regex.exec(line)) !== null) {
            const matchStart = lineOffset + match.index;
            const matchEnd = matchStart + 3; // Length of [ ] or [X]
            const checkChar = match[1];
            const isChecked = checkChar === 'X' || checkChar === 'x';
            
            const cursorInside = cursorOffset >= matchStart && cursorOffset <= matchEnd;
            
            if (cursorInside) {
                print(`Todo cursor INSIDE at ${cursorOffset}, range: ${matchStart}-${matchEnd}`);
            }
            
            // Apply the base tag for the entire checkbox
            const start = this.buffer.get_iter_at_offset(matchStart);
            const end = this.buffer.get_iter_at_offset(matchEnd);
            
            if (cursorInside) {
                // When cursor is inside, use tags without background
                this._applyTag(isChecked ? 'todo-checked-inside' : 'todo-unchecked-inside', start, end);
                
                // Show the actual syntax when cursor is inside - dim everything (brackets and X)
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this._applyTag('dim', bracket1, bracket2);
                
                // Dim the middle character (X or space) as well
                const middle1 = this.buffer.get_iter_at_offset(matchStart + 1);
                const middle2 = this.buffer.get_iter_at_offset(matchStart + 2);
                this._applyTag('dim', middle1, middle2);
                
                const bracket3 = this.buffer.get_iter_at_offset(matchEnd - 1);
                const bracket4 = this.buffer.get_iter_at_offset(matchEnd);
                this._applyTag('dim', bracket3, bracket4);
            } else {
                // When cursor is outside, use tags with background
                this._applyTag(isChecked ? 'todo-checked' : 'todo-unchecked', start, end);
                
                // Hide the brackets to make it look cleaner
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this._applyTag('invisible', bracket1, bracket2);
                
                const bracket3 = this.buffer.get_iter_at_offset(matchEnd - 1);
                const bracket4 = this.buffer.get_iter_at_offset(matchEnd);
                this._applyTag('invisible', bracket3, bracket4);
            }
            
            // If checked, apply strikethrough and dimming to the text after the checkbox
            if (isChecked) {
                // Find text after the checkbox (skip any spaces after the checkbox)
                const textAfterCheckbox = line.substring(match.index + 3); // Everything after [X]
                const textMatch = textAfterCheckbox.match(/^\s*/); // Find leading spaces
                const spacesLength = textMatch ? textMatch[0].length : 0;
                const textStart = matchEnd + spacesLength;
                const textEnd = lineOffset + line.length;
                
                // Apply strikethrough and dimming to the text after the checkbox
                if (textStart < textEnd) {
                    const textStartIter = this.buffer.get_iter_at_offset(textStart);
                    const textEndIter = this.buffer.get_iter_at_offset(textEnd);
                    this._applyTag('todo-checked-text', textStartIter, textEndIter);
                }
            }
        }
    }
    
    _applyTablePattern(line, lineOffset) {
        // Check if this line looks like a table row (contains pipes)
        if (!line.includes('|')) return;
        
        // Check if it's a separator line (|---|---|---| or | --- | --- | --- |)
        const isSeparator = /^\s*\|[\s\-:|]+\|\s*$/.test(line);
        
        // Find all pipe positions and apply styling
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '|') {
                const pipeStart = this.buffer.get_iter_at_offset(lineOffset + i);
                const pipeEnd = this.buffer.get_iter_at_offset(lineOffset + i + 1);
                this._applyTag('table-pipe', pipeStart, pipeEnd);
            }
        }
        
        // If it's a separator line, style the dashes and colons
        if (isSeparator) {
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '-' || line[i] === ':') {
                    const charStart = this.buffer.get_iter_at_offset(lineOffset + i);
                    const charEnd = this.buffer.get_iter_at_offset(lineOffset + i + 1);
                    this._applyTag('table-separator', charStart, charEnd);
                }
            }
        }
    }
    
    _applyTablePatternWithCursor(line, lineOffset, cursorOffset) {
        // Check if this line looks like a table row (contains pipes)
        if (!line.includes('|')) return;
        
        // Check if it's a separator line (|---|---|---| or | --- | --- | --- |)
        const isSeparator = /^\s*\|[\s\-:|]+\|\s*$/.test(line);
        
        // Check if it's a header line (we need to look back one line, but for simplicity
        // we'll check if the current line has pipes and the text isn't all dashes)
        const isHeader = !isSeparator && line.trim().startsWith('|');
        
        const cursorOnLine = cursorOffset >= lineOffset && cursorOffset <= lineOffset + line.length;
        
        // Find all pipe positions and apply styling
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '|') {
                const pipeStart = this.buffer.get_iter_at_offset(lineOffset + i);
                const pipeEnd = this.buffer.get_iter_at_offset(lineOffset + i + 1);
                
                if (cursorOnLine) {
                    // Show pipes when cursor is on the line
                    this._applyTag('table-pipe', pipeStart, pipeEnd);
                } else {
                    // Dim pipes when cursor is away
                    this._applyTag('table-pipe', pipeStart, pipeEnd);
                }
            }
        }
        
        // If it's a separator line, style the dashes and colons
        if (isSeparator) {
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '-' || line[i] === ':') {
                    const charStart = this.buffer.get_iter_at_offset(lineOffset + i);
                    const charEnd = this.buffer.get_iter_at_offset(lineOffset + i + 1);
                    this._applyTag('table-separator', charStart, charEnd);
                }
            }
        }
        
        // Parse cells and apply header styling if this is the first row
        if (!isSeparator) {
            const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell.length > 0);
            
            // Find cell positions and apply header styling
            let currentPos = line.indexOf('|') + 1;
            for (const cell of cells) {
                const cellStart = line.indexOf(cell, currentPos);
                if (cellStart !== -1) {
                    const start = this.buffer.get_iter_at_offset(lineOffset + cellStart);
                    const end = this.buffer.get_iter_at_offset(lineOffset + cellStart + cell.length);
                    
                    // Apply header tag to cells (in real implementation, we'd need to track
                    // whether this is actually a header row by looking at the next line)
                    // For now, we'll style all table content
                    this._applyTag('table-cell', start, end);
                    
                    currentPos = cellStart + cell.length + 1;
                }
            }
        }
    }
}

// ============================================================================
// File Manager
// ============================================================================

class FileManager {
    static getJotDirectory() {
        const homeDir = GLib.get_home_dir();
        return GLib.build_filenamev([homeDir, ...JOT_DIR]);
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
        return `${now.format('%Y-%m-%d')}.md`;
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
            flags: Gio.ApplicationFlags.HANDLES_OPEN | Gio.ApplicationFlags.NON_UNIQUE,
        });
        this._fileToOpen = null;
        
        // Ensure font is installed
        this._ensureFontInstalled();
    }
    
    _ensureFontInstalled() {
        try {
            // Check if font is already installed by checking fontconfig
            const checkCmd = ['fc-list', ':', 'family', 'file'];
            const [, checkOutput] = GLib.spawn_command_line_sync(checkCmd.join(' '));
            const fontList = new TextDecoder().decode(checkOutput);
            
            if (fontList.toLowerCase().includes('pxlxxl')) {
                print('Font pxlxxl already installed');
                return;
            }
            
            print('Font pxlxxl not found, installing...');
            
            // Try multiple methods to find the script directory
            let scriptPath = null;
            
            // Method 1: Try using imports.system.programInvocationName (the actual script path)
            if (imports.system.programInvocationName) {
                const invocationPath = imports.system.programInvocationName;
                print(`Trying invocation path: ${invocationPath}`);
                if (invocationPath.startsWith('./') || invocationPath.startsWith('/')) {
                    scriptPath = GLib.path_get_dirname(GLib.canonicalize_filename(invocationPath, GLib.get_current_dir()));
                }
            }
            
            // Method 2: Try programPath
            if (!scriptPath) {
                scriptPath = GLib.path_get_dirname(imports.system.programPath);
                print(`Trying program path: ${scriptPath}`);
            }
            
            // Method 3: Check current directory
            if (!scriptPath || scriptPath === '/usr/bin') {
                scriptPath = GLib.get_current_dir();
                print(`Trying current directory: ${scriptPath}`);
            }
            
            const fontSourcePath = GLib.build_filenamev([scriptPath, 'pxlxxl.ttf']);
            print(`Looking for font at: ${fontSourcePath}`);
            
            // Check if font file exists in script directory
            const fontFile = Gio.File.new_for_path(fontSourcePath);
            if (!fontFile.query_exists(null)) {
                print(`Warning: Font file not found at ${fontSourcePath}`);
                print('Please ensure pxlxxl.ttf is in the same directory as jot.js');
                return;
            }
            
            print('Found font file, installing...');
            
            // Install to user fonts directory
            const fontDir = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'fonts', 'jot']);
            const fontDirFile = Gio.File.new_for_path(fontDir);
            
            // Create directory if it doesn't exist
            if (!fontDirFile.query_exists(null)) {
                print(`Creating font directory: ${fontDir}`);
                fontDirFile.make_directory_with_parents(null);
            }
            
            // Copy font file
            const fontDestPath = GLib.build_filenamev([fontDir, 'pxlxxl.ttf']);
            const fontDestFile = Gio.File.new_for_path(fontDestPath);
            print(`Copying font to: ${fontDestPath}`);
            fontFile.copy(fontDestFile, Gio.FileCopyFlags.OVERWRITE, null, null);
            
            // Update font cache
            print('Updating font cache...');
            const updateCmd = ['fc-cache', '-f', fontDir];
            const [cacheSuccess, cacheOutput, cacheError] = GLib.spawn_command_line_sync(updateCmd.join(' '));
            
            if (!cacheSuccess) {
                print(`Warning: fc-cache failed: ${new TextDecoder().decode(cacheError)}`);
            }
            
            print(`✓ Font installed successfully to ${fontDir}`);
            print('  Note: You may need to restart the application for the font to be available');
        } catch (e) {
            print(`ERROR: Could not auto-install font: ${e.message}`);
            print(`Stack trace: ${e.stack || 'N/A'}`);
        }
    }

    vfunc_activate() {
        // Always create a new window to allow multiple instances
        const window = new JotWindow(this);

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
        this._currentFilePath = null; // Track the full path of opened file
        this._themeManager = new ThemeManager();
        this._zoomLevel = 100; // Zoom level percentage (default 100%)
        this._zoomTimeoutId = null; // Track zoom indicator timeout
        this._filenameUpdateTimeoutId = null; // Track filename update debouncing
        this._markdownRenderer = null; // Will be initialized after textview is created
        this._lineMovePending = false; // Throttle line move operations

        this._buildUI();
        this._setupTheme();
        this._setupKeyboardShortcuts();

        // Initialize with default header with today's date
        const buffer = this._textView.get_buffer();
        const now = GLib.DateTime.new_now_local();
        const todayDate = now.format('%Y-%m-%d');
        const initialText = `# ${todayDate}`;
        buffer.set_text(initialText, -1);
        const iter = buffer.get_iter_at_offset(initialText.length); // Position at end
        buffer.place_cursor(iter);
        
        this._textView.grab_focus();
    }

    _buildUI() {
        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        mainBox.append(this._createTextView());
        mainBox.append(this._createStatusBar());

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

        // Initialize markdown renderer
        this._markdownRenderer = new MarkdownRenderer(
            this._textView,
            this._themeManager.colors
        );

        // Connect to buffer changes to update filename with debouncing (200ms delay)
        const buffer = this._textView.get_buffer();
        buffer.connect('changed', () => {
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

        // Setup bullet list keyboard handlers
        this._setupBulletListHandlers();

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

    _setupBulletListHandlers() {
        const buffer = this._textView.get_buffer();
        const keyController = new Gtk.EventControllerKey();
        
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            // Get current position and line
            const cursor = buffer.get_insert();
            const iter = buffer.get_iter_at_mark(cursor);
            const cursorOffset = iter.get_offset();
            
            // Get all text and find current line
            const [start, end] = buffer.get_bounds();
            const allText = buffer.get_text(start, end, false);
            const lines = allText.split('\n');
            
            // Find which line we're on
            let offset = 0;
            let currentLineNum = 0;
            let lineText = '';
            let lineStartOffset = 0;
            
            for (let i = 0; i < lines.length; i++) {
                const lineLength = lines[i].length;
                if (cursorOffset >= offset && cursorOffset <= offset + lineLength) {
                    currentLineNum = i;
                    lineText = lines[i];
                    lineStartOffset = offset;
                    break;
                }
                offset += lineLength + 1; // +1 for newline
            }
            
            if (lineText === undefined) {
                lineText = lines[lines.length - 1] || '';
                lineStartOffset = offset;
            }
            
            // Handle Enter key (65293)
            if (keyval === 65293 && !(state & CTRL_MASK)) {
                print('Enter key detected on bullet list handler');
                const bulletMatch = lineText.match(/^(\s*)([-*])\s+(.*)$/);
                if (bulletMatch) {
                    print('Bullet line detected!');
                    const [, indent, bullet, content] = bulletMatch;
                    
                    // Check if this is a todo item (has [ ] or [X] or [x])
                    const hasTodo = content.match(/^\[([ Xx])\]\s*/);
                    
                    // If line is empty bullet (or empty todo), remove it and exit list
                    if (!content.trim() || (hasTodo && !content.slice(hasTodo[0].length).trim())) {
                        print('Empty bullet, removing');
                        const lineStart = buffer.get_iter_at_offset(lineStartOffset);
                        const lineEnd = buffer.get_iter_at_offset(lineStartOffset + lineText.length);
                        buffer.delete(lineStart, lineEnd);
                        return true;
                    }
                    
                    // Insert new bullet on next line
                    print('Adding new bullet');
                    let newBullet;
                    if (hasTodo) {
                        // If current line has a todo checkbox, add [ ] to the new line
                        newBullet = `\n${indent}${bullet} [ ] `;
                    } else {
                        // Normal bullet without todo checkbox
                        newBullet = `\n${indent}${bullet} `;
                    }
                    buffer.insert_at_cursor(newBullet, -1);
                    return true;
                }
            }
            
            // Handle Tab key (65289)
            if (keyval === 65289 && !(state & CTRL_MASK)) {
                print('Tab key detected');
                
                // Check if there's a selection
                const [hasSelection, selStart, selEnd] = buffer.get_selection_bounds();
                
                if (hasSelection) {
                    // Multi-line selection: indent all selected bullet lines
                    const selStartOffset = selStart.get_offset();
                    const selEndOffset = selEnd.get_offset();
                    
                    // Find which lines are selected
                    let offset = 0;
                    let firstLineNum = -1;
                    let lastLineNum = -1;
                    
                    for (let i = 0; i < lines.length; i++) {
                        const lineLength = lines[i].length;
                        const lineEndOffset = offset + lineLength;
                        
                        // Check if this line is partially or fully selected
                        if (selStartOffset <= lineEndOffset && selEndOffset >= offset) {
                            if (firstLineNum === -1) firstLineNum = i;
                            lastLineNum = i;
                        }
                        
                        offset += lineLength + 1; // +1 for newline
                    }
                    
                    if (firstLineNum !== -1 && lastLineNum !== -1) {
                        // Check if any selected lines are bullets
                        let anyBullets = false;
                        for (let i = firstLineNum; i <= lastLineNum; i++) {
                            if (lines[i].match(/^(\s*)([-*])(\s+.*)$/)) {
                                anyBullets = true;
                                break;
                            }
                        }
                        
                        if (anyBullets) {
                            print(`Indenting ${lastLineNum - firstLineNum + 1} lines`);
                            
                            // Find which line the selection start is on
                            let selStartLineNum = -1;
                            let lineOffset = 0;
                            for (let i = 0; i < lines.length; i++) {
                                const lineEnd = lineOffset + lines[i].length;
                                if (selStartOffset >= lineOffset && selStartOffset <= lineEnd) {
                                    selStartLineNum = i;
                                    break;
                                }
                                lineOffset += lines[i].length + 1; // +1 for newline
                            }
                            
                            // Build the new text with all lines indented
                            const newLines = [];
                            let spacesAddedAtOrBeforeSelStart = 0;
                            let totalSpacesAdded = 0;
                            
                            for (let i = 0; i < lines.length; i++) {
                                if (i >= firstLineNum && i <= lastLineNum) {
                                    const bulletMatch = lines[i].match(/^(\s*)([-*])(\s+.*)$/);
                                    if (bulletMatch) {
                                        const [, indent, bullet, rest] = bulletMatch;
                                        newLines.push(`  ${indent}${bullet}${rest}`);
                                        
                                        // Track spaces added up to and including selection start line
                                        if (i <= selStartLineNum) {
                                            spacesAddedAtOrBeforeSelStart += 2;
                                        }
                                        totalSpacesAdded += 2;
                                    } else {
                                        newLines.push(lines[i]);
                                    }
                                } else {
                                    newLines.push(lines[i]);
                                }
                            }
                            
                            // Replace all text as a single undo action
                            buffer.begin_user_action();
                            const [bufStart, bufEnd] = buffer.get_bounds();
                            buffer.delete(bufStart, bufEnd);
                            buffer.insert(bufStart, newLines.join('\n'), -1);
                            
                            // Restore selection (adjusted for added spaces)
                            const newSelStart = buffer.get_iter_at_offset(selStartOffset + spacesAddedAtOrBeforeSelStart);
                            const newSelEnd = buffer.get_iter_at_offset(selEndOffset + totalSpacesAdded);
                            buffer.select_range(newSelStart, newSelEnd);
                            buffer.end_user_action();
                            
                            // Force immediate re-render to avoid visual glitch
                            if (this._markdownRenderer) {
                                this._markdownRenderer._updateSyntaxVisibility();
                            }
                            
                            return true;
                        }
                    }
                } else {
                    // Single line: original behavior
                    const bulletMatch = lineText.match(/^(\s*)([-*])(\s+.*)$/);
                    if (bulletMatch) {
                        print('Indenting bullet');
                        const [, indent, bullet, rest] = bulletMatch;
                        const newLine = `  ${indent}${bullet}${rest}`;
                        
                        // Wrap in user action for proper undo
                        buffer.begin_user_action();
                        const lineStart = buffer.get_iter_at_offset(lineStartOffset);
                        const lineEnd = buffer.get_iter_at_offset(lineStartOffset + lineText.length);
                        buffer.delete(lineStart, lineEnd);
                        const insertIter = buffer.get_iter_at_offset(lineStartOffset);
                        buffer.insert(insertIter, newLine, -1);
                        buffer.end_user_action();
                        
                        // Force immediate re-render to avoid visual glitch
                        if (this._markdownRenderer) {
                            this._markdownRenderer._updateSyntaxVisibility();
                        }
                        
                        return true;
                    }
                }
            }
            
            // Handle Shift+Tab key (ISO_Left_Tab = 65056)
            if (keyval === 65056) {
                print('Shift+Tab detected');
                
                // Check if there's a selection
                const [hasSelection, selStart, selEnd] = buffer.get_selection_bounds();
                
                if (hasSelection) {
                    // Multi-line selection: outdent all selected bullet lines
                    const selStartOffset = selStart.get_offset();
                    const selEndOffset = selEnd.get_offset();
                    
                    // Find which lines are selected
                    let offset = 0;
                    let firstLineNum = -1;
                    let lastLineNum = -1;
                    
                    for (let i = 0; i < lines.length; i++) {
                        const lineLength = lines[i].length;
                        const lineEndOffset = offset + lineLength;
                        
                        // Check if this line is partially or fully selected
                        if (selStartOffset <= lineEndOffset && selEndOffset >= offset) {
                            if (firstLineNum === -1) firstLineNum = i;
                            lastLineNum = i;
                        }
                        
                        offset += lineLength + 1; // +1 for newline
                    }
                    
                    if (firstLineNum !== -1 && lastLineNum !== -1) {
                        // Check if any selected lines are bullets with indentation
                        let anyIndentedBullets = false;
                        for (let i = firstLineNum; i <= lastLineNum; i++) {
                            if (lines[i].match(/^(\s+)([-*])(\s+.*)$/)) {
                                anyIndentedBullets = true;
                                break;
                            }
                        }
                        
                        if (anyIndentedBullets) {
                            print(`Outdenting ${lastLineNum - firstLineNum + 1} lines`);
                            
                            // Find which line the selection start is on
                            let selStartLineNum = -1;
                            let lineOffset = 0;
                            for (let i = 0; i < lines.length; i++) {
                                const lineEnd = lineOffset + lines[i].length;
                                if (selStartOffset >= lineOffset && selStartOffset <= lineEnd) {
                                    selStartLineNum = i;
                                    break;
                                }
                                lineOffset += lines[i].length + 1; // +1 for newline
                            }
                            
                            // Build the new text with all lines outdented
                            const newLines = [];
                            let spacesRemovedAtOrBeforeSelStart = 0;
                            let totalSpacesRemoved = 0;
                            
                            for (let i = 0; i < lines.length; i++) {
                                if (i >= firstLineNum && i <= lastLineNum) {
                                    const bulletMatch = lines[i].match(/^(\s+)([-*])(\s+.*)$/);
                                    if (bulletMatch) {
                                        const [, indent, bullet, rest] = bulletMatch;
                                        // Remove up to 2 spaces
                                        const spacesRemoved = Math.min(2, indent.length);
                                        const newIndent = indent.substring(spacesRemoved);
                                        newLines.push(`${newIndent}${bullet}${rest}`);
                                        
                                        // Track spaces removed up to and including selection start line
                                        if (i <= selStartLineNum) {
                                            spacesRemovedAtOrBeforeSelStart += spacesRemoved;
                                        }
                                        totalSpacesRemoved += spacesRemoved;
                                    } else {
                                        newLines.push(lines[i]);
                                    }
                                } else {
                                    newLines.push(lines[i]);
                                }
                            }
                            
                            // Replace all text as a single undo action
                            buffer.begin_user_action();
                            const [bufStart, bufEnd] = buffer.get_bounds();
                            buffer.delete(bufStart, bufEnd);
                            buffer.insert(bufStart, newLines.join('\n'), -1);
                            
                            // Restore selection (adjusted for removed spaces)
                            const newSelStart = buffer.get_iter_at_offset(Math.max(0, selStartOffset - spacesRemovedAtOrBeforeSelStart));
                            const newSelEnd = buffer.get_iter_at_offset(Math.max(0, selEndOffset - totalSpacesRemoved));
                            buffer.select_range(newSelStart, newSelEnd);
                            buffer.end_user_action();
                            
                            // Force immediate re-render to avoid visual glitch
                            if (this._markdownRenderer) {
                                this._markdownRenderer._updateSyntaxVisibility();
                            }
                            
                            return true;
                        }
                    }
                } else {
                    // Single line: original behavior
                    const bulletMatch = lineText.match(/^(\s+)([-*])(\s+.*)$/);
                    if (bulletMatch) {
                        print('Outdenting bullet');
                        const [, indent, bullet, rest] = bulletMatch;
                        // Remove up to 2 spaces
                        const newIndent = indent.length >= 2 ? indent.substring(2) : '';
                        const newLine = `${newIndent}${bullet}${rest}`;
                        
                        // Wrap in user action for proper undo
                        buffer.begin_user_action();
                        const lineStart = buffer.get_iter_at_offset(lineStartOffset);
                        const lineEnd = buffer.get_iter_at_offset(lineStartOffset + lineText.length);
                        buffer.delete(lineStart, lineEnd);
                        const insertIter = buffer.get_iter_at_offset(lineStartOffset);
                        buffer.insert(insertIter, newLine, -1);
                        buffer.end_user_action();
                        
                        // Force immediate re-render to avoid visual glitch
                        if (this._markdownRenderer) {
                            this._markdownRenderer._updateSyntaxVisibility();
                        }
                        
                        return true;
                    }
                }
            }
            
            // Handle Ctrl+X: Cut entire line if no text is selected
            if (keyval === KEY_X && (state & CTRL_MASK)) {
                print('Ctrl+X detected in textview handler');
                const [hasSelection, selStart, selEnd] = buffer.get_selection_bounds();
                
                if (!hasSelection) {
                    print('No selection - cutting entire line');
                    // No text selected - cut the entire line
                    const cursor = buffer.get_insert();
                    const iter = buffer.get_iter_at_mark(cursor);
                    
                    // Get line start
                    const lineStart = iter.copy();
                    lineStart.set_line_offset(0);
                    
                    // Get line end (including the newline character if it exists)
                    const lineEnd = iter.copy();
                    if (!lineEnd.ends_line()) {
                        lineEnd.forward_to_line_end();
                    }
                    // Include the newline character
                    if (!lineEnd.is_end()) {
                        lineEnd.forward_char();
                    }
                    
                    // Get the clipboard
                    const clipboard = this._textView.get_clipboard();
                    
                    // Copy line text to clipboard (GTK4 API)
                    const lineText = buffer.get_text(lineStart, lineEnd, false);
                    clipboard.set(lineText);
                    
                    // Delete the line
                    buffer.delete(lineStart, lineEnd);
                    
                    print('Line cut to clipboard');
                    return true;
                }
                print('Selection exists - using default cut');
                // If text is already selected, let the default cut handler process it
                return false;
            }
            
            // Handle Ctrl+Up: Move line up
            if (keyval === KEY_UP && (state & CTRL_MASK)) {
                print('Ctrl+Up detected');
                this._moveLineUp();
                return true;
            }
            
            // Handle Ctrl+Down: Move line down
            if (keyval === KEY_DOWN && (state & CTRL_MASK)) {
                print('Ctrl+Down detected');
                this._moveLineDown();
                return true;
            }
            
            return false;
        });
        
        this._textView.add_controller(keyController);
        print('Bullet list handlers installed');
    }

    _createStatusBar() {
        this._statusBar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 16,
            height_request: 24,
            margin_start: 0,
            margin_end: 0,
            margin_top: 4,
            margin_bottom: 4,
        });
        this._statusBar.add_css_class('jot-statusbar');

        const jotDir = FileManager.getJotDirectory();
        this._pathLabel = new Gtk.Label({
            label: GLib.build_filenamev([jotDir, this._currentFilename]),
            halign: Gtk.Align.START,
            hexpand: true,
            ellipsize: 3,
            margin_start: 8,
        });
        this._pathLabel.add_css_class('status-label');

        this._statusBar.append(this._pathLabel);

        return this._statusBar;
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
        openButton.connect('clicked', () => this._openFileDialog());

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
            
            if (state & ALT_MASK) {
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
            print('Theme file changed, reloading...');
            this._reloadTheme();
        });
        
        // Also monitor GTK theme changes from the system
        const gtkSettings = Gtk.Settings.get_default();
        if (gtkSettings) {
            let reloadTimeout = null;
            
            // Monitor when GTK theme name changes
            gtkSettings.connect('notify::gtk-theme-name', () => {
                print('GTK theme changed, scheduling reload...');
                if (reloadTimeout) GLib.source_remove(reloadTimeout);
                reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._reloadTheme();
                    reloadTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            });
            
            // Monitor dark mode preference changes
            gtkSettings.connect('notify::gtk-application-prefer-dark-theme', () => {
                print('Dark mode preference changed, scheduling reload...');
                if (reloadTimeout) GLib.source_remove(reloadTimeout);
                reloadTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._reloadTheme();
                    reloadTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            });
            
            print('GTK theme monitoring enabled');
        }
    }
    
    _reloadTheme() {
        print('Reloading theme completely...');
        // Reload colors from file
        const oldBackground = this._themeManager.colors.background;
        this._themeManager.colors = this._themeManager._loadColors();
        const newBackground = this._themeManager.colors.background;
        print(`Background color changed from ${oldBackground} to ${newBackground}`);
        // Apply new CSS
        this._applyCSS();
        // Force a full redraw
        this.queue_draw();
        if (this._textView) {
            this._textView.queue_draw();
        }
        print('Theme reload complete');
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

    _setupKeyboardShortcuts() {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            if ((keyval === KEY_ENTER || keyval === KEY_S) && (state & CTRL_MASK) && !(state & SHIFT_MASK)) {
                this._saveNote();
                return true;
            }
            if ((keyval === KEY_S_UPPER || keyval === KEY_S) && (state & CTRL_MASK) && (state & SHIFT_MASK)) {
                this._showSaveAsDialog();
                return true;
            }
            if (keyval === KEY_N && (state & CTRL_MASK)) {
                this._newFile();
                return true;
            }
            if (keyval === KEY_O && (state & CTRL_MASK)) {
                this._openFileDialog();
                return true;
            }
            // Zoom in: Ctrl + or Ctrl = (multiple keycodes for compatibility)
            if ((keyval === KEY_PLUS || keyval === 43 || keyval === 61 || keyval === 65451 || keyval === 65455) && (state & CTRL_MASK)) {
                this._zoomIn();
                return true;
            }
            // Zoom out: Ctrl - (multiple keycodes for compatibility)
            if ((keyval === KEY_MINUS || keyval === 45 || keyval === 95 || keyval === 65109 || keyval === 65453) && (state & CTRL_MASK)) {
                this._zoomOut();
                return true;
            }
            // Reset zoom: Ctrl 0
            if (keyval === KEY_0 && (state & CTRL_MASK)) {
                this._zoomReset();
                return true;
            }
            return false;
        });
        this.add_controller(keyController);
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
        // If a file is already opened, don't change the path
        if (this._currentFilePath) {
            return;
        }

        const title = this._extractTitleFromContent();
        this._currentFilename = FileManager.generateFilename(title);

        const jotDir = FileManager.getJotDirectory();
        this._pathLabel.set_label(GLib.build_filenamev([jotDir, this._currentFilename]));
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
        FILE_PATTERNS.forEach(pattern => filter.add_pattern(pattern));
        filter.set_name(FILE_FILTER_NAME);
        dialog.add_filter(filter);
        
        // Set initial folder to Jot directory
        FileManager.ensureJotDirectoryExists();
        const jotDir = FileManager.getJotDirectory();
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
            this._pathLabel.set_label(this._currentFilePath);
            
            print(`Note saved to ${this._currentFilePath}`);
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

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, FEEDBACK_TIMEOUT_MS, () => {
            // Restore to actual path, not captured label
            const actualPath = this._currentFilePath || 
                               GLib.build_filenamev([FileManager.getJotDirectory(), this._currentFilename]);
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
                               GLib.build_filenamev([FileManager.getJotDirectory(), this._currentFilename]);
            this._pathLabel.set_label(actualPath);
            this._zoomTimeoutId = null;
            return false;
        });
    }

    _moveLineUp() {
        // Throttle to prevent overwhelming the UI when holding down the key
        if (this._lineMovePending) {
            return;
        }
        this._lineMovePending = true;
        
        const buffer = this._textView.get_buffer();
        const cursor = buffer.get_insert();
        const iter = buffer.get_iter_at_mark(cursor);
        const currentLineNum = iter.get_line();
        
        // Can't move the first line up
        if (currentLineNum === 0) {
            this._lineMovePending = false;
            return;
        }
        
        // Calculate cursor position within the line
        const cursorOffset = iter.get_line_offset();
        
        // Get all text and split into lines
        const [start, end] = buffer.get_bounds();
        const allText = buffer.get_text(start, end, false);
        const lines = allText.split('\n');
        
        const currentLineText = lines[currentLineNum];
        const prevLineText = lines[currentLineNum - 1];
        
        // Calculate byte offsets for the two lines
        let prevLineStart = 0;
        for (let i = 0; i < currentLineNum - 1; i++) {
            prevLineStart += lines[i].length + 1; // +1 for newline
        }
        const currentLineStart = prevLineStart + prevLineText.length + 1;
        const currentLineEnd = currentLineStart + currentLineText.length;
        
        // Delete both lines and replace with swapped version
        const deleteStart = buffer.get_iter_at_offset(prevLineStart);
        const deleteEnd = buffer.get_iter_at_offset(currentLineEnd);
        
        buffer.begin_user_action();
        buffer.delete(deleteStart, deleteEnd);
        
        const insertIter = buffer.get_iter_at_offset(prevLineStart);
        buffer.insert(insertIter, `${currentLineText}\n${prevLineText}`, -1);
        
        // Move cursor to the new position (one line up, same offset)
        const newCursorOffset = prevLineStart + Math.min(cursorOffset, currentLineText.length);
        const newCursorIter = buffer.get_iter_at_offset(newCursorOffset);
        buffer.place_cursor(newCursorIter);
        
        buffer.end_user_action();
        
        // Cancel any pending debounced renders and trigger immediate re-render
        if (this._markdownRenderer) {
            // Cancel pending timeouts
            if (this._markdownRenderer._renderTimeoutId) {
                GLib.source_remove(this._markdownRenderer._renderTimeoutId);
                this._markdownRenderer._renderTimeoutId = null;
            }
            if (this._markdownRenderer._cursorTimeoutId) {
                GLib.source_remove(this._markdownRenderer._cursorTimeoutId);
                this._markdownRenderer._cursorTimeoutId = null;
            }
            // Reset the flag so cursor movements work again
            this._markdownRenderer._textJustChanged = false;
            // Do immediate render
            this._markdownRenderer._updateSyntaxVisibility();
        }
        
        this._textView.scroll_mark_onscreen(buffer.get_insert());
        
        // Reset throttle flag after a short delay to allow smooth but not overwhelming repeats
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            this._lineMovePending = false;
            return false;
        });
    }

    _moveLineDown() {
        // Throttle to prevent overwhelming the UI when holding down the key
        if (this._lineMovePending) {
            return;
        }
        this._lineMovePending = true;
        
        const buffer = this._textView.get_buffer();
        const cursor = buffer.get_insert();
        const iter = buffer.get_iter_at_mark(cursor);
        const currentLineNum = iter.get_line();
        
        // Calculate cursor position within the line
        const cursorOffset = iter.get_line_offset();
        
        // Get all text and split into lines
        const [start, end] = buffer.get_bounds();
        const allText = buffer.get_text(start, end, false);
        const lines = allText.split('\n');
        
        // Can't move the last line down
        if (currentLineNum >= lines.length - 1) {
            this._lineMovePending = false;
            return;
        }
        
        const currentLineText = lines[currentLineNum];
        const nextLineText = lines[currentLineNum + 1];
        
        // Calculate byte offsets for the two lines
        let currentLineStart = 0;
        for (let i = 0; i < currentLineNum; i++) {
            currentLineStart += lines[i].length + 1; // +1 for newline
        }
        const nextLineStart = currentLineStart + currentLineText.length + 1;
        const nextLineEnd = nextLineStart + nextLineText.length;
        
        // Delete both lines and replace with swapped version
        const deleteStart = buffer.get_iter_at_offset(currentLineStart);
        const deleteEnd = buffer.get_iter_at_offset(nextLineEnd);
        
        buffer.begin_user_action();
        buffer.delete(deleteStart, deleteEnd);
        
        const insertIter = buffer.get_iter_at_offset(currentLineStart);
        buffer.insert(insertIter, `${nextLineText}\n${currentLineText}`, -1);
        
        // Move cursor to the new position (one line down, same offset)
        // The current line is now after the next line, so add next line length + 1 for newline
        const newCursorOffset = currentLineStart + nextLineText.length + 1 + Math.min(cursorOffset, currentLineText.length);
        const newCursorIter = buffer.get_iter_at_offset(newCursorOffset);
        buffer.place_cursor(newCursorIter);
        
        buffer.end_user_action();
        
        // Cancel any pending debounced renders and trigger immediate re-render
        if (this._markdownRenderer) {
            // Cancel pending timeouts
            if (this._markdownRenderer._renderTimeoutId) {
                GLib.source_remove(this._markdownRenderer._renderTimeoutId);
                this._markdownRenderer._renderTimeoutId = null;
            }
            if (this._markdownRenderer._cursorTimeoutId) {
                GLib.source_remove(this._markdownRenderer._cursorTimeoutId);
                this._markdownRenderer._cursorTimeoutId = null;
            }
            // Reset the flag so cursor movements work again
            this._markdownRenderer._textJustChanged = false;
            // Do immediate render
            this._markdownRenderer._updateSyntaxVisibility();
        }
        
        this._textView.scroll_mark_onscreen(buffer.get_insert());
        
        // Reset throttle flag after a short delay to allow smooth but not overwhelming repeats
        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            this._lineMovePending = false;
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
            const [success, contents] = file.load_contents(null);
            if (!success) {
                throw new Error('Failed to load file');
            }

            const text = new TextDecoder().decode(contents);
            const buffer = this._textView.get_buffer();
            buffer.set_text(text, -1);

            this._currentFilename = file.get_basename();
            this._currentFilePath = file.get_path();
            this._pathLabel.set_label(this._currentFilePath);

            print(`Loaded file: ${this._currentFilePath}`);
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
