<p align="center">
  <img src="./public/logo-animated.svg" width="80" height="80" alt="Scenex Logo">
</p>
<h1 align="center" style="margin-top: 8px;">Scenex</h1>

<p align="center">A browser-based tool for extracting frames from videos with high performance using web workers. All processing is done locally in the browser - no server uploads required.</p>
<p align="center">
  <a href="#features">Features</a> •
  <a href="#development">Development</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#development">Development</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0">
    <img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3">
  </a>
  <a href="https://scenex.pics/">
    <img src="https://img.shields.io/badge/Live-Preview-brightgreen.svg" alt="Live Preview">
  </a>
</p>

## Features

- Extract frames using different methods:
    - Every frame
    - Fixed interval (FPS)
    - Specific number of frames
- Support for multiple output formats:
    - JPEG (smaller files)
    - PNG (lossless)
    - WebP (best compression)
- Configurable quality and resolution
- Custom filename patterns
- Parallel processing using web workers
- Large file support with streaming downloads
- Private & secure - all processing done locally

## Development

### Prerequisites

- Bun (https://bun.sh/) or any other NodeJS runtime

### Local Setup

```bash
# Clone the repository
git clone https://github.com/lkxe/scenex.git
cd scenex

# Install dependencies
bun install

# Start development server
bun run dev
```

### Build

```bash
# Production build
bun run build

# Preview production build locally
bun run preview
```

## Deployment

### Option 1: Using Docker

```bash
# Build the image
docker build -t scenex .

# Run the container
docker run -d -p 8153:8153 --name scenex scenex

# View logs
docker logs -f scenex
```

### Option 2: Using Docker Compose

```bash
# Start the service
docker compose up -d

# View logs
docker compose logs -f

# Stop the service
docker compose down
```

Access the application at `http://localhost:8153`

## Performance Considerations

- The application uses web workers for parallel processing
- Large files are handled using streaming downloads
- Image processing is optimized for memory usage

## Security Notes

- All processing is done client-side
- No data is ever sent to a server

## License

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

This means that if you modify this software and use it to provide a service over a network (even client-side), you must make your modified source code available to users.