const { Gtk, Gdk, GLib, Pango } = imports.gi;

// ============================================================================
// Markdown Renderer
// ============================================================================

// ============================================================================
// Markdown Renderer
// ============================================================================

var MarkdownRenderer = class MarkdownRenderer {
    constructor(textView, colors, moodConfig = null) {
        this.textView = textView;
        this.buffer = textView.get_buffer();
        this.colors = colors;
        this.moodConfig = moodConfig || this._getDefaultMoods();
        this.updating = false;
        this.lastCursorPosition = -1;
        this._previousCursorPosition = -1; // Track position from previous update for arrow direction
        this._renderTimeoutId = null;
        this._cursorTimeoutId = null;
        this._textJustChanged = false; // Track if text was recently changed
        this._appliedTags = new Set(); // Track which tags we actually applied (Optimization #1)
        this._searchMode = false; // Track if we're in search mode to avoid interfering with selections
        this._isUndoRedoOperation = false; // Track if we're in an undo/redo operation
        this._undoRedoResetTimeoutId = null; // Track timeout for resetting undo/redo flag
        this._indentTagCache = new Map(); // Cache for hanging indent tags keyed by pixel width
        this._pangoLayout = null; // Cached Pango layout for measuring text width
        
        this._initTags();
        this._setupSignals();
    }
    
    _getDefaultMoods() {
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
    
    _isEmoji(char) {
        // Check if character is an emoji based on Unicode ranges
        const codePoint = char.codePointAt(0);
        if (!codePoint) return false;
        
        // Common emoji ranges
        return (
            (codePoint >= 0x1F600 && codePoint <= 0x1F64F) || // Emoticons
            (codePoint >= 0x1F300 && codePoint <= 0x1F5FF) || // Misc Symbols and Pictographs
            (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) || // Transport and Map
            (codePoint >= 0x1F1E0 && codePoint <= 0x1F1FF) || // Regional flags
            (codePoint >= 0x2600 && codePoint <= 0x26FF) ||   // Misc symbols
            (codePoint >= 0x2700 && codePoint <= 0x27BF) ||   // Dingbats
            (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||   // Variation Selectors
            (codePoint >= 0x1F900 && codePoint <= 0x1F9FF) || // Supplemental Symbols and Pictographs
            (codePoint >= 0x1FA00 && codePoint <= 0x1FA6F) || // Chess Symbols
            (codePoint >= 0x1FA70 && codePoint <= 0x1FAFF) || // Symbols and Pictographs Extended-A
            (codePoint >= 0x231A && codePoint <= 0x231B) ||   // Watch
            (codePoint >= 0x23E9 && codePoint <= 0x23F3) ||   // Arrows
            (codePoint >= 0x25AA && codePoint <= 0x25AB) ||   // Squares
            (codePoint >= 0x25B6 && codePoint <= 0x25C0) ||   // Triangles
            (codePoint >= 0x25FB && codePoint <= 0x25FE) ||   // Squares
            (codePoint >= 0x2B50 && codePoint <= 0x2B55) ||   // Stars
            (codePoint >= 0x203C && codePoint <= 0x3299)      // Various symbols
        );
    }
    
    _initTags() {
        const tagTable = this.buffer.get_tag_table();
        
        // Remove existing tags if they exist
        const tagsToRemove = ['bold', 'italic', 'code', 'code-block', 'strikethrough', 'underline', 'link', 'link-url', 
         'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
         'emoji-h1', 'emoji-h2', 'emoji-h3', 'emoji-h4', 'emoji-h5', 'emoji-h6',
         'bullet', 'bullet-char', 'bullet-dash', 'bullet-dot', 'bullet-star-raw', 'bullet-star', 'bullet-star-near', 
         'bullet-margin', 'sub-bullet-margin', 'numbered-list-number', 'numbered-list-margin', 'sub-numbered-list-margin',
         'dim', 'invisible', 'todo-unchecked', 'todo-checked',
         'todo-unchecked-inside', 'todo-checked-inside', 'todo-checked-text',
         'dim-h1', 'dim-h2', 'dim-h3', 'dim-h4', 'dim-h5', 'dim-h6',
         'table-pipe', 'table-separator', 'table-header', 'table-cell', 'search-highlight', 'search-current',
         'hr-line', 'hr-line-dim'];
        
        // Add gradient background tags to removal list for all moods (including custom ones)
        // Use existing mood names from this.moodConfig if available, otherwise use defaults
        let moodNamesToRemove = ['stone', 'metal', 'fire', 'ice', 'purple', 'forest', 'sunset', 'ocean', 'lava', 'mint', 'amber', 'royal',
                          'aurora', 'sunken', 'ghost', 'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'cobalt', 'ectoplasm', 'polar', 'chiaroscuro',
                          'vanta', 'toxicvelvet', 'bruise', 'bismuth', 'solar', 'ultralich', 'paradox', 'cryo', 'hazmat', 'feral'];
        
        // If we have existing mood config, add all its mood names to removal list
        if (this.moodConfig && Object.keys(this.moodConfig).length > 0) {
            moodNamesToRemove = moodNamesToRemove.concat(Object.keys(this.moodConfig));
        }
        
        // Remove duplicates
        moodNamesToRemove = [...new Set(moodNamesToRemove)];
        
        for (const moodName of moodNamesToRemove) {
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
        
        // Emoji tags for headers: emojis need smaller scale to match pixel font size
        // Emojis are significantly larger than pixel fonts, so scale them down by ~0.60
        const emojiScales = scales.map(s => s * 0.60);
        for (let i = 1; i <= 6; i++) {
            const tag = new Gtk.TextTag({
                name: `emoji-h${i}`,
                scale: emojiScales[i-1],
                weight: 400,
            });
            tagTable.add(tag);
        }
        
        // Use moods from configuration (this.moodConfig is set in constructor)
        const moods = this.moodConfig;
        
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
            
            if (palette.length === 0) {
                // No colors defined, skip this mood
                print(`Warning: Mood "${moodName}" has no colors defined`);
                continue;
            } else if (palette.length === 1) {
                // 1-color mood: use the same color for all steps
                const color = toHex(palette[0].r, palette[0].g, palette[0].b);
                for (let i = 0; i < steps; i++) {
                    gradientColors.push(color);
                }
            } else {
                // N-color gradient (N >= 2): create a smooth loop through all colors and back
                // For N colors, we have (N-1)*2 segments to create a complete loop
                const numSegments = (palette.length - 1) * 2;
                const segmentSteps = Math.floor(steps / numSegments);
                
                // Helper function to interpolate between two colors
                const interpolateColors = (color1, color2, ratio) => {
                    const r = Math.round(color1.r + (color2.r - color1.r) * ratio);
                    const g = Math.round(color1.g + (color2.g - color1.g) * ratio);
                    const b = Math.round(color1.b + (color2.b - color1.b) * ratio);
                    return toHex(r, g, b);
                };
                
                // Forward pass: go through all colors 0->1->2->...->N-1
                for (let segmentIdx = 0; segmentIdx < palette.length - 1; segmentIdx++) {
                    const startColor = palette[segmentIdx];
                    const endColor = palette[segmentIdx + 1];
                    
                    for (let i = 0; i < segmentSteps; i++) {
                        const ratio = i / (segmentSteps - 1 || 1);
                        gradientColors.push(interpolateColors(startColor, endColor, ratio));
                    }
                }
                
                // Backward pass: go back through all colors N-1->...->2->1->0
                for (let segmentIdx = palette.length - 1; segmentIdx > 0; segmentIdx--) {
                    const startColor = palette[segmentIdx];
                    const endColor = palette[segmentIdx - 1];
                    
                    for (let i = 0; i < segmentSteps; i++) {
                        const ratio = i / (segmentSteps - 1 || 1);
                        gradientColors.push(interpolateColors(startColor, endColor, ratio));
                    }
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
        
        // Numbered list number styling (with reduced opacity, similar to bullet-dash)
        const numberedListNumberTag = new Gtk.TextTag({
            name: 'numbered-list-number',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.5),
        });
        tagTable.add(numberedListNumberTag);
        
        // Numbered list line margins: persistent margins for main numbered items
        const numberedListMarginTag = new Gtk.TextTag({
            name: 'numbered-list-margin',
            pixels_above_lines: 1,  // Margin above main numbered items
            pixels_below_lines: 1,  // Margin below main numbered items
        });
        tagTable.add(numberedListMarginTag);
        
        // Sub-numbered list line margins: persistent margins for indented numbered items
        const subNumberedListMarginTag = new Gtk.TextTag({
            name: 'sub-numbered-list-margin',
            pixels_above_lines: 1,  // Margin above sub-numbered items
            pixels_below_lines: 1,  // Margin below sub-numbered items
        });
        tagTable.add(subNumberedListMarginTag);
        
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
        
        // Search highlight tags
        const searchHighlightTag = new Gtk.TextTag({
            name: 'search-highlight',
            background_rgba: this._colorWithOpacity(this.colors.yellow, 0.3),
        });
        tagTable.add(searchHighlightTag);
        
        const searchCurrentTag = new Gtk.TextTag({
            name: 'search-current',
            background_rgba: this._colorWithOpacity(this.colors.blue, 0.5),
        });
        tagTable.add(searchCurrentTag);
        
        // Horizontal rule: full-width line (when cursor is away)
        const hrLineTag = new Gtk.TextTag({
            name: 'hr-line',
            foreground: this.colors.background, // Make text invisible by matching background
            strikethrough: true,
            strikethrough_rgba: this._colorWithOpacity(this.colors.foreground, 0.3), // Visible line through the middle
        });
        tagTable.add(hrLineTag);
        
        // Horizontal rule: dim dashes (when cursor is on line)
        const hrLineDimTag = new Gtk.TextTag({
            name: 'hr-line-dim',
            foreground_rgba: this._colorWithOpacity(this.colors.foreground, 0.4),
        });
        tagTable.add(hrLineDimTag);
    }
    
    _setupSignals() {
        // Update on text changes with debouncing (50ms delay, or immediate for headers/undo/redo)
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
                
                // Render immediately for headers or undo/redo operations
                if (isHeader || this._isUndoRedoOperation) {
                    // For headers and undo/redo, render immediately
                    this._updateSyntaxVisibility();
                    this._renderTimeoutId = null;
                    
                    // Reset undo/redo flag after a small delay to handle multiple buffer changes
                    if (this._isUndoRedoOperation) {
                        // Cancel any existing reset timeout
                        if (this._undoRedoResetTimeoutId) {
                            GLib.source_remove(this._undoRedoResetTimeoutId);
                        }
                        // Use a small delay in case the undo/redo triggers multiple changes
                        this._undoRedoResetTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 30, () => {
                            this._isUndoRedoOperation = false;
                            this._undoRedoResetTimeoutId = null;
                            return false;
                        });
                    }
                    
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
            if (!this.updating && !this._textJustChanged && !this._searchMode) {
                // Check if there's an active selection - if so, skip re-rendering
                const [hasSelection] = this.buffer.get_selection_bounds();
                if (hasSelection) {
                    return; // Skip re-rendering during selection
                }
                
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
        
        // Re-render markdown when selection is cleared/completed
        this.buffer.connect('mark-set', (buffer, iter, mark) => {
            // Only care about the selection bound mark
            if (mark === buffer.get_selection_bound()) {
                const [hasSelection] = buffer.get_selection_bounds();
                if (!hasSelection && !this.updating && !this._textJustChanged) {
                    // Selection was just cleared - schedule a re-render
                    if (this._cursorTimeoutId) {
                        GLib.source_remove(this._cursorTimeoutId);
                    }
                    this._cursorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 30, () => {
                        this._adjustCursorPosition();
                        this._updateSyntaxVisibility();
                        this._cursorTimeoutId = null;
                        return false;
                    });
                }
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
    
    // Get or create a hanging indent tag based on indent and bullet/marker width
    _getHangingIndentTag(indentText, markerText) {
        // Always recreate the layout to ensure we have the current font settings
        // This ensures accurate measurement even if font changes
        this._pangoLayout = this.textView.create_pango_layout('');
        
        // Measure the indentation width (leading spaces)
        this._pangoLayout.set_text(indentText, -1);
        const [indentWidth] = this._pangoLayout.get_pixel_size();
        
        // Measure the marker width (bullet/number + space)
        this._pangoLayout.set_text(markerText, -1);
        const [markerWidth] = this._pangoLayout.get_pixel_size();
        
        // Round to avoid floating point issues
        const indentKey = Math.round(indentWidth);
        const markerKey = Math.round(markerWidth);
        const totalWidth = indentKey + markerKey;
        
        // Create unique key combining both widths
        const cacheKey = `${indentKey}-${markerKey}`;
        
        // Debug: log the measurement
        print(`[Hanging Indent] Measured indent "${indentText.replace(/\s/g, '·')}" = ${indentKey}px, marker "${markerText.replace(/\s/g, '·')}" = ${markerKey}px, total = ${totalWidth}px`);
        
        // Check cache first
        if (this._indentTagCache.has(cacheKey)) {
            const cachedName = this._indentTagCache.get(cacheKey);
            print(`[Hanging Indent] Using cached tag: ${cachedName}`);
            return cachedName;
        }
        
        // Create new indent tag
        const tagTable = this.buffer.get_tag_table();
        const tagName = `hanging-indent-${indentKey}-${markerKey}`;
        
        // Check if tag already exists (shouldn't happen, but be safe)
        let tag = tagTable.lookup(tagName);
        if (!tag) {
            // GTK hanging indent: 
            // The text contains "  - Item text" where "  " is indent and "- " is marker
            // - left_margin: position where wrapped lines should start (indent + marker width)
            // - indent: negative offset to pull first line back to position 0
            // Result: first line at 0 (renders "  - Item"), wrapped lines at indent+marker (align with "Item")
            print(`[Hanging Indent] Creating new tag: ${tagName} with left_margin=${totalWidth}px, indent=-${totalWidth}px`);
            
            tag = new Gtk.TextTag({
                name: tagName,
                left_margin: totalWidth,    // Wrapped lines align after indent + marker
                indent: -totalWidth,         // First line starts at 0
            });
            tagTable.add(tag);
            print(`[Hanging Indent] Tag created and added to table`);
        } else {
            print(`[Hanging Indent] Tag ${tagName} already exists in table`);
        }
        
        // Cache it
        this._indentTagCache.set(cacheKey, tagName);
        return tagName;
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
                const headerMatch = line.match(/^(#{1,6})(\s+)(.+)$/);
                if (headerMatch && posInLine <= headerMatch[1].length && movingForward) {
                    // Jump past the hashes and all spaces
                    return (headerMatch[1].length + headerMatch[2].length) - posInLine;
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
         'emoji-h1', 'emoji-h2', 'emoji-h3', 'emoji-h4', 'emoji-h5', 'emoji-h6',
         'dim', 'invisible', 'todo-unchecked', 'todo-checked', 'todo-checked-text', 'bullet-char', 'bullet-dash', 'bullet-star', 'bullet-star-near', 'numbered-list-number',
         'dim-h1', 'dim-h2', 'dim-h3', 'dim-h4', 'dim-h5', 'dim-h6',
         'table-pipe', 'table-separator', 'table-header', 'table-cell', 'hr-line', 'hr-line-dim'];
        
        // Add gradient background tags to removal list for all moods (including custom ones)
        let moodNamesToRemove = ['stone', 'metal', 'fire', 'ice', 'purple', 'forest', 'sunset', 'ocean', 'lava', 'mint', 'amber', 'royal',
                          'aurora', 'sunken', 'ghost', 'sulfur', 'velvet', 'cicada', 'lunar', 'tonic', 'cobalt', 'ectoplasm', 'polar', 'chiaroscuro',
                          'vanta', 'toxicvelvet', 'bruise', 'bismuth', 'solar', 'ultralich', 'paradox', 'cryo', 'hazmat', 'feral'];
        
        // If we have existing mood names, add them to removal list
        if (this.moodNames && this.moodNames.length > 0) {
            moodNamesToRemove = moodNamesToRemove.concat(this.moodNames);
        }
        
        // Remove duplicates
        moodNamesToRemove = [...new Set(moodNamesToRemove)];
        
        for (const moodName of moodNamesToRemove) {
            for (let level = 1; level <= 6; level++) {
                for (let i = 0; i < 30; i++) {
                    tagsToRemove.push(`gradient-${moodName}-h${level}-${i}`);
                }
            }
        }
        
        // Remove only syntax tags, preserve margin tags (bullet, sub-bullet, numbered-list, sub-numbered-list)
        tagsToRemove.forEach(tagName => {
            const tag = this.buffer.get_tag_table().lookup(tagName);
            if (tag) {
                this.buffer.remove_tag(tag, start, end);
            }
        });
        
        // Remove hanging indent tags (they will be re-applied if needed)
        for (const tagName of this._indentTagCache.values()) {
            const tag = this.buffer.get_tag_table().lookup(tagName);
            if (tag) {
                this.buffer.remove_tag(tag, start, end);
            }
        }
        
        // Also remove any hanging indent tags that might exist but aren't in cache
        const tagTable = this.buffer.get_tag_table();
        tagTable.foreach((tag) => {
            if (tag.name && tag.name.startsWith('hanging-indent-')) {
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
        const headerMatch = line.match(/^(#{1,})(\s+)(.+)$/);
        if (headerMatch) {
            const [, hashes, spaces, content] = headerMatch;
            const actualLevel = hashes.length; // Actual number of hashes
            const styleLevel = Math.min(actualLevel, 6); // Cap at level 6 for styling
            const start = this.buffer.get_iter_at_offset(lineOffset);
            
            // Hide the hashes by default (will be shown when cursor is on line)
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + spaces.length);
            this._applyTag('invisible', start, hashEnd);
            
            // Assign mood based on header level (# gets color 0, ## gets color 1, etc.)
            const moodIndex = (actualLevel - 1) % this.moodNames.length;
            const mood = this.moodNames[moodIndex];
            const gradientColors = this.moodGradients[mood];
            
            // Apply gradient with 45-degree diagonal pattern
            // Calculate actual content start position accounting for all spaces
            const contentStart = lineOffset + hashes.length + spaces.length;
            
            // Use Array.from to properly iterate Unicode code points (handles emojis correctly)
            const chars = Array.from(content);
            
            // GTK TextBuffer counts each character (including emojis) as 1 position
            for (let i = 0; i < chars.length; i++) {
                const char = chars[i];
                
                // Each character is 1 position in GTK buffer (even emojis)
                const charStart = this.buffer.get_iter_at_offset(contentStart + i);
                const charEnd = this.buffer.get_iter_at_offset(contentStart + i + 1);
                
                // 45-degree diagonal: color based on (charPos + actualLevel) for diagonal stripes
                const gradientIndex = (i + (actualLevel * 2)) % gradientColors.length;
                
                // Check if this is an emoji - emojis need special handling
                const isEmoji = this._isEmoji(char);
                
                if (isEmoji) {
                    // For emojis: only apply the emoji scale tag (not the gradient tag)
                    // The emoji tag already has the correct scaled-down size
                    this._applyTag(`emoji-h${styleLevel}`, charStart, charEnd);
                } else {
                    // For regular text: apply the gradient tag with header scale
                    this._applyTag(`gradient-${mood}-h${styleLevel}-${gradientIndex}`, charStart, charEnd);
                }
            }
            // Don't return - continue to apply inline formatting to header content
        }
        
        // Horizontal rule: 3 or more dashes on their own line (with optional surrounding whitespace)
        const hrMatch = line.match(/^(\s*)(---+)(\s*)$/);
        if (hrMatch) {
            const [, leadingSpace, dashes, trailingSpace] = hrMatch;
            const dashesStart = lineOffset + leadingSpace.length;
            const dashesEnd = dashesStart + dashes.length;
            
            const dashesStartIter = this.buffer.get_iter_at_offset(dashesStart);
            const dashesEndIter = this.buffer.get_iter_at_offset(dashesEnd);
            
            // Apply default styling (will be overridden by cursor-aware version)
            this._applyTag('hr-line', dashesStartIter, dashesEndIter);
            
            // Don't process this line further for other patterns
            return;
        }
        
        // Bullet points (must be at start of line or after whitespace)
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
        if (bulletMatch) {
            const [, indent, bullet] = bulletMatch;
            const bulletStart = this.buffer.get_iter_at_offset(lineOffset + indent.length);
            const bulletEnd = this.buffer.get_iter_at_offset(lineOffset + indent.length + 1);
            
            // Apply bullet character styling
            this._applyTag('bullet-char', bulletStart, bulletEnd);
            
            // Apply margin styling to the entire line (only if not already applied)
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            if (indent.length >= 1) {
                // Apply sub-bullet margin for indented bullets (1+ spaces)
                this._applyTag('sub-bullet-margin', lineStart, lineEnd);
            } else {
                // Apply bullet margin for main bullets (0 spaces)
                this._applyTag('bullet-margin', lineStart, lineEnd);
            }
            
            // Apply hanging indent: separate indent and marker
            const markerText = bullet + ' ';
            const indentTagName = this._getHangingIndentTag(indent, markerText);
            print(`[Hanging Indent APPLY _applyLineMarkdown] Applying tag "${indentTagName}" to bullet line at offset ${lineOffset}, line: "${line.substring(0, 30)}..."`);
            this._applyTag(indentTagName, lineStart, lineEnd);
        }
        
        // Numbered list points (e.g., "1. item" or "  1. item")
        const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
            const [, indent, number] = numberedMatch;
            const numberStart = this.buffer.get_iter_at_offset(lineOffset + indent.length);
            const numberEnd = this.buffer.get_iter_at_offset(lineOffset + indent.length + number.length + 1); // +1 for the dot
            
            // Apply numbered list number styling (dimmed)
            this._applyTag('numbered-list-number', numberStart, numberEnd);
            
            // Apply margin styling to the entire line
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            if (indent.length >= 3) {
                // Apply sub-numbered-list margin for indented items (3+ spaces)
                this._applyTag('sub-numbered-list-margin', lineStart, lineEnd);
            } else {
                // Apply numbered-list margin for main items (0-2 spaces)
                this._applyTag('numbered-list-margin', lineStart, lineEnd);
            }
            
            // Apply hanging indent: separate indent and marker
            const markerText = number + '. ';
            const indentTagName = this._getHangingIndentTag(indent, markerText);
            print(`[Hanging Indent APPLY] Applying tag "${indentTagName}" to numbered line at offset ${lineOffset}, line: "${line.substring(0, 30)}..."`);
            this._applyTag(indentTagName, lineStart, lineEnd);
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
        const hasMovement = movingRight || movingLeft;
        
        // Find all arrows (both ASCII and Unicode) and transform based on cursor position
        // Use buffer iterators to handle multi-byte characters (emojis) correctly
        const transformations = []; // [{offset, length, replacement, cursorPos}]
        
        // Iterate through the buffer to find arrows using byte offsets
        const iter = this.buffer.get_start_iter();
        const endIter = this.buffer.get_end_iter();
        
        while (!iter.equal(endIter)) {
            const currentOffset = iter.get_offset();
            const iter2 = iter.copy();
            
            // Check for -> (2 chars)
            if (!iter2.forward_chars(2)) {
                // Not enough characters left
                if (!iter.forward_char()) break;
                continue;
            }
            
            const twoCharText = this.buffer.get_text(iter, iter2, false);
            if (twoCharText === '->') {
                const arrowStart = currentOffset;
                const arrowEnd = iter2.get_offset();
                const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
                
                if (!cursorNear) {
                    // Cursor is away, replace -> with →
                    transformations.push({
                        offset: arrowStart,
                        length: arrowEnd - arrowStart,
                        replacement: '→',
                        cursorPos: null
                    });
                }
                // Skip past this arrow
                iter.forward_chars(2);
                continue;
            }
            
            if (twoCharText === '<-') {
                const arrowStart = currentOffset;
                const arrowEnd = iter2.get_offset();
                const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
                
                if (!cursorNear) {
                    // Cursor is away, replace <- with ←
                    transformations.push({
                        offset: arrowStart,
                        length: arrowEnd - arrowStart,
                        replacement: '←',
                        cursorPos: null
                    });
                }
                // Skip past this arrow
                iter.forward_chars(2);
                continue;
            }
            
            // Check for Unicode arrows (only if movement detected)
            if (hasMovement) {
                const iter1 = iter.copy();
                if (!iter1.forward_char()) break;
                
                const oneCharText = this.buffer.get_text(iter, iter1, false);
                const arrowStart = currentOffset;
                const arrowEnd = iter1.get_offset();
                
                if (oneCharText === '→') {
                    const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
                    
                    if (cursorNear) {
                        // Cursor is near, replace → with ->
                        // Position cursor based on entry direction
                        let newCursorPos;
                        if (movingRight) {
                            // Entered from left, put cursor at start of arrow
                            newCursorPos = arrowStart;
                        } else if (movingLeft) {
                            // Entered from right, account for expansion from 1 char to 2
                            newCursorPos = arrowStart + 2;
                        } else {
                            newCursorPos = arrowStart;
                        }
                        
                        transformations.push({
                            offset: arrowStart,
                            length: arrowEnd - arrowStart,
                            replacement: '->',
                            cursorPos: newCursorPos
                        });
                    }
                    // Skip past this arrow
                    iter.forward_char();
                    continue;
                }
                
                if (oneCharText === '←') {
                    const cursorNear = cursorOffset >= arrowStart && cursorOffset <= arrowEnd;
                    
                    if (cursorNear) {
                        // Cursor is near, replace ← with <-
                        // Position cursor based on entry direction
                        let newCursorPos;
                        if (movingRight) {
                            // Entered from left, put cursor at start of arrow
                            newCursorPos = arrowStart;
                        } else if (movingLeft) {
                            // Entered from right, account for expansion from 1 char to 2
                            newCursorPos = arrowStart + 2;
                        } else {
                            newCursorPos = arrowStart;
                        }
                        
                        transformations.push({
                            offset: arrowStart,
                            length: arrowEnd - arrowStart,
                            replacement: '<-',
                            cursorPos: newCursorPos
                        });
                    }
                    // Skip past this arrow
                    iter.forward_char();
                    continue;
                }
            }
            
            // Move to next character
            if (!iter.forward_char()) break;
        }
        
        // Apply transformations in reverse order to maintain offsets
        transformations.sort((a, b) => b.offset - a.offset);
        
        // Track cumulative offset adjustments from transformations that occur after (higher offsets)
        // Since we process in reverse order, we need to adjust cursor positions for transformations
        // that happen before (lower offsets) based on length changes from transformations after
        let cumulativeOffsetAdjustment = 0;
        let finalCursorPos = null;
        
        for (const transform of transformations) {
            // Adjust offset for cumulative changes from previous transformations
            const adjustedOffset = transform.offset + cumulativeOffsetAdjustment;
            
            // Validate that the offset is within bounds
            const [start, end] = this.buffer.get_bounds();
            const bufferLength = end.get_offset();
            if (adjustedOffset < 0 || adjustedOffset >= bufferLength) {
                // Skip invalid transformation
                continue;
            }
            
            // Validate that we're not trying to delete beyond buffer bounds
            const deleteEnd = adjustedOffset + transform.length;
            if (deleteEnd > bufferLength) {
                // Adjust to only delete what's available
                const actualLength = bufferLength - adjustedOffset;
                if (actualLength <= 0) {
                    continue; // Nothing to delete
                }
                // Use actual length instead of transform.length
                const startIter = this.buffer.get_iter_at_offset(adjustedOffset);
                const endIter = this.buffer.get_iter_at_offset(bufferLength);
                this.buffer.delete(startIter, endIter);
                
                const insertIter = this.buffer.get_iter_at_offset(adjustedOffset);
                this.buffer.insert(insertIter, transform.replacement, -1);
                
                // Calculate offset change based on actual deletion
                const offsetChange = transform.replacement.length - actualLength;
                
                if (transform.cursorPos !== null) {
                    finalCursorPos = transform.cursorPos + cumulativeOffsetAdjustment;
                }
                
                cumulativeOffsetAdjustment += offsetChange;
                continue;
            }
            
            const startIter = this.buffer.get_iter_at_offset(adjustedOffset);
            const endIter = this.buffer.get_iter_at_offset(adjustedOffset + transform.length);
            this.buffer.delete(startIter, endIter);
            
            const insertIter = this.buffer.get_iter_at_offset(adjustedOffset);
            this.buffer.insert(insertIter, transform.replacement, -1);
            
            // Calculate offset change: replacement length - deleted length
            const offsetChange = transform.replacement.length - transform.length;
            
            // Adjust cursor position for cumulative offset changes from transformations at higher offsets
            // (which have already been processed since we're going in reverse order)
            if (transform.cursorPos !== null) {
                finalCursorPos = transform.cursorPos + cumulativeOffsetAdjustment;
            }
            
            // Update cumulative adjustment for next iteration (affects transforms at lower offsets)
            cumulativeOffsetAdjustment += offsetChange;
        }
        
        // Set cursor position after all transformations are complete
        if (finalCursorPos !== null) {
            const newCursorIter = this.buffer.get_iter_at_offset(finalCursorPos);
            this.buffer.place_cursor(newCursorIter);
        }
    }
    
    _updateSyntaxVisibility() {
        if (this.updating) return;
        
        this.updating = true;
        
        // Get cursor position
        const cursor = this.buffer.get_insert();
        const cursorIter = this.buffer.get_iter_at_mark(cursor);
        const cursorOffset = cursorIter.get_offset();
        
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
        const headerMatch = line.match(/^(#{1,})(\s+)(.+)$/);
        if (headerMatch) {
            const [, hashes, spaces, content] = headerMatch;
            const actualLevel = hashes.length; // Actual number of hashes
            const styleLevel = Math.min(actualLevel, 6); // Cap at level 6 for styling
            const start = this.buffer.get_iter_at_offset(lineOffset);
            
            // Show/hide the hashes and spaces based on cursor position
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + spaces.length);
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
            // Calculate actual content start position accounting for all spaces
            const contentStart = lineOffset + hashes.length + spaces.length;
            
            // Use Array.from to properly iterate Unicode code points (handles emojis correctly)
            const chars = Array.from(content);
            
            // GTK TextBuffer counts each character (including emojis) as 1 position
            for (let i = 0; i < chars.length; i++) {
                const char = chars[i];
                
                // Each character is 1 position in GTK buffer (even emojis)
                const charStart = this.buffer.get_iter_at_offset(contentStart + i);
                const charEnd = this.buffer.get_iter_at_offset(contentStart + i + 1);
                
                // 45-degree diagonal: color based on (charPos + actualLevel) for diagonal stripes
                const gradientIndex = (i + (actualLevel * 2)) % gradientColors.length;
                
                // Check if this is an emoji - emojis need special handling
                const isEmoji = this._isEmoji(char);
                
                if (isEmoji) {
                    // For emojis: only apply the emoji scale tag (not the gradient tag)
                    // The emoji tag already has the correct scaled-down size
                    this._applyTag(`emoji-h${styleLevel}`, charStart, charEnd);
                } else {
                    // For regular text: apply the gradient tag with header scale
                    this._applyTag(`gradient-${mood}-h${styleLevel}-${gradientIndex}`, charStart, charEnd);
                }
            }
            // Don't return - continue to apply inline formatting to header content
        }
        
        // Horizontal rule: 3 or more dashes on their own line (with optional surrounding whitespace)
        const hrMatch = line.match(/^(\s*)(---+)(\s*)$/);
        if (hrMatch) {
            const [, leadingSpace, dashes, trailingSpace] = hrMatch;
            const dashesStart = lineOffset + leadingSpace.length;
            const dashesEnd = dashesStart + dashes.length;
            
            const dashesStartIter = this.buffer.get_iter_at_offset(dashesStart);
            const dashesEndIter = this.buffer.get_iter_at_offset(dashesEnd);
            
            if (cursorOnLine) {
                // Cursor is on the line - show dashes with dim styling
                this._applyTag('hr-line-dim', dashesStartIter, dashesEndIter);
            } else {
                // Cursor is away - show as full-width line with strikethrough effect
                this._applyTag('hr-line', dashesStartIter, dashesEndIter);
            }
            
            // Don't process this line further for other patterns
            return;
        }
        
        // Bullet points - handle * and - bullets
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
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
            
            if (indent.length >= 1) {
                // Apply sub-bullet margin for indented bullets (1+ spaces)
                this._applyTag('sub-bullet-margin', lineStart, lineEnd);
            } else {
                // Apply bullet margin for main bullets (0 spaces)
                this._applyTag('bullet-margin', lineStart, lineEnd);
            }
            
            // Apply hanging indent: separate indent and marker
            const markerText = bullet + ' ';
            const indentTagName = this._getHangingIndentTag(indent, markerText);
            print(`[Hanging Indent APPLY _applyLineMarkdownWithCursor] Applying tag "${indentTagName}" to bullet line at offset ${lineOffset}, line: "${line.substring(0, 30)}..."`);
            this._applyTag(indentTagName, lineStart, lineEnd);
        }
        
        // Numbered list points (e.g., "1. item" or "  1. item")
        const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
            const [, indent, number] = numberedMatch;
            const numberPos = lineOffset + indent.length;
            const numberStart = this.buffer.get_iter_at_offset(numberPos);
            const numberEnd = this.buffer.get_iter_at_offset(numberPos + number.length + 1); // +1 for the dot
            
            // Apply numbered list number styling (dimmed, similar to dash bullets)
            this._applyTag('numbered-list-number', numberStart, numberEnd);
            
            // Apply margin styling to the entire line
            const lineStart = this.buffer.get_iter_at_offset(lineOffset);
            const lineEnd = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            if (indent.length >= 3) {
                // Apply sub-numbered-list margin for indented items (3+ spaces)
                this._applyTag('sub-numbered-list-margin', lineStart, lineEnd);
            } else {
                // Apply numbered-list margin for main items (0-2 spaces)
                this._applyTag('numbered-list-margin', lineStart, lineEnd);
            }
            
            // Apply hanging indent: separate indent and marker
            const markerText = number + '. ';
            const indentTagName = this._getHangingIndentTag(indent, markerText);
            print(`[Hanging Indent APPLY _applyLineMarkdownWithCursor] Applying tag "${indentTagName}" to numbered line at offset ${lineOffset}, line: "${line.substring(0, 30)}..."`);
            this._applyTag(indentTagName, lineStart, lineEnd);
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
