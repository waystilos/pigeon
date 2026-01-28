# Pigeon

A modern, fast HTTP client (like Postman/Insomnia) built with Tauri for native performance.

## Project Structure

```
pigeon/
├── package.json          # Node dependencies (Tauri CLI)
├── src/                  # Frontend (HTML/CSS/JS)
│   ├── index.html        # Main UI
│   ├── styles.css        # Dark theme styling
│   └── app.js           # Frontend logic (Tauri invoke)
└── src-tauri/           # Rust backend
    ├── Cargo.toml        # Rust dependencies
    ├── tauri.conf.json   # Tauri config
    └── src/
        ├── main.rs       # Entry point
        └── lib.rs        # HTTP request handler (reqwest)
```

## Features

- **All HTTP Methods** - GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **Request Builder**
  - Query parameters editor
  - Headers editor (key-value)
  - JSON/Text/Form body
  - Auth support (Bearer Token, Basic Auth, API Key)
- **Response Viewer**
  - Syntax-highlighted JSON
  - Response headers table
  - Status, time, size stats
  - Copy & format buttons
  - Word wrap toggle
- **History** - Stored in localStorage, click to reload
- **Keyboard Shortcuts** - Enter to send
- **Dark Theme** - Purple accent, modern UI

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS
- **Backend**: Rust with Tauri 2.x
- **HTTP Client**: reqwest (async)
- **Icons**: Font Awesome 6

## Build & Run

### Prerequisites
- Node.js 18+
- Rust (install via rustup)
- System dependencies for Tauri (see below)

### Ubuntu/Debian
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Development
```bash
npm install
npm run dev
```

### Build for Release
```bash
npm run build
```

Outputs:
- Linux: `.deb`, `.AppImage` in `src-tauri/target/release/bundle/`
- Windows: `.msi`, `.exe`
- macOS: `.dmg`, `.app`

## Customization

### Theming
Edit CSS variables in `src/styles.css`:
```css
:root {
  --accent: #7c3aed;        /* Purple accent */
  --bg-primary: #0f0f0f;    /* Dark background */
  --method-get: #10b981;    /* Green for GET */
  ...
}
```

### Adding Features
- Edit `src-tauri/src/lib.rs` for backend changes
- Edit `src/app.js` for frontend logic
- Call Rust from JS: `await invoke('command_name', { args })`
