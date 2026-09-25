const { Gtk, GObject, Graphene } = imports.gi;

// Draw list dots over transparent asterisks, preserving buffer text and layout.
var MarkdownTextView = GObject.registerClass(
class MarkdownTextView extends Gtk.TextView {
    vfunc_snapshot_layer(layer, snapshot) {
        if (layer !== Gtk.TextViewLayer.ABOVE_TEXT || !this.bulletColor) return;

        const buffer = this.get_buffer();
        const tag = buffer.get_tag_table().lookup('bullet-star');
        if (!tag) return;

        const visible = this.get_visible_rect();
        const [, iter] = this.get_iter_at_location(visible.x, visible.y);
        iter.set_line_offset(0);
        do {
            if (!iter.has_tag(tag)) continue;
            const rect = this.get_iter_location(iter);
            if (rect.y > visible.y + visible.height) break;
            if (rect.y + rect.height < visible.y) continue;

            const radius = Math.min(Math.abs(rect.width) * 0.3, rect.height * 0.14);
            if (radius <= 0) continue;
            const bounds = new Graphene.Rect();
            bounds.init(rect.x, rect.y, Math.abs(rect.width), rect.height);
            const cr = snapshot.append_cairo(bounds);
            const color = this.bulletColor;
            cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
            cr.arc(rect.x + rect.width / 2, rect.y + rect.height / 2,
                radius, 0, 2 * Math.PI);
            cr.fill();
            cr.$dispose();
        } while (iter.forward_to_tag_toggle(tag));
    }
});
