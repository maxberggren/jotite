const { Gtk, GLib, Gio, Gdk } = imports.gi;

// ============================================================================
// Link Handlers: Ctrl+click opens links, Ctrl+hover shows a pointer
// ============================================================================
//
// Link detection is delegated to the renderer (getLinkAtIter), which knows
// the parsed inline structure ([text](url), <autolinks>, bare URLs). URLs are
// opened through Gtk.UriLauncher / Gtk.FileLauncher (portal-aware, no shell).
// Local text files open in Jotite through the window's unsaved-changes guard.

const TEXT_EXTENSIONS = /\.(md|markdown|mdown|mkd|txt|text)$/i;

var LinkHandlers = class LinkHandlers {
    constructor(textView, markdownRenderer, window) {
        this.textView = textView;
        this.markdownRenderer = markdownRenderer;
        this.window = window;
        this._pointer = false;
        this._controllers = [];
    }

    setup() {
        const clickGesture = new Gtk.GestureClick();
        clickGesture.connect('pressed', (gesture, nPress, x, y) => this._handleClick(gesture, x, y));
        this.textView.add_controller(clickGesture);

        const motion = new Gtk.EventControllerMotion();
        motion.connect('motion', (controller, x, y) => this._handleMotion(controller, x, y));
        motion.connect('leave', () => this._setPointer(false));
        this.textView.add_controller(motion);

        this._controllers = [clickGesture, motion];
    }

    destroy() {
        for (const c of this._controllers)
            this.textView.remove_controller(c);
        this._controllers = [];
    }

    _linkAt(x, y) {
        const [bx, by] = this.textView.window_to_buffer_coords(Gtk.TextWindowType.WIDGET, x, y);
        const [inside, iter] = this.textView.get_iter_at_location(bx, by);
        if (!inside)
            return null;
        return this.markdownRenderer.getLinkAtIter(iter) || null;
    }

    _handleMotion(controller, x, y) {
        const state = controller.get_current_event_state();
        if (!(state & Gdk.ModifierType.CONTROL_MASK)) {
            this._setPointer(false);
            return;
        }
        this._setPointer(!!this._linkAt(x, y));
    }

    _setPointer(on) {
        if (on === this._pointer)
            return;
        this._pointer = on;
        this.textView.set_cursor_from_name(on ? 'pointer' : 'text');
    }

    _handleClick(gesture, x, y) {
        const state = gesture.get_current_event_state();
        if (!(state & Gdk.ModifierType.CONTROL_MASK))
            return;
        const url = this._linkAt(x, y);
        if (!url)
            return;
        gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        this.openLink(url);
    }

    // Resolve a link target. Returns { kind: 'uri', uri } or { kind: 'file', file }.
    static resolve(url, currentFilePath) {
        const trimmed = url.trim().replace(/^<|>$/g, '');
        const scheme = GLib.Uri.peek_scheme(trimmed);
        if (scheme && scheme !== 'file')
            return { kind: 'uri', uri: trimmed };
        if (/^www\./i.test(trimmed))
            return { kind: 'uri', uri: `https://${trimmed}` };

        let file;
        if (scheme === 'file') {
            file = Gio.File.new_for_uri(trimmed.replace(/#.*$/, ''));
        } else {
            // Relative or absolute path, possibly percent-encoded, maybe with #anchor
            let path = trimmed.replace(/#.*$/, '');
            path = GLib.Uri.unescape_string(path, null) ?? path;
            if (path.startsWith('~/'))
                path = GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
            if (!GLib.path_is_absolute(path)) {
                const base = currentFilePath ? GLib.path_get_dirname(currentFilePath) : GLib.get_home_dir();
                path = GLib.build_filenamev([base, path]);
            }
            file = Gio.File.new_for_path(GLib.canonicalize_filename(path, null));
        }
        return { kind: 'file', file };
    }

    openLink(url) {
        const target = LinkHandlers.resolve(url, this.window.getFilePath?.() ?? null);
        if (target.kind === 'uri') {
            new Gtk.UriLauncher({ uri: target.uri }).launch(this.window, null, (launcher, result) => {
                try {
                    launcher.launch_finish(result);
                } catch (e) {
                    if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        this.window.showError?.(`Could not open ${target.uri}: ${e.message}`);
                }
            });
            return;
        }

        const file = target.file;
        if (!file.query_exists(null)) {
            this.window.showError?.(`Link target not found: ${file.get_path()}`);
            return;
        }
        const isDir = file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY;
        if (!isDir && TEXT_EXTENSIONS.test(file.get_basename())) {
            // Goes through the unsaved-changes guard
            this.window.openFile(file);
            return;
        }
        new Gtk.FileLauncher({ file }).launch(this.window, null, (launcher, result) => {
            try {
                launcher.launch_finish(result);
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this.window.showError?.(`Could not open ${file.get_path()}: ${e.message}`);
            }
        });
    }
};
