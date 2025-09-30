# Jot

A quick-capture note jotter for Linux desktop built with GJS and GTK4.

## Features

- **Global hotkey access**: Summon from anywhere (requires desktop environment configuration)
- **Instant capture**: Type your thought and hit Ctrl+Enter to save
- **Minimal interface**: Simple text box that disappears when done
- **Markdown storage**: All notes appended to `~/Jot/inbox.md` with timestamps
- **Zero friction**: No organization overhead, just capture and go

## Installation

1. Make sure you have GJS and GTK4 installed:
   ```bash
   # Arch Linux
   sudo pacman -S gjs gtk4 libadwaita
   ```

2. Clone or download this repository

3. Make the script executable:
   ```bash
   chmod +x jot
   ```

4. Copy the desktop entry to your applications folder:
   ```bash
   mkdir -p ~/.local/share/applications
   cp jot.desktop ~/.local/share/applications/
   # Update the Exec path in jot.desktop to match your installation location
   ```

## Usage

### Running Jot

Run directly:
```bash
./jot
```

Or launch from your application menu after installing the desktop entry.

### Keyboard Shortcuts

- **Ctrl+Enter**: Save note and close
- **Escape**: Close without saving

### Setting Up Global Hotkey

Configure a global hotkey in your desktop environment to launch Jot:

**GNOME:**
```bash
# Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts
# Add new shortcut with command: /path/to/jot
# Assign your preferred hotkey (e.g., Super+J)
```

**KDE Plasma:**
```bash
# System Settings → Shortcuts → Custom Shortcuts
# Add new Command/URL shortcut
# Command: /path/to/jot
```

**i3/Sway:**
```bash
# Add to your config:
bindsym $mod+j exec /path/to/jot
```

### Notes Location

All notes are saved to `~/Jot/inbox.md` with timestamps in the format:

```markdown
## 2025-09-30 14:32:15
Your note content here

## 2025-09-30 15:45:22
Another quick thought
```

## License

MIT
