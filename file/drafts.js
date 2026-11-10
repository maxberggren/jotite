const { Gio, GLib } = imports.gi;

// ============================================================================
// Recovery drafts for untitled notes
// ============================================================================
//
// While an untitled (never saved) note has unsaved edits, its text is written
// to $XDG_STATE_HOME/jotite/drafts/<id>.md (default ~/.local/state/jotite).
// The draft is deleted once the note is saved or explicitly discarded, so any
// draft found at startup belongs to a session that crashed or was killed.
// Draft ids embed the owning process id so a running instance never restores
// another live process's drafts.

function defaultDraftDir() {
    return GLib.build_filenamev([GLib.get_user_state_dir(), 'jotite', 'drafts']);
}

let _counter = 0;

function _pidAlive(pid) {
    if (!pid)
        return false;
    if (pid === _ownPid())
        return true;
    return GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS);
}

function _ownPid() {
    try {
        return Number(GLib.file_read_link('/proc/self'));
    } catch (e) {
        return 0;
    }
}

var Drafts = class Drafts {
    constructor(dir = null) {
        this.dir = dir || defaultDraftDir();
    }

    newId() {
        const time = GLib.DateTime.new_now_utc().format('%Y%m%dT%H%M%S');
        return `${time}-${_ownPid()}-${++_counter}`;
    }

    pathFor(id) {
        return GLib.build_filenamev([this.dir, `${id}.md`]);
    }

    // Atomically write a draft. Errors propagate to the caller.
    write(id, text) {
        GLib.mkdir_with_parents(this.dir, 0o700);
        const file = Gio.File.new_for_path(this.pathFor(id));
        const stream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
        const bytes = new TextEncoder().encode(text);
        if (bytes.length > 0)
            stream.write_all(bytes, null);
        stream.close(null);
    }

    remove(id) {
        if (!id)
            return;
        try {
            Gio.File.new_for_path(this.pathFor(id)).delete(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(e, 'Jotite: could not delete draft');
        }
    }

    // Drafts left behind by processes that are no longer running, oldest
    // first: [{ id, path, text, modified: GLib.DateTime }]
    listOrphans() {
        const result = [];
        let enumerator;
        try {
            enumerator = Gio.File.new_for_path(this.dir).enumerate_children(
                'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return result;
        }
        let info;
        while ((info = enumerator.next_file(null))) {
            const name = info.get_name();
            if (!name.endsWith('.md'))
                continue;
            const id = name.slice(0, -3);
            const pid = Number(id.split('-')[1]);
            if (_pidAlive(pid))
                continue;
            const path = this.pathFor(id);
            try {
                const [, bytes] = GLib.file_get_contents(path);
                const text = new TextDecoder().decode(bytes);
                result.push({ id, path, text, modified: info.get_modification_date_time() });
            } catch (e) {
                logError(e, `Jotite: could not read draft ${path}`);
            }
        }
        enumerator.close(null);
        result.sort((a, b) => a.id.localeCompare(b.id));
        return result;
    }
};
