#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

// Add current directory to import search path
const { GLib } = imports.gi;
const scriptDir = GLib.path_get_dirname(imports.system.programPath);
imports.searchPath.unshift(scriptDir);

const { JotApplication } = imports.app.application;

// ============================================================================
// Entry Point
// ============================================================================

const app = new JotApplication();
app.run([imports.system.programInvocationName].concat(ARGV));

