#!/usr/bin/env python3
"""
AT-SPI window focus watcher — prints focused window info to stdout.
Used by Electron main process to track active window on Wayland.
"""
import sys
import signal
import pyatspi

def get_window_info():
    """Get currently focused/active window."""
    try:
        desktop = pyatspi.Registry.getDesktop(0)
        
        # First pass: find window with ACTIVE or FOCUSED state
        for app in desktop:
            if app is None or not app.name:
                continue
            try:
                for window in app:
                    if window is None or not window.name:
                        continue
                    state = window.getState()
                    if (state.contains(pyatspi.STATE_ACTIVE) or
                        state.contains(pyatspi.STATE_FOCUSED)):
                        return app.name, window.name
            except:
                continue

        # Second pass: priority apps fallback
        priority = ['Google Chrome', 'chromium', 'Firefox', 'Brave',
                    'code', 'slack', 'Slack', 'spotify', 'discord']
        for p in priority:
            for app in desktop:
                if app is None or not app.name:
                    continue
                if p.lower() not in app.name.lower():
                    continue
                try:
                    for window in app:
                        if window is None or not window.name:
                            continue
                        return app.name, window.name
                except:
                    continue
    except Exception as e:
        print(f"ERROR:{e}", file=sys.stderr, flush=True)
    return None, None

def on_focus(event):
    """Called when any window gains focus."""
    try:
        app_name = event.source.get_application().name if event.source else ''
        win_name = event.source.name if event.source else ''

        # Skip empty or our own app
        if not app_name or not win_name:
            return
        if 'electron' in app_name.lower() and 'employee' in win_name.lower():
            return

        print(f"{app_name}||{win_name}", flush=True)
    except:
        pass

def on_window_activate(event):
    """Called when a window is activated."""
    try:
        source = event.source
        if source is None:
            return
        
        app = source.get_application()
        app_name = app.name if app else ''
        win_name = source.name if source else ''

        if not app_name or not win_name:
            return
        if 'electron' in app_name.lower() and 'employee' in win_name.lower():
            return

        print(f"{app_name}||{win_name}", flush=True)
    except:
        pass

# Print current focused window immediately on start
app_name, win_name = get_window_info()
if app_name and win_name:
    print(f"{app_name}||{win_name}", flush=True)

# Register AT-SPI event listeners
pyatspi.Registry.registerEventListener(on_focus, 'focus:')
pyatspi.Registry.registerEventListener(on_window_activate, 'window:activate')
pyatspi.Registry.registerEventListener(on_window_activate, 'window:create')

# Graceful shutdown
signal.signal(signal.SIGTERM, lambda *_: pyatspi.Registry.stop())
signal.signal(signal.SIGINT,  lambda *_: pyatspi.Registry.stop())

# Start event loop
pyatspi.Registry.start(synchronous=False, gil=False)