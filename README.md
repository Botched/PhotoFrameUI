# Raspberry Pi Photo Frame

A premium, web-based photo frame application designed for Raspberry Pi.
Features a glassmorphic UI, sleep timer, drag-drop uploads, and smooth slideshow transitions.

## Features
- **File Upload**: Drag & Drop interface accessible from any device on the network.
- **Gallery Manager**: Delete or Hide photos without removing them.
- **Configurable**: Adjust slideshow speed, transitions, and sleep schedule.
- **Touch Friendly**: Large buttons and responsive layout.

## Installation
1. Install Python 3.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the App
Run the server:
```bash
python app.py
```
The app will be available at `http://localhost:5000` (or your Pi's IP address).

## Setting up on Raspberry Pi (Kiosk Mode)
To have the Pi boot directly into the photo frame:

1. **Autostart the Server**:
   Add a line to your request `@reboot` crontab or use a systemd service to run `python /path/to/app.py`.

2. **Autostart the Browser**:
   Edit `/etc/xdg/lxsession/LXDE-pi/autostart` and add:
   ```bash
   @xset s off
   @xset -dpms
   @xset s noblank
   @chromium-browser --kiosk --incognito http://localhost:5000/frame
   ```
   *Note: Use `http://localhost:5000/frame` for the slideshow view.*

## Usage
- **Uploads**: Go to `http://<PI_IP>:5000` on your laptop/phone to manage photos.
- **Frame**: The Pi should display `http://<PI_IP>:5000/frame`.
