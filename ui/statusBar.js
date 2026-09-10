const { Gtk, Gdk, Gio, GLib } = imports.gi;
const { FileManager } = imports.file.fileManager;

// ============================================================================
// Status Bar Component
// ============================================================================

var StatusBarComponent = class StatusBarComponent {
    constructor(window, settingsManager, currentFilename) {
        this.window = window;
        this.settingsManager = settingsManager;
        this.currentFilename = currentFilename;
        this.statusBar = null;
        this.pathLabel = null;
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

        const jotDir = FileManager.getJotDirectory(this.settingsManager);
        this.pathLabel = new Gtk.Label({
            label: GLib.build_filenamev([jotDir, this.currentFilename]),
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
        pathGesture.connect('pressed', () => {
            // Delegate to window method
            if (this.window._openFileLocation) {
                this.window._openFileLocation();
            }
        });
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
        faqButton.connect('clicked', () => {
            if (this.window._openFAQ) {
                this.window._openFAQ();
            }
        });

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
        settingsButton.connect('clicked', () => {
            if (this.window._openSettings) {
                this.window._openSettings();
            }
        });

        rightBox.append(faqButton);
        rightBox.append(settingsButton);
        this.statusBar.append(rightBox);

        return this.statusBar;
    }

    getLabel() {
        return this.pathLabel;
    }
};
