// Run from the repository root: gjs tests/file_window.js   (needs a display)
// Window-level file behavior: no dirty flag after open, byte-identical save,
// nonexistent paths, autosave, recovery drafts, external changes, invalid
// UTF-8, close/quit guards, per-window zoom and status bar state.
const { GLib } = imports.gi;
const root = GLib.dir_make_tmp('jotite-window-XXXXXX');
// Isolate config/state before anything caches the XDG directories
GLib.setenv('XDG_CONFIG_HOME', `${root}/config`, true);
GLib.setenv('XDG_STATE_HOME', `${root}/state`, true);
GLib.setenv('GTK_A11Y', 'none', true);

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { Gio, Gtk, Gdk, Adw } = imports.gi;
imports.searchPath.unshift(GLib.get_current_dir());

const notesDir = `${root}/notes`;
GLib.mkdir_with_parents(`${root}/config/jotite`, 0o700);
GLib.file_set_contents(`${root}/config/jotite/settings.json`,
    JSON.stringify({ notesPath: notesDir, autosave: true }));

// The renderer is being rewritten against a contract; fill in any contract
// method the checked-out renderer does not have yet so this test can run.
const { MarkdownRenderer } = imports.markdown.markdownRenderer;
for (const name of ['renderNow', 'setMoodConfig', 'setZoom', 'invalidateAll', 'destroy'])
    if (typeof MarkdownRenderer.prototype[name] !== 'function')
        MarkdownRenderer.prototype[name] = function () {};
if (typeof MarkdownRenderer.prototype.getLinkAtIter !== 'function')
    MarkdownRenderer.prototype.getLinkAtIter = () => null;

for (const [mod, cls, names] of [
    ['bulletHandlers', 'BulletHandlers', ['destroy']],
    ['todoHandlers', 'TodoHandlers', ['destroy']],
    ['searchBar', 'SearchBarComponent', ['destroy', 'updateColors']],
]) {
    const proto = imports.ui[mod][cls].prototype;
    for (const name of names)
        if (typeof proto[name] !== 'function')
            proto[name] = function () {};
}
const { Constants } = imports.constants;
Constants.APP_ID = `com.github.jotite.test${GLib.random_int_range(0, 1e6)}`;
const { JotApplication } = imports.app.application;
const { JotWindow } = imports.ui.window;
const { LinkHandlers } = imports.ui.linkHandlers;
const { Drafts } = imports.file.drafts;

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
    if (cond) {
        passes++;
    } else {
        failures++;
        printerr(`FAIL: ${name} ${detail}`);
    }
}
const enc = s => new TextEncoder().encode(s);
const read = p => GLib.file_get_contents(p)[1];
const readText = p => new TextDecoder().decode(read(p));
const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
const exists = p => GLib.file_test(p, GLib.FileTest.EXISTS);
const draftDir = `${root}/state/jotite/drafts`;
const draftFiles = () => {
    try {
        const out = [];
        const en = Gio.File.new_for_path(draftDir).enumerate_children('standard::name', 0, null);
        let i;
        while ((i = en.next_file(null))) out.push(i.get_name());
        return out;
    } catch (e) {
        return [];
    }
};
const typeText = (w, text) => {
    const b = w._textView.get_buffer();
    b.begin_user_action();
    b.insert_at_cursor(text, -1);
    b.end_user_action();
};
// Answer the visible Adw.AlertDialog of a window
const answer = (w, response) => {
    const d = w.get_visible_dialog();
    if (!d) return false;
    d.emit('response', response);
    d.force_close();
    return true;
};

async function run(app) {
    // ---- Open + save without edits is byte-identical, not dirty ----------
    const crlfPath = `${root}/crlf.md`;
    const crlfBytes = new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('# Title\r\n- a -> b\r\nÅäö 😀\r\nlast')]);
    GLib.file_set_contents(crlfPath, crlfBytes);
    let w = new JotWindow(app, { file: Gio.File.new_for_path(crlfPath) });
    w.present();
    await sleep(200);
    check('open: not dirty', w.hasUnsavedChanges === false);
    check('open: label without dirty marker', !w._pathLabel.get_label().startsWith('●'), w._pathLabel.get_label());
    check('open: save resolves true', (await w.save()) === true);
    check('open+save byte-identical (BOM+CRLF+no trailing newline)', bytesEqual(read(crlfPath), crlfBytes));

    // Edit -> dirty marker; autosave writes CRLF; marker restored after flash
    w._buffer.place_cursor(w._buffer.get_end_iter());
    typeText(w, ' edit');
    await sleep(50);
    check('edit: dirty', w.hasUnsavedChanges === true);
    check('edit: status state dirty', w._statusState().dirty === true);
    w._setZoom(110);
    await sleep(1200);
    check('flash restores dirty marker', w._pathLabel.get_label().startsWith('● ') || !w.hasUnsavedChanges,
        w._pathLabel.get_label());
    await sleep(800);
    check('autosave: clean', w.hasUnsavedChanges === false);
    check('autosave: CRLF+BOM preserved', bytesEqual(read(crlfPath),
        new Uint8Array([0xEF, 0xBB, 0xBF, ...enc('# Title\r\n- a -> b\r\nÅäö 😀\r\nlast edit')])), readText(crlfPath));

    // ---- Mixed line endings: kept verbatim, edits touch only their line ---
    {
        const mixedPath = `${root}/mixed.md`;
        GLib.file_set_contents(mixedPath, enc('a\r\n- [ ] b\r\nc\nd\r\n'));
        const mw = new JotWindow(app, { file: Gio.File.new_for_path(mixedPath) });
        mw.present();
        await sleep(100);
        check('mixed: open+save byte-identical', (await mw.save()) && readText(mixedPath) === 'a\r\n- [ ] b\r\nc\nd\r\n');
        const mb = mw._textView.get_buffer();
        mb.place_cursor(mb.get_iter_at_line(2)[1]);
        typeText(mw, 'X');
        mb.place_cursor(mb.get_iter_at_line(1)[1]);
        mw._bulletHandlers.handleKeyPress(Constants.KEY_T, Constants.CTRL_MASK);
        await mw.save();
        check('mixed: edits keep other line endings', readText(mixedPath) === 'a\r\n- [X] b\r\nXc\nd\r\n', JSON.stringify(readText(mixedPath)));
        mb.place_cursor(mb.get_iter_at_line(0)[1]);
        mw._lineMovement.moveLineDown();
        await mw.save();
        check('mixed: line move keeps endings', readText(mixedPath) === '- [X] b\r\na\r\nXc\nd\r\n', JSON.stringify(readText(mixedPath)));
        mw.forceClose();
    }

    // ---- External change while clean -> silent reload (monitor) ---------
    await sleep(100);
    GLib.file_set_contents(crlfPath, enc('# Changed elsewhere\r\nline two\r\n'));
    await sleep(900);
    const buf = w._textView.get_buffer();
    check('external change (clean): reloaded', buf.get_text(buf.get_start_iter(), buf.get_end_iter(), false) === '# Changed elsewhere\nline two\n');
    check('external change (clean): not dirty', !w.hasUnsavedChanges);

    // ---- External change while dirty -> conflict, nothing clobbered ------
    typeText(w, 'my unsaved words');
    await sleep(50);
    GLib.file_set_contents(crlfPath, enc('third version\n'));
    await sleep(2200);
    check('external change (dirty): conflict shown', w._conflict === true && w._conflictBanner.get_revealed());
    check('external change (dirty): file not clobbered by autosave', readText(crlfPath) === 'third version\n');
    check('external change (dirty): still dirty', w.hasUnsavedChanges);
    // Explicit save asks Reload/Overwrite/Cancel
    let saved = w.save();
    await sleep(100);
    check('conflict: dialog shown on save', answer(w, 'overwrite'));
    check('conflict: overwrite resolves true', (await saved) === true);
    check('conflict: overwritten', readText(crlfPath).includes('my unsaved words'));
    check('conflict: banner hidden', !w._conflictBanner.get_revealed());

    // ---- Invalid UTF-8 is refused, buffer untouched --------------------------
    const latin1 = `${root}/latin1.md`;
    GLib.file_set_contents(latin1, new Uint8Array([0x48, 0xE9, 0x0A]));
    const before = buf.get_text(buf.get_start_iter(), buf.get_end_iter(), false);
    check('invalid utf8: loadFile false', w.loadFile(Gio.File.new_for_path(latin1)) === false);
    check('invalid utf8: buffer untouched', buf.get_text(buf.get_start_iter(), buf.get_end_iter(), false) === before);
    check('invalid utf8: still bound to previous file', w.getFilePath() === crlfPath);
    check('invalid utf8: file untouched', bytesEqual(read(latin1), new Uint8Array([0x48, 0xE9, 0x0A])));

    // ---- Escape closes a clean window ------------------------------------
        w._onKeyPressed(Gdk.KEY_Escape, 0);
    await sleep(100);
    check('escape: clean window closed', w._destroyed && !w.get_visible());

    // ---- Nonexistent path: empty buffer bound to path, created on save ----
    const newPath = `${root}/new/dir/fresh.md`;
    w = new JotWindow(app, { file: Gio.File.new_for_path(newPath) });
    w.present();
    await sleep(100);
    check('nonexistent: bound to path', w.getFilePath() === newPath);
    check('nonexistent: empty, clean', w._textView.get_buffer().get_char_count() === 0 && !w.hasUnsavedChanges);
    check('nonexistent: not created on open', !exists(newPath));
    typeText(w, 'hello');
    await sleep(1800);
    check('nonexistent: created by autosave', exists(newPath) && readText(newPath) === 'hello');
    // Ctrl+click on a local .md link goes through the guard
    typeText(w, ' more');
    const other = `${root}/other.md`;
    GLib.file_set_contents(other, 'other file\n');
    w.openFile(Gio.File.new_for_path(other));
    await sleep(100);
    check('link open: autosaved before replacing', readText(newPath) === 'hello more');
    check('link open: other file loaded', w.getFilePath() === other);

    // Ctrl+Enter / Ctrl+KP_Enter save without inserting a newline: handled
    // by a capture-phase controller that runs before GtkTextView's own
    for (const [name, keyval] of [['Return', Gdk.KEY_Return], ['KP_Enter', Gdk.KEY_KP_Enter]]) {
        const ob = w._textView.get_buffer();
        ob.place_cursor(ob.get_end_iter());
        typeText(w, name);
        const expected = ob.get_text(ob.get_start_iter(), ob.get_end_iter(), false);
        const ctl = w._saveKeyController;
        check(`ctrl+${name}: capture phase`, ctl.get_propagation_phase() === Gtk.PropagationPhase.CAPTURE);
        const handled = ctl.emit('key-pressed', keyval, 36, Gdk.ModifierType.CONTROL_MASK);
        await sleep(100);
        check(`ctrl+${name}: handled`, handled === true);
        check(`ctrl+${name}: buffer unchanged`, ob.get_text(ob.get_start_iter(), ob.get_end_iter(), false) === expected);
        check(`ctrl+${name}: saved`, readText(other) === expected && !w.hasUnsavedChanges, readText(other));
    }
    w.forceClose();

    // ---- Untitled note: recovery draft, Save in close dialog -------------
    w = new JotWindow(app);
    w.present();
    await sleep(100);
    check('untitled: no file', w.getFilePath() === null);
    check('untitled: today template clean', !w.hasUnsavedChanges);
    check('untitled: notesPath honored in label', w._pathLabel.get_label().startsWith(notesDir), w._pathLabel.get_label());
    check('untitled: notes dir not created', !exists(notesDir));
    w._textView.get_buffer().set_text('# Måndag möte\nimportant', -1);
    await sleep(1800);
    check('draft: written', draftFiles().length === 1, draftFiles().join(','));
    check('untitled: Unicode filename suggestion', w._pathLabel.get_label().endsWith('måndag-möte.md'), w._pathLabel.get_label());

    // Close -> dialog -> Save -> Save As cancelled -> window stays, draft stays
    w._chooseSaveFile = () => Promise.resolve(null);
    w.close();
    await sleep(100);
    check('close dirty: dialog shown', answer(w, 'save'));
    await sleep(100);
    check('close + Save As cancelled: window kept', !w._destroyed);
    check('close + Save As cancelled: draft kept', draftFiles().length === 1);

    // Save to a read-only location fails -> window kept
    const roDir = `${root}/readonly`;
    GLib.mkdir_with_parents(roDir, 0o500);
    w._chooseSaveFile = () => Promise.resolve(Gio.File.new_for_path(`${roDir}/x.md`));
    w.close();
    await sleep(100);
    answer(w, 'save');
    await sleep(150);
    check('close + save fails: window kept', !w._destroyed);
    check('close + save fails: still dirty', w.hasUnsavedChanges);

    // Save succeeds -> closed, draft removed, file written
    const savedPath = `${notesDir}/måndag-möte.md`;
    w._chooseSaveFile = () => Promise.resolve(Gio.File.new_for_path(savedPath));
    w.close();
    await sleep(100);
    answer(w, 'save');
    await sleep(150);
    check('close + save ok: closed', w._destroyed);
    check('close + save ok: written', exists(savedPath) && readText(savedPath) === '# Måndag möte\nimportant');
    check('close + save ok: draft removed', draftFiles().length === 0, draftFiles().join(','));

    // ---- Draft restore -----------------------------------------------------
    const drafts = new Drafts(draftDir);
    drafts.write('20200101T000000-999999999-1', '# Lost note\ncrash text');
    app._draftsChecked = false;
    const opened = app._restoreDrafts();
    const restored = app._jotWindows().find(x => x.getFilePath() === null);
    check('restore: window opened', opened === 1 && !!restored);
    const rb = restored._textView.get_buffer();
    check('restore: text', rb.get_text(rb.get_start_iter(), rb.get_end_iter(), false) === '# Lost note\ncrash text');
    check('restore: dirty', restored.hasUnsavedChanges);
    check('restore: re-owned draft', draftFiles().length === 1 && !draftFiles()[0].includes('999999999'), draftFiles().join(','));

    // ---- Ctrl+Q prompts every dirty window in turn -------------------------
    const w2 = new JotWindow(app);
    w2.present();
    w2._textView.get_buffer().set_text('second dirty', -1);
    await sleep(50);
    const quitting = app.quitGracefully();
    await sleep(100);
    const first = [restored, w2].find(x => x.get_visible_dialog());
    check('quit: first dirty window prompted', !!first);
    answer(first, 'discard');
    await sleep(100);
    const second = [restored, w2].find(x => x !== first && x.get_visible_dialog());
    check('quit: second dirty window prompted', !!second);
    answer(second, 'cancel');
    await quitting;
    check('quit: cancelled keeps windows', app._jotWindows().length === 2);
    check('quit: discarded draft deleted', !draftFiles().some(n => first._draftId && n.startsWith(first._draftId)));

    // ---- Per-window zoom -------------------------------------------------
    restored._buffer.set_modified(false);
    w2._buffer.set_modified(false);
    await sleep(100);
    const size = x => x._textView.get_pango_context().get_font_description().get_size();
    const s1 = size(restored), s2 = size(w2);
    w2._setZoom(150);
    await sleep(300);
    check('zoom: zoomed window grows', size(w2) > s2, `${s2} -> ${size(w2)}`);
    check('zoom: other window unchanged', size(restored) === s1, `${s1} -> ${size(restored)}`);

    // ---- Link target resolution ------------------------------------------
    const r1 = LinkHandlers.resolve('https://example.com/a?b=1&c="x"', null);
    check('link: https uri', r1.kind === 'uri' && r1.uri === 'https://example.com/a?b=1&c="x"');
    const r2 = LinkHandlers.resolve('my%20note.md#top', `${root}/dir/cur.md`);
    check('link: relative + unescaped', r2.kind === 'file' && r2.file.get_path() === `${root}/dir/my note.md`, r2.file?.get_path());
    check('link: mailto', LinkHandlers.resolve('mailto:a@b.c', null).kind === 'uri');
    check('link: www', LinkHandlers.resolve('www.example.com', null).uri === 'https://www.example.com');

    // ---- Invalid settings.json: status bar only, once per distinct error --
    {
        const settingsPath = `${root}/config/jotite/settings.json`;
        const good = readText(settingsPath);
        const sw = [new JotWindow(app), new JotWindow(app)];
        const counts = sw.map(() => ({ errors: 0, flashes: 0 }));
        sw.forEach((x, k) => {
            x.present();
            x.showError = () => counts[k].errors++;
            const flash = x._flash.bind(x);
            x._flash = (msg, opts) => {
                if (msg.includes('settings.json')) counts[k].flashes++;
                flash(msg, opts);
            };
        });
        await sleep(300);
        for (const text of ['{ "notesPath": ', '{ "notesPath": ', '{ "notesPath": ']) {
            GLib.file_set_contents(settingsPath, text);
            await sleep(500);
        }
        check('settings error: no toast/error dialog', counts.every(c => c.errors === 0), JSON.stringify(counts));
        check('settings error: flashed once per window', counts.every(c => c.flashes === 1), JSON.stringify(counts));
        check('settings error: warning in status bar', !!sw[0]._statusState().warning);
        GLib.file_set_contents(settingsPath, good);
        await sleep(500);
        check('settings fixed: warning cleared', !sw[0]._statusState().warning);
        GLib.file_set_contents(settingsPath, '{ broken');
        await sleep(500);
        check('settings error again: flashed again', counts.every(c => c.flashes === 2), JSON.stringify(counts));
        GLib.file_set_contents(settingsPath, good);
        await sleep(500);
        sw.forEach(x => x.forceClose());
    }

    // ---- FAQ opens read-only from the app directory (not copied) ---------
    {
        const { SettingsManager } = imports.settings.settingsManager;
        // The app directory is derived from the program path (tests/ here)
        Object.defineProperty(SettingsManager, 'faqPath', {
            get: () => `${GLib.get_current_dir()}/FAQ.md`, configurable: true,
        });
        const faqPath = SettingsManager.faqPath;
        const faqBytes = read(faqPath);
        const host = new JotWindow(app);
        host.present();
        host._openFAQ();
        await sleep(150);
        const faq = app._jotWindows().find(x => x.getFilePath() === faqPath);
        check('faq: opened from app dir', !!faq, faqPath);
        check('faq: not copied to config', !exists(`${root}/config/jotite/FAQ.md`));
        if (faq) {
            check('faq: read-only', faq.readOnly && !faq._textView.get_editable());
            const fb = faq._textView.get_buffer();
            fb.place_cursor(fb.get_start_iter());
            check('faq: Ctrl+T ignored', faq._bulletHandlers.handleKeyPress(Constants.KEY_T, Constants.CTRL_MASK) === false);
            check('faq: save refused', (await faq.save()) === false);
            check('faq: file untouched', bytesEqual(read(faqPath), faqBytes));
            host._openFAQ();
            await sleep(50);
            check('faq: second open raises same window',
                app._jotWindows().filter(x => x.getFilePath() === faqPath).length === 1);
            faq.forceClose();
        }
        host.forceClose();
    }

    // ---- Teardown: everything closes cleanly -------------------------------
    for (const x of app._jotWindows()) x.forceClose();
    await sleep(100);
    check('teardown: all windows closed', app._jotWindows().length === 0);
}

const { GObject } = imports.gi;
const TestApp = GObject.registerClass(class TestApp extends JotApplication {
    vfunc_activate() {
        this.hold();
        run(this).catch(e => {
            failures++;
            printerr(`FAIL: exception ${e}\n${e.stack}`);
        }).finally(() => {
            this.release();
            this.quit();
        });
    }
});
const app = new TestApp();
app.run([]);
GLib.spawn_sync(null, ['chmod', '-R', 'u+w', root], null, GLib.SpawnFlags.SEARCH_PATH, null);
GLib.spawn_sync(null, ['rm', '-rf', '--', root], null, GLib.SpawnFlags.SEARCH_PATH, null);
if (failures) {
    printerr(`${failures} failed, ${passes} passed`);
    imports.system.exit(1);
}
print(`PASS: file_window (${passes} checks)`);
