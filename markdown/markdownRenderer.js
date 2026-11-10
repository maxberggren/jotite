const { Gtk, Gdk, GLib, Pango } = imports.gi;
const Parser = imports.markdown.parser;
const Moods = imports.markdown.moods;

const { Kind } = Parser;

// ============================================================================
// Markdown Renderer
// ============================================================================
//
// Live, incremental markdown styling for a GtkTextView. Rendering only ever
// applies GtkTextTags; it never modifies buffer text.
//
// Per buffer line the renderer keeps the line text, its block kind and the
// fence state after it (see markdown/parser.js). Buffer edits splice these
// arrays and mark the touched lines dirty; an idle callback (running before
// the next frame is drawn) re-parses dirty lines, continues downwards while
// the fence state changes (e.g. typing ``` turns the following lines into
// code) and re-tags only the lines whose rendering changed. Cursor movement
// re-tags just the line the cursor left and the line it entered, which
// reveals (dims) markup near the cursor and hides it elsewhere. Large
// renders (opening a file) tag the visible lines first and the rest in
// short idle chunks.

const DIRTY_NONE = 0;
const DIRTY_TAG = 1;   // re-apply tags
const DIRTY_TEXT = 2;  // re-read text, re-classify and re-apply tags

const CHUNK_BUDGET_US = 8000;     // max time per background render chunk
const SYNC_LINE_LIMIT = 400;      // lines tagged synchronously before chunking
const VISIBLE_MARGIN = 10;        // extra lines around the visible region
const MAX_INDENT_TAGS = 512;
const CHUNK_PRIORITY = GLib.PRIORITY_HIGH_IDLE + 22; // GDK_PRIORITY_REDRAW + 2
const CLASSIFY_CHUNK_LINES = 3000; // lines classified per background chunk

const HEADING_SCALES = [5.4, 4.5, 3.6, 3.3, 3.15, 3.0];
const EMOJI_HEADING_FACTOR = 0.60;

const FENCE_KINDS = new Set([Kind.FENCE_OPEN, Kind.FENCE_CLOSE, Kind.CODE]);

function rgba(hex, alpha = 1) {
    const c = new Gdk.RGBA();
    if (!c.parse(hex || '#000000')) c.parse('#000000');
    c.alpha = alpha;
    return c;
}

function lighten(hex, percent) {
    const c = rgba(hex);
    const f = (v) => Math.min(255, Math.floor(v * 255 + (255 - v * 255) * (percent / 100)));
    return '#' + [c.red, c.green, c.blue].map(v => f(v).toString(16).padStart(2, '0')).join('');
}

function isEmoji(codePoint) {
    return (
        (codePoint >= 0x1F600 && codePoint <= 0x1F64F) ||
        (codePoint >= 0x1F300 && codePoint <= 0x1F5FF) ||
        (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) ||
        (codePoint >= 0x1F1E0 && codePoint <= 0x1F1FF) ||
        (codePoint >= 0x2600 && codePoint <= 0x26FF) ||
        (codePoint >= 0x2700 && codePoint <= 0x27BF) ||
        (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
        (codePoint >= 0x1F900 && codePoint <= 0x1F9FF) ||
        (codePoint >= 0x1FA00 && codePoint <= 0x1FAFF) ||
        (codePoint >= 0x231A && codePoint <= 0x231B) ||
        (codePoint >= 0x23E9 && codePoint <= 0x23F3) ||
        (codePoint >= 0x25AA && codePoint <= 0x25AB) ||
        (codePoint >= 0x25B6 && codePoint <= 0x25C0) ||
        (codePoint >= 0x25FB && codePoint <= 0x25FE) ||
        (codePoint >= 0x2B50 && codePoint <= 0x2B55) ||
        (codePoint >= 0x2B05 && codePoint <= 0x2B07) ||
        (codePoint >= 0x2B1B && codePoint <= 0x2B1C) ||
        (codePoint >= 0x2194 && codePoint <= 0x2199) ||
        (codePoint >= 0x21A9 && codePoint <= 0x21AA) ||
        (codePoint >= 0x2934 && codePoint <= 0x2935) ||
        codePoint === 0x203C || codePoint === 0x2049 ||
        codePoint === 0x2122 || codePoint === 0x2139 ||
        codePoint === 0x24C2 ||
        codePoint === 0x3030 || codePoint === 0x303D ||
        codePoint === 0x3297 || codePoint === 0x3299 ||
        codePoint === 0x200D || codePoint >= 0x1F000
    );
}

var MarkdownRenderer = class MarkdownRenderer {
    constructor(textView, colors, moodConfig = null) {
        this.textView = textView;
        this.buffer = textView.get_buffer();
        this.colors = colors || {};
        this._table = this.buffer.get_tag_table();
        this._destroyed = false;

        this._ownTags = new Set();      // every tag this renderer created
        this._tagProps = new Map();     // tag -> last applied props (for in-place updates)
        this._gradientTags = new Map(); // tag name -> {tag, mood} (created lazily)
        this._indentTags = new Map();   // prefix key -> {tag, gen, text, box, checked, revealed}
        this._indentSeq = 0;
        this._metricsGen = 0;
        this._fontPx = 0;
        this._fallbackCache = new Map();
        this._namedTags = new Map();     // tag name -> tag lookup cache
        this._headerFont = undefined;

        this._removeStaleTags();
        this._createStaticTags();
        this._moods = Moods.normalizeMoods(moodConfig);

        // Per-line state (indices are buffer line numbers)
        const n = this.buffer.get_line_count();
        this._texts = new Array(n).fill(null);
        this._kinds = new Array(n).fill(-1);
        this._fenceOut = new Array(n).fill('');
        this._dirty = new Array(n).fill(DIRTY_TEXT);
        // Tags this renderer applied to each line, so re-tagging a line only
        // removes what is there (inherited by split lines, merged on joins)
        this._lineTags = Array.from({ length: n }, () => []);
        this._clsLo = 0;
        this._clsHi = n - 1;
        this._tagLo = 0;
        this._tagHi = n - 1;

        this._reveal = { line: -1, col: -1, lines: new Set() };
        this._revealValid = false;
        this._pendingEdit = null;
        this._carryFrom = -1;           // line whose fence-in state changed (deferred)
        this._flushId = 0;
        this._chunkId = 0;
        this._tickId = 0;
        this._inFlush = false;

        this._insertMark = this.buffer.get_insert();
        this._selectionMark = this.buffer.get_selection_bound();

        this._handlers = [
            this.buffer.connect('insert-text', (b, iter) => this._beginEdit(iter.get_line())),
            this.buffer.connect_after('insert-text', () => this._applyPendingEdit()),
            this.buffer.connect('delete-range', (b, start) => this._beginEdit(start.get_line())),
            this.buffer.connect_after('delete-range', () => this._applyPendingEdit()),
            this.buffer.connect('changed', () => this._applyPendingEdit()),
            this.buffer.connect('mark-set', (b, iter, mark) => {
                if (mark === this._insertMark || mark === this._selectionMark) this._scheduleFlush();
            }),
            this.buffer.connect('notify::cursor-position', () => this._scheduleFlush()),
        ];

        this._applyViewColors();
        this._scheduleFlush();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    // Synchronously render pending changes and the cursor reveal state.
    // Off-screen lines of a large pending render continue in idle chunks
    // unless full is true.
    renderNow(full = false) {
        if (this._flushId) {
            GLib.source_remove(this._flushId);
            this._flushId = 0;
        }
        this._flush(full ? Infinity : 0);
    }

    // Re-render the whole document (e.g. after loading a file). Visible
    // lines are rendered on the next idle, the rest in background chunks.
    invalidateAll() {
        const n = this._texts.length;
        this._dirty.fill(DIRTY_TEXT);
        this._kinds.fill(-1);
        this._clsLo = 0;
        this._clsHi = n - 1;
        this._tagLo = 0;
        this._tagHi = n - 1;
        this._revealValid = false;
        this._carryFrom = -1;
        this._refreshMetrics();
        this._scheduleFlush();
    }

    setMoodConfig(moodConfig) {
        const oldMoods = new Map(this._moods.map(m => [m.name, m.gradient.join()]));
        this._moods = Moods.normalizeMoods(moodConfig);
        const newMoods = new Map(this._moods.map(m => [m.name, m.gradient.join()]));

        // Drop tags of moods that were removed or whose colours changed
        for (const [name, { tag, mood }] of [...this._gradientTags]) {
            if (newMoods.get(mood) !== oldMoods.get(mood) || !newMoods.has(mood)) {
                this._table.remove(tag);
                this._ownTags.delete(tag);
                this._gradientTags.delete(name);
            }
        }
        for (let i = 0; i < this._kinds.length; i++) {
            if (this._kinds[i] === Kind.HEADING) this._markTag(i);
        }
        this._scheduleFlush();
    }

    // Theme change: update tag colours in place (no re-tagging needed)
    updateColors(colors) {
        this.colors = colors || {};
        const specs = this._tagSpecs();
        for (const [name, props] of specs) {
            const tag = this._table.lookup(name);
            if (tag && this._ownTags.has(tag)) this._updateTagProps(tag, props);
        }
        this._applyViewColors();
        this._refreshMetrics();
    }

    // Zoom / font size change (CSS font-size in pixels). Heading and other
    // relative sizes follow automatically; list hanging indents are
    // re-measured and updated in place.
    setZoom(fontSizePx) {
        this._fontPx = fontSizePx > 0 ? fontSizePx : 0;
        this._refreshMetrics();
    }

    // Whether a line is part of a fenced code block (including fence lines)
    isInCodeBlock(lineNumber) {
        this._ensureClassified();
        return FENCE_KINDS.has(this._kinds[lineNumber]);
    }

    // Whether a line belongs to an HTML comment block (<!-- ... -->
    // starting at the beginning of a line, possibly spanning lines)
    isInHtmlComment(lineNumber) {
        this._ensureClassified();
        return this._kinds[lineNumber] === Kind.HTML;
    }

    // Whether a line is shown literally (fenced code or HTML comment), so
    // list/task editing commands must leave it alone
    isLiteralLine(lineNumber) {
        return this.isInCodeBlock(lineNumber) || this.isInHtmlComment(lineNumber);
    }

    // Whether the character at iter belongs to an inline code span
    // (including its backticks)
    isInCodeSpan(iter) {
        const model = this._modelAt(iter.get_line());
        if (!model) return false;
        const col = iter.get_line_offset();
        return model.codeSpans.some(c => col >= c.s && col < c.e);
    }

    // URL of the link (inline link, image, <autolink> or bare URL) whose
    // source text contains iter, or null
    getLinkAtIter(iter) {
        const model = this._modelAt(iter.get_line());
        if (!model) return null;
        const col = iter.get_line_offset();
        const link = model.links.find(l => col >= l.s && col < l.e);
        return link && link.url ? link.url : null;
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        for (const id of this._handlers) this.buffer.disconnect(id);
        this._handlers = [];
        if (this._flushId) GLib.source_remove(this._flushId);
        if (this._chunkId) GLib.source_remove(this._chunkId);
        if (this._tickId) this.textView.remove_tick_callback(this._tickId);
        this._flushId = this._chunkId = this._tickId = 0;
        this.textView.bulletColor = null;
        this.textView.arrowColor = null;
    }

    // ------------------------------------------------------------------
    // Tags
    // ------------------------------------------------------------------

    // Static tags in priority order (lowest first). Lazily created heading
    // gradient tags are inserted just below 'gradient-anchor'.
    _tagSpecs() {
        const c = this.colors;
        const fg = c.foreground || '#ffffff';
        const bg = c.background || '#000000';
        const transparent = rgba(fg, 1 / 65535); // Pango treats alpha 0 as unset
        const specs = [
            ['no-hyphens', { insert_hyphens: false }],
            ['list-item', { pixels_above_lines: 1, pixels_below_lines: 1 }],
            ['code-block', {
                family: 'monospace', foreground: c.red || fg,
                paragraph_background: lighten(bg, 8), scale: 0.95, weight: 500,
            }],
            ['comment', { foreground_rgba: rgba(fg, 0.45) }],
            ['blockquote', { style: Pango.Style.ITALIC, foreground_rgba: rgba(fg, 0.75) }],
            ['quote-marker', { foreground: c.cyan || fg, weight: 700 }],
            ['bold', { weight: 700 }],
            ['italic', { style: Pango.Style.ITALIC }],
            ['strikethrough', { strikethrough: true }],
            ['link', { foreground: c.blue || fg, underline: Pango.Underline.SINGLE }],
            ['link-url', { foreground: c.magenta || fg, scale: 0.85 }],
            ['code', {
                family: 'monospace', foreground: c.red || fg, background: lighten(bg, 8),
                scale: 0.95, weight: 500, rise: -200,
            }],
            ['todo-checked-text', { strikethrough: true, foreground_rgba: rgba(fg, 0.3) }],
            ['bullet-dash', { foreground_rgba: rgba(fg, 0.5) }],
            ['numbered-list-number', { foreground_rgba: rgba(fg, 0.5) }],
        ];
        for (let i = 1; i <= 6; i++)
            specs.push([`emoji-h${i}`, { scale: HEADING_SCALES[i - 1] * EMOJI_HEADING_FACTOR, weight: 400 }]);
        specs.push(['gradient-anchor', {}]);
        specs.push(
            ['todo-unchecked', {
                foreground: c.cyan || fg, background: lighten(bg, 12), scale: 0.7, weight: 400,
                family: 'monospace', pixels_above_lines: 3, pixels_below_lines: 0, letter_spacing: 4000,
            }],
            ['todo-checked', {
                foreground: c.green || fg, background: c.green || fg, scale: 0.7, weight: 700,
                family: 'monospace', pixels_above_lines: 3, pixels_below_lines: 0, letter_spacing: 4000,
            }],
            ['todo-unchecked-inside', { foreground: c.cyan || fg, scale: 1.2, weight: 400, family: 'monospace' }],
            ['todo-checked-inside', { foreground: c.green || fg, scale: 1.2, weight: 400, family: 'monospace' }],
            ['bullet-star', { foreground_rgba: transparent }],
            ['bullet-star-near', { foreground: c.cyan || fg }],
            ['dim', { foreground: c.cyan || fg, scale: 0.8 }],
        );
        for (let i = 1; i <= 6; i++)
            specs.push([`dim-h${i}`, { foreground: c.cyan || fg, scale: HEADING_SCALES[i - 1], family: 'pxlxxl' }]);
        specs.push(
            ['invisible', { foreground_rgba: transparent, scale: 0.01 }],
            ['hr-line', {
                foreground_rgba: transparent, strikethrough: true,
                strikethrough_rgba: rgba(fg, 0.3),
            }],
            ['hr-line-dim', { foreground_rgba: rgba(fg, 0.4) }],
            ['arrow', { foreground_rgba: transparent }],
        );
        return specs;
    }

    // Remove tags left behind by a previous renderer on the same buffer
    _removeStaleTags() {
        const names = new Set(this._tagSpecs().map(([name]) => name));
        const stale = [];
        this._table.foreach(tag => {
            const name = tag.name || '';
            if (names.has(name) || name.startsWith('gradient-') || name.startsWith('md-indent-'))
                stale.push(tag);
        });
        for (const tag of stale) this._table.remove(tag);
    }

    _createStaticTags() {
        for (const [name, props] of this._tagSpecs()) {
            const tag = new Gtk.TextTag(Object.assign({ name }, props));
            this._table.add(tag);
            this._ownTags.add(tag);
            this._tagProps.set(tag, this._propKeys(props));
        }
        this._anchorTag = this._table.lookup('gradient-anchor');
    }

    _propKeys(props) {
        const out = {};
        for (const [k, v] of Object.entries(props))
            out[k] = v instanceof Gdk.RGBA ? v.to_string() : v;
        return out;
    }

    _updateTagProps(tag, props) {
        const old = this._tagProps.get(tag) || {};
        const keys = this._propKeys(props);
        for (const [k, v] of Object.entries(props)) {
            if (old[k] !== keys[k]) tag[k] = v;
        }
        this._tagProps.set(tag, keys);
    }

    _applyViewColors() {
        const fg = this.colors.foreground || '#ffffff';
        this.textView.bulletColor = rgba(fg, 0.35);
        this.textView.arrowColor = rgba(fg, 1);
        this.textView.queue_draw();
    }

    _gradientTag(moodIndex, level, step) {
        const mood = this._moods[moodIndex];
        const name = `gradient-${mood.name}-h${level}-${step}`;
        const entry = this._gradientTags.get(name);
        if (entry) return entry.tag;
        const tag = new Gtk.TextTag({
            name,
            scale: HEADING_SCALES[level - 1],
            weight: 400,
            family: 'pxlxxl',
            foreground: mood.gradient[step],
        });
        this._table.add(tag);
        tag.set_priority(this._anchorTag.get_priority());
        this._gradientTags.set(name, { tag, mood: mood.name });
        this._ownTags.add(tag);
        return tag;
    }

    // Whether a heading character needs the reduced fallback scale: the
    // pixel heading font only covers Latin text, glyphs it lacks (emoji,
    // CJK, ...) come from much taller fallback fonts.
    _needsFallbackScale(ch) {
        let r = this._fallbackCache.get(ch);
        if (r !== undefined) return r;
        const cp = ch.codePointAt(0);
        if (isEmoji(cp)) {
            r = true;
        } else {
            if (this._headerFont === undefined) {
                try {
                    const desc = Pango.FontDescription.from_string('pxlxxl');
                    this._headerFont = this.textView.get_pango_context().load_font(desc);
                } catch (e) {
                    this._headerFont = null;
                }
            }
            r = this._headerFont ? !this._headerFont.has_char(String.fromCodePoint(cp)) : false;
        }
        this._fallbackCache.set(ch, r);
        return r;
    }

    // ------------------------------------------------------------------
    // List hanging indents
    // ------------------------------------------------------------------

    _baseFontDescription() {
        const desc = this.textView.get_pango_context().get_font_description().copy();
        if (this.colors.font) desc.set_family(`${this.colors.font},monospace`);
        if (this._fontPx) desc.set_absolute_size(this._fontPx * Pango.SCALE);
        return desc;
    }

    // Rendered width in pixels of a line prefix (indentation, quote and list
    // markers, task box) using the same scales/spacing as the applied tags
    _measurePrefix(text, box, checked, revealed) {
        const layout = Pango.Layout.new(this.textView.get_pango_context());
        layout.set_font_description(this._baseFontDescription());
        layout.set_text(text, -1);
        if (box >= 0) {
            const attrs = new Pango.AttrList();
            const add = (attr, s, e) => {
                attr.start_index = s;
                attr.end_index = e;
                attrs.insert(attr);
            };
            add(Pango.attr_family_new('monospace'), box, box + 3);
            if (revealed) {
                add(Pango.attr_scale_new(1.2 * 0.8), box, box + 3);
            } else {
                add(Pango.attr_scale_new(0.7 * 0.01), box, box + 1);
                add(Pango.attr_scale_new(0.7), box + 1, box + 2);
                add(Pango.attr_scale_new(0.7 * 0.01), box + 2, box + 3);
                add(Pango.attr_letter_spacing_new(4000), box, box + 3);
                add(Pango.attr_weight_new(checked ? 700 : 400), box, box + 3);
            }
            layout.set_attributes(attrs);
        }
        const [width] = layout.get_pixel_size();
        return width;
    }

    _indentTag(prefix, checked, revealed) {
        const key = `${prefix.text}\u0001${prefix.box}${checked ? 'x' : ''}${revealed ? 'r' : ''}`;
        let entry = this._indentTags.get(key);
        if (!entry) {
            if (this._indentTags.size >= MAX_INDENT_TAGS) return null;
            const tag = new Gtk.TextTag({ name: `md-indent-${this._indentSeq++}` });
            this._table.add(tag);
            this._ownTags.add(tag);
            entry = { tag, gen: -1, text: prefix.text, box: prefix.box, checked, revealed };
            this._indentTags.set(key, entry);
        }
        if (entry.gen !== this._metricsGen) this._updateIndent(entry);
        return entry.tag;
    }

    _updateIndent(entry) {
        const width = this._measurePrefix(entry.text, entry.box, entry.checked, entry.revealed);
        // Negative indent = hanging indent: the first line starts at the
        // margin, wrapped lines are indented to the item's content.
        if (entry.tag.indent !== -width) entry.tag.indent = -width;
        entry.gen = this._metricsGen;
    }

    // Re-measure all hanging indents now, and again after the next frame
    // in case the new CSS font is applied lazily.
    _refreshMetrics() {
        this._metricsGen++;
        for (const entry of this._indentTags.values()) this._updateIndent(entry);
        if (!this._tickId && !this._destroyed) {
            let frames = 0;
            this._tickId = this.textView.add_tick_callback(() => {
                if (++frames < 2) return GLib.SOURCE_CONTINUE;
                this._tickId = 0;
                this._metricsGen++;
                for (const entry of this._indentTags.values()) this._updateIndent(entry);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // ------------------------------------------------------------------
    // Edit tracking
    // ------------------------------------------------------------------

    _beginEdit(line) {
        this._applyPendingEdit();
        this._pendingEdit = { line, count: this.buffer.get_line_count() };
    }

    _applyPendingEdit() {
        const p = this._pendingEdit;
        if (!p) return;
        this._pendingEdit = null;
        const L = p.line;
        const delta = this.buffer.get_line_count() - p.count;
        if (delta > 0) {
            const add = (arr, fill) => {
                const extra = new Array(delta);
                for (let k = 0; k < delta; k++) extra[k] = fill();
                return arr.slice(0, L + 1).concat(extra, arr.slice(L + 1));
            };
            // Inserted text can inherit the split line's tags. New lines
            // also inherit its old block state: the last of them now ends
            // where line L used to, so the classify cascade compares it
            // with the state the following (pre-existing) line was
            // classified against and keeps going while they differ.
            const inherited = [...(this._lineTags[L] || [])];
            const oldKind = this._kinds[L] !== undefined ? this._kinds[L] : -1;
            const oldOut = this._fenceOut[L] !== undefined ? this._fenceOut[L] : '';
            this._texts = add(this._texts, () => null);
            this._kinds = add(this._kinds, () => oldKind);
            this._fenceOut = add(this._fenceOut, () => oldOut);
            this._dirty = add(this._dirty, () => DIRTY_TEXT);
            this._lineTags = add(this._lineTags, () => inherited.slice());
        } else if (delta < 0) {
            // Joined lines keep the tags of every line merged into L
            const merged = new Set(this._lineTags[L] || []);
            for (let k = L + 1; k <= L - delta && k < this._lineTags.length; k++)
                for (const tag of this._lineTags[k] || []) merged.add(tag);
            this._lineTags[L] = [...merged];
            // The joined line now ends where the last merged line ended, so
            // it takes over that line's old block state (see above)
            const last = Math.min(L - delta, this._fenceOut.length - 1);
            if (last > L) {
                this._fenceOut[L] = this._fenceOut[last];
                this._kinds[L] = this._kinds[last];
            }
            for (const arr of [this._texts, this._kinds, this._fenceOut, this._dirty, this._lineTags])
                arr.splice(L + 1, -delta);
        }
        const shift = (v) => (v > L ? Math.max(L, v + delta) : v);
        if (delta !== 0) {
            this._clsLo = shift(this._clsLo);
            this._clsHi = shift(this._clsHi);
            this._tagLo = shift(this._tagLo);
            this._tagHi = shift(this._tagHi);
            const lines = new Set();
            for (const l of this._reveal.lines) lines.add(shift(l));
            this._reveal.lines = lines;
            this._reveal.line = shift(this._reveal.line);
            if (this._carryFrom > L) this._carryFrom = Math.max(L + 1, this._carryFrom + delta);
        }
        for (let i = L; i <= L + Math.max(0, delta); i++) this._markText(i);
        this._scheduleFlush();
    }

    _markText(i) {
        if (i < 0 || i >= this._dirty.length) return;
        this._dirty[i] = DIRTY_TEXT;
        if (i < this._clsLo) this._clsLo = i;
        if (i > this._clsHi) this._clsHi = i;
        if (i < this._tagLo) this._tagLo = i;
        if (i > this._tagHi) this._tagHi = i;
    }

    _markTag(i) {
        if (i < 0 || i >= this._dirty.length) return;
        if (this._dirty[i] === DIRTY_NONE) this._dirty[i] = DIRTY_TAG;
        if (i < this._tagLo) this._tagLo = i;
        if (i > this._tagHi) this._tagHi = i;
    }

    // ------------------------------------------------------------------
    // Line access
    // ------------------------------------------------------------------

    _iterAtLine(i) {
        const r = this.buffer.get_iter_at_line(i);
        return Array.isArray(r) ? r[1] : r;
    }

    _lineEndIter(start) {
        const end = start.copy();
        if (!end.ends_line()) end.forward_to_line_end();
        return end;
    }

    _readLines(a, b) {
        const start = this._iterAtLine(a);
        const end = this._lineEndIter(this._iterAtLine(b));
        const parts = Parser.splitLines(this.buffer.get_text(start, end, true));
        for (let i = a; i <= b; i++) {
            if (this._dirty[i] === DIRTY_TEXT || this._texts[i] === null)
                this._texts[i] = parts[i - a] !== undefined ? parts[i - a] : '';
        }
    }

    _readLine(i) {
        const start = this._iterAtLine(i);
        this._texts[i] = this.buffer.get_text(start, this._lineEndIter(start), true);
    }

    _ensureClassified() {
        this._applyPendingEdit();
        if (this._clsLo <= this._clsHi) this._classify();
    }

    _modelAt(line) {
        this._ensureClassified();
        if (line < 0 || line >= this._texts.length) return null;
        const kind = this._kinds[line];
        if (kind !== Kind.TEXT && kind !== Kind.HEADING) return null;
        // Cache the last parsed line: getLinkAtIter runs on every pointer
        // motion while Ctrl is held
        const text = this._texts[line];
        const fenceIn = line > 0 ? this._fenceOut[line - 1] : '';
        const c = this._modelCache;
        if (c && c.text === text && c.fenceIn === fenceIn) return c.model;
        const model = Parser.parseLine(text, fenceIn);
        this._modelCache = { text, fenceIn, model };
        return model;
    }

    // Opening fence line of the block containing line i, or -1
    _fenceOpenFor(i) {
        if (!FENCE_KINDS.has(this._kinds[i])) return -1;
        while (i > 0 && this._kinds[i] !== Kind.FENCE_OPEN) i--;
        return this._kinds[i] === Kind.FENCE_OPEN ? i : -1;
    }

    // Closing fence line of the block opened at line o, or -1 if unclosed
    _fenceCloseFor(o) {
        const n = this._kinds.length;
        let i = o + 1;
        while (i < n && this._kinds[i] === Kind.CODE) i++;
        return i < n && this._kinds[i] === Kind.FENCE_CLOSE ? i : -1;
    }

    // ------------------------------------------------------------------
    // Classification (pure JS, cheap): re-parse dirty lines' block state
    // and cascade while the fence state differs from before.
    // ------------------------------------------------------------------

    // Classify pending lines, continuing past the dirty range while the
    // fence state differs from before. Stops after line stopAt (the rest is
    // continued by a later call, see _carryFrom).
    _classify(stopAt = Infinity) {
        const n = this._texts.length;
        const lo = Math.max(0, this._clsLo);
        const hi = Math.min(n - 1, this._clsHi);
        const carryFrom = this._carryFrom;
        this._clsLo = Infinity;
        this._clsHi = -1;
        this._carryFrom = -1;
        if (lo > hi) return;

        const readHi = Math.min(hi, stopAt);
        let textDirty = 0;
        for (let i = lo; i <= readHi; i++) if (this._dirty[i] === DIRTY_TEXT) textDirty++;
        const bulk = textDirty > 32;
        if (bulk) this._readLines(lo, readHi);

        let fenceChangeLo = -1, fenceChangeHi = -1;
        let carry = false;
        for (let i = lo; i < n; i++) {
            if (i === carryFrom) carry = true;
            const dirty = this._dirty[i] === DIRTY_TEXT;
            if (i > hi && !carry) break;
            if (i > stopAt) {
                // Defer the rest; remember whether line i must be
                // re-classified because the state above it changed
                this._clsLo = i;
                this._clsHi = Math.max(hi, i);
                this._carryFrom = carry ? i : -1;
                break;
            }
            if (!dirty && !carry && this._kinds[i] >= 0) continue;
            if (this._texts[i] === null || (dirty && !(bulk && i <= readHi))) this._readLine(i);

            const fenceIn = i > 0 ? this._fenceOut[i - 1] : '';
            const c = Parser.classifyLine(this._texts[i], fenceIn);
            const oldKind = this._kinds[i];
            const oldOut = this._fenceOut[i];
            this._kinds[i] = c.kind;
            this._fenceOut[i] = c.fenceOut;
            carry = c.fenceOut !== oldOut;

            if (dirty || c.kind !== oldKind) {
                this._dirty[i] = DIRTY_TAG;
                if (i < this._tagLo) this._tagLo = i;
                if (i > this._tagHi) this._tagHi = i;
            }
            if (carry || c.kind !== oldKind) {
                if (fenceChangeLo < 0) fenceChangeLo = i;
                fenceChangeHi = i;
            }
        }

        // Fence structure changed: opening fence lines render differently
        // when their block is closed or not, and the cursor's block may
        // have changed shape.
        if (fenceChangeLo >= 0) {
            const open = this._fenceOpenFor(Math.max(0, fenceChangeLo - 1));
            if (open >= 0) this._markTag(open);
            for (let i = fenceChangeLo; i <= fenceChangeHi; i++) {
                if (this._kinds[i] === Kind.FENCE_OPEN) this._markTag(i);
            }
            this._revealValid = false;
        }
    }

    _classifyPending() {
        return this._clsLo <= this._clsHi;
    }

    // Last line whose classification is up to date
    _classifiedFrontier() {
        return this._classifyPending() ? this._clsLo - 1 : this._texts.length - 1;
    }

    // ------------------------------------------------------------------
    // Cursor reveal
    // ------------------------------------------------------------------

    _updateReveal() {
        const [hasSelection] = this.buffer.get_selection_bounds();
        // Keep the current reveal state while a selection is being made so
        // the text does not change width under the pointer.
        if (hasSelection && this._revealValid) return;

        const iter = this.buffer.get_iter_at_mark(this._insertMark);
        const line = iter.get_line();
        const col = iter.get_line_offset();
        const lines = new Set([line]);
        const open = this._fenceOpenFor(line);
        if (open >= 0) {
            lines.add(open);
            const close = this._fenceCloseFor(open);
            if (close >= 0) lines.add(close);
        }

        const old = this._reveal;
        if (this._revealValid && old.line === line && old.col === col &&
            old.lines.size === lines.size && [...lines].every(l => old.lines.has(l)))
            return;

        for (const l of old.lines) this._markTag(l);
        for (const l of lines) this._markTag(l);
        this._reveal = { line, col, lines };
        this._revealValid = true;
    }

    // ------------------------------------------------------------------
    // Flushing
    // ------------------------------------------------------------------

    _scheduleFlush() {
        if (this._flushId || this._destroyed) return;
        // Runs before GTK's layout/paint (GDK_PRIORITY_REDRAW), so edits and
        // cursor moves are rendered in the same frame.
        this._flushId = GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
            this._flushId = 0;
            this._flush(0);
            return GLib.SOURCE_REMOVE;
        });
    }

    // One render pass. budgetUs: 0 = only what must be visible now (the
    // rest continues in background chunks), Infinity = everything.
    _flush(budgetUs) {
        if (this._destroyed || this._inFlush) return;
        this._inFlush = true;
        try {
            this._applyPendingEdit();
            if (this._classifyPending()) {
                if (budgetUs === Infinity) {
                    this._classify();
                } else {
                    const cursorLine = this.buffer.get_iter_at_mark(this._insertMark).get_line();
                    this._classify(Math.max(this._visibleRange()[1], cursorLine));
                }
            }
            this._updateReveal();
            this._tagPending(budgetUs);
        } catch (e) {
            logError(e, 'Jotite markdown renderer');
        } finally {
            this._inFlush = false;
        }
        this._ensureBackgroundWork();
    }

    // Background chunk: classify the next block of lines, then tag
    _backgroundStep() {
        if (this._destroyed || this._inFlush) return;
        this._inFlush = true;
        try {
            this._applyPendingEdit();
            if (this._classifyPending()) this._classify(this._clsLo + CLASSIFY_CHUNK_LINES);
            this._updateReveal();
            this._tagPending(CHUNK_BUDGET_US);
        } catch (e) {
            logError(e, 'Jotite markdown renderer');
        } finally {
            this._inFlush = false;
        }
        this._ensureBackgroundWork();
    }

    _ensureBackgroundWork() {
        if (this._chunkId || this._destroyed) return;
        if (!this._classifyPending() && this._tagLo > this._tagHi) return;
        // Above GtkTextView's layout validation (GDK_PRIORITY_REDRAW + 5) so
        // lines are tagged before GTK lays them out, but below redraw so
        // frames keep being drawn and input is handled between chunks.
        this._chunkId = GLib.idle_add(CHUNK_PRIORITY, () => {
            this._chunkId = 0;
            this._backgroundStep();
            return GLib.SOURCE_REMOVE;
        });
    }

    _visibleRange() {
        const n = this._texts.length;
        const tv = this.textView;
        let a, b;
        const rect = tv.get_mapped() ? tv.get_visible_rect() : null;
        if (rect && rect.height > 0) {
            a = tv.get_line_at_y(rect.y)[0].get_line();
            b = tv.get_line_at_y(rect.y + rect.height)[0].get_line();
        } else {
            a = b = this.buffer.get_iter_at_mark(this._insertMark).get_line();
            b += 40;
        }
        return [Math.max(0, a - VISIBLE_MARGIN), Math.min(n - 1, b + VISIBLE_MARGIN)];
    }

    // Tag pending lines (only classified ones). The reveal lines and the
    // visible region are always done now; other lines too if few, or until
    // budgetUs is used up; the remainder continues in background chunks.
    _tagPending(budgetUs) {
        const n = this._texts.length;
        if (this._tagLo > this._tagHi) return;
        const frontier = this._classifiedFrontier();

        const tagIfDirty = (i) => {
            if (i >= 0 && i <= frontier && this._dirty[i] !== DIRTY_NONE) this._tagLineSafe(i);
        };
        for (const l of this._reveal.lines) tagIfDirty(l);

        const lo = Math.max(0, this._tagLo);
        const hi = Math.min(n - 1, this._tagHi, frontier);
        let pending = 0;
        for (let i = lo; i <= hi && pending <= SYNC_LINE_LIMIT; i++)
            if (this._dirty[i] !== DIRTY_NONE) pending++;

        const all = pending <= SYNC_LINE_LIMIT || budgetUs === Infinity;
        if (!all) {
            const [va, vb] = this._visibleRange();
            for (let i = va; i <= vb; i++) tagIfDirty(i);
        }

        const t0 = GLib.get_monotonic_time();
        let i = lo;
        let done = 0;
        for (; i <= hi; i++) {
            if (this._dirty[i] !== DIRTY_NONE) {
                this._tagLineSafe(i);
                if (!all && (++done & 7) === 0 && GLib.get_monotonic_time() - t0 > budgetUs) {
                    i++;
                    break;
                }
            }
        }
        if (i > hi && hi === Math.min(n - 1, this._tagHi)) {
            this._tagLo = Infinity;
            this._tagHi = -1;
        } else {
            this._tagLo = i;
        }
    }


    _tagLineSafe(i) {
        this._dirty[i] = DIRTY_NONE;
        try {
            this._tagLine(i);
        } catch (e) {
            logError(e, `Jotite markdown renderer: line ${i}`);
        }
    }

    // ------------------------------------------------------------------
    // Applying tags to one line
    // ------------------------------------------------------------------

    _tagByName(name) {
        let tag = this._namedTags.get(name);
        if (!tag) {
            tag = this._table.lookup(name);
            this._namedTags.set(name, tag);
        }
        return tag;
    }

    _tagLine(i) {
        if (this._texts[i] === null) this._readLine(i);
        const text = this._texts[i];
        const kind = this._kinds[i];
        const buffer = this.buffer;
        const start = this._iterAtLine(i);
        const next = start.copy();
        if (!next.forward_line()) next.forward_to_end();

        // Remove what this renderer applied to the line before
        for (const tag of this._lineTags[i]) {
            if (this._ownTags.has(tag)) buffer.remove_tag(tag, start, next);
        }
        const used = new Set();
        this._lineTags[i] = used;

        // Two scratch iters reused for every span (avoids allocating iters)
        const sIter = start.copy(), eIter = start.copy();
        const applyRange = (tag, s, e) => {
            if (typeof tag === 'string') tag = this._tagByName(tag);
            if (!tag) return;
            buffer.apply_tag(tag, s, e);
            used.add(tag);
        };
        const apply = (tag, s, e) => {
            if (e > s) {
                sIter.set_line_offset(s);
                eIter.set_line_offset(e);
                applyRange(tag, sIter, eIter);
            }
        };

        applyRange('no-hyphens', start, next);
        const revealed = this._revealValid && this._reveal.lines.has(i);

        if (kind === Kind.CODE) {
            applyRange('code-block', start, next);
            return;
        }
        if (kind === Kind.FENCE_OPEN || kind === Kind.FENCE_CLOSE) {
            applyRange('code-block', start, next);
            // An unclosed fence stays visible so it is clear why the rest
            // of the note is code
            const show = revealed || (kind === Kind.FENCE_OPEN && this._fenceCloseFor(i) < 0);
            const end = this._lineEndIter(start);
            if (end.compare(start) > 0) applyRange(show ? 'dim' : 'invisible', start, end);
            return;
        }
        if (kind === Kind.BLANK) return;

        const model = Parser.parseLine(text, i > 0 ? this._fenceOut[i - 1] : '');
        const col = (this._revealValid && this._reveal.line === i) ? this._reveal.col : -1;

        for (const s of model.spans) apply(s.t, s.s, s.e);
        for (const m of model.marks) {
            const on = col >= 0 && col >= m.gs && col <= m.ge;
            const tag = on ? m.on : m.off;
            if (tag) apply(tag, m.s, m.e);
        }

        if (model.heading) this._applyHeading(model.heading, text, apply);

        if (model.prefix && model.prefix.end > 0) {
            const task = model.task;
            const boxRevealed = !!task && col >= task.s && col <= task.s + 3;
            const tag = this._indentTag(model.prefix, !!task && task.checked, boxRevealed);
            if (tag) applyRange(tag, start, next);
        }
    }


    _applyHeading(heading, text, apply) {
        const level = heading.level;
        const moodIndex = (level - 1) % this._moods.length;
        const gradient = this._moods[moodIndex].gradient;
        const chars = Array.from(text);
        let runTag = null, runStart = 0;
        for (let c = heading.contentStart; c <= heading.contentEnd; c++) {
            let tag = null;
            if (c < heading.contentEnd) {
                const i = c - heading.contentStart;
                tag = this._needsFallbackScale(chars[c])
                    ? `emoji-h${level}`
                    : this._gradientTag(moodIndex, level, (i + level * 2) % gradient.length);
            }
            if (tag !== runTag) {
                if (runTag) apply(runTag, runStart, c);
                runTag = tag;
                runStart = c;
            }
        }
    }
};
