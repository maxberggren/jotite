const { Gtk, GObject, Graphene, Pango } = imports.gi;

const ARROW_RE = /<->|->|<-/g;
const ARROW_GLYPHS = { '->': '→', '<-': '←', '<->': '↔' };

// Text view that draws visual-only decorations over transparent source
// characters, preserving buffer text and layout:
//   - list dots over '*' bullets (tag 'bullet-star')
//   - arrow glyphs over '->', '<-' and '<->' (tag 'arrow')
// Colours are set by MarkdownRenderer (bulletColor, arrowColor). Only the
// visible part of the buffer is scanned.
var MarkdownTextView = GObject.registerClass(
class MarkdownTextView extends Gtk.TextView {
    vfunc_snapshot_layer(layer, snapshot) {
        if (layer !== Gtk.TextViewLayer.ABOVE_TEXT) return;
        if (!this.bulletColor && !this.arrowColor) return;

        const table = this.get_buffer().get_tag_table();
        const visible = this.get_visible_rect();
        const [, top] = this.get_iter_at_location(visible.x, visible.y);
        top.set_line_offset(0);
        const [, bottom] = this.get_iter_at_location(visible.x + visible.width, visible.y + visible.height);
        if (!bottom.ends_line()) bottom.forward_to_line_end();

        const bulletTag = this.bulletColor ? table.lookup('bullet-star') : null;
        if (bulletTag) {
            this._forEachRun(bulletTag, top, bottom, (start, end) => {
                const iter = start.copy();
                while (iter.compare(end) < 0) {
                    this._drawDot(snapshot, this.get_iter_location(iter));
                    iter.forward_char();
                }
            });
        }

        const arrowTag = this.arrowColor ? table.lookup('arrow') : null;
        if (arrowTag) {
            this._forEachRun(arrowTag, top, bottom, (start, end) => {
                const text = this.get_buffer().get_text(start, end, true);
                ARROW_RE.lastIndex = 0;
                let m;
                while ((m = ARROW_RE.exec(text)) !== null) {
                    // Arrows are ASCII, so string indices equal char offsets
                    const s = start.copy();
                    s.forward_chars(m.index);
                    const last = s.copy();
                    last.forward_chars(m[0].length - 1);
                    this._drawArrow(snapshot, ARROW_GLYPHS[m[0]], s, last, arrowTag);
                }
            });
        }
    }

    // Call fn(runStart, runEnd) for each range tagged with tag that
    // intersects [top, bottom]
    _forEachRun(tag, top, bottom, fn) {
        const it = top.copy();
        if (!it.has_tag(tag) && !it.forward_to_tag_toggle(tag)) return;
        while (it.compare(bottom) <= 0) {
            const runStart = it.copy();
            const runEnd = it.copy();
            runEnd.forward_to_tag_toggle(tag);
            if (runEnd.compare(runStart) <= 0) break;
            fn(runStart, runEnd);
            it.assign(runEnd);
            if (!it.forward_to_tag_toggle(tag)) break;
        }
    }

    _drawDot(snapshot, rect) {
        const radius = Math.min(Math.abs(rect.width) * 0.3, rect.height * 0.14);
        if (radius <= 0) return;
        const bounds = new Graphene.Rect();
        bounds.init(rect.x, rect.y, Math.abs(rect.width), rect.height);
        const cr = snapshot.append_cairo(bounds);
        const color = this.bulletColor;
        cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
        cr.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, radius, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }

    _drawArrow(snapshot, glyph, first, last, arrowTag) {
        const a = this.get_iter_location(first);
        const b = this.get_iter_location(last);
        if (a.y !== b.y) return; // wrapped between its characters
        const width = b.x + b.width - a.x;

        // Match the size, family and colour other tags give these chars
        // (e.g. a heading's scale and gradient colour)
        let scale = 1;
        let family = null;
        let color = this.arrowColor;
        for (const tag of first.get_tags()) {
            if (tag === arrowTag) continue;
            if (tag.scale_set) scale *= tag.scale;
            if (tag.family_set) family = tag.family;
            if (tag.foreground_set && tag.foreground_rgba) color = tag.foreground_rgba;
        }

        const layout = this.create_pango_layout(glyph);
        const desc = this.get_pango_context().get_font_description().copy();
        if (family) desc.set_family(`${family},${desc.get_family() || 'monospace'}`);
        if (scale !== 1) {
            if (desc.get_size_is_absolute()) desc.set_absolute_size(desc.get_size() * scale);
            else desc.set_size(Math.round(desc.get_size() * scale));
        }
        layout.set_font_description(desc);
        const [lw, lh] = layout.get_pixel_size();

        const point = new Graphene.Point();
        point.init(a.x + (width - lw) / 2, a.y + (a.height - lh) / 2);
        snapshot.save();
        snapshot.translate(point);
        snapshot.append_layout(layout, color);
        snapshot.restore();
    }
});
