let photos = [];
let currentIndex = -1;
let settings = null;
let container = document.getElementById('frame-container');
let sleepOverlay = document.getElementById('sleep-overlay');
let loopTimeout = null;
let socket = null;

// Initialize
(async function init() {
    await initializeWebSocket();
    startLoop();

    // Check sleep every minute (local time check doesn't need server)
    setInterval(checkSleep, 60000);

    // Tap to advance
    container.addEventListener('click', () => {
        if (sleepOverlay.style.display === 'block') return;
        if (loopTimeout) clearTimeout(loopTimeout);
        showNextPhoto();
    });
})();

function initializeWebSocket() {
    return new Promise((resolve) => {
        socket = io('/frame', {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        socket.on('connect', () => {
            console.log('Connected to server via WebSocket');
            socket.emit('request_sync');
        });

        socket.on('full_sync', (data) => {
            console.log('Received full sync:', data.photos?.length, 'photos');
            photos = data.photos || [];
            settings = data.settings || {};
            checkSleep();
            resolve();
        });

        socket.on('photos_changed', () => {
            console.log('Photos changed, requesting sync');
            socket.emit('request_sync');
        });

        socket.on('settings_changed', () => {
            console.log('Settings changed, requesting sync');
            socket.emit('request_sync');
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        socket.on('connect_error', (err) => {
            console.error('WebSocket connection error:', err);
            // Fallback to polling if WebSocket fails
            if (!photos.length) {
                console.log('Falling back to HTTP polling');
                fallbackFetch().then(resolve);
            }
        });

        // Timeout fallback in case WebSocket doesn't connect
        setTimeout(() => {
            if (!photos.length) {
                console.log('WebSocket timeout, falling back to HTTP');
                fallbackFetch().then(resolve);
            }
        }, 5000);
    });
}

async function fallbackFetch() {
    // Fallback to traditional fetch if WebSocket unavailable
    try {
        const [pRes, sRes] = await Promise.all([
            fetch('/api/photos'),
            fetch('/api/settings')
        ]);

        const allPhotos = await pRes.json();
        photos = allPhotos.filter(p => p.active);
        settings = await sRes.json();
        checkSleep();

        // Set up polling fallback
        setInterval(async () => {
            try {
                const [pRes, sRes] = await Promise.all([
                    fetch('/api/photos'),
                    fetch('/api/settings')
                ]);
                const allPhotos = await pRes.json();
                photos = allPhotos.filter(p => p.active);
                settings = await sRes.json();
                checkSleep();
            } catch (e) {
                console.error("Polling sync failed", e);
            }
        }, 60000);
    } catch (e) {
        console.error("Fallback fetch failed", e);
    }
}

function checkSleep() {
    if (!settings || !settings.sleep_enabled) {
        sleepOverlay.style.display = 'none';
        return;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const parseTime = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };

    const start = parseTime(settings.sleep_start);
    const end = parseTime(settings.sleep_end);

    let isSleepTime = false;
    if (start < end) {
        // Sleep during day (e.g. 09:00 to 17:00)
        isSleepTime = currentTime >= start && currentTime < end;
    } else {
        // Sleep overnight (e.g. 22:00 to 08:00)
        isSleepTime = currentTime >= start || currentTime < end;
    }

    if (isSleepTime) {
        sleepOverlay.style.display = 'block';
    } else {
        sleepOverlay.style.display = 'none';
    }
}

function startLoop() {
    if (loopTimeout) clearTimeout(loopTimeout);
    showNextPhoto();
}

function showNextPhoto() {
    if (photos.length === 0) {
        container.innerHTML = '<h1 style="color:white; opacity:0.5;">No Photos Available</h1>';
        loopTimeout = setTimeout(showNextPhoto, 5000);
        return;
    }

    currentIndex = (currentIndex + 1) % photos.length;
    const photo = photos[currentIndex];

    // Create new image
    const img = document.createElement('img');
    img.src = `/static/uploads/${photo.filename}`;

    // Apply transition class
    const transitionType = settings?.transition || 'fade';
    let transitionClass = '';
    if (transitionType === 'slide') transitionClass = 'tx-slide';
    else if (transitionType === 'zoom') transitionClass = 'tx-zoom';
    else if (transitionType === 'blur') transitionClass = 'tx-blur';
    else if (transitionType === 'flip') transitionClass = 'tx-flip';
    else if (transitionType === 'revolve') transitionClass = 'tx-revolve';

    img.className = `frame-image ${transitionClass}`;

    // Preload
    img.onload = () => {
        container.appendChild(img);

        // Trigger reflow
        img.offsetHeight;

        // Animate in
        img.classList.add('active');

        // Clean up old images: Transition them OUT while new one comes IN
        const oldImages = container.querySelectorAll('.frame-image:not(:last-child)');
        oldImages.forEach(el => {
            el.classList.remove('active');
            el.classList.add('exit');
        });

        setTimeout(() => {
            oldImages.forEach(el => el.remove());
        }, 1000); // 1s transition duration matches CSS

        // Schedule next
        const duration = (settings?.rotation_speed || 10) * 1000;
        loopTimeout = setTimeout(showNextPhoto, duration);
    };

    img.onerror = () => {
        console.error("Failed to load image", photo.filename);
        // Skip this one quickly
        loopTimeout = setTimeout(showNextPhoto, 1000);
    };
}
