#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gtk, Gio, GLib, Adw, GObject } = imports.gi;

// Constants
const APP_ID = 'com.github.jot';
const JOT_DIR = ['Documents', 'Jot'];
const THEME_PATH = ['.config', 'omarchy', 'current', 'theme', 'alacritty.toml'];
const FEEDBACK_TIMEOUT_MS = 3000;

// Keyboard constants
const KEY_ESCAPE = 65307;
const KEY_ENTER = 65293;
const KEY_S = 115;
const KEY_PLUS = 61;     // '+' key (also '=' key without shift)
const KEY_MINUS = 45;    // '-' key
const KEY_0 = 48;        // '0' key
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

    generateCSS(zoomLevel = 100) {
        const c = this.colors;
        const zoom = zoomLevel / 100;
        return `
            window {
                background: ${c.black};
            }

            .jot-textview {
                background: transparent;
                color: ${c.white};
                font-size: ${15 * zoom}px;
                font-family: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'DejaVu Sans Mono', 'Courier New', monospace;
                caret-color: ${c.white};
            }

            .jot-textview text {
                background: transparent;
                color: ${c.white};
            }
            
            textview {
                background: transparent;
                color: ${c.white};
            }
            
            textview > text {
                background: transparent;
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
                font-size: ${18 * zoom}px;
                font-weight: bold;
                font-family: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'DejaVu Sans Mono', 'Courier New', monospace;
                margin-right: 8px;
            }

            .jot-title {
                background: transparent;
                border: none;
                color: ${c.white};
                font-size: ${18 * zoom}px;
                font-weight: bold;
                font-family: 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'DejaVu Sans Mono', 'Courier New', monospace;
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
        
        this._initTags();
        this._setupSignals();
    }
    
    _initTags() {
        const tagTable = this.buffer.get_tag_table();
        
        // Remove existing tags if they exist
        ['bold', 'italic', 'code', 'code-block', 'strikethrough', 'link', 'link-url', 
         'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
         'bullet', 'dim', 'invisible'].forEach(name => {
            const existing = tagTable.lookup(name);
            if (existing) tagTable.remove(existing);
        });
        
        // Bold: **text** or __text__
        const boldTag = new Gtk.TextTag({ name: 'bold', weight: 700 });
        tagTable.add(boldTag);
        
        // Italic: *text* or _text_
        const italicTag = new Gtk.TextTag({ name: 'italic', style: 2 }); // Pango.Style.ITALIC
        tagTable.add(italicTag);
        
        // Code: `code` - Slack-style with subtle background
        const codeTag = new Gtk.TextTag({ 
            name: 'code',
            family: 'monospace',
            foreground: this.colors.red,
            background: '#2a2a2a',  // Visible darker background
            scale: 0.95,  // Slightly smaller but keeps line height consistent
            weight: 500,
            rise: -200,  // Slight vertical adjustment for visual balance
        });
        tagTable.add(codeTag);
        
        // Code block: ```code block```
        const codeBlockTag = new Gtk.TextTag({ 
            name: 'code-block',
            family: 'monospace',
            foreground: this.colors.red,
            paragraph_background: '#2a2a2a',  // Full-width background
            scale: 0.95,
            weight: 500,
        });
        tagTable.add(codeBlockTag);
        
        // Strikethrough: ~~text~~
        const strikeTag = new Gtk.TextTag({
            name: 'strikethrough',
            strikethrough: true,
            foreground: this.colors.red,
        });
        tagTable.add(strikeTag);
        
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
        
        // Headers: # Header
        const h1Tag = new Gtk.TextTag({
            name: 'heading1',
            scale: 1.8,
            weight: 700,
            foreground: this.colors.blue,
        });
        tagTable.add(h1Tag);
        
        const h2Tag = new Gtk.TextTag({
            name: 'heading2',
            scale: 1.5,
            weight: 700,
            foreground: this.colors.cyan,
        });
        tagTable.add(h2Tag);
        
        const h3Tag = new Gtk.TextTag({
            name: 'heading3',
            scale: 1.2,
            weight: 700,
            foreground: this.colors.green,
        });
        tagTable.add(h3Tag);
        
        const h4Tag = new Gtk.TextTag({
            name: 'heading4',
            scale: 1.1,
            weight: 700,
            foreground: this.colors.yellow,
        });
        tagTable.add(h4Tag);
        
        const h5Tag = new Gtk.TextTag({
            name: 'heading5',
            scale: 1.05,
            weight: 700,
            foreground: this.colors.magenta,
        });
        tagTable.add(h5Tag);
        
        const h6Tag = new Gtk.TextTag({
            name: 'heading6',
            scale: 1.0,
            weight: 700,
            foreground: this.colors.red,
        });
        tagTable.add(h6Tag);
        
        // Bullet points: - or *
        const bulletTag = new Gtk.TextTag({
            name: 'bullet',
            foreground: this.colors.yellow,
        });
        tagTable.add(bulletTag);
        
        // Dim tag for markdown syntax (when cursor is inside)
        const dimTag = new Gtk.TextTag({
            name: 'dim',
            foreground: this.colors.cyan,
            scale: 0.8,
        });
        tagTable.add(dimTag);
        
        // Invisible tag for markdown syntax (when cursor is outside)
        const invisibleTag = new Gtk.TextTag({
            name: 'invisible',
            foreground: this.colors.background,
            scale: 0.01,
        });
        tagTable.add(invisibleTag);
    }
    
    _setupSignals() {
        // Update on text changes
        this.buffer.connect('changed', () => {
            if (!this.updating) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._applyMarkdown();
                    return false;
                });
            }
        });
        
        // Update on cursor movement to show/hide syntax
        this.buffer.connect('notify::cursor-position', () => {
            if (!this.updating) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._adjustCursorPosition();
                    this._updateSyntaxVisibility();
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
    
    _adjustCursorPosition() {
        if (this.updating) return;
        
        const cursor = this.buffer.get_insert();
        const cursorIter = this.buffer.get_iter_at_mark(cursor);
        const cursorOffset = cursorIter.get_offset();
        
        // Track movement direction
        const movingForward = cursorOffset > this.lastCursorPosition;
        const movingBackward = cursorOffset < this.lastCursorPosition;
        const lastPos = this.lastCursorPosition;
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
                
                // Check inline patterns: bold, italic, code, strikethrough, links
                const patterns = [
                    { regex: /`([^`]+?)`/g, openLen: 1, closeLen: 1 },           // code
                    { regex: /(\*\*|__)(.+?)\1/g, openLen: 2, closeLen: 2 },    // bold
                    { regex: /\*([^\*]+?)\*/g, openLen: 1, closeLen: 1 },       // italic *
                    { regex: /_([^_]+?)_/g, openLen: 1, closeLen: 1 },          // italic _
                    { regex: /~~(.+?)~~/g, openLen: 2, closeLen: 2 },           // strikethrough
                    { regex: /\[(.+?)\]\((.+?)\)/g, openLen: 1, closeLen: 0 },  // links (special)
                ];
                
                for (const pattern of patterns) {
                    let match;
                    pattern.regex.lastIndex = 0;
                    
                    while ((match = pattern.regex.exec(line)) !== null) {
                        const matchStart = match.index;
                        const matchEnd = matchStart + match[0].length;
                        
                        // Special handling for links
                        if (pattern.regex.source.includes('\\[')) {
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
        
        // Remove all tags
        this.buffer.remove_all_tags(start, end);
        
        const text = this.buffer.get_text(start, end, false);
        const lines = text.split('\n');
        let offset = 0;
        let inCodeBlock = false;
        let codeBlockStart = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for code block markers
            if (line.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true;
                    codeBlockStart = offset;
                } else {
                    // Ending a code block
                    const blockEnd = offset + line.length;
                    const blockStart = this.buffer.get_iter_at_offset(codeBlockStart);
                    const blockEndIter = this.buffer.get_iter_at_offset(blockEnd);
                    this.buffer.apply_tag_by_name('code-block', blockStart, blockEndIter);
                    
                    // Dim the backticks
                    const startLineEnd = this.buffer.get_iter_at_offset(codeBlockStart + lines[i - (i - Math.max(0, text.substring(0, codeBlockStart).split('\n').length - 1))].length);
                    this.buffer.apply_tag_by_name('dim', blockStart, startLineEnd);
                    
                    const endLineStart = this.buffer.get_iter_at_offset(offset);
                    this.buffer.apply_tag_by_name('dim', endLineStart, blockEndIter);
                    
                    inCodeBlock = false;
                    codeBlockStart = -1;
                }
            } else if (inCodeBlock) {
                // Inside code block, will be styled when block ends
            } else {
                // Normal line processing
                this._applyLineMarkdown(line, offset);
            }
            
            offset += line.length + 1; // +1 for newline
        }
        
        this.updating = false;
    }
    
    _applyLineMarkdown(line, lineOffset) {
        // Headers (must be at start of line)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const [, hashes, content] = headerMatch;
            const level = hashes.length;
            const start = this.buffer.get_iter_at_offset(lineOffset);
            const end = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            this.buffer.apply_tag_by_name(`heading${level}`, start, end);
            
            // Hide the hashes by default (will be shown when cursor is on line)
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + 1); // +1 to include the space
            this.buffer.apply_tag_by_name('invisible', start, hashEnd);
            return;
        }
        
        // Bullet points (must be at start of line or after whitespace)
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
        if (bulletMatch) {
            const [, indent, bullet] = bulletMatch;
            const bulletStart = this.buffer.get_iter_at_offset(lineOffset + indent.length);
            const bulletEnd = this.buffer.get_iter_at_offset(lineOffset + indent.length + 1);
            this.buffer.apply_tag_by_name('bullet', bulletStart, bulletEnd);
        }
        
        // Process patterns in order: code first (highest priority), then bold, italic, strikethrough
        // Code: `code`
        this._applyPattern(line, lineOffset, /`([^`]+?)`/g, 'code');
        
        // Bold: **text** or __text__
        this._applyPattern(line, lineOffset, /(\*\*|__)(.+?)\1/g, 'bold');
        
        // Italic: *text* or _text_
        this._applyPattern(line, lineOffset, /\*([^\*]+?)\*/g, 'italic');
        this._applyPattern(line, lineOffset, /_([^_]+?)_/g, 'italic');
        
        // Strikethrough: ~~text~~
        this._applyPattern(line, lineOffset, /~~(.+?)~~/g, 'strikethrough');
        
        // Links: [text](url)
        this._applyLinkPattern(line, lineOffset);
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
            this.buffer.apply_tag_by_name(tagName, start, end);
            
            // Dim the syntax markers
            const syntaxStart1 = this.buffer.get_iter_at_offset(lineOffset + matchStart);
            const syntaxEnd1 = this.buffer.get_iter_at_offset(lineOffset + contentStart);
            this.buffer.apply_tag_by_name('dim', syntaxStart1, syntaxEnd1);
            
            const syntaxStart2 = this.buffer.get_iter_at_offset(lineOffset + contentEnd);
            const syntaxEnd2 = this.buffer.get_iter_at_offset(lineOffset + matchEnd);
            this.buffer.apply_tag_by_name('dim', syntaxStart2, syntaxEnd2);
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
            this.buffer.apply_tag_by_name('link', linkStart, linkEnd);
            
            // Apply link-url tag to URL
            const urlStartIter = this.buffer.get_iter_at_offset(lineOffset + urlStart);
            const urlEndIter = this.buffer.get_iter_at_offset(lineOffset + urlEnd);
            this.buffer.apply_tag_by_name('link-url', urlStartIter, urlEndIter);
            
            // Dim the brackets and parentheses
            const bracket1 = this.buffer.get_iter_at_offset(lineOffset + matchStart);
            const bracket2 = this.buffer.get_iter_at_offset(lineOffset + matchStart + 1);
            this.buffer.apply_tag_by_name('dim', bracket1, bracket2);
            
            const bracket3 = this.buffer.get_iter_at_offset(lineOffset + textEnd);
            const bracket4 = this.buffer.get_iter_at_offset(lineOffset + textEnd + 1);
            this.buffer.apply_tag_by_name('dim', bracket3, bracket4);
            
            const paren1 = this.buffer.get_iter_at_offset(lineOffset + urlStart - 1);
            const paren2 = this.buffer.get_iter_at_offset(lineOffset + urlStart);
            this.buffer.apply_tag_by_name('dim', paren1, paren2);
            
            const paren3 = this.buffer.get_iter_at_offset(lineOffset + urlEnd);
            const paren4 = this.buffer.get_iter_at_offset(lineOffset + urlEnd + 1);
            this.buffer.apply_tag_by_name('dim', paren3, paren4);
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
        
        // Remove all tags first
        this.buffer.remove_all_tags(start, end);
        
        // Find all markdown patterns and apply them
        // Show syntax markers only when cursor is inside the pattern
        this._applyMarkdownWithCursorContext(text, cursorOffset);
        
        this.updating = false;
    }
    
    _applyMarkdownWithCursorContext(text, cursorOffset) {
        const lines = text.split('\n');
        let offset = 0;
        let inCodeBlock = false;
        let codeBlockStart = -1;
        let codeBlockStartLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = offset + line.length;
            
            // Check if cursor is on this line
            const cursorOnLine = cursorOffset >= offset && cursorOffset <= lineEnd;
            
            // Check for code block markers
            if (line.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    // Starting a code block
                    inCodeBlock = true;
                    codeBlockStart = offset;
                    codeBlockStartLine = i;
                } else {
                    // Ending a code block
                    const blockEnd = offset + line.length;
                    const cursorInBlock = cursorOffset >= codeBlockStart && cursorOffset <= blockEnd;
                    
                    const blockStart = this.buffer.get_iter_at_offset(codeBlockStart);
                    const blockEndIter = this.buffer.get_iter_at_offset(blockEnd);
                    this.buffer.apply_tag_by_name('code-block', blockStart, blockEndIter);
                    
                    // Dim or hide the backticks based on cursor position
                    if (cursorInBlock) {
                        // Show backticks when cursor is in the block
                        const startLine = text.split('\n')[codeBlockStartLine];
                        const firstLineEnd = this.buffer.get_iter_at_offset(codeBlockStart + startLine.length);
                        this.buffer.apply_tag_by_name('dim', blockStart, firstLineEnd);
                        
                        const endLineStart = this.buffer.get_iter_at_offset(offset);
                        this.buffer.apply_tag_by_name('dim', endLineStart, blockEndIter);
                    } else {
                        // Hide backticks when cursor is outside
                        const startLine = text.split('\n')[codeBlockStartLine];
                        const firstLineEnd = this.buffer.get_iter_at_offset(codeBlockStart + startLine.length);
                        this.buffer.apply_tag_by_name('invisible', blockStart, firstLineEnd);
                        
                        const endLineStart = this.buffer.get_iter_at_offset(offset);
                        this.buffer.apply_tag_by_name('invisible', endLineStart, blockEndIter);
                    }
                    
                    inCodeBlock = false;
                    codeBlockStart = -1;
                }
            } else if (inCodeBlock) {
                // Inside code block, will be styled when block ends
            } else {
                // Normal line processing
                this._applyLineMarkdownWithCursor(line, offset, cursorOffset, cursorOnLine);
            }
            
            offset += line.length + 1; // +1 for newline
        }
    }
    
    _applyLineMarkdownWithCursor(line, lineOffset, cursorOffset, cursorOnLine) {
        // Headers (must be at start of line)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const [, hashes, content] = headerMatch;
            const level = hashes.length;
            const start = this.buffer.get_iter_at_offset(lineOffset);
            const end = this.buffer.get_iter_at_offset(lineOffset + line.length);
            
            this.buffer.apply_tag_by_name(`heading${level}`, start, end);
            
            // Show/hide the hashes based on cursor position
            const hashEnd = this.buffer.get_iter_at_offset(lineOffset + hashes.length + 1); // +1 to include the space after #
            if (cursorOnLine) {
                // Cursor is on this line - show hashes with dim tag
                this.buffer.apply_tag_by_name('dim', start, hashEnd);
            } else {
                // Cursor is on a different line - hide the hashes
                this.buffer.apply_tag_by_name('invisible', start, hashEnd);
            }
            return;
        }
        
        // Bullet points
        const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
        if (bulletMatch) {
            const [, indent, bullet] = bulletMatch;
            const bulletStart = this.buffer.get_iter_at_offset(lineOffset + indent.length);
            const bulletEnd = this.buffer.get_iter_at_offset(lineOffset + indent.length + 1);
            this.buffer.apply_tag_by_name('bullet', bulletStart, bulletEnd);
        }
        
        // For inline patterns, check if cursor is inside each pattern
        // Process in order: code first (highest priority), then bold, italic, strikethrough
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /`([^`]+?)`/g, 'code');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /(\*\*|__)(.+?)\1/g, 'bold');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /\*([^\*]+?)\*/g, 'italic');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /_([^_]+?)_/g, 'italic');
        this._applyPatternWithCursor(line, lineOffset, cursorOffset, /~~(.+?)~~/g, 'strikethrough');
        this._applyLinkPatternWithCursor(line, lineOffset, cursorOffset);
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
            this.buffer.apply_tag_by_name(tagName, start, end);
            
            // Show syntax markers only when cursor is inside
            if (cursorInside) {
                // Dim the syntax markers (visible but subtle)
                const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                this.buffer.apply_tag_by_name('dim', syntaxStart1, syntaxEnd1);
                
                const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                this.buffer.apply_tag_by_name('dim', syntaxStart2, syntaxEnd2);
            } else {
                // Cursor is outside - make syntax invisible
                const syntaxStart1 = this.buffer.get_iter_at_offset(matchStart);
                const syntaxEnd1 = this.buffer.get_iter_at_offset(contentStart);
                this.buffer.apply_tag_by_name('invisible', syntaxStart1, syntaxEnd1);
                
                const syntaxStart2 = this.buffer.get_iter_at_offset(contentEnd);
                const syntaxEnd2 = this.buffer.get_iter_at_offset(matchEnd);
                this.buffer.apply_tag_by_name('invisible', syntaxStart2, syntaxEnd2);
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
            this.buffer.apply_tag_by_name('link', linkStart, linkEnd);
            
            // Show URL and syntax when cursor is inside
            if (cursorInside) {
                // Apply link-url tag to URL (visible)
                const urlStartIter = this.buffer.get_iter_at_offset(urlStart);
                const urlEndIter = this.buffer.get_iter_at_offset(urlEnd);
                this.buffer.apply_tag_by_name('link-url', urlStartIter, urlEndIter);
                
                // Dim the brackets and parentheses
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this.buffer.apply_tag_by_name('dim', bracket1, bracket2);
                
                const bracket3 = this.buffer.get_iter_at_offset(textEnd);
                const bracket4 = this.buffer.get_iter_at_offset(textEnd + 1);
                this.buffer.apply_tag_by_name('dim', bracket3, bracket4);
                
                const paren1 = this.buffer.get_iter_at_offset(urlStart - 1);
                const paren2 = this.buffer.get_iter_at_offset(urlStart);
                this.buffer.apply_tag_by_name('dim', paren1, paren2);
                
                const paren3 = this.buffer.get_iter_at_offset(urlEnd);
                const paren4 = this.buffer.get_iter_at_offset(urlEnd + 1);
                this.buffer.apply_tag_by_name('dim', paren3, paren4);
            } else {
                // Hide URL and syntax when cursor is outside
                const urlStartIter = this.buffer.get_iter_at_offset(urlStart);
                const urlEndIter = this.buffer.get_iter_at_offset(urlEnd);
                this.buffer.apply_tag_by_name('invisible', urlStartIter, urlEndIter);
                
                const bracket1 = this.buffer.get_iter_at_offset(matchStart);
                const bracket2 = this.buffer.get_iter_at_offset(matchStart + 1);
                this.buffer.apply_tag_by_name('invisible', bracket1, bracket2);
                
                const bracket3 = this.buffer.get_iter_at_offset(textEnd);
                const bracket4 = this.buffer.get_iter_at_offset(textEnd + 1);
                this.buffer.apply_tag_by_name('invisible', bracket3, bracket4);
                
                const paren1 = this.buffer.get_iter_at_offset(urlStart - 1);
                const paren2 = this.buffer.get_iter_at_offset(urlStart);
                this.buffer.apply_tag_by_name('invisible', paren1, paren2);
                
                const paren3 = this.buffer.get_iter_at_offset(urlEnd);
                const paren4 = this.buffer.get_iter_at_offset(urlEnd + 1);
                this.buffer.apply_tag_by_name('invisible', paren3, paren4);
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
        return `jot-${now.format('%Y%m%d-%H%M%S')}.md`;
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
        this._currentFilePath = null; // Track the full path of opened file
        this._themeManager = new ThemeManager();
        this._lastSaveClickTime = 0; // Track double-click for Save As
        this._zoomLevel = 100; // Zoom level percentage (default 100%)
        this._zoomTimeoutId = null; // Track zoom indicator timeout
        this._markdownRenderer = null; // Will be initialized after textview is created

        this._buildUI();
        this._setupTheme();
        this._setupKeyboardShortcuts();

        // Initialize with default header if empty
        const buffer = this._textView.get_buffer();
        buffer.set_text('# ', -1);
        const iter = buffer.get_iter_at_offset(2); // Position after "# "
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

        // Connect to buffer changes to update filename
        const buffer = this._textView.get_buffer();
        buffer.connect('changed', () => this._updateFilenameDisplay());

        // Wrap in ScrolledWindow for scrolling
        const scrolledWindow = new Gtk.ScrolledWindow({
            child: this._textView,
            vexpand: true,
            hexpand: true,
        });

        return scrolledWindow;
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

        const jotDir = FileManager.getJotDirectory();
        this._pathLabel = new Gtk.Label({
            label: GLib.build_filenamev([jotDir, this._currentFilename]),
            halign: Gtk.Align.START,
            hexpand: true,
            ellipsize: 3,
        });
        this._pathLabel.add_css_class('status-label');

        const buttonBox = this._createButtonBox();

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
        saveButton.connect('clicked', () => this._saveNote());

        buttonBox.append(openButton);
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
        const css = this._themeManager.generateCSS(this._zoomLevel);
        cssProvider.load_from_data(css, -1);
        Gtk.StyleContext.add_provider_for_display(
            this.get_display(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
        
        // Update markdown renderer colors
        if (this._markdownRenderer) {
            this._markdownRenderer.updateColors(this._themeManager.colors);
        }
    }

    _setupKeyboardShortcuts() {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            // Debug: log Ctrl key presses
            if (state & CTRL_MASK) {
                print(`Ctrl key pressed: keyval=${keyval}, keycode=${keycode}`);
            }
            
            if (keyval === KEY_ESCAPE) {
                this.close();
                return true;
            }
            if ((keyval === KEY_ENTER || keyval === KEY_S) && (state & CTRL_MASK)) {
                this._saveNote();
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

    _saveNote() {
        const buffer = this._textView.get_buffer();
        const [start, end] = buffer.get_bounds();
        const content = buffer.get_text(start, end, false);

        if (!content.trim()) {
            this._showFeedback('⚠ Nothing to save');
            return;
        }

        const title = this._extractTitleFromContent();
        
        // Check for double-click (within 1 second)
        const currentTime = GLib.get_monotonic_time() / 1000; // Convert to milliseconds
        const timeSinceLastClick = currentTime - this._lastSaveClickTime;
        const isDoubleClick = timeSinceLastClick < 1000;
        this._lastSaveClickTime = currentTime;
        
        // If file exists and not double-click, just save directly
        if (this._currentFilePath && !isDoubleClick) {
            const file = Gio.File.new_for_path(this._currentFilePath);
            this._saveToFile(file, content);
            return;
        }
        
        // Show "Save As" dialog for new files or double-click
        this._showSaveAsDialog(content);
    }
    
    _showSaveAsDialog(content) {
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
        print(`Zoom in called, new level: ${this._zoomLevel}%`);
        this._applyCSS();
        this._showZoomLevel();
    }

    _zoomOut() {
        this._zoomLevel = Math.max(this._zoomLevel - 10, 50); // Min 50%
        print(`Zoom out called, new level: ${this._zoomLevel}%`);
        this._applyCSS();
        this._showZoomLevel();
    }

    _zoomReset() {
        this._zoomLevel = 100;
        print(`Zoom reset called, level: ${this._zoomLevel}%`);
        this._applyCSS();
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
