/* Own TV dashboard — app.js
   Classic script, no dependencies, no network access of its own.
   All TV data comes from window.OwnTVBridge (parent-owned bridge.js).
   Sample data exists only in explicit browser preview mode (?preview=sample). */
(function () {
  'use strict';

  var VERSION = '0.2.2';
  var STORE_KEY = 'owntv.preferences.v1';
  var EXPORT_KIND = 'owntv.preferences';
  var POLL_MS = 60 * 1000;
  var CALL_TIMEOUT_MS = 65 * 1000; // TV helper spawns node; allow cold starts
  var STALE_MS = 3 * 60 * 1000;
  var MAX_IMPORT_CHARS = 64 * 1024;
  var UA = navigator.userAgent || '';
  var IS_WEBOS = /Web0S|webOS|NetCast/i.test(UA) || typeof window.PalmSystem !== 'undefined';
  var root = document.documentElement;
  root.setAttribute('data-version',VERSION);

  function $(id) { return document.getElementById(id); }

  /* ======================================================================
     Strings (English default, German)
     ====================================================================== */
  var STRINGS = {
    en: {
      "h.memoryModeNote": "Prevents Netflix, YouTube, Prime Video and LG Channels from preloading. They remain available; opening them may take longer. Reapplied by the Home router.",
      "h.memoryMode": "More free RAM",
      "set.wx.noResults": "No matching places. Try a nearby town or add the country.",
      "set.wx.pick": "Choose a search result or enter coordinates",
      "set.wx.coordinates": "Coordinates",
      "set.wx.searching": "Searching…",
      "set.wx.search": "Find city",
      "set.wx.city": "City or town",
      "h.release": "Release idle video apps",
      "h.releasing": "Releasing…",
      "h.released": "Released {n} idle video apps",
      "h.releaseNote": "Closes idle video apps while Own TV is open. Keeps Spotify, system services and OLED protection running. Apps may start more slowly next time; LG may preload them again.",

      "theme.cap.sunFallback": "Sun times unavailable · using the schedule below",
      "theme.cap.sun": "Sunrise {sunrise} · sunset {sunset}",
      "set.ap.sun": "Sunrise / sunset",
      "h.memoryNote": "Whole-TV memory. Available RAM includes reclaimable cache; a high percentage alone does not mean the TV is slow.",
      "h.availableShort": "{n} MiB available",
      "h.cached": "File cache",
      "h.available": "Available RAM",
      "h.panelHours": "Panel use",
      "set.apps.sort": "App order",
      "set.apps.recent": "Recently used first",
      "set.apps.manual": "Manual",
      "fw.check": "Check firmware compatibility",
      "fw.checking": "Checking…",
      "fw.description": "Checks reviewed compatibility reports. No firmware is installed.",
      "fw.unknown": "No verified upgrade for this setup.",
      "fw.offline": "Compatibility catalogue unavailable. No update approved.",
      "fw.report": "Matching report found. Installation still requires a reviewed update workflow.",

      'doc.title': 'Own TV',
      'brand.tag': '',
      'greet.morning': 'Good morning', 'greet.afternoon': 'Good afternoon',
      'greet.evening': 'Good evening', 'greet.night': 'Good night',
      'greet.named': '{greet}, {name}',

      'status.updated': 'Live · {time}',
      'status.stale': 'Last data {time}',
      'status.connecting': 'Connecting…',
      'status.error': 'Bridge error',
      'status.none': 'No TV bridge',
      'status.preview.sample': 'Preview · sample data',
      'status.preview.empty': 'Preview · empty states',
      'status.preview.error': 'Preview · failing bridge',
      'status.refresh': '{status}. Press OK to refresh.',

      'banner.label.preview': 'Preview',
      'banner.label.none': 'Not live',
      'banner.preview.sample': 'Sample data generated in this browser. Nothing is read from a TV.',
      'banner.preview.empty': 'Simulated bridge with nothing configured. Nothing is read from a TV.',
      'banner.preview.error': 'Simulated bridge where every call fails. Nothing is read from a TV.',
      'banner.none': 'No TV connection. Readings are unavailable and actions do nothing. Open this on the TV or through the local editor.',
      'banner.noneTv': 'The TV bridge did not load. Readings are unavailable until it runs.',
      'banner.openSample': 'Sample preview',
      'banner.openEmpty': 'Empty-state preview',
      'banner.exit': 'Exit preview',

      'mast.theme': 'Theme', 'mast.lgHome': 'LG Home', 'mast.tvSettings': 'TV settings',
      'mast.screenOff': 'Screen off', 'mast.settings': 'Settings',
      'mast.themeAria': 'Theme: {mode}, showing {shown}. Press to change.',

      'theme.day': 'Day', 'theme.night': 'Night', 'theme.auto': 'Auto',
      'theme.cap.manual': '{theme} theme, set manually',
      'theme.cap.schedule.day': 'Day theme · night begins {time}',
      'theme.cap.schedule.night': 'Night theme · day begins {time}',
      'theme.cap.system': '{theme} theme · following system appearance',

      'sec.apps': 'Apps', 'sec.glance': 'At a glance',
      'sec.inputs': 'Inputs', 'sec.recent': 'Recent',
      'sec.sleep': 'Sleep timer', 'sec.health': 'This TV', 'sec.smartHome': 'Smart home',
      'sec.agenda': 'Calendar', 'sec.weather': 'Weather',
      'watch.empty': 'Every app is hidden. Choose what to show in Settings → Apps.',
      'glance.ok': 'OK opens its settings',

      'app.notReported': 'not found',
      'app.notReportedLong': 'Not in the TV’s app list',
      'app.lastUsed': 'Last used',
      'app.usedRecently': 'Used recently',
      'app.onTv': 'Installed on this TV',
      'app.unknown': 'Availability unknown until the bridge reports apps',
      'app.open': 'Open {title}',
      'app.openFlag': 'Open {title}. The TV did not list this app.',

      'na': 'unavailable',
      'na.bridge': 'Unavailable without the TV bridge.',
      'na.field': 'The bridge did not report this.',
      'na.loading': 'Waiting for the TV…',
      'na.error': 'Couldn’t read from the TV.',

      'wx.setup.title': 'Add your city',
      'wx.setup.text': 'Nothing is guessed about where you are. Coordinates are rounded to about 1 km.',
      'wx.pending.title': 'Waiting for weather',
      'wx.pending.text': 'Location {label} is saved. The TV has not reported a forecast yet.',
      'wx.na': 'Weather unavailable',
      'wx.error': 'The forecast could not be fetched right now. The last attempt failed on the TV.',
      'wx.updated': 'Updated {time}',

      "cal.source": "Calendar subscription",
      'cal.setup.title': 'Connect calendar',
      "cal.setup.text": "Your calendar subscription link stays in the private TV backend.",
      'cal.empty': 'Nothing in the next days',
      'cal.updated': 'Calendar · updated {time}',
      'cal.unavailable': 'Calendar unavailable. Check the private integration.',
      'cal.busy': 'Busy',
      'cal.today': 'Today', 'cal.tomorrow': 'Tomorrow', 'cal.allDay': 'All day', 'cal.now': 'now',
      'cal.more': '+{n} more',

      'in.connected': 'signal', 'in.idle': 'no signal', 'in.empty': 'The TV reported no inputs.',
      'in.open': 'Switch to {title}',
      'rec.empty': 'Nothing reported yet',
      'rec.open': 'Open {title}',

      'sleep.off': 'Off',
      'sleep.unknown': 'Not reported',
      'sleep.unknownSub': 'The TV doesn’t report its timer state',
      'sleep.at': 'Sleeps {time}',
      'sleep.in': 'in {n} min',
      'sleep.setHere': 'set here',
      'sleep.cancel': 'Off',
      'sleep.setAria': 'Sleep in {n} minutes',
      'sleep.cancelAria': 'Cancel sleep timer',
      'sleep.na': 'The bridge cannot set a sleep timer.',
      'sleep.min': 'min',
      'sleep.choose': 'Minutes until the TV turns off',

      'h.temp': 'Temperature', 'h.mem': 'Memory', 'h.uptime': 'Uptime', 'h.model': 'Model',
      'h.fw': 'Firmware', 'h.privacy': 'Privacy',
      'p.trackingOff': 'Tracking off', 'p.trackingOn': 'Tracking on',
      'p.adsOn': 'Ads blocked', 'p.adsOff': 'Ads not blocked',
      'u.d': 'd', 'u.h': 'h', 'u.min': 'min',
      'h.memShort': 'memory', 'h.up': 'up {v}',

      'sh.setup.title': 'Not set up',
      'sh.setup.text': 'Reserved for lights, plugs and sensors later. Nothing is connected or scanned.',
      'sh.empty': 'Connected, no devices reported',

      'toast.opening': 'Opening {title}…',
      'toast.previewDid': 'Preview: “{action}” was not sent anywhere.',
      'toast.sleepSet': 'Sleep timer: {n} min',
      'toast.sleepOff': 'Sleep timer cancelled',
      'toast.screenOff': 'Turning the screen off…',
      'toast.noBridge': 'No TV bridge — can’t {action} from here.',
      'toast.notSupported': 'This bridge can’t {action}.',
      'toast.err': '{action} failed: {msg}',
      'toast.timeout': 'the TV did not answer in time',
      'toast.badResponse': 'the bridge returned an unreadable reply',
      'toast.unreachable': 'the bridge could not be reached',
      'toast.syncErr': 'Saved on this screen, but the TV helper didn’t store it: {msg}',
      'set.hint.bridgeSays': 'Bridge says:',
      'set.ab.via.tv': 'running on the TV', 'set.ab.via.editor': 'through the computer editor',
      'toast.stateErr': 'Couldn’t read the TV state: {msg}',
      'toast.stateBack': 'TV bridge is responding again',
      'toast.saved': 'Saved',
      'toast.storage': 'Preferences could not be saved on this device',
      'toast.wxSent': 'Weather location sent to the TV bridge',
      'toast.wxLocal': 'Weather location saved on this TV',
      'toast.imported': 'Preferences imported',
      'toast.exported': 'Preferences exported',
      'toast.reset': 'Preferences reset to defaults',
      'toast.refreshed': 'Refreshed',
      'toast.backHome': 'You’re home. Use the remote’s Home button for LG’s menu.',

      'act.launch': 'open {title}', 'act.sleep': 'set the sleep timer', 'act.screenOff': 'turn the screen off',
      'act.lgHome': 'open LG Home', 'act.tvSettings': 'open TV settings', 'act.wx': 'send the weather location',
      'act.editor': 'open the editor', 'act.refresh': 'refresh',

      'set.title': 'Dashboard settings',
      'set.close': 'Done',
      'set.keys': 'Arrows move · OK selects · Back returns',
      'set.nav.apps': 'Apps', 'set.nav.widgets': 'Widgets', 'set.nav.appearance': 'Appearance',
      'set.nav.language': 'Language', 'set.nav.weather': 'Weather', 'set.nav.calendar': 'Calendar',
      'set.nav.backup': 'Backup', 'set.nav.about': 'About',

      'set.apps.lede': 'Choose which apps sit on the Watch rail and in what order. The seven favourites are always listed here; hide the ones you don’t use.',
      'set.apps.order': 'On the rail',
      'set.apps.add': 'More apps from this TV',
      'set.apps.addNone': 'No other apps reported by the TV.',
      'set.apps.addNa': 'Connect the TV bridge to add more apps.',
      'set.apps.reset': 'Reset apps',
      'set.apps.show': 'Shown', 'set.apps.hidden': 'Hidden',
      'set.apps.showAria': 'Show {title} on the home screen',
      'set.apps.up': 'Move {title} earlier', 'set.apps.down': 'Move {title} later',
      'set.apps.remove': 'Remove {title}',
      'set.apps.addAria': 'Add {title} to the rail',

      'set.w.lede': 'Widgets sit in one compact row under your apps. Focus one to see its details.',
      'set.w.weather': 'Weather', 'set.w.weather.d': 'Shows a setup prompt until you add a city. The TV fetches the forecast.',
      'set.w.calendar': 'Calendar', 'set.w.calendar.d': 'Upcoming Calendar events, read by the private TV backend.',
      'set.w.inputs': 'HDMI inputs', 'set.w.inputs.d': 'Switch sources; shows signal when the TV reports it.',
      'set.w.recent': 'Recent apps', 'set.w.recent.d': 'As reported by the TV.',
      'set.w.sleep': 'Sleep timer', 'set.w.sleep.d': 'Timers of 10, 30, 60, 90 or 120 minutes.',
      'set.w.health': 'This TV', 'set.w.health.d': 'Temperature and memory. Uptime, model, firmware and privacy show on focus.',
      'set.w.smartHome': 'Smart home', 'set.w.smartHome.d': 'Reserved for a later panel. Nothing to set up yet.',

      'set.ap.lede': 'Style sets the look; the theme sets light or dark. Every style works by day and by night.',
      'set.ap.style': 'Style', 'set.ap.screen': 'Screen care', 'set.ap.themeHead': 'Day and night',
      'style.ambient': 'Ambient', 'style.ambient.d': 'Big colour cards. The background takes on the colour of the app you focus.',
      'style.quiet': 'Quiet', 'style.quiet.d': 'Neutral surfaces, no colour wash. Typographic and still.',
      'style.compact': 'Compact', 'style.compact.d': 'Smaller tiles beside a grid of widgets, with every reading shown.',
      'set.ap.mode': 'Theme', "set.ap.mode.d": "Night is OLED black. Day is warm paper. Auto follows the source below.",
      'set.ap.source': 'Auto follows', "set.ap.source.d": "Use weather’s sunrise/sunset, the schedule below, or the device’s light/dark setting.",
      'set.ap.schedule': 'Schedule', 'set.ap.system': 'System',
      'set.ap.dayStart': 'Day begins', 'set.ap.nightStart': 'Night begins',
      'set.ap.stepEarlier': '{what}: 15 minutes earlier', 'set.ap.stepLater': '{what}: 15 minutes later',
      'set.ap.idle': 'Dim when idle', 'set.ap.idle.d': 'Fades the screen after no input; any key wakes it without acting.',
      'set.ap.idleOff': 'Never',
      'set.ap.shift': 'Pixel shift', 'set.ap.shift.d': 'Moves the whole layout a few pixels every few minutes to spare the OLED panel.',
      'set.ap.motion': 'Motion', 'set.ap.motion.d': 'Reduced removes focus zoom, colour fades and transitions.',
      'set.ap.motionSystem': 'System', 'set.ap.motionReduced': 'Reduced',
      'set.ap.on': 'On', 'set.ap.off': 'Off',

      'set.lang.lede': 'Interface language and an optional name for the greeting.',
      'set.lang.lang': 'Language',
      'set.lang.name': 'Your name', 'set.lang.name.d': 'Optional, up to 24 characters. Stored only on this TV.',
      'set.lang.namePh': 'Name',

      'set.wx.lede': 'Weather is opt-in. Coordinates are rounded to two decimals (about 1 km) before they are stored.',
      'set.wx.status': 'Bridge status',
      'set.wx.st.on': 'Bridge reports weather for {city}',
      'set.wx.st.onNoCity': 'Bridge reports weather',
      'set.wx.st.off': 'Bridge has no weather location',
      'set.wx.st.na': 'Unavailable without the TV bridge',
      'set.wx.label': 'City name', 'set.wx.lat': 'Latitude', 'set.wx.lon': 'Longitude',
      'set.wx.latHint': '−90 to 90', 'set.wx.lonHint': '−180 to 180',
      'set.wx.save': 'Save location', 'set.wx.clear': 'Clear',
      'set.wx.err.label': 'Enter a city name (letters, up to 40 characters).',
      'set.wx.err.lat': 'Latitude must be a number from −90 to 90.',
      'set.wx.err.lon': 'Longitude must be a number from −180 to 180.',
      'set.wx.noApi': '<strong>This bridge can’t receive a weather location yet.</strong> The location is saved here and included in exports. To activate weather, add the same latitude, longitude and city to the bridge configuration on your computer.',
      'set.wx.cleared': 'Weather location cleared',
      "set.wx.how": "Find your city, choose a result, then save. Approximate coordinates are enough. No API key is needed.",

      "set.cal.lede": "Read-only agenda from Google, Apple/iCloud, Proton, Outlook or another ICS feed.",
      'set.cal.status': 'Bridge status',
      'set.cal.st.on': 'Connected · {n} upcoming events',
      'set.cal.st.off': 'Not connected',
      'set.cal.st.na': 'Unavailable without the TV bridge',
      "set.cal.warn": "<strong>Subscription links grant read access.</strong> Add yours in the private computer editor; it stays out of this dashboard and exports.",
      "set.cal.s1": "Copy a calendar subscription link: Google’s secret iCal address, Apple/iCloud Public Calendar, Proton sharing, Outlook publishing or another ICS feed.",
      "set.cal.s2": "Paste it only in the private computer editor. HTTPS and webcal links are supported.",
      "set.cal.s3": "Save. The agenda refreshes within a minute, then checks the feed every 15 minutes.",
      'set.cal.editor': 'Open bridge editor',
      'set.cal.noEditor': 'This bridge has no on-screen editor; use the steps above on your computer.',

      'set.bk.lede': 'Export copies your display preferences to a local JSON file. It never contains calendar links, tokens or device keys — the dashboard doesn’t have any.',
      'set.bk.export': 'Export', 'set.bk.import': 'Import',
      'set.bk.includeWx': 'Include weather location', 'set.bk.includeWx.d': 'City name and rounded coordinates.',
      'set.bk.download': 'Save JSON file', 'set.bk.show': 'Show JSON',
      'set.bk.importLede': 'Choose an exported file, or paste its contents below. Everything is validated first; nothing changes unless it passes.',
      'set.bk.choose': 'Choose file', 'set.bk.apply': 'Validate & apply',
      'set.bk.pastePh': 'Paste exported JSON here',
      'set.bk.reset': 'Reset all preferences', 'set.bk.resetConfirm': 'Press again to reset',
      'set.bk.resetZone': 'Start over',
      'set.bk.ok': 'Imported.', 'set.bk.okNotes': 'Imported with {n} note(s):',
      'set.bk.fail': 'Not imported — nothing was changed:',

      'imp.empty': 'There is nothing to import.',
      'imp.tooBig': 'The file is larger than 64 KB, which is far more than any preferences export.',
      'imp.json': 'This is not valid JSON.',
      'imp.notObject': 'The file does not contain a preferences object.',
      'imp.kind': 'This is not an Own TV preferences export.',
      'imp.schema': 'Unsupported preferences version {v}.',
      'imp.unknown': 'Ignored unknown setting “{key}”.',
      'imp.invalid': 'Ignored invalid value for “{key}”.',
      'imp.secret': 'Refused “{key}”: it looks like a link, token or password. Secrets never belong in dashboard preferences.',
      'imp.appKey': 'Ignored an invalid app entry.',
      'imp.sameHours': 'Day and night start at the same time; kept the default schedule.',

      'set.ab.lede': 'A home screen you can make your own.',
      'set.ab.bridge': 'Bridge', 'set.ab.mode': 'Mode', 'set.ab.last': 'Last reading',
      'set.ab.never': 'never',
      'set.ab.mode.live': 'Live TV bridge', 'set.ab.mode.none': 'No bridge (browser view)',
      'set.ab.mode.preview': 'Preview with simulated bridge',
      'set.ab.caps': 'Bridge capabilities',
      'set.ab.refresh': 'Refresh now',
      'set.ab.keys': 'Remote shortcuts',
      'set.ab.k1': 'Arrows / Magic Remote pointer — move focus',
      'set.ab.k2': 'OK — open or select',
      'set.ab.k3': 'Back — close settings, then return to the first app',
      'set.ab.k4': 'Yellow — cycle Day / Night / Auto',
      'set.ab.k6': 'Red — next style (Ambient, Quiet, Compact)',
      'set.ab.k5': 'Blue — open or close these settings',
      'set.ab.storage': 'Preferences are stored on this device under “{key}”. No account, no cloud.',
      'set.ab.version': 'Version {v}'
    },
    de: {
      "h.memoryModeNote": "Verhindert das Vorladen von Netflix, YouTube, Prime Video und LG Channels. Apps bleiben verfügbar, starten aber eventuell langsamer. Wird vom Home-Router erneut angewendet.",
      "h.memoryMode": "Mehr freier RAM",
      "set.wx.noResults": "Kein passender Ort. Nächste Stadt oder Land ergänzen.",
      "set.wx.pick": "Suchergebnis wählen oder Koordinaten eingeben",
      "set.wx.coordinates": "Koordinaten",
      "set.wx.searching": "Suche…",
      "set.wx.search": "Stadt suchen",
      "set.wx.city": "Stadt oder Ort",
      "h.release": "Inaktive Video-Apps schließen",
      "h.releasing": "Wird freigegeben…",
      "h.released": "{n} inaktive Video-Apps geschlossen",
      "h.releaseNote": "Schließt inaktive Video-Apps, während Own TV geöffnet ist. Spotify, Systemdienste und OLED-Schutz bleiben aktiv. Apps starten danach eventuell langsamer; LG kann sie erneut vorladen.",

      "theme.cap.sunFallback": "Sonnenzeiten fehlen · Zeitplan unten wird verwendet",
      "theme.cap.sun": "Sonnenaufgang {sunrise} · Sonnenuntergang {sunset}",
      "set.ap.sun": "Sonnenauf- / untergang",
      "h.memoryNote": "Speicher des gesamten TVs. Verfügbarer RAM enthält freigebbaren Cache; ein hoher Prozentwert allein bedeutet keinen langsamen TV.",
      "h.availableShort": "{n} MiB verfügbar",
      "h.cached": "Datei-Cache",
      "h.available": "RAM verfügbar",
      "h.panelHours": "Panel-Laufzeit",
      "set.apps.sort": "App-Reihenfolge",
      "set.apps.recent": "Zuletzt genutzt zuerst",
      "set.apps.manual": "Manuell",
      "fw.check": "Firmware-Kompatibilität prüfen",
      "fw.checking": "Wird geprüft…",
      "fw.description": "Prüft bestätigte Kompatibilitätsberichte. Installiert keine Firmware.",
      "fw.unknown": "Kein bestätigtes Upgrade für diese Konfiguration.",
      "fw.offline": "Kompatibilitätskatalog nicht verfügbar. Kein Update freigegeben.",
      "fw.report": "Passender Testbericht gefunden. Installation erfordert weiterhin einen geprüften Update-Ablauf.",

      'cal.unavailable': 'Kalender nicht verfügbar. Private Integration prüfen.',
      'cal.busy': 'Belegt',
      'doc.title': 'Own TV',
      'brand.tag': '',
      'greet.morning': 'Guten Morgen', 'greet.afternoon': 'Guten Tag',
      'greet.evening': 'Guten Abend', 'greet.night': 'Gute Nacht',
      'greet.named': '{greet}, {name}',

      'status.updated': 'Live · {time}',
      'status.stale': 'Letzte Daten {time}',
      'status.connecting': 'Verbinde…',
      'status.error': 'Bridge-Fehler',
      'status.none': 'Keine TV-Bridge',
      'status.preview.sample': 'Vorschau · Beispieldaten',
      'status.preview.empty': 'Vorschau · leere Zustände',
      'status.preview.error': 'Vorschau · fehlerhafte Bridge',
      'status.refresh': '{status}. OK drücken zum Aktualisieren.',

      'banner.label.preview': 'Vorschau',
      'banner.label.none': 'Nicht live',
      'banner.preview.sample': 'Beispieldaten aus diesem Browser. Es wird nichts von einem Fernseher gelesen.',
      'banner.preview.empty': 'Simulierte Bridge ohne Einrichtung. Es wird nichts von einem Fernseher gelesen.',
      'banner.preview.error': 'Simulierte Bridge, bei der jeder Aufruf fehlschlägt. Nichts ist echt.',
      'banner.none': 'Keine TV-Verbindung. Werte sind nicht verfügbar, Aktionen bewirken nichts. Auf dem Fernseher oder über den lokalen Editor öffnen.',
      'banner.noneTv': 'Die TV-Bridge wurde nicht geladen. Werte sind erst verfügbar, wenn sie läuft.',
      'banner.openSample': 'Beispiel-Vorschau',
      'banner.openEmpty': 'Leere Vorschau',
      'banner.exit': 'Vorschau beenden',

      'mast.theme': 'Design', 'mast.lgHome': 'LG Start', 'mast.tvSettings': 'TV-Einstellungen',
      'mast.screenOff': 'Bildschirm aus', 'mast.settings': 'Einstellungen',
      'mast.themeAria': 'Design: {mode}, aktuell {shown}. Drücken zum Wechseln.',

      'theme.day': 'Tag', 'theme.night': 'Nacht', 'theme.auto': 'Auto',
      'theme.cap.manual': 'Design {theme}, manuell gewählt',
      'theme.cap.schedule.day': 'Tagdesign · Nacht beginnt {time}',
      'theme.cap.schedule.night': 'Nachtdesign · Tag beginnt {time}',
      'theme.cap.system': 'Design {theme} · folgt dem System',

      'sec.apps': 'Apps', 'sec.glance': 'Auf einen Blick',
      'sec.inputs': 'Eingänge', 'sec.recent': 'Zuletzt',
      'sec.sleep': 'Sleep-Timer', 'sec.health': 'Dieser TV', 'sec.smartHome': 'Smart Home',
      'sec.agenda': 'Kalender', 'sec.weather': 'Wetter',
      'watch.empty': 'Alle Apps sind ausgeblendet. Unter Einstellungen → Apps auswählen.',
      'glance.ok': 'OK öffnet die Einstellungen',

      'app.notReported': 'fehlt',
      'app.notReportedLong': 'Nicht in der App-Liste des Fernsehers',
      'app.lastUsed': 'Zuletzt genutzt',
      'app.usedRecently': 'Kürzlich genutzt',
      'app.onTv': 'Auf diesem Fernseher installiert',
      'app.unknown': 'Unbekannt, bis die Bridge Apps meldet',
      'app.open': '{title} öffnen',
      'app.openFlag': '{title} öffnen. Der Fernseher hat diese App nicht gemeldet.',

      'na': 'nicht verfügbar',
      'na.bridge': 'Ohne TV-Bridge nicht verfügbar.',
      'na.field': 'Die Bridge meldet diesen Wert nicht.',
      'na.loading': 'Warte auf den Fernseher…',
      'na.error': 'Konnte nicht vom Fernseher lesen.',

      'wx.setup.title': 'Stadt hinzufügen',
      'wx.setup.text': 'Dein Standort wird nicht geraten. Koordinaten werden auf ca. 1 km gerundet.',
      'wx.pending.title': 'Warte auf Wetter',
      'wx.pending.text': 'Ort {label} ist gespeichert. Der Fernseher hat noch keine Vorhersage gemeldet.',
      'wx.na': 'Wetter nicht verfügbar',
      'wx.error': 'Die Vorhersage konnte gerade nicht geladen werden. Der letzte Versuch ist auf dem Fernseher fehlgeschlagen.',
      'wx.updated': 'Aktualisiert {time}',

      "cal.source": "Kalender-Abonnement",
      'cal.setup.title': 'Kalender verbinden',
      "cal.setup.text": "Dein Kalender-Abonnement-Link bleibt im privaten TV-Backend.",
      'cal.empty': 'In den nächsten Tagen nichts',
      'cal.updated': 'Calendar · aktualisiert {time}',
      'cal.today': 'Heute', 'cal.tomorrow': 'Morgen', 'cal.allDay': 'Ganztägig', 'cal.now': 'jetzt',
      'cal.more': '+{n} weitere',

      'in.connected': 'Signal', 'in.idle': 'kein Signal', 'in.empty': 'Der Fernseher meldet keine Eingänge.',
      'in.open': 'Zu {title} wechseln',
      'rec.empty': 'Noch nichts gemeldet',
      'rec.open': '{title} öffnen',

      'sleep.off': 'Aus',
      'sleep.unknown': 'Nicht gemeldet',
      'sleep.unknownSub': 'Der Fernseher meldet den Timer-Status nicht',
      'sleep.at': 'Aus um {time}',
      'sleep.in': 'in {n} Min.',
      'sleep.setHere': 'hier gestellt',
      'sleep.cancel': 'Aus',
      'sleep.setAria': 'Ausschalten in {n} Minuten',
      'sleep.cancelAria': 'Sleep-Timer abbrechen',
      'sleep.na': 'Diese Bridge kann keinen Sleep-Timer stellen.',
      'sleep.min': 'Min.',
      'sleep.choose': 'Minuten bis der Fernseher ausgeht',

      'h.temp': 'Temperatur', 'h.mem': 'Speicher', 'h.uptime': 'Laufzeit', 'h.model': 'Modell',
      'h.fw': 'Firmware', 'h.privacy': 'Datenschutz',
      'p.trackingOff': 'Tracking aus', 'p.trackingOn': 'Tracking an',
      'p.adsOn': 'Werbung blockiert', 'p.adsOff': 'Werbung nicht blockiert',
      'u.d': 'T.', 'u.h': 'Std.', 'u.min': 'Min.',
      'h.memShort': 'Speicher', 'h.up': 'seit {v}',

      'sh.setup.title': 'Nicht eingerichtet',
      'sh.setup.text': 'Reserviert für Licht, Steckdosen und Sensoren. Nichts ist verbunden oder wird gesucht.',
      'sh.empty': 'Verbunden, keine Geräte gemeldet',

      'toast.opening': '{title} wird geöffnet…',
      'toast.previewDid': 'Vorschau: „{action}“ wurde nirgendwohin gesendet.',
      'toast.sleepSet': 'Sleep-Timer: {n} Min.',
      'toast.sleepOff': 'Sleep-Timer abgebrochen',
      'toast.screenOff': 'Bildschirm wird ausgeschaltet…',
      'toast.noBridge': 'Keine TV-Bridge – {action} geht hier nicht.',
      'toast.notSupported': 'Diese Bridge kann nicht: {action}.',
      'toast.err': '{action} fehlgeschlagen: {msg}',
      'toast.timeout': 'der Fernseher hat nicht rechtzeitig geantwortet',
      'toast.badResponse': 'die Bridge hat eine unlesbare Antwort geliefert',
      'toast.unreachable': 'die Bridge ist nicht erreichbar',
      'toast.syncErr': 'Hier gespeichert, aber der TV-Helfer hat es nicht übernommen: {msg}',
      'set.hint.bridgeSays': 'Die Bridge meldet:',
      'set.ab.via.tv': 'läuft auf dem Fernseher', 'set.ab.via.editor': 'über den Computer-Editor',
      'toast.stateErr': 'TV-Status nicht lesbar: {msg}',
      'toast.stateBack': 'Die TV-Bridge antwortet wieder',
      'toast.saved': 'Gespeichert',
      'toast.storage': 'Einstellungen konnten auf diesem Gerät nicht gespeichert werden',
      'toast.wxSent': 'Wetterort an die TV-Bridge gesendet',
      'toast.wxLocal': 'Wetterort auf diesem Fernseher gespeichert',
      'toast.imported': 'Einstellungen importiert',
      'toast.exported': 'Einstellungen exportiert',
      'toast.reset': 'Einstellungen zurückgesetzt',
      'toast.refreshed': 'Aktualisiert',
      'toast.backHome': 'Du bist auf der Startseite. Für LGs Menü die Home-Taste nutzen.',

      'act.launch': '{title} öffnen', 'act.sleep': 'Sleep-Timer stellen', 'act.screenOff': 'Bildschirm ausschalten',
      'act.lgHome': 'LG Start öffnen', 'act.tvSettings': 'TV-Einstellungen öffnen', 'act.wx': 'Wetterort senden',
      'act.editor': 'Editor öffnen', 'act.refresh': 'aktualisieren',

      'set.title': 'Dashboard-Einstellungen',
      'set.close': 'Fertig',
      'set.keys': 'Pfeile bewegen · OK wählt · Zurück kehrt zurück',
      'set.nav.apps': 'Apps', 'set.nav.widgets': 'Widgets', 'set.nav.appearance': 'Darstellung',
      'set.nav.language': 'Sprache', 'set.nav.weather': 'Wetter', 'set.nav.calendar': 'Kalender',
      'set.nav.backup': 'Sicherung', 'set.nav.about': 'Info',

      'set.apps.lede': 'Wähle, welche Apps in welcher Reihenfolge in der Ansehen-Leiste stehen. Die sieben Favoriten sind immer gelistet; blende ungenutzte aus.',
      'set.apps.order': 'In der Leiste',
      'set.apps.add': 'Weitere Apps auf diesem Fernseher',
      'set.apps.addNone': 'Der Fernseher meldet keine weiteren Apps.',
      'set.apps.addNa': 'Verbinde die TV-Bridge, um weitere Apps hinzuzufügen.',
      'set.apps.reset': 'Apps zurücksetzen',
      'set.apps.show': 'Sichtbar', 'set.apps.hidden': 'Versteckt',
      'set.apps.showAria': '{title} auf der Startseite zeigen',
      'set.apps.up': '{title} nach vorn', 'set.apps.down': '{title} nach hinten',
      'set.apps.remove': '{title} entfernen',
      'set.apps.addAria': '{title} zur Leiste hinzufügen',

      'set.w.lede': 'Widgets stehen in einer kompakten Reihe unter deinen Apps. Fokussiere eins für Details.',
      'set.w.weather': 'Wetter', 'set.w.weather.d': 'Zeigt einen Hinweis, bis du eine Stadt hinzufügst. Der Fernseher holt die Vorhersage.',
      'set.w.calendar': 'Kalender', 'set.w.calendar.d': 'Kommende Kalendertermine, gelesen vom privaten TV-Backend.',
      'set.w.inputs': 'HDMI-Eingänge', 'set.w.inputs.d': 'Quelle wechseln; zeigt Signal, wenn der Fernseher es meldet.',
      'set.w.recent': 'Zuletzt genutzte Apps', 'set.w.recent.d': 'Wie vom Fernseher gemeldet.',
      'set.w.sleep': 'Sleep-Timer', 'set.w.sleep.d': 'Timer mit 10, 30, 60, 90 oder 120 Minuten.',
      'set.w.health': 'Dieser TV', 'set.w.health.d': 'Temperatur und Speicher. Laufzeit, Modell, Firmware und Datenschutz bei Fokus.',
      'set.w.smartHome': 'Smart Home', 'set.w.smartHome.d': 'Reserviert für ein späteres Panel. Noch nichts einzurichten.',

      'set.ap.lede': 'Der Stil bestimmt das Aussehen, das Design hell oder dunkel. Jeder Stil funktioniert bei Tag und Nacht.',
      'set.ap.style': 'Stil', 'set.ap.screen': 'Bildschirmschutz', 'set.ap.themeHead': 'Tag und Nacht',
      'style.ambient': 'Ambient', 'style.ambient.d': 'Große Farbkarten. Der Hintergrund nimmt die Farbe der fokussierten App an.',
      'style.quiet': 'Ruhig', 'style.quiet.d': 'Neutrale Flächen, keine Farbstimmung. Typografisch und still.',
      'style.compact': 'Kompakt', 'style.compact.d': 'Kleinere Kacheln neben einem Widget-Raster, alle Werte sichtbar.',
      'set.ap.mode': 'Design', "set.ap.mode.d": "Nacht ist OLED-Schwarz. Tag ist warmes Papier. Auto folgt der Quelle unten.",
      'set.ap.source': 'Auto folgt', "set.ap.source.d": "Sonnenzeiten des Wetters, Zeitplan oder das Hell-/Dunkeldesign des Geräts verwenden.",
      'set.ap.schedule': 'Zeitplan', 'set.ap.system': 'System',
      'set.ap.dayStart': 'Tag beginnt', 'set.ap.nightStart': 'Nacht beginnt',
      'set.ap.stepEarlier': '{what}: 15 Minuten früher', 'set.ap.stepLater': '{what}: 15 Minuten später',
      'set.ap.idle': 'Bei Inaktivität dimmen', 'set.ap.idle.d': 'Blendet ab, wenn nichts gedrückt wird; jede Taste weckt, ohne etwas auszulösen.',
      'set.ap.idleOff': 'Nie',
      'set.ap.shift': 'Pixel-Verschiebung', 'set.ap.shift.d': 'Verschiebt das Layout alle paar Minuten um wenige Pixel, um das OLED-Panel zu schonen.',
      'set.ap.motion': 'Bewegung', 'set.ap.motion.d': 'Reduziert entfernt Fokus-Zoom, Farbüberblendungen und Übergänge.',
      'set.ap.motionSystem': 'System', 'set.ap.motionReduced': 'Reduziert',
      'set.ap.on': 'An', 'set.ap.off': 'Aus',

      'set.lang.lede': 'Sprache der Oberfläche und ein optionaler Name für die Begrüßung.',
      'set.lang.lang': 'Sprache',
      'set.lang.name': 'Dein Name', 'set.lang.name.d': 'Optional, bis zu 24 Zeichen. Nur auf diesem Fernseher gespeichert.',
      'set.lang.namePh': 'Name',

      'set.wx.lede': 'Wetter ist freiwillig. Koordinaten werden vor dem Speichern auf zwei Nachkommastellen (ca. 1 km) gerundet.',
      'set.wx.status': 'Bridge-Status',
      'set.wx.st.on': 'Bridge meldet Wetter für {city}',
      'set.wx.st.onNoCity': 'Bridge meldet Wetter',
      'set.wx.st.off': 'Bridge hat keinen Wetterort',
      'set.wx.st.na': 'Ohne TV-Bridge nicht verfügbar',
      'set.wx.label': 'Stadtname', 'set.wx.lat': 'Breitengrad', 'set.wx.lon': 'Längengrad',
      'set.wx.latHint': '−90 bis 90', 'set.wx.lonHint': '−180 bis 180',
      'set.wx.save': 'Ort speichern', 'set.wx.clear': 'Löschen',
      'set.wx.err.label': 'Gib einen Stadtnamen ein (bis zu 40 Zeichen).',
      'set.wx.err.lat': 'Breitengrad muss eine Zahl von −90 bis 90 sein.',
      'set.wx.err.lon': 'Längengrad muss eine Zahl von −180 bis 180 sein.',
      'set.wx.noApi': '<strong>Diese Bridge kann noch keinen Wetterort empfangen.</strong> Der Ort wird hier gespeichert und exportiert. Um Wetter zu aktivieren, trage Breitengrad, Längengrad und Stadt in die Bridge-Konfiguration auf deinem Computer ein.',
      'set.wx.cleared': 'Wetterort gelöscht',
      "set.wx.how": "Stadt suchen, Ergebnis wählen und speichern. Ungefähre Koordinaten reichen. Kein API-Schlüssel nötig.",

      "set.cal.lede": "Agenda aus Google, Apple/iCloud, Proton, Outlook oder einem anderen ICS-Feed. Nur lesbar.",
      'set.cal.status': 'Bridge-Status',
      'set.cal.st.on': 'Verbunden · {n} kommende Termine',
      'set.cal.st.off': 'Nicht verbunden',
      'set.cal.st.na': 'Ohne TV-Bridge nicht verfügbar',
      "set.cal.warn": "<strong>Abonnement-Links gewähren Lesezugriff.</strong> Nur im privaten Computer-Editor eintragen; sie erscheinen nie hier oder im Export.",
      "set.cal.s1": "Kalender-Abonnement-Link kopieren: geheime iCal-Adresse von Google, öffentlicher iCloud-Kalender, Proton-Freigabe, Outlook-Veröffentlichung oder anderer ICS-Feed.",
      "set.cal.s2": "Nur im privaten Computer-Editor einfügen. HTTPS- und webcal-Links werden unterstützt.",
      "set.cal.s3": "Speichern. Die Agenda erscheint innerhalb einer Minute, danach wird der Feed alle 15 Minuten geprüft.",
      'set.cal.editor': 'Bridge-Editor öffnen',
      'set.cal.noEditor': 'Diese Bridge hat keinen Editor auf dem Bildschirm; nutze die Schritte oben am Computer.',

      'set.bk.lede': 'Der Export kopiert deine Anzeige-Einstellungen in eine lokale JSON-Datei. Er enthält nie Kalenderlinks, Tokens oder Geräteschlüssel – das Dashboard hat keine.',
      'set.bk.export': 'Export', 'set.bk.import': 'Import',
      'set.bk.includeWx': 'Wetterort einschließen', 'set.bk.includeWx.d': 'Stadtname und gerundete Koordinaten.',
      'set.bk.download': 'JSON-Datei speichern', 'set.bk.show': 'JSON zeigen',
      'set.bk.importLede': 'Wähle eine exportierte Datei oder füge ihren Inhalt unten ein. Alles wird zuerst geprüft; nichts ändert sich, wenn die Prüfung fehlschlägt.',
      'set.bk.choose': 'Datei wählen', 'set.bk.apply': 'Prüfen & übernehmen',
      'set.bk.pastePh': 'Exportiertes JSON hier einfügen',
      'set.bk.reset': 'Alle Einstellungen zurücksetzen', 'set.bk.resetConfirm': 'Nochmal drücken zum Zurücksetzen',
      'set.bk.resetZone': 'Neu beginnen',
      'set.bk.ok': 'Importiert.', 'set.bk.okNotes': 'Importiert mit {n} Hinweis(en):',
      'set.bk.fail': 'Nicht importiert – nichts wurde geändert:',

      'imp.empty': 'Es gibt nichts zu importieren.',
      'imp.tooBig': 'Die Datei ist größer als 64 KB – viel mehr als jeder Einstellungsexport.',
      'imp.json': 'Das ist kein gültiges JSON.',
      'imp.notObject': 'Die Datei enthält kein Einstellungsobjekt.',
      'imp.kind': 'Das ist kein Own-TV-Einstellungsexport.',
      'imp.schema': 'Nicht unterstützte Einstellungsversion {v}.',
      'imp.unknown': 'Unbekannte Einstellung „{key}“ ignoriert.',
      'imp.invalid': 'Ungültiger Wert für „{key}“ ignoriert.',
      'imp.secret': '„{key}“ abgelehnt: sieht aus wie ein Link, Token oder Passwort. Geheimnisse gehören nie in Dashboard-Einstellungen.',
      'imp.appKey': 'Ungültigen App-Eintrag ignoriert.',
      'imp.sameHours': 'Tag und Nacht beginnen zur selben Zeit; Standard-Zeitplan beibehalten.',

      'set.ab.lede': 'Ein Startbildschirm, den du selbst gestaltest.',
      'set.ab.bridge': 'Bridge', 'set.ab.mode': 'Modus', 'set.ab.last': 'Letzte Messung',
      'set.ab.never': 'nie',
      'set.ab.mode.live': 'Live-TV-Bridge', 'set.ab.mode.none': 'Keine Bridge (Browseransicht)',
      'set.ab.mode.preview': 'Vorschau mit simulierter Bridge',
      'set.ab.caps': 'Bridge-Funktionen',
      'set.ab.refresh': 'Jetzt aktualisieren',
      'set.ab.keys': 'Tasten der Fernbedienung',
      'set.ab.k1': 'Pfeile / Magic-Remote-Zeiger – Fokus bewegen',
      'set.ab.k2': 'OK – öffnen oder auswählen',
      'set.ab.k3': 'Zurück – Einstellungen schließen, dann zur ersten App',
      'set.ab.k4': 'Gelb – Tag / Nacht / Auto wechseln',
      'set.ab.k6': 'Rot – nächster Stil (Ambient, Ruhig, Kompakt)',
      'set.ab.k5': 'Blau – diese Einstellungen öffnen oder schließen',
      'set.ab.storage': 'Einstellungen liegen auf diesem Gerät unter „{key}“. Kein Konto, keine Cloud.',
      'set.ab.version': 'Version {v}'
    }
  };

  function t(key, vars) {
    var lang=prefs&&prefs.language.split('-')[0]==='de'?'de':'en';
    var s = STRINGS[lang][key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) s = key;
    if(prefs)s=OwnTVI18n.translate(prefs.languagePack,prefs.language,key,s);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
    }
    return s;
  }

  /* ======================================================================
     App catalogue — the seven must-have favourites.
     The artwork is the TV's own installed icon (from the bridge). Without an
     icon, a card shows the app's name in type on its colour field; no brand
     logos are reproduced. `art` is that fallback field colour.
     `ids` are best-known webOS app ids; the bridge's app list always wins.
     ====================================================================== */
  var CATALOG = [
    { key: 'youtube', title: 'YouTube', mono: 'YT', art: '#c4302b', ids: ['youtube.leanback.v4', 'youtube.leanback.v3'], names: ['youtube'] },
    { key: 'twitch', title: 'Twitch', mono: 'Tw', art: '#7646d6', ids: ['tv.twitch.tv.starshot.lg', 'twitch'], names: ['twitch'] },
    { key: 'spotify', title: 'Spotify', mono: 'Sp', art: '#1c9a52', ids: ['spotify-beehive', 'com.spotify.app'], names: ['spotify', 'spotify - music and podcasts'] },
    { key: 'netflix', title: 'Netflix', mono: 'N', art: '#b3121b', ids: ['netflix'], names: ['netflix'] },
    { key: 'prime', title: 'Prime Video', mono: 'pv', art: '#1b78b8', ids: ['amazon', 'com.amazon.amazonvideo.webos'], names: ['prime video', 'amazon prime video'] },
    { key: 'disney', title: 'Disney+', mono: 'D+', art: '#1d3b8c', ids: ['com.disney.disneyplus-prod'], names: ['disney+', 'disney plus'] },
    { key: 'rtlplus', title: 'RTL+', mono: 'R+', art: '#d4502a', ids: ['com.netrtl.tvnow', 'de.rtl.rtlplus', 'de.rtl.tvnow', 'com.rtl.rtlplus'], names: ['rtl+', 'rtl plus', 'tvnow'] }
  ];
  var CATALOG_BY_KEY = {};
  CATALOG.forEach(function (c) { CATALOG_BY_KEY[c.key] = c; });
  var EXTRA_ART = ['#8a6a2a', '#2a7a72', '#8e3d78', '#5d6b22', '#3a5f8f', '#7a4a3a'];

  var WIDGETS = ['weather', 'calendar', 'sleep', 'health', 'smartHome', 'inputs'];
  var LEGACY_WIDGETS = ['dayRuler', 'recent']; // accepted silently from older exports, then dropped
  var STYLES = ['ambient', 'quiet', 'compact'];
  var IDLE_CHOICES = [0, 2, 5, 10, 20];
  var SLEEP_CHOICES = [10, 30, 60, 90, 120];

  /* ======================================================================
     Preferences (non-secret only), stored under owntv.preferences.v1
     ====================================================================== */
  function defaultPrefs() {
    return {
      schema: 1,
      language: 'en',
      languagePack: null,
      name: '',
      style: 'ambient',
      theme: { mode: 'auto', autoSource: 'schedule', dayStart: '07:00', nightStart: '19:30' },
      motion: 'system',
      idleDimMinutes: 5,
      pixelShift: true,
      apps: { sort: 'recent', order: CATALOG.map(function (c) { return c.key; }), hidden: [], labels: {} },
      widgets: { weather: true, calendar: true, sleep: true, health: true, smartHome: true, inputs: false },
      weather: { label: '', latitude: null, longitude: null }
    };
  }

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function finite(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function str(v) { return typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Anything that smells like a link or credential is refused outright.
  var SECRET_RE = /:\/\/|webcal|\.ics\b|token|secret|passw|api[_-]?key|bearer|calendar\.proton|[A-Za-z0-9_\-]{32,}/i;
  function looksSecret(s) { return SECRET_RE.test(s); }
  function cleanText(v, max) {
    if (typeof v !== 'string') return null;
    var s = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (s.length > max) return null;
    return s;
  }
  function parseHM(s) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(mins) { mins = ((mins % 1440) + 1440) % 1440; return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60); }

  var APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
  function validAppKey(k) {
    if (typeof k !== 'string') return false;
    if (CATALOG_BY_KEY[k]) return true;
    return k.indexOf('app:') === 0 && APP_ID_RE.test(k.slice(4));
  }

  /* sanitizePrefs: whitelist every field. `rep` collects errors (block import)
     and warnings (dropped values). Used for storage load and imports. */
  function sanitizePrefs(raw, rep) {
    rep = rep || { errors: [], warnings: [] };
    var out = defaultPrefs();
    if (!isObj(raw)) { rep.errors.push(t('imp.notObject')); return out; }
    var known = { schema: 1, language: 1, languagePack: 1, name: 1, style: 1, theme: 1, motion: 1, idleDimMinutes: 1, pixelShift: 1, apps: 1, widgets: 1, weather: 1 };
    Object.keys(raw).forEach(function (k) { if (!known[k]) rep.warnings.push(t('imp.unknown', { key: clip(k, 32) })); });
    function bad(key) { rep.warnings.push(t('imp.invalid', { key: key })); }
    function secret(key) { rep.errors.push(t('imp.secret', { key: key })); }

    if ('language' in raw) { var language=OwnTVI18n.locale(raw.language);if(language)out.language=language;else bad('language'); }
    if(raw.languagePack){try{out.languagePack=OwnTVI18n.validatePack(raw.languagePack,languageBase(raw.languagePack));}catch(e){rep.errors.push(e.message);}}
    if ('style' in raw) { if (STYLES.indexOf(raw.style) >= 0) out.style = raw.style; else bad('style'); }
    if ('name' in raw) {
      var n = cleanText(raw.name, 24);
      if (n === null) bad('name'); else if (looksSecret(n)) secret('name'); else out.name = n;
    }
    if ('theme' in raw) {
      var th = raw.theme;
      if (!isObj(th)) bad('theme');
      else {
        if ('mode' in th) { if (['auto', 'day', 'night'].indexOf(th.mode) >= 0) out.theme.mode = th.mode; else bad('theme.mode'); }
        if ('autoSource' in th) { if (['schedule', 'system', 'sun'].indexOf(th.autoSource) >= 0) out.theme.autoSource = th.autoSource; else bad('theme.autoSource'); }
        var ds = 'dayStart' in th ? parseHM(th.dayStart) : parseHM(out.theme.dayStart);
        var ns = 'nightStart' in th ? parseHM(th.nightStart) : parseHM(out.theme.nightStart);
        if (ds === null) { bad('theme.dayStart'); ds = parseHM(out.theme.dayStart); }
        if (ns === null) { bad('theme.nightStart'); ns = parseHM(out.theme.nightStart); }
        if (ds === ns) rep.warnings.push(t('imp.sameHours'));
        else { out.theme.dayStart = hm(ds); out.theme.nightStart = hm(ns); }
        Object.keys(th).forEach(function (k) { if (['mode', 'autoSource', 'dayStart', 'nightStart'].indexOf(k) < 0) rep.warnings.push(t('imp.unknown', { key: 'theme.' + clip(k, 24) })); });
      }
    }
    if ('motion' in raw) { if (raw.motion === 'system' || raw.motion === 'reduced') out.motion = raw.motion; else bad('motion'); }
    if ('idleDimMinutes' in raw) { if (IDLE_CHOICES.indexOf(raw.idleDimMinutes) >= 0) out.idleDimMinutes = raw.idleDimMinutes; else bad('idleDimMinutes'); }
    if ('pixelShift' in raw) { if (typeof raw.pixelShift === 'boolean') out.pixelShift = raw.pixelShift; else bad('pixelShift'); }

    if ('apps' in raw) {
      var a = raw.apps;
      if (!isObj(a)) bad('apps');
      else {
        if (a.sort === 'manual' || a.sort === 'recent') out.apps.sort = a.sort;
        var seen = {}, order = [];
        (Array.isArray(a.order) ? a.order : []).forEach(function (k) {
          if (typeof k === 'string' && looksSecret(k) && !validAppKey(k)) { secret('apps.order'); return; }
          if (!validAppKey(k)) { rep.warnings.push(t('imp.appKey')); return; }
          if (!seen[k]) { seen[k] = 1; order.push(k); }
        });
        if (!Array.isArray(a.order) && 'order' in a) bad('apps.order');
        // Must-have favourites are always present (append any that are missing).
        CATALOG.forEach(function (c) { if (!seen[c.key]) { seen[c.key] = 1; order.push(c.key); } });
        out.apps.order = order;
        out.apps.hidden = (Array.isArray(a.hidden) ? a.hidden : []).filter(function (k) { return validAppKey(k) && seen[k]; })
          .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
        if (isObj(a.labels)) {
          Object.keys(a.labels).forEach(function (k) {
            if (!validAppKey(k) || k.indexOf('app:') !== 0) { rep.warnings.push(t('imp.appKey')); return; }
            var l = cleanText(a.labels[k], 48);
            if (l === null) { bad('apps.labels'); return; }
            if (looksSecret(l)) { secret('apps.labels'); return; }
            out.apps.labels[k] = l;
          });
        }
      }
    }
    if ('widgets' in raw) {
      var w = raw.widgets;
      if (!isObj(w)) bad('widgets');
      else Object.keys(w).forEach(function (k) {
        if (LEGACY_WIDGETS.indexOf(k) >= 0) return;
        if (WIDGETS.indexOf(k) < 0) { rep.warnings.push(t('imp.unknown', { key: 'widgets.' + clip(k, 24) })); return; }
        if (typeof w[k] === 'boolean') out.widgets[k] = w[k]; else bad('widgets.' + k);
      });
    }
    if ('weather' in raw) {
      var wx = raw.weather;
      if (!isObj(wx)) bad('weather');
      else {
        var label = wx.label === undefined || wx.label === null ? '' : cleanText(wx.label, 40);
        var lat = finite(wx.latitude), lon = finite(wx.longitude);
        if (label === null) bad('weather.label');
        else if (looksSecret(label)) secret('weather.label');
        else if (lat === null && lon === null && wx.latitude == null && wx.longitude == null) out.weather.label = label;
        else if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) bad('weather.coordinates');
        else out.weather = { label: label, latitude: round2(lat), longitude: round2(lon) };
      }
    }
    return out;
  }

  var storageOk = true;
  var hadStoredPrefs = false;
  /* Revision-based sync with the TV helper (see DESIGN.md §8):
     - lastRemoteRevision: the helper revision our prefs correspond to.
     - prefsDirty: a local change that the helper has not confirmed yet.
     Both persist, so a reload never lets an older helper copy overwrite an
     unsaved local change, and a newer helper copy is adopted within a poll. */
  var SYNC_KEY = 'owntv.sync.v1';
  var lastRemoteRevision = 0, prefsDirty = false;
  (function loadSync() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SYNC_KEY) || 'null');
      if (isObj(s)) {
        if (typeof s.revision === 'number' && isFinite(s.revision) && s.revision >= 0) lastRemoteRevision = s.revision;
        prefsDirty = s.dirty === true;
      }
    } catch (e) { /* ignore */ }
  })();
  function saveSync() {
    try { window.localStorage.setItem(SYNC_KEY, JSON.stringify({ revision: lastRemoteRevision, dirty: prefsDirty })); } catch (e) { /* ignore */ }
  }
  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return defaultPrefs();
      hadStoredPrefs = true;
      return sanitizePrefs(JSON.parse(raw));
    } catch (e) {
      return defaultPrefs();
    }
  }
  function savePrefs(quiet) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
      storageOk = true;
    } catch (e) {
      if (storageOk && !quiet) toast(t('toast.storage'), 'error');
      storageOk = false;
    }
  }

  var prefs = loadPrefs();

  /* ======================================================================
     DOM helpers (no innerHTML with external data)
     ====================================================================== */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'trustedHtml') el.innerHTML = v; // only for static strings from STRINGS
        else if (k === 'style') { for (var s in v) el.style.setProperty(s, v[s]); }
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { el.appendChild(document.createTextNode(String(c))); return; }
    el.appendChild(c);
  }
  function icon(name, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  function na(text) { return h('span', { class: 'na' }, text || t('na')); }
  /* Why a value is missing: no bridge, still loading, bridge failing, or not reported. */
  function naText() {
    if (Bridge.mode === 'none') return t('na.bridge');
    if (!state.data) return state.error ? t('na.error') : t('na.loading');
    return t('na.field');
  }

  /* Replace a region's children only if the markup changed; keep focus stable.
     While focus is being restored, focus-driven behaviour (settings sections
     following focus) is paused so a re-render never changes the section. */
  var restoringFocus = false;
  function patch(container, nodes) {
    var tmp = document.createElement('div');
    add(tmp, nodes);
    if (tmp.innerHTML === container.innerHTML) return false;
    var oldRail = container.querySelector('.cards');
    var railScroll = oldRail ? oldRail.scrollLeft : 0;
    var active = document.activeElement;
    var fid = active && container.contains(active) ? active.getAttribute('data-fid') : null;
    var alt = active && container.contains(active) ? active.getAttribute('data-fid-alt') : null;
    container.textContent = '';
    while (tmp.firstChild) container.appendChild(tmp.firstChild);
    var newRail = container.querySelector('.cards');
    if (newRail) newRail.scrollLeft = railScroll;
    if (fid) { restoringFocus = true; try { restoreFocus(fid, alt, container); } finally { restoringFocus = false; } }
    return true;
  }
  function restoreFocus(fid, alt, scope) {
    root.classList.add('no-anim');
    var el = findFid(fid) || (alt && findFid(alt));
    if (el && isFocusable(el)) el.focus({ preventScroll: true });
    else focusDefault(scope);
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('no-anim'); }); });
  }
  function findFid(fid) {
    try { return document.querySelector('[data-fid="' + CSS.escape(fid) + '"]'); } catch (e) { return null; }
  }

  /* ======================================================================
     Colour helpers and app artwork
     Card colour comes from the TV's own icon: a tiny canvas reads the icon's
     edge and its most colourful tone. Precomputed hex (no color-mix) for
     older engines. Results are cached per icon.
     ====================================================================== */
  var NIGHT_BG = '#000000', DAY_BG = '#f2ebdf';
  function hexToRgb(hx) { var n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mix(a, b, w) {
    var A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.map(function (v, i) { return v * w + B[i] * (1 - w); }));
  }
  function satOf(c) { var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return mx === 0 ? 0 : (mx - mn) / mx; }
  function lumOf(hx) {
    var c = hexToRgb(hx).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function hashStr(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); }
  function monoFor(title) {
    var words = String(title).replace(/[^\p{L}\p{N}+ ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2);
    return (words[0][0] + words[1][0]);
  }

  var artCache = {}; // icon src -> { tone, neutral } | 'pending' | 'none'
  var artRenderTimer = null;
  function iconTone(src) {
    var c = artCache[src];
    if (c === 'pending') return null;
    if (c) return c === 'none' ? null : c;
    artCache[src] = 'pending';
    var img = new Image();
    img.onload = function () { artCache[src] = readTone(img) || 'none'; queueArtRender(); };
    img.onerror = function () { artCache[src] = 'none'; };
    img.src = src;
    return null;
  }
  function queueArtRender() {
    clearTimeout(artRenderTimer);
    artRenderTimer = setTimeout(function () { renderApps(); renderShelf(); if (ui.settingsOpen) renderSettings(); refreshAtmo(); }, 60);
  }
  function readTone(img) {
    try {
      var n = 20, cv = document.createElement('canvas');
      cv.width = n; cv.height = n;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, n, n);
      var d = cx.getImageData(0, 0, n, n).data;
      var edge = [0, 0, 0], edgeN = 0, edgeTotal = 0, body = [0, 0, 0], bodyW = 0;
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          var i = (y * n + x) * 4, a = d[i + 3];
          var isEdge = x < 2 || y < 2 || x >= n - 2 || y >= n - 2;
          if (isEdge) edgeTotal++;
          if (a < 170) continue;
          var px = [d[i], d[i + 1], d[i + 2]];
          if (isEdge) { edge[0] += px[0]; edge[1] += px[1]; edge[2] += px[2]; edgeN++; }
          var s = satOf(px), w = 0.05 + s * s * 4;
          body[0] += px[0] * w; body[1] += px[1] * w; body[2] += px[2] * w; bodyW += w;
        }
      }
      var edgeHex = edgeN / edgeTotal > 0.7 ? rgbToHex(edge.map(function (v) { return v / edgeN; })) : null;
      var bodyHex = bodyW ? rgbToHex(body.map(function (v) { return v / bodyW; })) : null;
      // Prefer the icon's own colourful background; otherwise its most colourful tone.
      if (edgeHex && satOf(hexToRgb(edgeHex)) > 0.28) return { tone: edgeHex, neutral: false };
      if (bodyHex && satOf(hexToRgb(bodyHex)) > 0.28) return { tone: bodyHex, neutral: false };
      var base = edgeHex || bodyHex;
      return base ? { tone: base, neutral: true } : null;
    } catch (e) { return null; }
  }

  /* Card colours for both themes. Night fields stay deep (OLED, dark room);
     day fields are fuller over warm paper. `glow` feeds the atmosphere. */
  function artFor(app) {
    var src = app.icon, tone = null, neutral = false;
    if (src) { var r = iconTone(src); if (r) { tone = r.tone; neutral = r.neutral; } }
    if (!tone) tone = app.art;
    var nField, dField, nGlow, dGlow;
    if (neutral) {
      var light = lumOf(tone) > 0.4;
      nField = light ? '#24211d' : '#151413';
      dField = light ? '#e6ddcf' : '#2b2622';
      nGlow = '#1c1a17'; dGlow = '#e3d8c6';
    } else {
      nField = mix(tone, NIGHT_BG, 0.5);
      dField = mix(tone, DAY_BG, 0.86);
      nGlow = mix(tone, NIGHT_BG, 0.3);
      dGlow = mix(tone, DAY_BG, 0.22);
    }
    function ink(f) { return lumOf(f) > 0.42 ? '#1d1914' : '#fbf6ee'; }
    return {
      vars: { '--f-n': nField, '--i-n': ink(nField), '--f-d': dField, '--i-d': ink(dField) },
      glowN: nGlow, glowD: dGlow
    };
  }

  /* Atmosphere: two stacked layers crossfade (opacity only, cheap on the TV)
     so the room light follows the focused card. Ambient style only (CSS). */
  var atmo = { on: 0, key: null, timer: null };
  function setAtmo(colour, xPct) {
    var layers = [$('atmoA'), $('atmoB')];
    if (!layers[0] || !layers[1]) return;
    var key = colour ? colour + '@' + Math.round(xPct) : 'none';
    if (key === atmo.key) return;
    atmo.key = key;
    clearTimeout(atmo.timer);
    atmo.timer = setTimeout(function () {
      var cur = layers[atmo.on], next = layers[1 - atmo.on];
      if (colour) {
        next.style.setProperty('--ac', colour);
        next.style.setProperty('--ax', xPct.toFixed(1) + '%');
        next.classList.add('is-on');
      } else next.classList.remove('is-on');
      cur.classList.remove('is-on');
      atmo.on = 1 - atmo.on;
    }, 110);
  }
  function refreshAtmo() {
    if (document.hidden || prefs.style !== 'ambient' || prefs.motion === 'reduced' || (mqReduce && mqReduce.matches)) { setAtmo(null,50); return; }
    var el = document.activeElement;
    if (el && el.classList && el.classList.contains('card') && !ui.settingsOpen) {
      var r = el.getBoundingClientRect();
      var x = (r.left + r.width / 2) / Math.max(1, window.innerWidth) * 100;
      var g = el.getAttribute(resolveTheme() === 'day' ? 'data-glow-d' : 'data-glow-n');
      setAtmo(g, x);
    } else setAtmo(null, 50);
  }

  /* ======================================================================
     Bridge adapter
     ====================================================================== */
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = { get: function () { return null; } }; }
  var previewKind = (function () {
    var p = params.get('preview');
    return (!IS_WEBOS && (p === 'sample' || p === 'empty' || p === 'error')) ? p : null;
  })();

  var Bridge = {
    mode: 'none', // 'live' | 'preview' | 'none'
    impl: null,
    // A method counts as available only if it exists and is not switched off in
    // the optional `capabilities` map (see DESIGN.md).
    has: function (m) {
      if (!this.impl || typeof this.impl[m] !== 'function') return false;
      var caps = this.impl.capabilities;
      return !(caps && typeof caps === 'object' && caps[m] === false);
    },
    call: function (m, args) {
      var impl = this.impl;
      if (!impl) return Promise.reject(bridgeError('nobridge'));
      if (typeof impl[m] !== 'function') return Promise.reject(bridgeError('unsupported'));
      var p;
      try { p = Promise.resolve(impl[m].apply(impl, args || [])); } catch (e) { p = Promise.reject(e); }
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(bridgeError('timeout')); }, CALL_TIMEOUT_MS);
        p.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
      });
    }
  };
  function bridgeError(code) { var e = new Error(code); e.code = code; return e; }
  function errText(e) {
    if (e && e.code === 'timeout') return t('toast.timeout');
    if (e && e.name === 'SyntaxError') return t('toast.badResponse');
    if (e && e.name === 'TypeError' && /fetch|network/i.test(String(e.message))) return t('toast.unreachable');
    var m = e && (e.message || e.errorText || e.error) ? String(e.message || e.errorText || e.error) : String(e || '');
    m = m.replace(/\s+/g, ' ').trim();
    return clip(m || 'unknown error', 140);
  }

  /* Mode selection:
     - live:    OwnTVBridge exists and can reach a TV (on the TV, or through the
                computer editor). A bridge that reports onTV:false and editor:false
                cannot reach anything and is treated as absent.
     - preview: explicit ?preview=… and provably not running on a TV.
     - none:    everything else. */
  function attachBridge() {
    var live = window.OwnTVBridge;
    var onTv = IS_WEBOS || !!(live && live.onTV === true);
    var usable = !!(live && typeof live.getState === 'function' && !(live.onTV === false && live.editor === false));
    if (previewKind && !onTv) {
      Bridge.mode = 'preview'; Bridge.impl = makePreviewBridge(previewKind); Bridge.via = 'preview';
      return true;
    }
    if (usable) {
      Bridge.mode = 'live'; Bridge.impl = live; Bridge.via = live.onTV === true ? 'tv' : (live.editor === true ? 'editor' : 'tv');
      return true;
    }
    Bridge.mode = 'none'; Bridge.impl = null; Bridge.via = live ? 'unreachable' : 'missing';
    return false;
  }

  /* Preview bridge: only ever constructed for ?preview=… in a non-webOS browser,
     never assigned to window.OwnTVBridge, and every value is labelled "Sample". */
  function makePreviewBridge(kind) {
    function at(dayOffset, h0, m0) { var d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h0, m0, 0, 0); return d.toISOString(); }
    function ymd(dayOffset) { var d = new Date(); d.setDate(d.getDate() + dayOffset); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    var now = new Date();
    var nowStart = new Date(now.getTime() - 25 * 60000);
    var nowEnd = new Date(now.getTime() + 35 * 60000);
    function later(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function fail(ms) { return later(ms).then(function () { throw new Error('Preview: simulated bridge failure'); }); }
    /* Abstract sample icons: plain geometric glyphs, deliberately not brand marks.
       They only exercise the icon path (colour extraction, framing). */
    function sampleIcon(bg, glyph) {
      var shapes = {
        dot: '<circle cx="48" cy="48" r="20" fill="#fff"/>',
        tri: '<path d="M38 30v36l30-18z" fill="#fff"/>',
        bars: '<path d="M30 36h36M30 48h36M30 60h24" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
        ring: '<circle cx="48" cy="48" r="18" fill="none" stroke="#fff" stroke-width="8"/>',
        wave: '<path d="M26 56c8-16 14-16 22 0s14 16 22 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
        plus: '<path d="M48 30v36M30 48h36" stroke="#fff" stroke-width="8" stroke-linecap="round"/>'
      };
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="' + bg + '"/>' + shapes[glyph] + '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    var sample = {
      apps: [
        { id: 'youtube.leanback.v4', title: 'YouTube', icon: sampleIcon('#b8322c', 'tri') }, { id: 'tv.twitch.tv.starshot.lg', title: 'Twitch', icon: sampleIcon('#6c46c4', 'bars') },
        { id: 'spotify-beehive', title: 'Spotify', icon: sampleIcon('#1f8f50', 'wave') }, { id: 'netflix', title: 'Netflix', icon: sampleIcon('#141414', 'ring') },
        { id: 'amazon', title: 'Prime Video', icon: sampleIcon('#1d6fa8', 'dot') }, { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
        { id: 'sample.mediathek', title: 'Sample Mediathek', icon: sampleIcon('#2a6f6a', 'plus') }, { id: 'sample.radio', title: 'Sample Radio' }
      ],
      inputs: [
        { id: 'com.webos.app.hdmi1', title: 'HDMI 1', connected: true }, { id: 'com.webos.app.hdmi2', title: 'HDMI 2', connected: false },
        { id: 'com.webos.app.hdmi3', title: 'HDMI 3' }, { id: 'com.webos.app.hdmi4', title: 'HDMI 4', connected: false }
      ],
      recent: [{ id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'spotify-beehive', title: 'Spotify' }, { id: 'sample.mediathek', title: 'Sample Mediathek' }],
      health: { temperature: 46, memoryUsedPercent: 41, uptimeSeconds: 3 * 86400 + 4 * 3600 + 720, model: 'Sample TV', firmware: 'sample' },
      privacy: { summary: 'Sample: 3 telemetry hosts blocked', trackingOff: true, adBlocking: true },
      calendar: {
        configured: true,
        updatedAt: now.getTime() - 6 * 60000,
        events: [
          { title: 'Sample · Laundry running', start: nowStart.toISOString(), end: nowEnd.toISOString() },
          { title: 'Sample · Film night', start: at(0, 20, 15), end: at(0, 22, 0) },
          { title: 'Sample · Recycling day', start: ymd(1) },
          { title: 'Sample · Dentist', start: at(1, 9, 30), end: at(1, 10, 0) },
          { title: 'Sample · Football', start: at(2, 18, 0), end: at(2, 19, 30) }
        ]
      },
      weather: { configured: true, temperature: 9, condition: 'Light rain', city: 'Sample City', updatedAt: now.getTime() - 12 * 60000 },
      smartHome: { configured: false, devices: [] }
    };
    var empty = {
      apps: [], inputs: [], recent: [], health: {}, privacy: {},
      calendar: { configured: false, events: [] },
      weather: { configured: false },
      smartHome: { configured: false, devices: [] }
    };
    var ok = function () { return kind === 'error' ? fail(500) : later(250).then(function () { return { ok: true, preview: true }; }); };
    return {
      __preview: kind,
      getState: function () {
        if (kind === 'error') return fail(400);
        return later(300).then(function () { return JSON.parse(JSON.stringify(kind === 'empty' ? empty : sample)); });
      },
      getWeather:function(){return later(200).then(function(){if(kind==='error')throw Error('Preview unavailable');if(kind==='empty')return {configured:false};var start=Math.floor(Date.now()/3600000)*3600000;return {configured:true,city:'Sample City',temperature:9,feelsLike:7,code:3,wind:12,humidity:78,isDay:true,updatedAt:Date.now(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,location:{latitude:48,longitude:11},hourly:Array.from({length:24},function(_,i){return {time:start+i*3600000,temperature:9+Math.round(Math.sin(i/5)*4),code:i<6?61:3,probability:i<6?60+i*4:20,precipitation:i<6?.4:0,wind:12};}),daily:Array.from({length:7},function(_,i){return {time:Date.now()+i*86400000,code:i%3===0?61:3,high:12+i%3,low:4+i%3,probability:30+i*5,precipitation:i%3,wind:15,sunrise:Date.now(),sunset:Date.now()+36000000};})};});},
      capabilities: { configureWeather: kind === 'sample' },
      launch: ok, setSleepTimer: ok, screenOff: ok, openLgHome: ok, openSettings: ok,
      configureWeather: kind === 'sample' ? ok : undefined,
      searchWeather: kind === 'sample' ? function(){return later(100).then(function(){return {places:[{label:'Sample City',region:'Sample Region, Sample Country',latitude:10,longitude:20},{label:'Sample Town',region:'Sample Region, Sample Country',latitude:11,longitude:21},{label:'Sample Place',region:'Sample Region, Sample Country',latitude:12,longitude:22},{label:'Sample Village',region:'Sample Region, Sample Country',latitude:13,longitude:23}]};});} : undefined
    };
  }

  /* ======================================================================
     State normalisation — missing means unavailable, never zero.
     ====================================================================== */
  var state = { data: null, lastOk: 0, error: null, loading: false, everFailed: false };
  var sleepLocal = null; // { endsAt } — timer set from this dashboard (memory only)

  function safeIcon(v) {
    if (typeof v !== 'string' || !v) return null;
    if (/^data:image\/(png|jpe?g|webp|svg\+xml);/i.test(v)) return v;
    if (/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|file:\/\/\/|\/)/i.test(v)) return v;
    if (/^[\w.\-\/]+\.(png|jpe?g|webp|svg)$/i.test(v) && v.indexOf('..') < 0) return v;
    return null; // no remote hosts
  }
  function parseWhen(v) {
    if (typeof v === 'number' && isFinite(v)) return { d: new Date(v < 1e12 ? v * 1000 : v), allDay: false };
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    var ms = Date.parse(v);
    return isNaN(ms) ? null : { d: new Date(ms), allDay: false };
  }
  function stamp(v) { var w = parseWhen(v); return w && !w.allDay ? w.d.getTime() : null; }
  function normalizeState(raw) {
    raw = isObj(raw) ? raw : {};
    function list(v, max) { return Array.isArray(v) ? v.filter(isObj).slice(0, max || 200) : null; }
    var apps = list(raw.apps, 400);
    var out = {
      apps: apps ? apps.filter(function (a) { return str(a.id); }).map(function (a) {
        return { id: str(a.id), title: clip(str(a.title) || str(a.id), 48), icon: safeIcon(a.icon) };
      }) : null,
      inputs: list(raw.inputs, 12) ? list(raw.inputs, 12).filter(function (i) { return str(i.id); }).map(function (i) {
        return { id: str(i.id), title: clip(str(i.title) || str(i.id), 32), connected: typeof i.connected === 'boolean' ? i.connected : null };
      }) : null,
      recent: list(raw.recent, 20) ? list(raw.recent, 20).filter(function (r) { return str(r.id); }).map(function (r) {
        return { id: str(r.id), title: clip(str(r.title) || str(r.id), 48) };
      }) : null,
      health: isObj(raw.health) ? {
        panelHours: finite(raw.health.panelHours),
        webos: str(raw.health.webos),
        temperature: finite(raw.health.temperature),
        idleReleaseSupported: raw.health.idleReleaseSupported === true,
        lowMemoryMode: raw.health.lowMemoryMode === true,
        memoryUsedPercent: finite(raw.health.memoryUsedPercent),
        memoryAvailableMB: finite(raw.health.memoryAvailableMB),
        memoryTotalMB: finite(raw.health.memoryTotalMB),
        memoryCachedMB: finite(raw.health.memoryCachedMB),
        swapUsedMB: finite(raw.health.swapUsedMB),
        uptimeSeconds: finite(raw.health.uptimeSeconds),
        model: str(raw.health.model) ? clip(str(raw.health.model), 40) : null,
        firmware: str(raw.health.firmware) ? clip(str(raw.health.firmware), 40) : null
      } : null,
      privacy: isObj(raw.privacy) ? {
        summary: str(raw.privacy.summary) ? clip(str(raw.privacy.summary), 80) : null,
        trackingOff: typeof raw.privacy.trackingOff === 'boolean' ? raw.privacy.trackingOff : null,
        adBlocking: typeof raw.privacy.adBlocking === 'boolean' ? raw.privacy.adBlocking : null
      } : null,
      calendar: isObj(raw.calendar) ? {
        configured: raw.calendar.configured === true,
        error: !!raw.calendar.error,
        partial: !!raw.calendar.partial,
        busyOnly: raw.calendar.busyOnly!==false,
        sources: (list(raw.calendar.sources,16)||[]).map(function(s){return {id:clip(str(s.id)||'',24),name:clip(str(s.name)||'Calendar',60),enabled:s.enabled!==false,catalogId:clip(str(s.catalogId)||'',80),connected:s.connected===true,stale:s.stale===true};}),
        updatedAt: stamp(raw.calendar.updatedAt),
        events: (list(raw.calendar.events, 200) || []).map(function (e) {
          var s = parseWhen(e.start); if (!s) return null;
          var en = parseWhen(e.end);
          var end = en ? en.d : (s.allDay ? new Date(s.d.getFullYear(), s.d.getMonth(), s.d.getDate() + 1) : new Date(s.d.getTime() + 3600000));
          return { title: clip(e.title === 'Busy' ? t('cal.busy') : str(e.title) || '—', 60), start: s.d, end: end, allDay: s.allDay || e.allDay === true, calendar:clip(str(e.calendar)||'',60) };
        }).filter(Boolean).sort(function (a, b) { return a.start - b.start; })
      } : null,
      weather: isObj(raw.weather) ? {
        configured: raw.weather.configured === true,
        temperature: finite(raw.weather.temperature),
        condition: str(raw.weather.condition) ? clip(str(raw.weather.condition), 32) : null,
        city: str(raw.weather.city) ? clip(str(raw.weather.city), 32) : null,
        solar: (list(raw.weather.solar, 8) || []).map(function(d) { return {start:finite(d.start),end:finite(d.end),sunrise:finite(d.sunrise),sunset:finite(d.sunset)}; }),
        error: !!raw.weather.error,
        updatedAt: stamp(raw.weather.updatedAt)
      } : null,
      smartHome: isObj(raw.smartHome) ? {
        configured: raw.smartHome.configured === true,
        devices: (list(raw.smartHome.devices, 24) || []).map(function (d) {
          return { name: clip(str(d.title) || str(d.name) || str(d.id) || '—', 32), state: str(d.state) ? clip(str(d.state), 20) : null };
        })
      } : null,
      sleepTimer: null
    };
    // Optional extension (see DESIGN.md): sleepTimer: { endsAt } | null
    if ('sleepTimer' in raw) {
      if (raw.sleepTimer === null) out.sleepTimer = { off: true };
      else if (isObj(raw.sleepTimer)) {
        var ends = parseWhen(raw.sleepTimer.endsAt);
        var rem = finite(raw.sleepTimer.minutesRemaining);
        if (ends) out.sleepTimer = { endsAt: ends.d.getTime() };
        else if (rem !== null) out.sleepTimer = rem > 0 ? { endsAt: Date.now() + rem * 60000 } : { off: true };
      }
    }
    return out;
  }

  /* ======================================================================
     Polling: once a minute, only while visible
     ====================================================================== */
  var pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (document.hidden || weatherView) return;
    pollTimer = setTimeout(function () { refresh(false).then(schedulePoll); }, POLL_MS);
  }
  function refresh(manual) {
    if (!Bridge.impl) { renderAll(); return Promise.resolve(); }
    if (state.loading) return Promise.resolve();
    state.loading = true;
    renderTop();
    return Bridge.call('getState').then(function (raw) {
      var wasFailing = !!state.error;
      state.data = normalizeState(raw);
      adoptRemotePrefs(raw);
      state.lastOk = Date.now();
      state.error = null;
      if (wasFailing && state.everFailed) toast(t('toast.stateBack'), 'ok');
      else if (manual) toast(t('toast.refreshed'), 'ok');
    }, function (err) {
      var first = !state.error;
      state.error = err;
      state.everFailed = true;
      if (first || manual) toast(t('toast.stateErr', { msg: errText(err) }), 'error');
    }).then(function () {
      state.loading = false;
      renderAll();
    });
  }

  /* Adopt the helper's preferences when they are newer than ours and nothing
     local is waiting to be saved. Called on every successful getState(). */
  var seededRemote = false;
  function adoptRemotePrefs(raw) {
    if (Bridge.mode !== 'live' || !isObj(raw)) return;
    var rev = Number(raw.preferencesRevision);
    if (!isFinite(rev) || rev < 0) rev = 0;
    var remote = raw.preferences;
    if (!isObj(remote) || remote.schema !== 1) {
      // The helper has nothing yet: seed it once with this screen's preferences.
      if (hadStoredPrefs && !seededRemote && Bridge.has('savePreferences')) { seededRemote = true; syncPrefs(); }
      return;
    }
    if (prefsDirty || syncInFlight) {
      // Our unsaved change wins; make sure it is on its way.
      if (prefsDirty && !syncInFlight && !syncTimer && Bridge.has('savePreferences')) syncPrefs();
      return;
    }
    if (hadStoredPrefs && rev <= lastRemoteRevision) return;
    var r = { errors: [], warnings: [] };
    var adopted = sanitizePrefs(remote, r);
    lastRemoteRevision = rev;
    hadStoredPrefs = true;
    saveSync();
    if (r.errors.length) return; // refuse a helper copy containing anything secret-shaped
    if (JSON.stringify(adopted) === JSON.stringify(prefs)) return;
    prefs = adopted;
    ui.wxDraft = null;
    savePrefs(true);
    applyTheme();
  }

  /* ======================================================================
     Actions that reach the TV
     ====================================================================== */
  function act(method, args, label, onOk) {
    if (Bridge.mode === 'none') { toast(t('toast.noBridge', { action: label }), 'error'); return Promise.resolve(false); }
    if (!Bridge.has(method)) { toast(t('toast.notSupported', { action: label }), 'error'); return Promise.resolve(false); }
    return Bridge.call(method, args).then(function (r) {
      if (Bridge.mode === 'preview') toast(t('toast.previewDid', { action: label }), 'info');
      if (onOk) onOk(r);
      return true;
    }, function (err) {
      var l = label.charAt(0).toUpperCase() + label.slice(1);
      toast(t('toast.err', { action: l, msg: errText(err) }), 'error');
      return false;
    });
  }

  /* ======================================================================
     Apps: resolve rail entries against the bridge's app list
     ====================================================================== */
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function resolveApp(key) {
    var apps = state.data && state.data.apps;
    var c = CATALOG_BY_KEY[key];
    if (c) {
      var found = null;
      if (apps) {
        for (var i = 0; i < apps.length && !found; i++) {
          if (c.ids.indexOf(apps[i].id) >= 0 || c.names.indexOf(norm(apps[i].title)) >= 0) found = apps[i];
        }
      }
      return {
        key: key, title: c.title, mono: c.mono, art: c.art,
        launchId: found ? found.id : c.ids[0], icon: found && found.icon,
        onTv: found ? true : (apps && apps.length ? false : null), builtin: true
      };
    }
    var id = key.slice(4);
    var b = apps ? apps.filter(function (a) { return a.id === id; })[0] : null;
    var title = (b && b.title) || prefs.apps.labels[key] || id;
    return {
      key: key, title: title, mono: monoFor(title), art: EXTRA_ART[hashStr(id) % EXTRA_ART.length],
      launchId: id, icon: b && b.icon, onTv: b ? true : (apps && apps.length ? false : null), builtin: false
    };
  }
  function railApps() {
    var items = prefs.apps.order.filter(function (k) { return prefs.apps.hidden.indexOf(k) < 0; }).map(resolveApp);
    return window.OwnTVOrder.recentFirst(items, state.data && state.data.recent, prefs.apps.sort === 'manual');
  }
  function launchApp(app, btn) {
    if (btn) btn.setAttribute('aria-busy', 'true');
    return act('launch', [app.launchId], t('act.launch', { title: app.title })).then(function (ok) {
      if (ok && state.data) { state.data.recent = [{id: app.launchId, title: app.title}].concat((state.data.recent || []).filter(function (a) { return a.id !== app.launchId; })); renderApps(); }
      if (btn) btn.removeAttribute('aria-busy');
    });
  }

  /* ======================================================================
     Theme, motion, language
     ====================================================================== */
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var mqLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function minutesNow(d) { return d.getHours() * 60 + d.getMinutes(); }
  function inDay(mins) {
    var ds = parseHM(prefs.theme.dayStart), ns = parseHM(prefs.theme.nightStart);
    return ds < ns ? (mins >= ds && mins < ns) : (mins >= ds || mins < ns);
  }
  function resolveTheme(now) {
    var m = prefs.theme.mode;
    if (m === 'day' || m === 'night') return m;
    if (prefs.theme.autoSource === 'sun' && window.OwnTVSolar) {
      var solarTheme = OwnTVSolar.theme(state.data && state.data.weather, +(now || new Date()));
      if (solarTheme) return solarTheme;
    }
    if (prefs.theme.autoSource === 'system') {
      if (mqLight && mqLight.matches) return 'day';
      if (mqDark && mqDark.matches) return 'night';
    }
    return inDay(minutesNow(now || new Date())) ? 'day' : 'night';
  }
  function themeCaption(now) {
    var shown = resolveTheme(now);
    var name = t('theme.' + shown);
    if (prefs.theme.mode !== 'auto') return t('theme.cap.manual', { theme: name });
    if (prefs.theme.autoSource === 'sun') {
      var solarDay = window.OwnTVSolar && OwnTVSolar.period(state.data && state.data.weather, +(now || new Date()));
      return solarDay ? t('theme.cap.sun', { sunrise:fmtTime(new Date(solarDay.sunrise)), sunset:fmtTime(new Date(solarDay.sunset)) }) : t('theme.cap.sunFallback');
    }
    if (prefs.theme.autoSource === 'system' && mqDark && (mqDark.matches || (mqLight && mqLight.matches))) return t('theme.cap.system', { theme: name });
    return shown === 'day' ? t('theme.cap.schedule.day', { time: prefs.theme.nightStart }) : t('theme.cap.schedule.night', { time: prefs.theme.dayStart });
  }
  function applyTheme() {
    var th = resolveTheme();
    var changed = false;
    if (root.getAttribute('data-theme') !== th) { root.setAttribute('data-theme', th); changed = true; }
    if (root.getAttribute('data-style') !== prefs.style) { root.setAttribute('data-style', prefs.style); changed = true; }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th === 'day' ? DAY_BG : NIGHT_BG);
    if (changed && $('atmoA')) refreshAtmo();
    if(changed && weatherView)weatherView.themeChanged();
    var reduce = prefs.motion === 'reduced' || (mqReduce && mqReduce.matches);
    root.setAttribute('data-motion', reduce ? 'reduced' : 'full');
    root.setAttribute('lang', prefs.language);
    root.setAttribute('dir',OwnTVI18n.direction(prefs.language));
    document.title = t('doc.title');
  }
  function onMq(mq, fn) { if (!mq) return; if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn); }

  /* ======================================================================
     Formatting
     ====================================================================== */
  function loc() { return prefs.language==='en'?'en-GB':prefs.language; }
  function fmtTime(d) { try{return new Intl.DateTimeFormat(loc(),{hour:'2-digit',minute:'2-digit'}).format(d);}catch(e){return pad(d.getHours())+':'+pad(d.getMinutes());} }
  function fmtDate(d, opts) {
    try { return d.toLocaleDateString(loc(), opts || { weekday: 'long', day: 'numeric', month: 'long' }); }
    catch (e) { return d.toDateString(); }
  }
  function fmtNum(n, digits) {
    try { return new Intl.NumberFormat(loc(), { maximumFractionDigits: digits || 0 }).format(n); }
    catch (e) { return String(Math.round(n)); }
  }
  function fmtUptime(sec) {
    var d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return d + ' ' + t('u.d') + ' ' + hh + ' ' + t('u.h');
    if (hh) return hh + ' ' + t('u.h') + ' ' + m + ' ' + t('u.min');
    return m + ' ' + t('u.min');
  }
  function greeting(d) {
    var hr = d.getHours();
    var g = hr >= 5 && hr < 12 ? 'greet.morning' : hr >= 12 && hr < 18 ? 'greet.afternoon' : hr >= 18 && hr < 23 ? 'greet.evening' : 'greet.night';
    return prefs.name ? t('greet.named', { greet: t(g), name: prefs.name }) : t(g);
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayLabel(d, now) {
    var tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (sameDay(d, now)) return t('cal.today');
    if (sameDay(d, tom)) return t('cal.tomorrow');
    return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' });
  }

  /* ======================================================================
     Render: banner + top bar
     ====================================================================== */
  function bridgeStatus() {
    if (Bridge.mode === 'preview') return { dot: 'flag', text: t('status.preview.' + previewKind) };
    if (Bridge.mode === 'none') return { dot: 'hollow', text: t('status.none') };
    if (!state.lastOk && state.error) return { dot: 'bad', text: t('status.error') };
    if (!state.lastOk) return { dot: '', text: t('status.connecting') };
    var stale = Date.now() - state.lastOk > STALE_MS || state.error;
    return stale ? { dot: 'warn', text: t('status.stale', { time: fmtTime(new Date(state.lastOk)) }) }
      : { dot: 'ok', text: t('status.updated', { time: fmtTime(new Date(state.lastOk)) }) };
  }

  function renderBanner() {
    var el = $('banner');
    root.classList.toggle('is-preview', Bridge.mode === 'preview');
    root.classList.toggle('is-nobridge', Bridge.mode === 'none');
    if (Bridge.mode === 'live') { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    var base = window.location.pathname;
    var nodes;
    if (Bridge.mode === 'preview') {
      nodes = [h('strong', null, t('banner.label.preview')), h('span', { class: 'banner__text' }, t('banner.preview.' + previewKind)),
        previewKind !== 'sample' ? h('a', { href: base + '?preview=sample', 'data-fid': 'bn-sample' }, t('banner.openSample')) : null,
        previewKind !== 'empty' ? h('a', { href: base + '?preview=empty', 'data-fid': 'bn-empty' }, t('banner.openEmpty')) : null,
        h('a', { href: base, 'data-fid': 'bn-exit' }, t('banner.exit'))];
    } else {
      nodes = [h('strong', null, t('banner.label.none')), h('span', { class: 'banner__text' }, IS_WEBOS ? t('banner.noneTv') : t('banner.none')),
        IS_WEBOS ? null : h('a', { href: base + '?preview=sample', 'data-fid': 'bn-sample' }, t('banner.openSample')),
        IS_WEBOS ? null : h('a', { href: base + '?preview=empty', 'data-fid': 'bn-empty' }, t('banner.openEmpty'))];
    }
    patch(el, nodes);
  }

  /* Top bar: one clock, the date, and quiet icon actions whose labels unfold
     on focus. The bridge pill appears only when something needs attention. */
  function topAction(action, fid, ic, label, extra) {
    var props = { class: 'act', type: 'button', 'data-action': action, 'data-fid': fid, 'aria-label': (extra && extra.aria) || label };
    if (extra && extra.popup) props['aria-haspopup'] = 'dialog';
    return h('button', props, icon(ic), h('span', { class: 'act__l', 'aria-hidden': 'true' }, label));
  }
  function renderTop() {
    var now = new Date();
    var st = bridgeStatus();
    var mode = prefs.theme.mode;
    var showPill = !(Bridge.mode === 'live' && state.lastOk && !state.error && Date.now() - state.lastOk <= STALE_MS);
    patch($('top'), [
      h('div', { class: 'top__when' },
        h('span', { class: 'top__time', id: 'clock' }, fmtTime(now)),
        h('span', { class: 'top__date' }, fmtDate(now)),
        prefs.name ? h('span', { class: 'top__greet' }, greeting(now)) : null),
      h('div', { class: 'top__right' },
        showPill ? h('button', { class: 'pill', type: 'button', 'data-action': 'refresh', 'data-fid': 'm-status', 'aria-label': t('status.refresh', { status: st.text }) },
          h('span', { class: 'dot' + (st.dot ? ' dot--' + st.dot : '') }), st.text) : null,
        h('nav', { class: 'top__actions', 'aria-label': 'TV' },
          topAction('theme-cycle', 'm-theme', mode === 'auto' ? 'auto' : (mode === 'day' ? 'sun' : 'moon'), t('theme.' + mode),
            { aria: t('mast.themeAria', { mode: t('theme.' + mode), shown: t('theme.' + resolveTheme()) }) }),
          topAction('lg-home', 'm-home', 'home', t('mast.lgHome')),
          topAction('tv-settings', 'm-tvset', 'tvset', t('mast.tvSettings')),
          topAction('screen-off', 'm-off', 'power', t('mast.screenOff')),
          topAction('open-settings', 'm-settings', 'sliders', t('mast.settings'), { popup: true })))
    ]);
  }

  /* ======================================================================
     Render: app cards (the hero of the screen)
     ====================================================================== */
  var OWN_APP_ID = 'io.github.noelhuibers.owntv';
  function recentRank(app) {
    var rec = state.data && state.data.recent;
    if (!rec || app.onTv !== true) return -1;
    var list = rec.filter(function (r) { return r.id !== OWN_APP_ID; });
    for (var i = 0; i < list.length; i++) if (list[i].id === app.launchId) return i;
    return -1;
  }
  function artNode(app, cls) {
    if (app.icon) return h('img', { class: cls + '__icon', src: app.icon, alt: '' });
    var long = app.title.length > 8;
    return h('span', { class: cls + '__word' + (long ? ' ' + cls + '__word--long' : '') }, app.title);
  }
  function renderApps() {
    var el = $('apps');
    el.setAttribute('aria-label', t('sec.apps'));
    var apps = railApps();
    if (!apps.length) { patch(el, h('p', { class: 'empty-line' }, t('watch.empty'))); return; }
    patch(el, h('ul', { class: 'cards', 'data-nav-memory': 'rail' }, apps.map(function (app) {
      var art = artFor(app);
      var rank = recentRank(app);
      var detail = app.onTv === false ? t('app.notReportedLong') : rank === 0 ? t('app.lastUsed') : rank > 0 && rank < 4 ? t('app.usedRecently') : '';
      var label = (app.onTv === false ? t('app.openFlag', { title: app.title }) : t('app.open', { title: app.title })) + (rank === 0 ? '. ' + t('app.lastUsed') : '');
      return h('li', { class: 'cards__item' },
        h('button', {
          class: 'card' + (app.icon ? ' card--icon' : ' card--word') + (app.onTv === false ? ' card--missing' : ''),
          type: 'button', 'data-action': 'launch', 'data-arg': app.key, 'data-fid': 'plate:' + app.key, 'aria-label': label,
          'data-glow-n': art.glowN, 'data-glow-d': art.glowD, style: art.vars
        },
          h('span', { class: 'card__art', 'aria-hidden': 'true' }, artNode(app, 'card')),
          app.onTv === false ? h('span', { class: 'card__flag', 'aria-hidden': 'true' }, t('app.notReported')) : null),
        h('p', { class: 'card__cap', 'aria-hidden': 'true' },
          h('span', { class: 'card__name' }, app.title),
          detail ? h('span', { class: 'card__detail' }, detail) : null));
    })));
  }

  /* ======================================================================
     Render: the shelf — compact widgets under the apps.
     Each shows one useful line; its details unfold above it on focus.
     ====================================================================== */
  function wxIcon(cond, now) {
    var c = norm(cond);
    if (/thunder|storm|gewitter/.test(c)) return 'storm';
    if (/snow|sleet|schnee|graupel/.test(c)) return 'snow';
    if (/rain|drizzle|shower|regen|niesel|schauer/.test(c)) return 'rain';
    if (/fog|mist|haze|nebel|dunst/.test(c)) return 'fog';
    if (/cloud|overcast|wolk|bedeckt/.test(c)) return 'cloud';
    if (/clear|sun|fair|klar|sonn|heiter/.test(c)) return resolveTheme(now) === 'night' || now.getHours() >= 19 || now.getHours() < 6 ? 'moon' : 'sun';
    return 'cloud';
  }

  /* glance(): one widget.
     o.action → the face is a single button (OK opens o.arg settings);
     o.body   → the face holds its own controls (recent apps, sleep chips…). */
  function glance(key, o) {
    var moreId = 'more-' + key;
    var moreNodes = o.more ? [].concat(o.more) : [];
    if (o.action && o.okHint !== false) moreNodes.push(h('p', { class: 'w__hint' }, t('glance.ok')));
    var hintOnly = moreNodes.length === 1 && !o.more;
    var more = moreNodes.length ? h('div', { class: 'w__more' + (hintOnly ? ' w__more--hintonly' : ''), id: moreId }, moreNodes) : null;
    var head = h('span', { class: 'w__label' }, icon(o.icon), h('span', null, o.label));
    var cls = 'w w--' + key + (o.tone ? ' w--' + o.tone : '');
    if (o.action) {
      return h('section', { class: cls, 'aria-label': o.label },
        h('button', { class: 'w__face', type: 'button', 'data-action': o.action, 'data-arg': o.arg, 'data-fid': 'w:' + key, 'aria-describedby': more ? moreId : null },
          head, o.value !== undefined ? h('span', { class: 'w__value' }, o.value) : null, o.sub ? h('span', { class: 'w__sub' }, o.sub) : null, o.list || null),
        more);
    }
    return h('section', { class: cls, 'aria-label': o.label },
      h('div', { class: 'w__face' }, head, o.value !== undefined ? h('span', { class: 'w__value' }, o.value) : null, o.sub ? h('span', { class: 'w__sub' }, o.sub) : null, o.body),
      more);
  }
  function naGlance(key, ic, label, action, arg) {
    return glance(key, { icon: ic, label: label, value: na(t('na')), tone: 'na', more: h('p', null, naText()), action: action, arg: arg });
  }

  function wWeather(now) {
    var wx = state.data && state.data.weather;
    var label = t('sec.weather');
    var solarDay = window.OwnTVSolar && OwnTVSolar.period(wx, +(now || new Date()));
    var hasLocal = prefs.weather.latitude !== null;
    if (!state.data || Bridge.mode === 'none') return naGlance('weather', 'cloud', label, hasLocal&&Bridge.has('getWeather')?'open-weather':'open-settings', 'weather');
    if (wx && wx.configured) {
      var place = wx.city || prefs.weather.label;
      if (wx.temperature === null || wx.error) {
        return glance('weather', { icon: 'cloud', label: label, value: na(t('wx.na')), sub: place, tone: 'na',
          more: h('p', null, t('wx.error')), okHint:false, action: 'open-weather' });
      }
      return glance('weather', { icon: wxIcon(wx.condition, now), label: label,
        value: [h('span', { class: 'w__big' }, fmtNum(wx.temperature, 0) + '°'), wx.condition ? h('span', { class: 'w__cond' }, wx.condition) : null],
        sub: place || null,
        more: [wx.updatedAt ? h('p', null, t('wx.updated', { time: fmtTime(new Date(wx.updatedAt)) })) : null, solarDay ? h('p', {class:'w__meta'}, t('theme.cap.sun', {sunrise:fmtTime(new Date(solarDay.sunrise)),sunset:fmtTime(new Date(solarDay.sunset))})) : null],
        okHint:false, action: 'open-weather' });
    }
    if (hasLocal) {
      return glance('weather', { icon: 'pin', label: label, value: t('wx.pending.title'), tone: 'setup',
        more: h('p', null, t('wx.pending.text', { label: prefs.weather.label || (prefs.weather.latitude + ', ' + prefs.weather.longitude) })), action: 'open-settings', arg: 'weather' });
    }
    return glance('weather', { icon: 'plus', label: label, value: t('wx.setup.title'), tone: 'setup',
      more: h('p', null, t('wx.setup.text')), action: 'open-settings', arg: 'weather' });
  }

  function evRow(e, now, withDay) {
    var live = now >= e.start && now < e.end && !e.allDay;
    var time = e.allDay ? t('cal.allDay') : live ? t('cal.now') : fmtTime(e.start);
    var day = withDay ? dayLabel(e.start < now ? now : e.start, now) : null;
    return h('span', { class: 'ev' + (live ? ' ev--now' : '') },
      h('span', { class: 'ev__time' }, day && !sameDay(e.start < now ? now : e.start, now) ? day + ' ' + (e.allDay ? '' : fmtTime(e.start)) : time),
      h('span', { class: 'ev__title',title:e.calendar?e.calendar+' · '+e.title:e.title }, e.title), e.calendar?h('small',{class:'ev__calendar'},e.calendar):null);
  }
  function wCalendar(now) {
    var cal = state.data && state.data.calendar;
    var label = t('sec.agenda');
    if (!cal) return naGlance('calendar', 'calendar', label, 'open-settings', 'calendar');
    if (cal.error) return glance('calendar', { icon: 'calendar', label: label, value: na(t('na')), tone: 'na', more: h('p', null, t('cal.unavailable')), action: 'open-settings', arg: 'calendar' });
    if (!cal.configured) return glance('calendar', { icon: 'plus', label: label, value: t('cal.setup.title'), tone: 'setup', more: h('p', null, t('cal.setup.text')), action: 'open-settings', arg: 'calendar' });
    var upcoming = cal.events.filter(function (e) { return e.end > now; });
    var stampLine = cal.updatedAt ? h('p', { class: 'w__meta' }, t('cal.updated', { time: fmtTime(new Date(cal.updatedAt)) })) : h('p', { class: 'w__meta' }, t('cal.source'));
    if (!upcoming.length) return glance('calendar', { icon: 'calendar', label: label, value: t('cal.empty'), more: stampLine, action: 'open-settings', arg: 'calendar' });
    var face = upcoming.slice(0, 2), rest = upcoming.slice(2, 6);
    var more = [];
    if (rest.length) more.push(h('div', { class: 'w__evs' }, rest.map(function (e) { return evRow(e, now, true); })));
    if (upcoming.length > 6) more.push(h('p', { class: 'w__meta' }, t('cal.more', { n: upcoming.length - 6 })));
    more.push(stampLine);
    if(cal.partial)more.push(h('p',{class:'w__meta'},calText('Some calendars are temporarily unavailable.','Einige Kalender sind vorübergehend nicht erreichbar.')));
    return glance('calendar', { icon: 'calendar', label: label,
      list: h('span', { class: 'w__evs' }, face.map(function (e) { return evRow(e, now, true); })),
      more: more, action: 'open-settings', arg: 'calendar' });
  }

  function recentEntries() {
    var list = state.data && state.data.recent;
    if (!list) return null;
    var apps = (state.data && state.data.apps) || [];
    return list.filter(function (r) { return r.id !== OWN_APP_ID; }).slice(0, 3).map(function (r) {
      var match = null;
      CATALOG.forEach(function (c) { if (!match && (c.ids.indexOf(r.id) >= 0 || c.names.indexOf(norm(r.title)) >= 0)) match = c; });
      var src = apps.filter(function (a) { return a.id === r.id; })[0];
      return { id: r.id, title: match ? match.title : r.title, icon: src && src.icon, art: match ? match.art : EXTRA_ART[hashStr(r.id) % EXTRA_ART.length], mono: match ? match.mono : monoFor(r.title) };
    });
  }
  function wRecent() {
    var label = t('sec.recent');
    var list = recentEntries();
    if (!list) return naGlance('recent', 'recent', label);
    if (!list.length) return glance('recent', { icon: 'recent', label: label, value: t('rec.empty'), tone: 'quiet' });
    return glance('recent', { icon: 'recent', label: label,
      body: h('span', { class: 'recs' }, list.map(function (r) {
        var art = artFor(r);
        return h('button', { class: 'rec', type: 'button', 'data-action': 'launch-id', 'data-arg': r.id, 'data-label': r.title, 'data-fid': 'rec:' + r.id, 'aria-label': t('rec.open', { title: r.title }), style: art.vars },
          r.icon ? h('img', { class: 'rec__icon', src: r.icon, alt: '' }) : h('span', { class: 'rec__mono', 'aria-hidden': 'true' }, r.mono),
          h('span', { class: 'rec__name', 'aria-hidden': 'true' }, r.title));
      })) });
  }

  function currentSleep() {
    var now = Date.now();
    var st = state.data && state.data.sleepTimer;
    if (st && st.off) return { off: true };
    if (st && st.endsAt > now) return { endsAt: st.endsAt, reported: true };
    if (sleepLocal && sleepLocal.endsAt > now) return { endsAt: sleepLocal.endsAt, local: true };
    if (st) return { off: true };
    return { unknown: true };
  }
  function wSleep() {
    var can = Bridge.has('setSleepTimer');
    var cur = currentSleep();
    var label = t('sec.sleep');
    var value, sub = null, tone = '';
    if (cur.endsAt) {
      var mins = Math.max(1, Math.round((cur.endsAt - Date.now()) / 60000));
      value = [h('span', null, t('sleep.at', { time: fmtTime(new Date(cur.endsAt)) })),
        h('span', { class: 'w__cond' }, t('sleep.in', { n: mins }) + (cur.local ? ' · ' + t('sleep.setHere') : ''))];
      tone = 'active';
    } else if (cur.off) value = t('sleep.off');
    else if (!can) { value = na(t('na')); tone = 'na'; }
    else { value = na(t('sleep.unknown')); }
    var chips = h('span', { class: 'chips', role: 'group', 'aria-label': t('sleep.choose') }, SLEEP_CHOICES.map(function (m) {
      return h('button', { class: 'chip', type: 'button', 'data-action': 'sleep', 'data-arg': m, 'data-fid': 'sleep:' + m, 'aria-label': t('sleep.setAria', { n: m }), disabled: !can }, String(m));
    }).concat([h('button', { class: 'chip chip--off', type: 'button', 'data-action': 'sleep', 'data-arg': 0, 'data-fid': 'sleep:0', 'aria-label': t('sleep.cancelAria'), disabled: !can }, t('sleep.cancel'))]));
    var more = !can ? h('p', null, Bridge.mode === 'none' ? t('na.bridge') : t('sleep.na')) : cur.unknown ? h('p', null, t('sleep.unknownSub')) : h('p', null, t('sleep.choose') + ' (' + t('sleep.min') + ')');
    return glance('sleep', { icon: 'timer', label: label, value: value, sub: sub, tone: tone, body: chips, more: more });
  }

  function healthDetails(H, pv, peek) {
    function row(k, v) { return h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v === null || v === undefined ? na() : v)); }
    var badges = [];
    if (pv && pv.trackingOff !== null) badges.push(h('span', { class: 'badge ' + (pv.trackingOff ? 'badge--ok' : 'badge--warn') }, icon(pv.trackingOff ? 'check' : 'alert'), t(pv.trackingOff ? 'p.trackingOff' : 'p.trackingOn')));
    if (pv && pv.adBlocking !== null) badges.push(h('span', { class: 'badge ' + (pv.adBlocking ? 'badge--ok' : 'badge--warn') }, icon(pv.adBlocking ? 'shield' : 'alert'), t(pv.adBlocking ? 'p.adsOn' : 'p.adsOff')));
    function metric(label, value) { return h('div', {class:'health-stat'}, h('dt',null,label), h('dd',null,value == null ? na() : value)); }
    if (peek) return [h('div',{class:'health-peek'},
      h('div',{class:'health-heading'},h('span',null,H.model ? H.model.split('.')[0] : t('sec.health')),h('span',{class:'health-system'},H.webos ? 'webOS ' + H.webos : ''),h('div',{class:'badges'},badges)),
      h('dl',{class:'health-stats'},
        metric(t('h.panelHours'),H.panelHours == null ? null : fmtNum(H.panelHours,1) + ' h'),
        metric(t('h.uptime'),H.uptimeSeconds == null ? null : fmtUptime(H.uptimeSeconds)),
        metric(t('h.available'),H.memoryAvailableMB == null ? null : fmtNum(H.memoryAvailableMB,0) + ' MiB'),
        metric(t('h.fw'),H.firmware))),h('p',{class:'w__hint'},t('glance.ok'))];
    return [h('div', {class:'health-heading'}, h('span',null,H.model ? H.model.split('.')[0] : t('sec.health')), h('span',{class:'health-system'},H.webos ? 'webOS ' + H.webos : '')),
      h('dl', {class:'health-stats'},
        metric(t('h.panelHours'),H.panelHours == null ? null : fmtNum(H.panelHours,1) + ' h'),
        metric(t('h.uptime'),H.uptimeSeconds == null ? null : fmtUptime(H.uptimeSeconds))),
      h('dl', {class:'kvs health-readings'},
        row(t('h.fw'),H.firmware),
        row(t('h.available'),H.memoryAvailableMB == null ? null : fmtNum(H.memoryAvailableMB,0) + ' / ' + fmtNum(H.memoryTotalMB,0) + ' MiB'),
        row(t('h.cached'),H.memoryCachedMB == null ? null : fmtNum(H.memoryCachedMB,0) + ' MiB')),
      h('p',{class:'health-note'},t('h.memoryNote')),
      badges.length ? h('div', {class:'badges'},badges) : null];
  }

  function wHealth() {
    var label = t('sec.health');
    var hl = state.data && state.data.health, pv = state.data && state.data.privacy;
    if (!state.data || Bridge.mode === 'none') return naGlance('health', 'chip', label, 'open-settings', 'about');
    var H = hl || {};
    var allMissing = ['temperature', 'memoryUsedPercent', 'uptimeSeconds', 'model', 'firmware'].every(function (k) { return H[k] === null || H[k] === undefined; })
      && (!pv || (pv.summary === null && pv.trackingOff === null && pv.adBlocking === null));
    if (allMissing) return glance('health', { icon: 'chip', label: label, value: na(t('na')), tone: 'na', more: h('p', null, t('na.field')), action: 'open-settings', arg: 'about' });
    var temp = H.temperature, mem = H.memoryUsedPercent;
    var readings = h('span',{class:'health-face'},
      h('span',{class:'health-face__reading'}, h('span',{class:'health-face__label'},t('h.temp')), h('span',null,temp == null ? na() : [h('strong',null,fmtNum(temp,0)),h('small',null,' °C') ])),
      h('span',{class:'health-face__reading'}, h('span',{class:'health-face__label'},t('h.memShort')), h('span',null,mem == null ? na() : [h('strong',null,fmtNum(mem,0)),h('small',null,' %') ])));
    var sub = H.memoryAvailableMB == null ? null : t('h.availableShort',{n:fmtNum(H.memoryAvailableMB,0)});
    return glance('health', {icon:'chip',label:label,value:readings,sub:sub,more:healthDetails(H,pv,true),okHint:false,action:'open-settings',arg:'about'});
  }

  function wSmartHome() {
    var sh = state.data && state.data.smartHome;
    var label = t('sec.smartHome');
    if (!sh && (Bridge.mode === 'none' || !state.data)) return naGlance('smartHome', 'plug', label, 'open-settings', 'widgets');
    if (!sh || !sh.configured) return glance('smartHome', { icon: 'plug', label: label, value: t('sh.setup.title'), tone: 'quiet', more: h('p', null, t('sh.setup.text')), action: 'open-settings', arg: 'widgets' });
    if (!sh.devices.length) return glance('smartHome', { icon: 'plug', label: label, value: t('sh.empty'), action: 'open-settings', arg: 'widgets' });
    var first = sh.devices[0];
    return glance('smartHome', { icon: 'plug', label: label, value: first.name, sub: first.state || null,
      more: sh.devices.length > 1 ? h('dl', { class: 'kvs' }, sh.devices.slice(1, 6).map(function (d) { return h('div', { class: 'kv' }, h('dt', null, d.name), h('dd', null, d.state || '—')); })) : null,
      action: 'open-settings', arg: 'widgets' });
  }

  // The widget is already labelled "Inputs": "HDMI 2" shows as "2", custom names stay short.
  function shortInput(title) {
    var m = /^HDMI\s*(\d+)$/i.exec(title);
    return m ? m[1] : clip(title, 8);
  }
  function wInputs() {
    var label = t('sec.inputs');
    var list = state.data && state.data.inputs;
    if (!list) return naGlance('inputs', 'input', label);
    if (!list.length) return glance('inputs', { icon: 'input', label: label, value: t('in.empty'), tone: 'quiet' });
    return glance('inputs', { icon: 'input', label: label,
      body: h('span', { class: 'chips chips--inputs' }, list.slice(0, 4).map(function (inp) {
        var sig = inp.connected === true ? ', ' + t('in.connected') : inp.connected === false ? ', ' + t('in.idle') : '';
        return h('button', { class: 'chip chip--input', type: 'button', 'data-action': 'launch-id', 'data-arg': inp.id, 'data-label': inp.title, 'data-fid': 'in:' + inp.id, 'aria-label': t('in.open', { title: inp.title }) + sig },
          inp.connected === true ? h('span', { class: 'dot dot--ok', 'aria-hidden': 'true' }) : null, shortInput(inp.title));
      })) });
  }

  var SHELF = [
    { key: 'weather', render: wWeather }, { key: 'calendar', render: wCalendar },
    { key: 'sleep', render: wSleep }, { key: 'health', render: wHealth }, { key: 'smartHome', render: wSmartHome },
    { key: 'inputs', render: wInputs }
  ];
  function renderShelf() {
    var el = $('shelf');
    var now = new Date();
    var cols = SHELF.filter(function (c) { return prefs.widgets[c.key]; });
    el.hidden = !cols.length;
    el.setAttribute('aria-label', t('sec.glance'));
    el.setAttribute('data-count', String(cols.length));
    patch(el, cols.map(function (c) { return c.render(now); }));
  }

  /* ======================================================================
     Settings sheet
     ====================================================================== */
  var SECTIONS = [
    { key: 'apps', icon: 'grid' }, { key: 'widgets', icon: 'widgets' }, { key: 'appearance', icon: 'palette' },
    { key: 'language', icon: 'globe' }, { key: 'weather', icon: 'sun' }, { key: 'calendar', icon: 'calendar' },
    { key: 'backup', icon: 'archive' }, { key: 'about', icon: 'info' }
  ];
  var ui = {
    settingsOpen: false, section: 'apps', returnFid: null,
    wxDraft: null, wxErrors: {}, exportShown: false, includeWx: true,
    importText: '', importReport: null, resetArmed: false, resetTimer: null,
    hints: {} // setup directions returned by the bridge (e.g. configureWeather/openEditor)
  };

  function seg(group, options, current, fidPrefix, disabled) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': group },
      options.map(function (o) {
        return h('button', { class: 'seg__b', type: 'button', 'data-action': o.action, 'data-arg': o.arg, 'data-fid': fidPrefix + ':' + o.arg, 'aria-pressed': String(o.arg === current), disabled: !!disabled },
          o.icon ? icon(o.icon) : null, o.label);
      }));
  }
  function sw(action, arg, on, label, fid) {
    return [h('span', { class: 'switch__label', 'aria-hidden': 'true' }, on ? t('set.ap.on') : t('set.ap.off')),
      h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, 'data-action': action, 'data-arg': arg, 'data-fid': fid })];
  }
  function srow(label, desc, ctl, dim) {
    return h('div', { class: 'srow' + (dim ? ' srow--dim' : '') },
      h('div', null, h('div', { class: 'srow__label' }, label), desc ? h('div', { class: 'srow__desc' }, desc) : null),
      h('div', { class: 'srow__ctl' }, ctl));
  }
  function head(key) {
    return h('div', { class: 'sheet__head' }, h('h1', { class: 'sheet__title', id: 'sheet-title' }, t('set.nav.' + key)),
      h('p', { class: 'sheet__lede' }, t({ apps: 'set.apps.lede', widgets: 'set.w.lede', appearance: 'set.ap.lede', language: 'set.lang.lede', weather: 'set.wx.lede', calendar: 'set.cal.lede', backup: 'set.bk.lede', about: 'set.ab.lede' }[key])));
  }

  function secApps() {
    var order = prefs.apps.order;
    var rows = order.map(function (key, i) {
      var app = resolveApp(key);
      var hidden = prefs.apps.hidden.indexOf(key) >= 0;
      var sub = app.onTv === true ? t('app.onTv') : app.onTv === false ? t('app.notReportedLong') : t('app.unknown');
      return h('div', { class: 'approw' + (hidden ? ' approw--hidden' : '') },
        h('span', { class: 'approw__art' + (app.icon ? ' approw__art--icon' : ''), 'aria-hidden': 'true', style: artFor(app).vars }, app.icon ? h('img', { src: app.icon, alt: '' }) : app.mono),
        h('div', null, h('div', { class: 'approw__t' }, app.title), h('div', { class: 'approw__s' }, (hidden ? t('set.apps.hidden') + ' · ' : '') + sub)),
        h('div', { class: 'approw__ctl' },
          sw('app-toggle', key, !hidden, t('set.apps.showAria', { title: app.title }), 'ap-show:' + key),
          h('button', { class: 'btn btn--sq f', type: 'button', 'data-action': 'app-move', 'data-arg': key + '|-1', 'data-fid': 'ap-up:' + key, 'data-fid-alt': 'ap-down:' + key, 'aria-label': t('set.apps.up', { title: app.title }), disabled: i === 0 }, icon('up')),
          h('button', { class: 'btn btn--sq f', type: 'button', 'data-action': 'app-move', 'data-arg': key + '|1', 'data-fid': 'ap-down:' + key, 'data-fid-alt': 'ap-up:' + key, 'aria-label': t('set.apps.down', { title: app.title }), disabled: i === order.length - 1 }, icon('down')),
          app.builtin ? null : h('button', { class: 'btn btn--sq f', type: 'button', 'data-action': 'app-remove', 'data-arg': key, 'data-fid': 'ap-rm:' + key, 'aria-label': t('set.apps.remove', { title: app.title }) }, icon('x'))));
    });
    var tvApps = state.data && state.data.apps;
    var extra = null;
    if (!tvApps) extra = h('p', { class: 'note' }, t('set.apps.addNa'));
    else {
      var used = {};
      order.forEach(function (k) { var r = resolveApp(k); if (r.onTv) used[r.launchId] = 1; });
      var candidates = tvApps.filter(function (a) { return !used[a.id] && order.indexOf('app:' + a.id) < 0 && APP_ID_RE.test(a.id); })
        .sort(function (a, b) { return a.title.localeCompare(b.title); }).slice(0, 40);
      extra = candidates.length ? h('div', { class: 'addlist' }, candidates.map(function (a) {
        return h('button', { class: 'btn f', type: 'button', 'data-action': 'app-add', 'data-arg': a.id, 'data-fid': 'ap-add:' + a.id, 'aria-label': t('set.apps.addAria', { title: a.title }) }, icon('plus'), a.title);
      })) : h('p', { class: 'note' }, t('set.apps.addNone'));
    }
    return [head('apps'), srow(t('set.apps.sort'), null, seg(t('set.apps.sort'), [{label:t('set.apps.recent'),arg:'recent',action:'app-sort'},{label:t('set.apps.manual'),arg:'manual',action:'app-sort'}],prefs.apps.sort,'app-sort')), h('h2', { class: 'subhead' }, t('set.apps.order')), rows,
      h('h2', { class: 'subhead' }, t('set.apps.add')), extra,
      h('div', { class: 'formrow' }, h('button', { class: 'btn f', type: 'button', 'data-action': 'apps-reset', 'data-fid': 'ap-reset' }, icon('refresh'), t('set.apps.reset')))];
  }

  function secWidgets() {
    return [head('widgets')].concat(WIDGETS.map(function (k) {
      return srow(t('set.w.' + k), t('set.w.' + k + '.d'), sw('widget-toggle', k, prefs.widgets[k], t('set.w.' + k), 'w:' + k));
    }));
  }

  function stepper(field, label) {
    return h('div', { class: 'stepper' },
      h('button', { class: 'btn btn--sq f', type: 'button', 'data-action': 'hour-step', 'data-arg': field + '|-15', 'data-fid': 'hs:' + field + ':-', 'aria-label': t('set.ap.stepEarlier', { what: label }) }, icon('down')),
      h('span', { class: 'stepper__v', 'aria-live': 'polite' }, prefs.theme[field]),
      h('button', { class: 'btn btn--sq f', type: 'button', 'data-action': 'hour-step', 'data-arg': field + '|15', 'data-fid': 'hs:' + field + ':+', 'aria-label': t('set.ap.stepLater', { what: label }) }, icon('up')));
  }
  /* A miniature of each style, drawn in CSS from the live theme tokens. */
  function styleMini(key) {
    var cards = [0, 1, 2, 3, 4].map(function (i) { return h('i', { class: 'mini__card mini__card--' + i }); });
    var wid = [0, 1, 2, 3].map(function () { return h('i', { class: 'mini__w' }); });
    return h('span', { class: 'mini mini--' + key, 'aria-hidden': 'true' },
      h('i', { class: 'mini__glow' }), h('i', { class: 'mini__top' }),
      h('span', { class: 'mini__cards' }, cards), h('span', { class: 'mini__shelf' }, wid));
  }
  function secAppearance() {
    var auto = prefs.theme.mode === 'auto';
    var sched = auto && prefs.theme.autoSource !== 'system';
    return [head('appearance'),
      h('h2', { class: 'subhead' }, t('set.ap.style')),
      h('div', { class: 'styles', role: 'group', 'aria-label': t('set.ap.style') }, STYLES.map(function (k) {
        return h('button', { class: 'stylepick', type: 'button', 'data-action': 'style-set', 'data-arg': k, 'data-fid': 'style:' + k, 'aria-pressed': String(prefs.style === k), 'aria-describedby': 'style-d-' + k },
          styleMini(k),
          h('span', { class: 'stylepick__t' }, prefs.style === k ? icon('check') : null, t('style.' + k)),
          h('span', { class: 'stylepick__d', id: 'style-d-' + k }, t('style.' + k + '.d')));
      })),
      h('h2', { class: 'subhead' }, t('set.ap.themeHead')),
      srow(t('set.ap.mode'), t('set.ap.mode.d') + ' ' + themeCaption() + '.', seg(t('set.ap.mode'), [
        { action: 'theme-mode', arg: 'day', label: t('theme.day'), icon: 'sun' },
        { action: 'theme-mode', arg: 'night', label: t('theme.night'), icon: 'moon' },
        { action: 'theme-mode', arg: 'auto', label: t('theme.auto'), icon: 'auto' }], prefs.theme.mode, 'tm')),
      srow(t('set.ap.source'), t('set.ap.source.d'), seg(t('set.ap.source'), [
        { action: 'theme-source', arg: 'sun', label: t('set.ap.sun') },
        { action: 'theme-source', arg: 'schedule', label: t('set.ap.schedule') },
        { action: 'theme-source', arg: 'system', label: t('set.ap.system') }], prefs.theme.autoSource, 'ts', !auto), !auto),
      srow(t('set.ap.dayStart'), null, stepper('dayStart', t('set.ap.dayStart')), !sched),
      srow(t('set.ap.nightStart'), null, stepper('nightStart', t('set.ap.nightStart')), !sched),
      h('h2', { class: 'subhead' }, t('set.ap.screen')),
      srow(t('set.ap.idle'), t('set.ap.idle.d'), seg(t('set.ap.idle'), IDLE_CHOICES.map(function (n) {
        return { action: 'idle-set', arg: String(n), label: n ? n + ' ' + t('u.min') : t('set.ap.idleOff') };
      }), String(prefs.idleDimMinutes), 'idle')),
      srow(t('set.ap.shift'), t('set.ap.shift.d'), sw('shift-toggle', 'x', prefs.pixelShift, t('set.ap.shift'), 'shift')),
      srow(t('set.ap.motion'), t('set.ap.motion.d'), seg(t('set.ap.motion'), [
        { action: 'motion-set', arg: 'system', label: t('set.ap.motionSystem') },
        { action: 'motion-set', arg: 'reduced', label: t('set.ap.motionReduced') }], prefs.motion, 'mo'))];
  }

  var localeDraft=null,languageError=null;
  function languageBase(pack) {
    var base=Object.assign({},STRINGS.en),weather=window.OwnTVWeather&&OwnTVWeather.strings||{};
    Object.keys(weather).forEach(function(k){base['weather:'+k]=weather[k];});
    Object.keys(pack&&pack.strings||{}).forEach(function(k){if(k.indexOf('text:')===0)base[k]=k.slice(5);});
    return base;
  }
  function useLanguagePack(text) {
    try{var pack=OwnTVI18n.validatePack(JSON.parse(text),languageBase(JSON.parse(text)));prefs.languagePack=pack;prefs.language=pack.locale;localeDraft=null;languageError=null;commit();}
    catch(e){languageError=e.message;renderSettings();}
  }
  function secLanguage() {
    var pack=prefs.languagePack,primary=prefs.language.split('-')[0],isBuiltIn=primary==='en'||primary==='de';
    var count=OwnTVI18n.matches(pack,prefs.language)?Object.keys(pack.strings).length:0;
    return [head('language'),
      srow(t('set.lang.lang'),null,seg(t('set.lang.lang'),[
        {action:'lang-set',arg:'en',label:'English'},{action:'lang-set',arg:'de',label:'Deutsch'}].concat(pack?[{action:'lang-set',arg:pack.locale,label:pack.name}]:[]),prefs.language,'lang')),
      h('div',{class:'locale-picker'},h('label',{class:'field'},h('span',null,calText('Any language or regional locale','Beliebige Sprache oder Region')),h('input',{type:'text',maxlength:'64',dir:'ltr',value:localeDraft===null?prefs.language:localeDraft,'data-input':'locale','data-fid':'locale',placeholder:'fr-CA, es, ja, ar, zh-Hant…',autocomplete:'off',spellcheck:'false'})),h('button',{class:'btn f',type:'button','data-action':'locale-apply','data-fid':'locale-apply'},calText('Apply locale','Sprache anwenden'))),
      h('p',{class:'note',role:'status'},isBuiltIn?calText('Built-in interface translation. Regional date, time and number formats follow your locale.','Integrierte Übersetzung. Datum, Uhrzeit und Zahlen folgen der gewählten Region.'):calText('Offline pack entries: ','Einträge im Offline-Sprachpaket: ')+count+'. '+calText('Missing translations use English. Date, time and number formats follow your locale.','Fehlende Übersetzungen verwenden Englisch. Datum, Uhrzeit und Zahlen folgen der gewählten Sprache.')),
      h('div',{class:'formrow'},IS_WEBOS?h('p',{class:'note'},calText('Install language packs from the computer editor → Settings → Language.','Installiere Sprachpakete im Computer-Editor → Einstellungen → Sprache.')):h('label',{class:'btn filepick'},icon('upload'),calText('Install language pack','Sprachpaket installieren'),h('input',{type:'file',accept:'application/json,.json','data-input':'language-file','data-fid':'language-file','aria-label':calText('Install language pack','Sprachpaket installieren')})),pack?h('button',{class:'btn f',type:'button','data-action':'language-remove','data-fid':'language-remove'},calText('Remove pack','Sprachpaket entfernen')):null),
      h('p',{class:'note'},calText('Choose any BCP 47 locale. Packs are local JSON text files; nothing is sent to a translation service. See docs/LANGUAGES.md in the repository to create or contribute one.','Wähle ein beliebiges BCP-47-Sprachkürzel. Pakete sind lokale JSON-Textdateien; nichts wird an einen Übersetzungsdienst gesendet. Die Anleitung steht im Repository unter docs/LANGUAGES.md.')),
      languageError?h('p',{class:'callout callout--bad',role:'alert'},languageError):null,
      srow(t('set.lang.name'),t('set.lang.name.d'),h('div',{class:'field'},h('input',{id:'f-name',type:'text',maxlength:'24',autocomplete:'off',spellcheck:'false','data-input':'name','data-fid':'f-name',placeholder:t('set.lang.namePh'),'aria-label':t('set.lang.name'),value:prefs.name})))];
  }

  var wxSearch = {busy:false,places:[],error:null}, wxCoordinates=false;
  function secWeather() {
    var wx = state.data && state.data.weather;
    var d = ui.wxDraft || { label: prefs.weather.label, lat: prefs.weather.latitude === null ? '' : String(prefs.weather.latitude), lon: prefs.weather.longitude === null ? '' : String(prefs.weather.longitude) };
    ui.wxDraft = d;
    var e = ui.wxErrors;
    var status = !wx ? t('set.wx.st.na') : wx.configured ? (wx.city ? t('set.wx.st.on', { city: wx.city }) : t('set.wx.st.onNoCity')) : t('set.wx.st.off');
    function field(id, key, label, hint, mode, max) {
      return h('div', { class: 'field' },
        h('label', { for: id }, label + (hint ? ' (' + hint + ')' : '')),
        h('input', { id: id, type: 'text', inputmode: mode || 'text', maxlength: String(max), autocomplete: 'off', spellcheck: 'false', 'data-input': 'wx-' + key, 'data-fid': id, value: d[key], 'aria-invalid': e[key] ? 'true' : null, 'aria-describedby': e[key] ? id + '-err' : null }));
    }
    var errs = Object.keys(e).filter(function (k) { return e[k]; });
    return [head('weather'),
      srow(t('set.wx.status'), null, h('span', { class: 'note' }, h('span', { class: 'dot ' + (wx && wx.configured ? 'dot--ok' : '') , style: { display: 'inline-block', 'margin-right': '0.6rem' } }), status)),
      h('div', {class:'weather-search'},
        field('f-wx-label','label',t('set.wx.city'),null,'text',40),
        h('button',{class:'btn f',type:'button','data-action':'wx-search','data-fid':'wx-search',disabled:wxSearch.busy||!Bridge.has('searchWeather')},t(wxSearch.busy?'set.wx.searching':'set.wx.search'))),
      wxSearch.error ? h('p',{class:'note',role:'status'},wxSearch.error) : null,
      wxSearch.places.length ? h('div',{class:'weather-results'},wxSearch.places.map(function(p,i){return h('button',{class:'place f',type:'button','data-action':'wx-place','data-arg':String(i),'data-fid':'wx-place:'+i},h('strong',null,p.label),h('span',null,p.region));})) : null,
      h('div',{class:'formrow weather-coordinates-toggle'},h('button',{class:'btn f',type:'button','data-action':'wx-coordinates','data-fid':'wx-coordinates','aria-expanded':String(wxCoordinates)},t('set.wx.coordinates')),h('span',{class:'note'}, d.lat && d.lon ? d.lat + '°, ' + d.lon + '°' : t('set.wx.pick'))),
      wxCoordinates ? h('div', {class:'weather-coordinates'},
        field('f-wx-lat','lat',t('set.wx.lat'),null,'decimal',10),
        field('f-wx-lon','lon',t('set.wx.lon'),null,'decimal',11)) : null,
      errs.length ? h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert'), h('div', null, errs.map(function (k) { return h('p', { id: 'f-wx-' + k + '-err' }, e[k]); }))) : null,
      h('div', { class: 'formrow' },
        h('button', { class: 'btn btn--primary f', type: 'button', 'data-action': 'wx-save', 'data-fid': 'wx-save' }, icon('check'), t('set.wx.save')),
        h('button', { class: 'btn f', type: 'button', 'data-action': 'wx-clear', 'data-fid': 'wx-clear' }, icon('x'), t('set.wx.clear'))),
      Bridge.has('configureWeather') && !ui.hints.weather ? null : h('div', { class: 'callout callout--warn' }, icon('info'), h('div', null,
        h('div', { trustedHtml: t('set.wx.noApi') }),
        ui.hints.weather ? h('p', { style: { 'margin-top': '0.5rem' } }, h('strong', null, t('set.hint.bridgeSays') + ' '), ui.hints.weather) : null)),
      h('p', { class: 'note', style: { 'margin-top': '1rem' } }, t('set.wx.how'))];
  }

  var calPanel='agenda', calPage=0, calSearch='', calQuery='', calCatalog=null, calBusy=false, calError=null;
  function calText(en,de) { return OwnTVI18n.translate(prefs.languagePack,prefs.language,'text:'+en,prefs.language.split('-')[0]==='de'?de:en); }
  function calendarPages(count,size) {
    var pages=Math.max(1,Math.ceil(count/size));calPage=Math.min(calPage,pages-1);
    return pages>1?h('div',{class:'formrow calendar-pages'},
      h('button',{class:'btn f',type:'button','data-action':'cal-page','data-arg':'-1','data-fid':'cal-prev',disabled:calPage===0},calText('Previous','Zurück')),
      h('span',{class:'note'},(calPage+1)+' / '+pages),
      h('button',{class:'btn f',type:'button','data-action':'cal-page','data-arg':'1','data-fid':'cal-next',disabled:calPage===pages-1},calText('Next','Weiter'))):null;
  }
  function loadCalendarCatalog() {
    if(calBusy||!Bridge.has('getCalendarCatalog'))return;
    calBusy=true;calError=null;renderSettings();
    Bridge.call('getCalendarCatalog').then(function(r){calCatalog=r;},function(e){calError=errText(e);}).then(function(){calBusy=false;renderSettings();});
  }
  function changeCalendarSource(value) {
    if(calBusy||!Bridge.has('setCalendarSource'))return;
    calBusy=true;calError=null;renderSettings();
    Bridge.call('setCalendarSource',[value]).then(function(){
      var affected=value.publicId||(state.data&&state.data.calendar&&state.data.calendar.sources||[]).filter(function(s){return s.id===value.id;}).map(function(s){return s.catalogId;})[0];
      if(calCatalog&&affected)calCatalog.calendars.forEach(function(c){if(c.id===affected)c.selected=value.enabled;});
      return refresh(false);
    },function(e){calError=errText(e);}).then(function(){calBusy=false;renderSettings();});
  }
  function secCalendar() {
    var cal=state.data&&state.data.calendar,sources=cal&&cal.sources||[],now=new Date(),body=[],size=calPanel==='agenda'?6:4;
    var events=cal&&cal.events.filter(function(e){return e.end>now;})||[];
    if(calPanel==='agenda') {
      var paging=calendarPages(events.length,size);
      body.push(h('p',{class:'note'},calText('The next 14 days · enabled calendars only','Die nächsten 14 Tage · nur eingeschaltete Kalender')));
      if(events.length)body.push(h('div',{class:'calendar-agenda'},events.slice(calPage*size,(calPage+1)*size).map(function(e){return h('div',{class:'calendar-event'},h('div',{class:'calendar-event__date'},fmtDate(e.start<now?now:e.start,{weekday:'short',day:'numeric',month:'short'}),h('span',null,e.allDay?t('cal.allDay'):fmtTime(e.start)+' – '+fmtTime(e.end))),h('div',null,h('strong',null,e.title),h('small',null,e.calendar)));})));
      else body.push(h('p',{class:'calendar-empty'},cal&&cal.configured?t('cal.empty'):t('cal.setup.text')));
      body.push(paging);
      if(cal&&cal.partial)body.push(h('p',{class:'note',role:'status'},calText('Some calendars are unavailable. Your other calendars are still shown.','Einige Kalender sind nicht erreichbar. Die anderen werden weiterhin angezeigt.')));
    } else if(calPanel==='sources') {
      var sourcePages=calendarPages(sources.length,size);
      body.push(h('p',{class:'note'},calText('Switch off a calendar to hide its events and stop fetching it. Your connection stays saved.','Ausgeschaltete Kalender werden ausgeblendet und nicht abgerufen. Die Verbindung bleibt gespeichert.')));
      body.push(sources.map(function(source,i){if(i<calPage*size||i>=(calPage+1)*size)return null;return srow(source.name,!source.enabled?calText('Hidden','Ausgeblendet'):source.connected?calText('Connected','Verbunden'):calText('Temporarily unavailable','Vorübergehend nicht erreichbar'),sw('cal-toggle',source.id,source.enabled,source.name,'cal-source:'+source.id));}));
      if(!sources.length)body.push(h('p',{class:'note'},calText('No calendars connected yet. Add public holidays or connect a private subscription from your computer.','Noch keine Kalender verbunden. Füge Feiertage hinzu oder verbinde ein privates Abonnement am Computer.')));
      body.push(sourcePages,h('p',{class:'note'},cal&&cal.busyOnly===false?calText('Event titles and times are shown.','Termintitel und Zeiten werden angezeigt.'):calText('Only busy times are shown for private calendars.','Private Kalender zeigen nur Belegt-Zeiten.')));
      body.push(Bridge.has('openEditor')?h('button',{class:'btn f',type:'button','data-action':'open-editor','data-fid':'cal-editor'},icon('sliders'),t('set.cal.editor')):h('p',{class:'note'},t('set.cal.noEditor')));
    } else {
      body.push(h('label',{class:'field'},h('span',null,calText('Find a country or language','Land oder Sprache suchen')),h('input',{type:'search',maxlength:'60',value:calSearch,'data-input':'cal-search','data-fid':'cal-search',placeholder:calText('Search public holidays','Feiertage suchen')})),h('button',{class:'btn f',type:'button','data-action':'cal-find','data-fid':'cal-find'},calText('Search','Suchen')));
      if(calCatalog&&Array.isArray(calCatalog.calendars)) {
        var matches=calCatalog.calendars.filter(function(c){return c.name.toLowerCase().indexOf(calQuery.toLowerCase())>=0;}),publicPages=calendarPages(matches.length,size);
        body.push(h('p',{class:'note'},calCatalog.calendars.length+' '+calText('calendars · Thunderbird ·','Kalender · Thunderbird ·')+' '+calCatalog.coverage));
        body.push(matches.slice(calPage*size,(calPage+1)*size).map(function(c){return srow(c.name,null,sw('cal-public',c.id,c.selected,c.name,'cal-public:'+c.id));}));
        if(!matches.length)body.push(h('p',{class:'note'},calText('No matching calendar. You can connect another HTTPS or webcal feed from the private editor.','Kein passender Kalender. Weitere HTTPS- oder webcal-Abonnements kannst du im privaten Editor verbinden.')));
        body.push(publicPages,h('p',{class:'note'},calText('Only selected calendars connect to the provider. Regional observances can differ; check important dates.','Nur ausgewählte Kalender verbinden sich mit dem Anbieter. Regionale Feiertage können abweichen; prüfe wichtige Termine.')));
      } else body.push(h('button',{class:'btn f',type:'button','data-action':'cal-catalog','data-fid':'cal-load',disabled:calBusy||!Bridge.has('getCalendarCatalog')},calBusy?calText('Loading…','Wird geladen…'):calText('Load public calendars','Öffentliche Kalender laden')));
    }
    return [head('calendar'),seg(calText('Calendar view','Kalenderansicht'),[
      {action:'cal-panel',arg:'agenda',label:calText('Agenda','Agenda')},{action:'cal-panel',arg:'sources',label:calText('My calendars','Meine Kalender')},{action:'cal-panel',arg:'public',label:calText('Public holidays','Feiertage')}],calPanel,'cal-panel'),
      h('div',{class:'calendar-panel','aria-busy':String(calBusy)},body),calError?h('p',{class:'callout callout--bad',role:'alert'},calError):null,
      ui.hints.editor?h('p',{class:'note',role:'status'},ui.hints.editor):null];
  }

  function exportPayload() {
    var p = JSON.parse(JSON.stringify(prefs));
    if (!ui.includeWx) p.weather = { label: '', latitude: null, longitude: null };
    return { kind: EXPORT_KIND, schema: 1, exportedAt: new Date().toISOString(), app: 'Own TV dashboard ' + VERSION, note: 'Display preferences only. Contains no links, tokens or keys.', preferences: p };
  }
  function secBackup() {
    var rep = ui.importReport;
    var repEl = null;
    if (rep) {
      if (rep.errors.length) repEl = h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert'), h('div', null, h('strong', null, t('set.bk.fail')), h('ul', null, rep.errors.concat(rep.warnings).map(function (m) { return h('li', null, m); }))));
      else repEl = h('div', { class: 'callout callout--ok', role: 'status' }, icon('check'), h('div', null, h('strong', null, rep.warnings.length ? t('set.bk.okNotes', { n: rep.warnings.length }) : t('set.bk.ok')),
        rep.warnings.length ? h('ul', null, rep.warnings.map(function (m) { return h('li', null, m); })) : null));
    }
    return [head('backup'),
      h('h2', { class: 'subhead' }, t('set.bk.export')),
      srow(t('set.bk.includeWx'), t('set.bk.includeWx.d'), sw('bk-wx', 'x', ui.includeWx, t('set.bk.includeWx'), 'bk-wx')),
      h('div', { class: 'formrow' },
        h('button', { class: 'btn btn--primary f', type: 'button', 'data-action': 'export-download', 'data-fid': 'bk-dl' }, icon('download'), t('set.bk.download')),
        h('button', { class: 'btn f', type: 'button', 'data-action': 'export-show', 'data-fid': 'bk-show', 'aria-expanded': String(ui.exportShown) }, icon('archive'), t('set.bk.show'))),
      ui.exportShown ? h('textarea', { class: 'json', readonly: true, 'aria-label': t('set.bk.export'), 'data-fid': 'bk-json' }, JSON.stringify(exportPayload(), null, 2)) : null,
      h('h2', { class: 'subhead' }, t('set.bk.import')),
      h('p', { class: 'note' }, t('set.bk.importLede')),
      h('div', { class: 'formrow' },
        h('label', { class: 'btn filepick' }, icon('upload'), t('set.bk.choose'),
          h('input', { type: 'file', accept: 'application/json,.json', 'data-input': 'import-file', 'data-fid': 'bk-file', 'aria-label': t('set.bk.choose') }))),
      h('textarea', { class: 'json', 'data-input': 'import-text', 'data-fid': 'bk-paste', placeholder: t('set.bk.pastePh'), 'aria-label': t('set.bk.pastePh'), spellcheck: 'false' }, ui.importText),
      h('div', { class: 'formrow' }, h('button', { class: 'btn btn--primary f', type: 'button', 'data-action': 'import-apply', 'data-fid': 'bk-apply' }, icon('check'), t('set.bk.apply'))),
      repEl,
      h('h2', { class: 'subhead' }, t('set.bk.resetZone')),
      h('div', { class: 'formrow' }, h('button', { class: 'btn btn--danger f', type: 'button', 'data-action': 'prefs-reset', 'data-fid': 'bk-reset' }, icon('refresh'), ui.resetArmed ? t('set.bk.resetConfirm') : t('set.bk.reset')))];
  }

  var firmwareReply = null, firmwareBusy = false, releasingIdle = false, memoryBusy=false, aboutDetails=false;
  function secAbout() {
    var H=state.data&&state.data.health||{},pv=state.data&&state.data.privacy,cal=state.data&&state.data.calendar,wx=state.data&&state.data.weather;
    var count=cal&&cal.sources?cal.sources.filter(function(s){return s.enabled;}).length:0;
    var fwText=firmwareReply?t(firmwareReply.catalogueReachable===false?'fw.offline':firmwareReply.eligible?'fw.report':'fw.unknown'):t('fw.description');
    return [head('about'),
      h('div',{class:'about-identity'},h('strong',null,'own/tv'),h('span',{class:'note'},'v'+VERSION+' · '+calText('Open source · MIT','Open Source · MIT'))),
      h('p',{class:'about-copy'},calText('An independent home screen for LG webOS. Your apps up front, an atmosphere that follows your day, and useful details close by. Make it yours in Settings.','Ein unabhängiger Startbildschirm für LG webOS. Deine Apps im Mittelpunkt, eine Atmosphäre passend zum Tag und nützliche Details in Reichweite. Passe ihn in den Einstellungen an.')),
      h('h2',{class:'subhead'},calText('Your data stays yours','Deine Daten bleiben deine')),
      h('p',{class:'note'},calText('No Own TV account, advertising or analytics. Preferences and subscription links are stored on your TV. Calendar access is read-only; passwords are never needed. Appearance exports exclude calendar links and events.','Kein Own-TV-Konto, keine Werbung und keine Analyse. Einstellungen und Abonnement-Links bleiben auf deinem Fernseher. Kalenderzugriff ist nur lesend und benötigt kein Passwort. Design-Exporte enthalten keine Kalender-Links oder Termine.')),
      h('p',{class:'note'},calText('When enabled, weather and calendar providers receive the requests needed for those features. Your selected weather location is sent to Open-Meteo. Streaming apps and LG services have their own privacy settings.','Aktivierte Wetter- und Kalenderanbieter erhalten die für diese Funktionen nötigen Anfragen. Dein gewählter Wetterort wird an Open-Meteo gesendet. Streaming-Apps und LG-Dienste haben eigene Datenschutzeinstellungen.')),
      h('h2',{class:'subhead'},calText('Connected here','Hier verbunden')),
      srow(calText('Dashboard','Dashboard'),null,h('span',{class:'note'},Bridge.mode==='live'?calText('Connected to TV','Mit Fernseher verbunden'):Bridge.mode==='preview'?calText('Sample preview','Beispielvorschau'):calText('Not connected','Nicht verbunden'))),
      srow(t('set.nav.weather'),null,h('span',{class:'note'},wx&&wx.configured?wx.city||calText('Enabled','Aktiv'):calText('Off','Aus'))),
      srow(t('set.nav.calendar'),null,h('span',{class:'note'},count+' '+calText('calendars enabled','Kalender aktiv'))),
      h('button',{class:'btn f',type:'button','data-action':'about-details','data-fid':'about-details','aria-expanded':String(aboutDetails)},calText('TV & system details','TV- und Systemdetails')),
      aboutDetails?h('div',{class:'about-system'},healthDetails(H, pv), H.idleReleaseSupported ? srow(t('h.memoryMode'),t('h.memoryModeNote'),sw('memory-mode','mode',H.lowMemoryMode,t('h.memoryMode'),'memory-mode')) : null, H.idleReleaseSupported ? h('div',{class:'formrow'}, h('button',{class:'btn f',type:'button','data-action':'release-idle','data-fid':'release-idle',disabled:releasingIdle || !Bridge.has('releaseIdleApps')},t(releasingIdle ? 'h.releasing' : 'h.release'))) : null, H.idleReleaseSupported ? h('p',{class:'note'},t('h.releaseNote')) : null, h('div', {class:'formrow'}, h('button', {class:'btn f',type:'button','data-action':'check-firmware','data-fid':'fw-check',disabled:firmwareBusy || !Bridge.has('checkFirmware')}, firmwareBusy ? t('fw.checking') : t('fw.check'))), h('p',{class:'note',role:'status'},fwText),
        srow(t('set.ab.last'),null,h('span',{class:'note'},state.lastOk?fmtTime(new Date(state.lastOk)):t('set.ab.never'))),
        h('button',{class:'btn f',type:'button','data-action':'refresh','data-fid':'ab-refresh'},icon('refresh'),t('set.ab.refresh'))):null,
      h('h2',{class:'subhead'},t('set.ab.keys')),
      h('ul',{class:'steps'},['k1','k2','k3','k4','k6','k5'].map(function(k){return h('li',null,t('set.ab.'+k));})),
      h('h2',{class:'subhead'},calText('Built in the open','Offen entwickelt')),
      h('p',{class:'note'},'github.com/NoelHuibers/own-tv'),
      h('p',{class:'note'},calText('Weather: Open-Meteo · Radar: RainViewer · Map: Natural Earth · Calendar: ical.js · Holiday catalogue: Thunderbird.','Wetter: Open-Meteo · Radar: RainViewer · Karte: Natural Earth · Kalender: ical.js · Feiertagskatalog: Thunderbird.')),
      h('p',{class:'note'},calText('Independent of LG. TV controls require rooted webOS and Homebrew Channel. Firmware compatibility checks never install an update automatically.','Unabhängig von LG. TV-Steuerung benötigt gerootetes webOS und Homebrew Channel. Firmware-Kompatibilitätsprüfungen installieren niemals automatisch ein Update.'))];
  }

  function renderSettings() {
    var sheet = $('sheet');
    if (!ui.settingsOpen) { if (!sheet.hidden) { sheet.hidden = true; sheet.textContent = ''; } return; }
    sheet.hidden = false;
    var body = { apps: secApps, widgets: secWidgets, appearance: secAppearance, language: secLanguage, weather: secWeather, calendar: secCalendar, backup: secBackup, about: secAbout }[ui.section]();
    patch(sheet, [
      h('nav', { class: 'sheet__nav', 'aria-label': t('set.title'), 'data-nav-memory': 'settings-nav' },
        h('p', { class: 'sheet__brand' }, t('set.title')),
        SECTIONS.map(function (s) {
          return h('button', { class: 'navbtn', type: 'button', 'data-action': 'section', 'data-arg': s.key, 'data-fid': 'nav:' + s.key, 'aria-current': s.key === ui.section ? 'true' : null }, icon(s.icon), t('set.nav.' + s.key));
        }),
        h('div', { class: 'sheet__navfoot' },
          h('button', { class: 'btn f', type: 'button', 'data-action': 'close-settings', 'data-fid': 'nav:close' }, icon('back'), t('set.close')),
          h('p', { class: 'keyhint' }, t('set.keys')))),
      h('div', { class: 'sheet__body', id: 'sheet-body', 'data-section':ui.section }, body)
    ]);
  }

  var weatherView=null;
  function openWeather(){
    if(weatherView||!window.OwnTVWeather)return;
    if(ui.settingsOpen)closeSettings();
    clearTimeout(pollTimer);$('stage').inert=true;$('stage').setAttribute('aria-hidden','true');
    weatherView=OwnTVWeather.create({host:$('weather-app'),language:prefs.language,city:(state.data&&state.data.weather&&state.data.weather.city)||prefs.weather.label,preview:Bridge.mode==='preview',onTV:IS_WEBOS,translate:function(k,fallback){return OwnTVI18n.translate(prefs.languagePack,prefs.language,k,fallback);},call:function(m,args){return Bridge.call(m,args);},onInput:noteInput,onClose:closeWeather,onSetup:function(){closeWeather();openSettings('weather');}});
  }
  function closeWeather(){
    if(!weatherView)return;weatherView.close();weatherView=null;$('stage').inert=false;$('stage').removeAttribute('aria-hidden');
    var tile=findFid('w:weather');if(tile)tile.focus({preventScroll:true});refresh(false).then(schedulePoll);
  }
  function openSettings(section) {
    if(weatherView)closeWeather();
    if (!ui.settingsOpen) {
      var a = document.activeElement;
      ui.returnFid = a && a.getAttribute ? a.getAttribute('data-fid') : null;
    }
    ui.settingsOpen = true;
    if (section) ui.section = section;
    $('stage').setAttribute('aria-hidden', 'true');
    $('stage').inert = true;
    renderSettings();
    var target = findFid('nav:' + ui.section);
    if (target) target.focus({ preventScroll: true });
    var body = $('sheet-body'); if (body) body.scrollTop = 0;
  }
  function closeSettings() {
    ui.settingsOpen = false;
    ui.wxErrors = {};
    ui.importReport = null;
    $('stage').removeAttribute('aria-hidden');
    $('stage').inert = false;
    renderSettings();
    renderAll();
    var el = ui.returnFid && findFid(ui.returnFid);
    if (el && isFocusable(el)) el.focus({ preventScroll: true }); else focusDefault();
  }

  /* ======================================================================
     Render all
     ====================================================================== */
  function renderAll() {
    applyTheme();
    renderBanner();
    renderTop();
    renderApps();
    renderShelf();
    renderSettings();
    if (!document.activeElement || document.activeElement === document.body) focusDefault();
  }

  /* ======================================================================
     Toasts
     ====================================================================== */
  function toast(msg, kind) {
    kind = kind || 'info';
    var box = $('toasts');
    var el = h('div', { class: 'toast toast--' + kind, role: kind === 'error' ? 'alert' : 'status' },
      icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info'), h('span', null, msg));
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.classList.add('toast--out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
    }, kind === 'error' ? 6000 : 3800);
  }

  /* ======================================================================
     Spatial navigation (D-pad), Back, colour keys, Magic Remote pointer
     ====================================================================== */
  var FOCUSABLE = '[tabindex="0"], button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';
  function activeScope() { return weatherView ? $('weather-app') : ui.settingsOpen ? $('sheet') : $('stage'); }
  function isFocusable(el) {
    if (!el || !el.matches || !el.matches(FOCUSABLE)) return false;
    if (el.closest('[hidden]') || el.closest('[inert]')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function focusables(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll(FOCUSABLE), isFocusable);
  }
  function focusDefault() {
    var pref = ui.settingsOpen ? findFid('nav:' + ui.section) : (document.querySelector('#apps .card') || null);
    if (pref && isFocusable(pref)) { pref.focus({ preventScroll: true }); return; }
    var list = focusables(activeScope());
    if (list[0]) list[0].focus({ preventScroll: true });
  }
  function navScore(a, b, dir) {
    var acx = (a.left + a.right) / 2, acy = (a.top + a.bottom) / 2;
    var bcx = (b.left + b.right) / 2, bcy = (b.top + b.bottom) / 2;
    var primary, orth, overlap;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'right' ? bcx <= acx + 1 : bcx >= acx - 1) return null;
      primary = dir === 'right' ? b.left - a.right : a.left - b.right;
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      orth = Math.abs(bcy - acy);
      // Left/right stay on the same line: at the end of a row, nothing happens.
      // (Home only; in settings, Right from the section list must always reach the content.)
      if (!ui.settingsOpen && overlap <= 0 && orth > Math.max(a.height, b.height)) return null;
    } else {
      if (dir === 'down' ? bcy <= acy + 1 : bcy >= acy - 1) return null;
      primary = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      orth = Math.abs(bcx - acx);
    }
    primary = Math.max(0, primary);
    return overlap > 0 ? primary + orth * 0.3 : primary + 60 + orth * 2;
  }
  function navigate(dir) {
    var scope = activeScope();
    var cur = document.activeElement;
    var items = focusables(scope);
    if (!cur || cur === document.body || !scope.contains(cur)) { focusDefault(); return; }
    // Rail order and scroll positions must not depend on animated rectangles.
    if (cur.classList.contains('card') && (dir === 'left' || dir === 'right')) {
      var railCards = Array.prototype.slice.call(cur.closest('.cards').querySelectorAll('.card'));
      var nextCard = railCards[railCards.indexOf(cur) + (dir === 'right' ? 1 : -1)];
      if (nextCard) nextCard.focus({preventScroll:true});
      return;
    }
    var a = cur.getBoundingClientRect();
    var best = null, bestScore = Infinity;
    items.forEach(function (el) {
      if (el === cur) return;
      var s = navScore(a, el.getBoundingClientRect(), dir);
      if (s !== null && s < bestScore) { bestScore = s; best = el; }
    });
    if (!best) return;
    // Entering a remembered group (rail, settings nav) restores its last/current item.
    var group = best.closest('[data-nav-memory]');
    if (group && !group.contains(cur)) {
      var remembered = group.querySelector('[aria-current="true"]') || (group.__last && document.contains(group.__last) ? group.__last : null);
      if (remembered && isFocusable(remembered) && (group.getAttribute('data-nav-memory') === 'settings-nav' || dir === 'up' || dir === 'down')) best = remembered;
    }
    best.focus({ preventScroll: true });
    if (!best.classList.contains('card')) best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function revealCard(card) {
    var rail = card.closest('.cards');
    if (!rail || getComputedStyle(rail).overflowX !== 'auto') return;
    var item = card.parentElement;
    var gutter = parseFloat(getComputedStyle(rail).paddingLeft);
    // Offset coordinates describe the layout before focus zoom and include no scroll.
    var left = item.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
    var right = left + item.offsetWidth;
    var target = rail.scrollLeft;
    if (left - gutter < target) target = left - gutter;
    else if (right + gutter > target + rail.clientWidth) target = right + gutter - rail.clientWidth;
    rail.scrollLeft = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, target));
  }
  document.addEventListener('focusin', function (e) {
    var g = e.target.closest && e.target.closest('[data-nav-memory]');
    if (g) g.__last = e.target;
    if (e.target.classList && e.target.classList.contains('card')) revealCard(e.target);
    if (!ui.settingsOpen) refreshAtmo();
    // Settings sections follow focus, like the TV's own menus.
    if (ui.settingsOpen && !restoringFocus && e.target.getAttribute && e.target.getAttribute('data-action') === 'section') {
      var key = e.target.getAttribute('data-arg');
      if (key && key !== ui.section) handle('section', key, e.target);
    }
  });

  function isTextField(el) {
    return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)$/i.test(el.type || 'text')));
  }
  function caretAtEdge(el, dir) {
    try {
      if (el.selectionStart !== el.selectionEnd) return false;
      if (dir === 'left' || dir === 'up') return el.selectionStart === 0;
      return el.selectionEnd === el.value.length;
    } catch (e) { return true; }
  }

  function goBack() {
    if(weatherView){closeWeather();return;}
    if (ui.settingsOpen) {
      var a = document.activeElement;
      var body = $('sheet-body');
      if (a && body && body.contains(a)) { var nav = findFid('nav:' + ui.section); if (nav) { nav.focus({ preventScroll: true }); return; } }
      closeSettings();
      return;
    }
    var first = document.querySelector('#apps .card');
    if (first && document.activeElement !== first) { first.focus({ preventScroll: true }); return; }
    toast(t('toast.backHome'), 'info');
  }

  var KEY_DIR = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  document.addEventListener('keydown', function (e) {
    if (wakeFromIdle()) { e.preventDefault(); e.stopPropagation(); return; }
    var k = e.keyCode;
    if(weatherView && weatherView.key(e)){e.preventDefault();return;}
    var dir = KEY_DIR[k];
    var tgt = e.target;
    var typing = isTextField(tgt);
    if (dir) {
      if (typing) {
        if (tgt.tagName === 'TEXTAREA' && !caretAtEdge(tgt, dir)) return;
        if ((dir === 'left' || dir === 'right') && !caretAtEdge(tgt, dir)) return;
      }
      e.preventDefault();
      navigate(dir);
      return;
    }
    if (k === 461 || k === 27 || (k === 8 && !typing)) { e.preventDefault(); goBack(); return; }
    if (k === 405) { e.preventDefault(); cycleTheme(); return; }        // yellow
    if (k === 403) { e.preventDefault(); cycleStyle(); return; }        // red
    if (k === 406) { e.preventDefault(); if (ui.settingsOpen) closeSettings(); else openSettings(); return; } // blue
  }, true);

  // Magic Remote / mouse: hovering focuses, so pointer and D-pad share one focus.
  var pointerOn = false;
  document.addEventListener('mousemove', function () { pointerOn = true; noteInput(); }, { passive: true });
  document.addEventListener('cursorStateChange', function (e) { pointerOn = !!(e.detail && e.detail.visibility); });
  document.addEventListener('mouseover', function (e) {
    if (!pointerOn || idle) return;
    var el = e.target.closest && e.target.closest(FOCUSABLE);
    if (!el || !activeScope().contains(el) || el === document.activeElement) return;
    if (isTextField(document.activeElement)) return;
    if (isFocusable(el)) el.focus({ preventScroll: true });
  });
  document.addEventListener('wheel', noteInput, { passive: true });

  /* ======================================================================
     Click / input delegation
     ====================================================================== */
  document.addEventListener('mousedown', function (e) { if (idle) { wakeFromIdle(); e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    noteInput();
    handle(el.getAttribute('data-action'), el.getAttribute('data-arg'), el);
  });

  function handle(action, arg, el) {
    switch (action) {
      case 'cal-panel': calPanel=arg;calPage=0;renderSettings();if(arg==='public'&&!calCatalog)loadCalendarCatalog();break;
      case 'cal-catalog': loadCalendarCatalog();break;
      case 'cal-find': calQuery=calSearch.trim();calPage=0;renderSettings();break;
      case 'cal-page': calPage=Math.max(0,calPage+Number(arg));renderSettings();break;
      case 'cal-toggle':
        var source=(state.data&&state.data.calendar&&state.data.calendar.sources||[]).filter(function(s){return s.id===arg;})[0];
        if(source)changeCalendarSource({id:arg,enabled:!source.enabled});break;
      case 'cal-public':
        var publicCal=calCatalog&&calCatalog.calendars.filter(function(c){return c.id===arg;})[0];
        if(publicCal)changeCalendarSource({publicId:arg,enabled:!publicCal.selected});break;
      case 'about-details': aboutDetails=!aboutDetails;renderSettings();break;
      case 'memory-mode':
        if(memoryBusy)break;memoryBusy=true;
        act('setMemoryMode',[!(state.data&&state.data.health&&state.data.health.lowMemoryMode)],t('h.memoryMode'),function(r){if(state.data&&state.data.health)state.data.health.lowMemoryMode=r.enabled===true;renderSettings();}).then(function(){memoryBusy=false;refresh(true);});
        break;
      case 'release-idle':
        if (releasingIdle) break;
        releasingIdle = true; renderSettings();
        act('releaseIdleApps', [], t('h.release'), function(reply) { toast(t('h.released',{n:(reply.closed||[]).length}), 'ok'); }).then(function() { releasingIdle=false; refresh(true); renderSettings(); });
        break;
      case 'check-firmware':
        if (firmwareBusy) break;
        firmwareBusy = true; renderSettings();
        act('checkFirmware', [], t('fw.check'), function (reply) { firmwareReply = reply; }).then(function () { firmwareBusy = false; renderSettings(); });
        break;
      case 'launch': {
        var app = resolveApp(arg);
        launchApp(app, el);
        break;
      }
      case 'launch-id':
        act('launch', [arg], t('act.launch', { title: el.getAttribute('data-label') || arg }));
        break;
      case 'sleep': {
        var m = parseInt(arg, 10) || 0;
        act('setSleepTimer', [m], t('act.sleep'), function () {
          sleepLocal = m ? { endsAt: Date.now() + m * 60000 } : null;
          if (state.data && state.data.sleepTimer) state.data.sleepTimer = m ? { endsAt: Date.now() + m * 60000 } : { off: true };
          if (Bridge.mode !== 'preview') toast(m ? t('toast.sleepSet', { n: m }) : t('toast.sleepOff'), 'ok');
          renderShelf();
        });
        break;
      }
      case 'screen-off':
        act('screenOff', [], t('act.screenOff'), function () { if (Bridge.mode !== 'preview') toast(t('toast.screenOff'), 'info'); });
        break;
      case 'lg-home': act('openLgHome', [], t('act.lgHome')); break;
      case 'tv-settings': act('openSettings', [], t('act.tvSettings')); break;
      case 'refresh':
        if (Bridge.mode === 'none') { attachBridge() ? refresh(true) : toast(t('toast.noBridge', { action: t('act.refresh') }), 'error'); }
        else refresh(true);
        break;
      case 'theme-cycle': cycleTheme(); break;
      case 'open-weather': openWeather();break;
      case 'open-settings': openSettings(arg || null); break;
      case 'close-settings': closeSettings(); break;
      case 'section':
        ui.section = arg; ui.importReport = null; ui.wxErrors = {}; ui.exportShown = false;
        renderSettings();
        var b = $('sheet-body'); if (b) b.scrollTop = 0;
        break;

      case 'theme-mode': prefs.theme.mode = arg; commit(); break;
      case 'style-set': if (STYLES.indexOf(arg) >= 0) { prefs.style = arg; commit(); } break;
      case 'theme-source': prefs.theme.autoSource = arg; commit(); break;
      case 'hour-step': {
        var parts = arg.split('|'), field = parts[0], delta = parseInt(parts[1], 10);
        var other = field === 'dayStart' ? 'nightStart' : 'dayStart';
        var v = parseHM(prefs.theme[field]) + delta;
        v = ((v % 1440) + 1440) % 1440;
        if (v === parseHM(prefs.theme[other])) v = ((v + delta) % 1440 + 1440) % 1440;
        prefs.theme[field] = hm(v);
        commit();
        break;
      }
      case 'idle-set': prefs.idleDimMinutes = parseInt(arg, 10) || 0; commit(); break;
      case 'shift-toggle': prefs.pixelShift = !prefs.pixelShift; if (!prefs.pixelShift) $('stage').style.transform = ''; commit(); break;
      case 'motion-set': prefs.motion = arg; commit(); break;
      case 'lang-set': prefs.language=OwnTVI18n.locale(arg)||'en';localeDraft=null;languageError=null;commit();break;
      case 'locale-apply':
        var language=OwnTVI18n.locale(localeDraft===null?prefs.language:localeDraft);
        if(!language){languageError=calText('Use a valid locale, such as fr-CA, es or ar.','Verwende ein gültiges Sprachkürzel, zum Beispiel fr-CA, es oder ar.');renderSettings();break;}
        prefs.language=language;localeDraft=null;languageError=null;commit();break;
      case 'language-remove': prefs.languagePack=null;commit();break;
      case 'widget-toggle': prefs.widgets[arg] = !prefs.widgets[arg]; commit(); break;

      case 'app-sort': prefs.apps.sort = arg === 'manual' ? 'manual' : 'recent'; commit(); break;
      case 'app-toggle': {
        var hi = prefs.apps.hidden.indexOf(arg);
        if (hi >= 0) prefs.apps.hidden.splice(hi, 1); else prefs.apps.hidden.push(arg);
        commit();
        break;
      }
      case 'app-move': {
        var p = arg.split('|'), key = p[0], d = parseInt(p[1], 10);
        var o = prefs.apps.order, i = o.indexOf(key), j = i + d;
        if (i < 0 || j < 0 || j >= o.length) break;
        prefs.apps.sort = 'manual';
        o.splice(i, 1); o.splice(j, 0, key);
        commit();
        break;
      }
      case 'app-add': {
        var k = 'app:' + arg;
        if (!validAppKey(k) || prefs.apps.order.indexOf(k) >= 0) break;
        var src = state.data && state.data.apps ? state.data.apps.filter(function (a) { return a.id === arg; })[0] : null;
        prefs.apps.order.push(k);
        if (src) { var lbl = cleanText(src.title, 48); if (lbl && !looksSecret(lbl)) prefs.apps.labels[k] = lbl; }
        commit();
        var nf = findFid('ap-show:' + k); if (nf) { nf.focus({ preventScroll: true }); nf.scrollIntoView({ block: 'nearest' }); }
        break;
      }
      case 'app-remove': {
        if (CATALOG_BY_KEY[arg]) break;
        prefs.apps.order = prefs.apps.order.filter(function (x) { return x !== arg; });
        prefs.apps.hidden = prefs.apps.hidden.filter(function (x) { return x !== arg; });
        delete prefs.apps.labels[arg];
        commit();
        break;
      }
      case 'apps-reset': prefs.apps = defaultPrefs().apps; commit(); break;

      case 'wx-coordinates': wxCoordinates=!wxCoordinates; renderSettings(); break;
      case 'wx-search':
        if(wxSearch.busy)break;wxSearch.busy=true;wxSearch.error=null;wxSearch.places=[];renderSettings();
        Bridge.call('searchWeather',[(ui.wxDraft&&ui.wxDraft.label)||'']).then(function(r){wxSearch.places=Array.isArray(r.places)?r.places.slice(0,4):[];if(!wxSearch.places.length)wxSearch.error=t('set.wx.noResults');},function(e){wxSearch.error=errText(e);}).then(function(){wxSearch.busy=false;renderSettings();var place=findFid('wx-place:0');if(place)place.focus({preventScroll:true});});
        break;
      case 'wx-place':
        var place=wxSearch.places[Number(arg)];if(!place)break;
        ui.wxDraft={label:place.label,lat:String(round2(place.latitude)),lon:String(round2(place.longitude))};ui.wxErrors={};wxSearch.places=[];renderSettings();var save=findFid('wx-save');if(save)save.focus({preventScroll:true});
        break;
      case 'wx-save': saveWeather(); break;
      case 'wx-clear':
        prefs.weather = { label: '', latitude: null, longitude: null };
        ui.wxDraft = null; ui.wxErrors = {};
        commit();
        if(Bridge.has('clearWeather'))act('clearWeather',[],t('set.wx.clear')).then(function(){refresh(false);});
        wxSearch.places=[];wxSearch.error=null;
        toast(t('set.wx.cleared'), 'ok');
        break;
      case 'open-editor':
        if (!Bridge.has('openEditor')) break;
        Bridge.call('openEditor', []).then(function () { ui.hints.editor = null; renderSettings(); }, function (err) {
          ui.hints.editor = errText(err); renderSettings();
        });
        break;

      case 'bk-wx': ui.includeWx = !ui.includeWx; renderSettings(); break;
      case 'export-show': ui.exportShown = !ui.exportShown; renderSettings(); break;
      case 'export-download': downloadExport(); break;
      case 'import-apply': importText(ui.importText); break;
      case 'prefs-reset':
        if (!ui.resetArmed) {
          ui.resetArmed = true; renderSettings();
          clearTimeout(ui.resetTimer);
          ui.resetTimer = setTimeout(function () { ui.resetArmed = false; renderSettings(); }, 5000);
        } else {
          ui.resetArmed = false; clearTimeout(ui.resetTimer);
          prefs = defaultPrefs(); ui.wxDraft = null;
          commit();
          toast(t('toast.reset'), 'ok');
        }
        break;
    }
  }

  function commit() { savePrefs(); syncPrefs(); applyTheme(); renderAll(); }

  /* Mirror non-secret preferences to the TV helper (bridge.savePreferences).
     Debounced; one request in flight at a time; edits made while a save is in
     flight trigger another save afterwards. Only a confirmed save marks clean. */
  var syncTimer = null, syncWarned = false, syncInFlight = false, editSeq = 0;
  function syncPrefs() {
    if (Bridge.mode === 'preview') return;
    editSeq++;
    prefsDirty = true;
    saveSync();
    if (Bridge.mode !== 'live' || !Bridge.has('savePreferences')) return; // stays dirty; sent once a bridge is live
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushPrefs, 1500);
  }
  function flushPrefs() {
    syncTimer = null;
    if (syncInFlight) return; // the running save reschedules when it ends
    var seq = editSeq;
    syncInFlight = true;
    Bridge.call('savePreferences', [JSON.parse(JSON.stringify(prefs))]).then(function (reply) {
      syncInFlight = false;
      syncWarned = false;
      var rev = Number(reply && reply.revision);
      if (isFinite(rev) && rev > lastRemoteRevision) lastRemoteRevision = rev;
      if (seq === editSeq) prefsDirty = false;
      else if (!syncTimer) syncTimer = setTimeout(flushPrefs, 400);
      saveSync();
    }, function (err) {
      syncInFlight = false;
      if (!syncWarned) { syncWarned = true; toast(t('toast.syncErr', { msg: errText(err) }), 'error'); }
      saveSync(); // still dirty; the next poll retries
    });
  }
  function cycleStyle() {
    prefs.style = STYLES[(STYLES.indexOf(prefs.style) + 1) % STYLES.length];
    commit();
    toast(t('style.' + prefs.style), 'info');
  }
  function cycleTheme() {
    var order = ['day', 'night', 'auto'];
    prefs.theme.mode = order[(order.indexOf(prefs.theme.mode) + 1) % order.length];
    commit();
  }

  var nameTimer = null;
  document.addEventListener('input', function (e) {
    var key = e.target.getAttribute && e.target.getAttribute('data-input');
    if (!key) return;
    noteInput();
    if(key==='locale'){localeDraft=e.target.value;return;}
    if (key === 'name') {
      clearTimeout(nameTimer);
      var target = e.target;
      nameTimer = setTimeout(function () {
        var v = cleanText(target.value, 24);
        if (v === null || looksSecret(v)) return;
        prefs.name = v; savePrefs(); syncPrefs(); renderTop();
      }, 400);
    } else if (key.indexOf('wx-') === 0) {
      ui.wxDraft = ui.wxDraft || { label: '', lat: '', lon: '' };
      ui.wxDraft[key.slice(3)] = e.target.value;
    } else if (key === 'cal-search') {
      calSearch=e.target.value;
    } else if (key === 'import-text') {
      ui.importText = e.target.value;
    }
  });
  document.addEventListener('change', function (e) {
    var key = e.target.getAttribute && e.target.getAttribute('data-input');
    if(key==='language-file'){var languageFile=e.target.files&&e.target.files[0];if(!languageFile)return;if(languageFile.size>65536){languageError='Language pack is too large.';renderSettings();return;}var languageReader=new FileReader();languageReader.onload=function(){useLanguagePack(String(languageReader.result||''));};languageReader.onerror=function(){languageError='Could not read language pack.';renderSettings();};languageReader.readAsText(languageFile);e.target.value='';return;}
    if (key !== 'import-file') return;
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) { ui.importReport = { errors: [t('imp.tooBig')], warnings: [] }; renderSettings(); return; }
    var reader = new FileReader();
    reader.onload = function () { ui.importText = String(reader.result || ''); importText(ui.importText); };
    reader.onerror = function () { ui.importReport = { errors: [t('imp.json')], warnings: [] }; renderSettings(); };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---------- Weather location ---------- */
  function parseCoord(s) {
    s = String(s || '').trim().replace(/[−–]/g, '-').replace(',', '.');
    if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }
  function saveWeather() {
    var d = ui.wxDraft || { label: '', lat: '', lon: '' };
    var errs = {};
    var label = cleanText(d.label || '', 40);
    if (!label || looksSecret(label)) errs.label = t('set.wx.err.label');
    var lat = parseCoord(d.lat), lon = parseCoord(d.lon);
    if (lat === null || lat < -90 || lat > 90) errs.lat = t('set.wx.err.lat');
    if (lon === null || lon < -180 || lon > 180) errs.lon = t('set.wx.err.lon');
    ui.wxErrors = errs;
    if (Object.keys(errs).length) { if(errs.lat||errs.lon)wxCoordinates=true; renderSettings(); var f = findFid('f-wx-' + Object.keys(errs)[0]); if (f) f.focus(); return; }
    prefs.weather = { label: label, latitude: round2(lat), longitude: round2(lon) };
    prefs.widgets.weather = true;
    ui.wxDraft = { label: label, lat: String(prefs.weather.latitude), lon: String(prefs.weather.longitude) };
    commit();
    if (Bridge.has('configureWeather')) {
      Bridge.call('configureWeather', [{ latitude: prefs.weather.latitude, longitude: prefs.weather.longitude, label: label }]).then(function () {
        ui.hints.weather = null;
        toast(Bridge.mode === 'preview' ? t('toast.previewDid', { action: t('act.wx') }) : t('toast.wxSent'), Bridge.mode === 'preview' ? 'info' : 'ok');
        renderSettings();
        refresh(false);
      }, function (err) {
        // The bridge declined: keep the local copy and show its directions in place.
        ui.hints.weather = errText(err);
        toast(t('toast.wxLocal'), 'ok');
        renderSettings();
      });
    } else toast(t('toast.wxLocal'), 'ok');
  }

  /* ---------- Export / import ---------- */
  function downloadExport() {
    var json = JSON.stringify(exportPayload(), null, 2);
    try {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var d = new Date();
      var a = h('a', { href: url, download: 'own-tv-preferences-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast(t('toast.exported'), 'ok');
    } catch (e) {
      ui.exportShown = true; renderSettings();
    }
  }
  function importText(text) {
    var rep = { errors: [], warnings: [] };
    text = String(text || '');
    if (!text.trim()) rep.errors.push(t('imp.empty'));
    else if (text.length > MAX_IMPORT_CHARS) rep.errors.push(t('imp.tooBig'));
    var obj = null;
    if (!rep.errors.length) { try { obj = JSON.parse(text); } catch (e) { rep.errors.push(t('imp.json')); } }
    var raw = null;
    if (!rep.errors.length) {
      if (!isObj(obj)) rep.errors.push(t('imp.notObject'));
      else if ('kind' in obj) {
        if (obj.kind !== EXPORT_KIND) rep.errors.push(t('imp.kind'));
        else if (obj.schema !== 1) rep.errors.push(t('imp.schema', { v: clip(String(obj.schema), 8) }));
        else raw = obj.preferences;
      } else if (obj.schema === 1) raw = obj;
      else rep.errors.push(t('imp.kind'));
    }
    var next = null;
    if (!rep.errors.length) next = sanitizePrefs(raw, rep);
    ui.importReport = rep;
    if (!rep.errors.length && next) {
      prefs = next;
      ui.importText = ''; ui.wxDraft = null;
      commit();
      toast(t('toast.imported'), 'ok');
    } else renderSettings();
    var target = findFid('bk-apply'); if (target && document.activeElement === document.body) target.focus();
  }

  /* ======================================================================
     Idle dimming + pixel shift (OLED care)
     ====================================================================== */
  var lastInput = Date.now();
  var idle = false;
  function noteInput() { lastInput = Date.now(); if (idle) setIdle(false); }
  function wakeFromIdle() { lastInput = Date.now(); if (idle) { setIdle(false); return true; } return false; }
  function setIdle(on) {
    idle = on;
    root.classList.toggle('is-idle', on);
    if (on) {placeIdleClock();if(weatherView)weatherView.suspend();}
  }
  function placeIdleClock() {
    var c = $('idleClock');
    var now = new Date();
    c.textContent = '';
    add(c, [fmtTime(now), h('small', null, fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' }))]);
    c.style.left = (8 + Math.random() * 62).toFixed(1) + '%';
    c.style.top = (10 + Math.random() * 65).toFixed(1) + '%';
  }
  setInterval(function () {
    var m = prefs.idleDimMinutes;
    if (!document.hidden && !idle && m && Date.now() - lastInput > m * 60000) setIdle(true);
  }, 10000);

  function pixelShift() {
    if (document.hidden || !prefs.pixelShift) return;
    var x = Math.round(Math.random() * 6 - 3), y = Math.round(Math.random() * 6 - 3);
    $('stage').style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  setInterval(pixelShift, 4 * 60000);

  /* ======================================================================
     Clock tick (minute-aligned), visibility, bridge arrival
     ====================================================================== */
  function tick() {
    if (!document.hidden) {
      applyTheme(); if(!weatherView){renderTop(); renderShelf();}
      if (idle) placeIdleClock();
    }
    var now = new Date();
    setTimeout(tick, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(pollTimer); return; }
    noteInput();
    refresh(false).then(schedulePoll);
  });
  window.addEventListener('owntv:bridge-ready', function () { if (Bridge.mode !== 'live' && attachBridge()) refresh(false).then(schedulePoll); });
  onMq(mqDark, applyTheme); onMq(mqLight, function () { applyTheme(); renderAll(); }); onMq(mqReduce, applyTheme);

  /* ======================================================================
     Boot
     ====================================================================== */
  function boot() {
    attachBridge();
    applyTheme();
    renderAll();
    focusDefault();
    var start = function () { refresh(false).then(schedulePoll); };
    if (Bridge.mode === 'live' && Bridge.impl.ready && typeof Bridge.impl.ready.then === 'function') {
      Bridge.impl.ready.then(start, start);
    } else if (Bridge.mode !== 'none') start();
    else {
      // bridge.js may finish initialising after app.js; look again briefly.
      [600, 2000, 5000].forEach(function (ms) {
        setTimeout(function () { if (Bridge.mode === 'none' && attachBridge()) start(); }, ms);
      });
    }
    var now = new Date();
    setTimeout(tick, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
    if (window.console && Bridge.mode === 'preview') console.info('[own-tv] Preview mode "' + previewKind + '": simulated bridge, sample data only.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
