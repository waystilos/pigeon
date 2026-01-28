# Pigeon

Pigeon is a fast, native-feeling HTTP client (think Postman/Insomnia) built with Tauri. It’s focused on the basics: make requests quickly, inspect responses clearly, and stay out of your way.

## Why this exists
I wanted a lightweight client that opens fast, uses little memory, and still feels pleasant to use. Tauri + Rust gives us native performance without the Electron tax.

## Features
- All HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Request builder: query params, headers, body (JSON/Text/Form), auth (Bearer, Basic, API Key)
- Response viewer: formatted JSON, headers table, status/time/size stats, copy/format buttons, word wrap toggle
- History stored locally (localStorage)
- Keyboard shortcut: Enter to send
- Dark theme UI

## Tech stack
- Frontend: Vanilla HTML/CSS/JS
- Backend: Rust + Tauri 2.x
- HTTP: reqwest (async)

## Project structure
```
pigeon/
├── package.json
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        └── lib.rs
```

## Getting started
### Prereqs
- Node.js 18+
- Rust via rustup
- Tauri system deps

### Ubuntu/Debian deps
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Dev
```bash
npm install
npm run dev
```

### Build
```bash
npm run build
```

Outputs:
- macOS: `src-tauri/target/release/bundle/macos/*.app` and `src-tauri/target/release/bundle/dmg/*.dmg`
- Windows: `src-tauri/target/release/bundle/msi/` or `src-tauri/target/release/bundle/nsis/`
- Linux: `src-tauri/target/release/bundle/deb/` and `src-tauri/target/release/bundle/appimage/`

## Contributing
Contributions are welcome, especially if you have a strong need for a feature. Open an issue and tell me your use case — if it solves a real pain, I’m happy to review PRs or collaborate on the design.

If you just want to fix a bug or improve UI/UX, feel free to open a PR directly.

---
If you use Pigeon and it helps, a star on the repo means a lot.
