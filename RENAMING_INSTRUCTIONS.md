# Renaming Instructions: jot → jotite

This guide will help you complete the renaming process for your repository.

## ✅ Completed Steps

The following files have already been updated:
- [x] `jot.js` - Updated app name references (APP_ID, window title, directory paths)
- [x] `jot.desktop` → `jotite.desktop` - Renamed and updated
- [x] `README.md` - Completely rewritten with comprehensive feature list

## 📋 Steps to Complete

### 1. Rename the Local Repository Folder

```bash
# Navigate to the parent directory
cd /home/max/Code

# Rename the folder
mv omarchy-jot omarchy-jotite

# Navigate into the renamed folder
cd omarchy-jotite
```

### 2. Rename the Main Script File

```bash
# Rename jot.js to jotite.js
mv jot.js jotite.js

# Make it executable (if not already)
chmod +x jotite.js
```

### 3. Update Any Symlinks

If you created a symlink for easy access, update it:

```bash
# Remove old symlink (if it exists)
sudo rm /usr/local/bin/jot

# Create new symlink
sudo ln -s $(pwd)/jotite.js /usr/local/bin/jotite
```

### 4. Update Desktop Entry Installation

If you installed the desktop entry:

```bash
# Remove old desktop entry (if it exists)
rm ~/.local/share/applications/jot.desktop

# Copy new desktop entry
cp jotite.desktop ~/.local/share/applications/

# Update the Exec path in the desktop file if needed
nano ~/.local/share/applications/jotite.desktop
# Change: Exec=/path/to/jotite.js (or just 'jotite' if symlink exists)

# Refresh desktop database
update-desktop-database ~/.local/share/applications/
```

### 5. Rename GitHub Repository

#### Option A: Via GitHub Web Interface (Recommended)

1. Go to your repository on GitHub: `https://github.com/yourusername/omarchy-jot`
2. Click on **Settings** (tab near the top)
3. Scroll down to the **Repository name** section
4. Change the name from `omarchy-jot` to `omarchy-jotite`
5. Click **Rename**
6. GitHub will automatically redirect all old links to the new URL

#### Option B: Via Git Commands

After renaming on GitHub, update your local repository:

```bash
cd /home/max/Code/omarchy-jotite

# Update the remote URL to the new repository name
git remote set-url origin https://github.com/yourusername/omarchy-jotite.git

# Or if using SSH:
git remote set-url origin git@github.com:yourusername/omarchy-jotite.git

# Verify the new remote URL
git remote -v
```

### 6. Commit and Push All Changes

```bash
cd /home/max/Code/omarchy-jotite

# Stage all changes
git add .

# Commit the changes
git commit -m "Rename project from jot to jotite

- Updated app name and directory references in jotite.js
- Renamed jot.desktop to jotite.desktop
- Rewrote README.md with comprehensive feature documentation
- Updated all user-facing strings and paths"

# Push to GitHub
git push origin markdown
```

### 7. Update the Font Directory (User Files)

The app will automatically create a new font directory at `~/.local/share/fonts/jotite/` on first run. You can optionally clean up the old font directory:

```bash
# Optional: Remove old font directory
rm -rf ~/.local/share/fonts/jot/

# Update font cache
fc-cache -f
```

### 8. Update User Data Directory (Optional)

If you want to rename the user data directory:

```bash
# Rename the directory
mv ~/Documents/Jot ~/Documents/Jotite

# All existing notes will be preserved and accessible
```

## 🔍 Verification Checklist

After completing the steps above, verify:

- [ ] Repository folder renamed to `omarchy-jotite`
- [ ] Script renamed to `jotite.js`
- [ ] Symlink points to `jotite` (not `jot`)
- [ ] Desktop entry installed as `jotite.desktop`
- [ ] GitHub repository renamed to `omarchy-jotite`
- [ ] Git remote URL updated
- [ ] All changes committed and pushed
- [ ] Application launches successfully with new name
- [ ] Window title shows "Jotite"
- [ ] Saves to `~/Documents/Jotite/` by default

## 🎉 Done!

Your project has been successfully renamed from **jot** to **jotite**!

### Testing the Installation

```bash
# Test running the app
jotite

# Or directly
./jotite.js

# Open with a file
jotite ~/Documents/Jotite/test.md
```

### Update Your Hotkey Configuration

If you set up a global hotkey, update it:

**Hyprland:**
```bash
# ~/.config/hypr/bindings.conf
bindd = SUPER SHIFT, J, Jotite, exec, uwsm app -- jotite
```

## 📝 Notes

- GitHub automatically redirects old repository URLs to the new one
- Existing clones will continue to work with the old remote URL
- The app will create new directories automatically on first run
- All existing notes in `~/Documents/Jot/` will still be accessible (either manually rename the directory or keep both)
