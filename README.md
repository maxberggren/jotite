# Jotite

<img src="icon.png" alt="Jotite Icon" width="64" height="64" />

**Jotite** - A lightweight, distraction-free markdown note-taking app with live rendering and cursor-aware syntax hiding.

![Demo Video](https://github.com/user-attachments/assets/e132e309-d115-4bd1-a965-b219b8458457)

## Installation

### Dependencies

Make sure you have GJS and GTK4 installed:

```bash
# Arch Linux
sudo pacman -S gjs gtk4 libadwaita fontconfig
```

### From AUR (Arch Linux)

```bash
yay -S jotite-git
```

## Features

### ⌨️ Keyboard Shortcuts
- **Ctrl+S** or **Ctrl+Enter** - Save note
- **Ctrl+Shift+S** - Save As (choose location)
- **Ctrl+N** - New file
- **Ctrl+O** - Open file
- **Ctrl+X** - Cut entire line (when no selection)
- **Ctrl+Up/Down** - Move current line up/down
- **Ctrl+Plus/Minus** - Zoom in/out
- **Ctrl+0** - Reset zoom
- **Escape** - Close application
- **Tab/Shift+Tab** - Indent/outdent bullets
- **Enter** - Auto-continue bullet lists


## Usage

Open a specific file:
```bash
jotite ~/Documents/notes/mynote.md
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