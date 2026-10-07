// Bakes the location of this checkout into the packaged app, so the installed
// Clockwize.app can find the server, the database and the built client.
const fs = require('fs');
const path = require('path');

// When the Notification Center widget is embedded, the installer passes the port and the
// per-install secret of the local widget feed (env CLOCKWIZE_WIDGET_PORT / CLOCKWIZE_WIDGET_SECRET)
const projectRoot = path.resolve(__dirname, '..', '..');
const widget = process.env.CLOCKWIZE_WIDGET_SECRET
  ? { widgetPort: Number(process.env.CLOCKWIZE_WIDGET_PORT) || 47321, widgetSecret: process.env.CLOCKWIZE_WIDGET_SECRET }
  : null;

fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, '..', 'build', 'app-config.json'),
  JSON.stringify({ projectRoot, ...widget }, null, 2),
  { mode: 0o600 }
);
console.log(`app-config.json → ${projectRoot}${widget ? ` (widget feed on port ${widget.widgetPort})` : ''}`);
