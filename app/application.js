const { Gio, GLib, Adw, GObject } = imports.gi;
const { Constants } = imports.constants;

// ============================================================================
// Application
// ============================================================================
//
// Single instance: launching `jotite FILE...` while Jotite runs opens the
// files in the running instance; plain `jotite` raises the most recently
// focused window (or opens today's note when no window is open). Every file
// gets its own window; a file that is already open just raises its window.

function _appDirectory() {
    return GLib.path_get_dirname(imports.system.programPath);
}

// Make the bundled pixel font available when running from a source checkout
// (packages install it system-wide). Registers it with the process' font map
// only; nothing is written to disk.
function _registerBundledFont() {
    const appDir = _appDirectory();
    if (appDir.startsWith('/usr/'))
        return;
    const path = GLib.build_filenamev([appDir, 'pxlxxl.ttf']);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return;
    try {
        imports.gi.versions.PangoCairo = '1.0';
        const { PangoCairo } = imports.gi;
        const fontMap = PangoCairo.FontMap.get_default();
        if (typeof fontMap.add_font_file === 'function')
            fontMap.add_font_file(path);
    } catch (e) {
        logError(e, 'Jotite: could not register bundled font');
    }
}

var JotApplication = GObject.registerClass(
class JotApplication extends Adw.Application {
    _init() {
        super._init({
            application_id: Constants.APP_ID,
            flags: Gio.ApplicationFlags.HANDLES_OPEN,
        });
        this._draftsChecked = false;
        this._quitting = false;
    }

    vfunc_startup() {
        super.vfunc_startup();
        _registerBundledFont();

        const quitAction = new Gio.SimpleAction({ name: 'quit' });
        quitAction.connect('activate', () => this.quitGracefully());
        this.add_action(quitAction);
        this.set_accels_for_action('app.quit', ['<Control>q']);
    }

    _JotWindow() {
        return imports.ui.window.JotWindow;
    }

    _jotWindows() {
        const JotWindow = this._JotWindow();
        return this.get_windows().filter(w => w instanceof JotWindow);
    }

    _windowForFile(file) {
        return this._jotWindows().find(w => {
            const path = w.getFilePath();
            return path && file.get_path() && path === file.get_path();
        }) || null;
    }

    // Recovery drafts left by a crashed session are restored once, at the
    // first activation of this process. Returns the number of windows opened.
    _restoreDrafts() {
        if (this._draftsChecked)
            return 0;
        this._draftsChecked = true;
        const { Drafts } = imports.file.drafts;
        const JotWindow = this._JotWindow();
        let count = 0;
        for (const draft of new Drafts().listOrphans()) {
            if (!draft.text.trim()) {
                new Drafts().remove(draft.id);
                continue;
            }
            new JotWindow(this, { draft }).present();
            count++;
        }
        return count;
    }

    vfunc_activate() {
        if (this._restoreDrafts() > 0)
            return;
        // Plain `jotite` while Jotite runs raises the most recently focused
        // window (GtkApplication keeps them in focus order); a new note
        // window is only opened when there is none.
        const existing = this._jotWindows()[0];
        if (existing) {
            existing.present();
            return;
        }
        const JotWindow = this._JotWindow();
        new JotWindow(this).present();
    }

    vfunc_open(files, _hint) {
        this._restoreDrafts();
        const JotWindow = this._JotWindow();
        for (const file of files) {
            const existing = this._windowForFile(file);
            if (existing)
                existing.present();
            else
                new JotWindow(this, { file }).present();
        }
    }

    // Ctrl+Q: ask about unsaved changes in every window, one after another;
    // quit only if none of them was cancelled.
    async quitGracefully() {
        if (this._quitting)
            return;
        this._quitting = true;
        try {
            const windows = this._jotWindows();
            for (const w of windows) {
                if (!(await w.confirmClose()))
                    return;
            }
            for (const w of windows)
                w.forceClose();
            this.quit();
        } catch (e) {
            logError(e, 'Jotite: quit failed');
        } finally {
            this._quitting = false;
        }
    }
});
