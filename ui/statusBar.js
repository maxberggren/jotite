const { Gtk, Gdk, Gio, GLib } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Status Bar Component
// ============================================================================
//
// The label text is always derived from window state through getState():
// { text, tooltip, dirty, warning }. Transient messages (save feedback, zoom
// level, errors) are shown with flash() and the derived text is restored
// afterwards, so the dirty marker is never lost.

var StatusBarComponent = class StatusBarComponent {
    // callbacks: { getState, onPathClicked, onFaq, onSettings }
    constructor(callbacks) {
        this._callbacks = callbacks;
        this.statusBar = null;
        this.pathLabel = null;
        this._flashSourceId = 0;
    }

    create() {
        this.statusBar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 16,
            height_request: 24,
            margin_start: 0,
            margin_end: 0,
            margin_top: 4,
            margin_bottom: 4,
        });
        this.statusBar.add_css_class('jot-statusbar');

        this.pathLabel = new Gtk.Label({
            label: '',
            halign: Gtk.Align.START,
            hexpand: true,
            ellipsize: 3,
            margin_start: 8,
        });
        this.pathLabel.add_css_class('status-label');
        
        // Set pointer cursor for path label
        this.pathLabel.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        
        // Make the path label clickable
        const pathGesture = new Gtk.GestureClick();
        pathGesture.connect('pressed', () => this._callbacks.onPathClicked?.());
        this.pathLabel.add_controller(pathGesture);

        this.statusBar.append(this.pathLabel);

        // Add right-side buttons
        const rightBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 0,
            halign: Gtk.Align.END,
            margin_end: 8,
        });

        // Load our own symbolic artwork, independent of fonts and icon themes.
        const statusIcon = (name) => new Gtk.Image({
            gicon: new Gio.FileIcon({
                file: Gio.File.new_for_path(GLib.build_filenamev([
                    imports.searchPath[0], 'ui', 'icons', `${name}-symbolic.svg`,
                ])),
            }),
            pixel_size: 14,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });

        // FAQ button (question mark)
        const faqButton = new Gtk.Button({
            child: statusIcon('help'),
            tooltip_text: 'Open FAQ',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        faqButton.add_css_class('status-button');
        faqButton.update_property([Gtk.AccessibleProperty.LABEL], ['Open FAQ']);
        faqButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        faqButton.connect('clicked', () => this._callbacks.onFaq?.());

        // Settings button (cog/gear)
        const settingsButton = new Gtk.Button({
            child: statusIcon('settings'),
            tooltip_text: 'Open Settings',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        settingsButton.add_css_class('status-button');
        settingsButton.add_css_class('status-settings-button');
        settingsButton.update_property([Gtk.AccessibleProperty.LABEL], ['Open Settings']);
        settingsButton.set_cursor(Gdk.Cursor.new_from_name('pointer', null));
        settingsButton.connect('clicked', () => this._callbacks.onSettings?.());

        rightBox.append(faqButton);
        rightBox.append(settingsButton);
        this.statusBar.append(rightBox);

        return this.statusBar;
    }

    getLabel() {
        return this.pathLabel;
    }

    // Re-derive the label from window state (unless a message is flashing).
    refresh() {
        if (this._flashSourceId || !this.pathLabel)
            return;
        const state = this._callbacks.getState();
        if (state.warning) {
            this.pathLabel.set_label(`⚠ ${state.warning}`);
            this.pathLabel.set_tooltip_text(state.warning);
            this.pathLabel.add_css_class('status-error');
            return;
        }
        this.pathLabel.remove_css_class('status-error');
        this.pathLabel.set_label((state.dirty ? '● ' : '') + state.text);
        this.pathLabel.set_tooltip_text(state.tooltip ?? state.text);
    }

    // Show a transient message, then restore the derived text.
    flash(message, { error = false, timeout = Constants.FEEDBACK_TIMEOUT_MS } = {}) {
        if (!this.pathLabel)
            return;
        if (this._flashSourceId)
            GLib.source_remove(this._flashSourceId);
        this.pathLabel.set_label(message);
        this.pathLabel.set_tooltip_text(message);
        if (error)
            this.pathLabel.add_css_class('status-error');
        else
            this.pathLabel.remove_css_class('status-error');
        this._flashSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
            this._flashSourceId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._flashSourceId) {
            GLib.source_remove(this._flashSourceId);
            this._flashSourceId = 0;
        }
        this._callbacks = { getState: () => ({ text: '' }) };
    }
};
