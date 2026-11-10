# Jotite

**Jotite** - A whimsical, lightweight, distraction-free Linux markdown note-taking app with live rendering.

## Demo

https://github.com/user-attachments/assets/6bb0a5ee-39ee-40ef-8ae7-403afd8ff62a

## Installation

### From AUR (Arch Linux)

```bash
yay -S jotite
```

### Dependencies for development

Make sure you have GJS and GTK4 installed:

```bash
# Arch Linux
sudo pacman -S gjs gtk4 libadwaita fontconfig
```

## Features

- Live markdown rendering: markup fades away and reappears when the cursor is near it
- Gradient-colored headings with configurable "moods"
- Smart lists: Enter continues bullets, numbers and tasks; Tab nests; numbering stays correct
- Autosave for saved notes, recovery drafts for untitled ones, and a warning if the file changes on disk
- Files round-trip byte-for-byte (line endings, BOM and trailing newline are preserved)
- Follows your Omarchy theme live

### ⌨️ Keyboard Shortcuts
- **Ctrl+S** or **Ctrl+Enter** - Save note
- **Ctrl+Shift+S** - Save As (choose location)
- **Ctrl+N** - New note
- **Ctrl+O** - Open file
- **Ctrl+F** - Find; **F3** / **Ctrl+G** next match, **Shift+F3** / **Ctrl+Shift+G** previous
- **Ctrl+Z** / **Ctrl+Shift+Z** (or **Ctrl+Y**) - Undo / redo (every command is a single undo step)
- **Ctrl+T** - Toggle the task checkbox on the current line
- **Ctrl+X** - Cut entire line (when nothing is selected)
- **Ctrl+Up/Down** - Move the current line (or all selected lines) up/down
- **Ctrl+Plus/Minus** - Zoom in/out (per window); **Ctrl+0** - Reset zoom
- **Ctrl+Click** - Open a link (web links in the browser, local notes in Jotite)
- **Escape** - Close search, or close the window (asks to save unsaved untitled notes)
- **Ctrl+Q** - Quit (asks about every window with unsaved changes)
- **Tab/Shift+Tab** - Nest/un-nest list items; on a heading, add/remove a `#`
- **Enter** - Continue a list; Enter on an empty item ends the list
- **Shift+Enter** - Plain newline (no list continuation)
- **Double-click a `[ ]`** - Toggle that task ([ ] ↔ [X])

### Manual Installation (All Distributions)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/maxberggren/omarchy-jotite.git
   cd omarchy-jotite
   ```

2. **Install the files:**
   ```bash
   # Install the application
   sudo install -d /usr/share/jotite
   sudo cp -r jotite.js constants.js settings.json app file markdown settings theme ui util /usr/share/jotite/
   printf '#!/bin/sh\nexec gjs /usr/share/jotite/jotite.js "$@"\n' | sudo install -Dm755 /dev/stdin /usr/local/bin/jotite

   # Install desktop entry and icon
   sudo install -Dm644 jotite.desktop /usr/share/applications/jotite.desktop
   sudo install -Dm644 icon.png /usr/share/pixmaps/jotite.png

   # Install the heading font
   sudo install -Dm644 pxlxxl.ttf /usr/share/fonts/TTF/pxlxxl.ttf
   sudo fc-cache -f
   ```

3. **Make sure dependencies are installed:**
   
   **Debian/Ubuntu:**
   ```bash
   sudo apt install gjs gir1.2-gtk-4.0 gir1.2-adw-1 fontconfig
   ```
   
   **Fedora:**
   ```bash
   sudo dnf install gjs gtk4 libadwaita fontconfig
   ```


## Usage

Open one or more files (a path that doesn't exist yet is created on first save):
```bash
jotite ~/Documents/notes/mynote.md other.md
```

Jotite runs as a single instance: launching it again opens files in the running app.

Run the test suite from the repository root:
```bash
for t in tests/*.js; do case "$t" in *bench*|*Harness*) ;; *) gjs "$t" ;; esac; done
gjs tests/bench_renderer.js   # renderer benchmark
```

Or launch from your application menu after installing the desktop entry.

### Setting Up Global Hotkey

Configure a global hotkey in your desktop environment to launch Jotite:

**Hyprland (Omarchy):**
```bash
# ~/.config/hypr/bindings.conf
bindd = SUPER SHIFT, J, Jotite, exec, uwsm app -- jotite
```

**Generic Hyprland:**
```bash
bind = SUPER SHIFT, J, exec, jotite
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Credits

Built with:
- [Jot](https://github.com/bjarneo/omarchy-jot) - Forked from Jot
- [GJS](https://gjs.guide/) - GNOME JavaScript bindings
- [GTK4](https://www.gtk.org/) - The GTK toolkit
- [Libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/) - GNOME design patterns
- [pxlxxl font](https://www.1001fonts.com/pxlxxl-font.html) - Pixel font for headers (free for personal use)