let photos = [];
let currentIndex = -1;
let settings = null;
let container = document.getElementById('frame-container');
let sleepOverlay = document.getElementById('sleep-overlay');
let loopTimeout = null;
let lastPhotoFetch = 0;

// Initialize
(async function init() {
    await refreshData();
    startLoop();
    
    // Refresh data every minute
    setInterval(refreshData, 60000);
    // Check sleep every minute
    setInterval(checkSleep, 60000);
})();

async function refreshData() {
    try {
        const [pRes, sRes] = await Promise.all([
            fetch('/api/photos'),
            fetch('/api/settings')
        ]);
        
        const allPhotos = await pRes.json();
        // Filter only active photos
        photos = allPhotos.filter(p => p.active);
        
        settings = await sRes.json();
        
        // Update basic styles if needed
        checkSleep();
    } catch(e) {
        console.error("Sync failed", e);
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
    const transitionClass = transitionType === 'slide' ? 'tx-slide' : 
                          transitionType === 'zoom' ? 'tx-zoom' : '';
                          
    img.className = `frame-image ${transitionClass}`;
    
    // Preload
    img.onload = () => {
        container.appendChild(img);
        
        // Trigger reflow
        img.offsetHeight; 
        
        // Animate in
        img.classList.add('active');
        
        // Clean up old images
        const oldImages = container.querySelectorAll('.frame-image:not(:last-child)');
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
