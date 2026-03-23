const { Gio } = imports.gi;
const Shell = imports.gi.Shell;

const IFACE = '<node><interface name="org.gnome.Shell.Extensions.WindowTracker"><method name="GetActiveWindow"><arg type="s" direction="out" name="result"/></method></interface></node>';

let dbusImpl = null;

const Impl = class {
    GetActiveWindow() {
        try {
            const win = global.display.focus_window;
            if (!win) return JSON.stringify({title:"",app:"",pid:0});
            const tracker = Shell.WindowTracker.get_default();
            const app = tracker.get_window_app(win);
            return JSON.stringify({
                title: win.title || "",
                app: app ? app.get_name() : (win.wm_class || ""),
                pid: win.get_pid ? win.get_pid() : 0
            });
        } catch(e) {
            return JSON.stringify({title:"",app:"",pid:0,error:String(e)});
        }
    }
};

function init() {}

function enable() {
    dbusImpl = Gio.DBusExportedObject.wrapJSObject(IFACE, new Impl());
    dbusImpl.export(Gio.DBus.session, "/org/gnome/Shell/Extensions/WindowTracker");
}

function disable() {
    if (dbusImpl) { dbusImpl.unexport(); dbusImpl = null; }
}
