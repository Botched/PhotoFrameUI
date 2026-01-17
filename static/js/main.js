document.addEventListener('DOMContentLoaded', () => {
    setupLazyLoading();
    loadPhotos();
    loadSettings();
    setupUpload();
    setupSettingsUI();
    setupGoogleImport();
});

// --- State ---
let allPhotos = [];
let currentSettings = {};
let isSelectMode = false;
let selectedPhotos = new Set();
let imageObserver = null;

// --- Lazy Loading ---
function setupLazyLoading() {
    if ('IntersectionObserver' in window) {
        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.src;
                    const fallback = img.dataset.fallback;
                    if (src) {
                        // Set up fallback handler before setting src
                        if (fallback) {
                            img.onerror = () => {
                                img.onerror = null;
                                img.src = fallback;
                            };
                        }
                        img.src = src;
                        img.removeAttribute('data-src');
                        img.removeAttribute('data-fallback');
                        img.classList.remove('lazy');
                        img.classList.add('loaded');
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '100px 0px',  // Preload 100px before visible
            threshold: 0.01
        });
    }
}

// --- API Calls ---
async function fetchPhotos() {
    const res = await fetch('/api/photos');
    return await res.json();
}

async function fetchSettings() {
    const res = await fetch('/api/settings');
    return await res.json();
}

async function saveSettings(newSettings) {
    const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
    });
    return await res.json();
}

async function togglePhoto(filename) {
    const res = await fetch(`/api/photo/toggle/${filename}`, { method: 'POST' });
    return await res.json();
}

async function toggleFolder(folderPath, activeState) {
    const res = await fetch('/api/folder/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, active: activeState })
    });
    return await res.json();
}

async function deleteFolder(folderPath) {
    const res = await fetch('/api/folder/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath })
    });
    return await res.json();
}

async function deletePhoto(filename) {
    // Escape filename just in case, though fetch handles it
    const res = await fetch(`/api/photo/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    return await res.json();
}

async function movePhotos(filenames, targetFolder) {
    const res = await fetch('/api/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: filenames, folder: targetFolder })
    });
    return await res.json();
}

async function rotatePhoto(filename, degrees = 90) {
    const res = await fetch('/api/photo/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, degrees })
    });
    return await res.json();
}

// --- UI Logic ---
async function loadPhotos() {
    allPhotos = await fetchPhotos();
    renderGallery();
}

async function loadSettings() {
    currentSettings = await fetchSettings();

    // Populate form
    document.getElementById('setting-rotation').value = currentSettings.rotation_speed;
    document.getElementById('setting-transition').value = currentSettings.transition;
    document.getElementById('setting-shuffle').checked = currentSettings.shuffle;
    document.getElementById('setting-sleep-enabled').checked = currentSettings.sleep_enabled;
    document.getElementById('setting-sleep-start').value = currentSettings.sleep_start;
    document.getElementById('setting-sleep-end').value = currentSettings.sleep_end;

    updateSleepUI();
}

function updateSleepUI() {
    const enabled = document.getElementById('setting-sleep-enabled').checked;
    const times = document.getElementById('sleep-times');
    times.style.opacity = enabled ? '1' : '0.3';
    times.style.pointerEvents = enabled ? 'auto' : 'none';
}

// --- Thumbnail Generation ---
let thumbnailPollInterval = null;

async function checkThumbnailStatus() {
    const statusEl = document.getElementById('thumbnail-status');
    const progressEl = document.getElementById('thumbnail-progress');
    const generateBtn = document.getElementById('generate-thumbnails-btn');

    try {
        const res = await fetch('/api/thumbnails/status');
        const data = await res.json();

        if (data.generation.running) {
            // Show progress
            statusEl.style.display = 'none';
            progressEl.style.display = 'block';
            generateBtn.style.display = 'none';
            updateThumbnailProgress(data.generation);
            startThumbnailPolling();
        } else if (data.missing > 0) {
            // Show status with generate button
            statusEl.innerHTML = `<span style="color:#f59e0b;">⚠️ ${data.missing} of ${data.total} photos missing thumbnails</span>`;
            statusEl.style.display = 'block';
            progressEl.style.display = 'none';
            generateBtn.style.display = 'inline-flex';
            generateBtn.innerText = `Generate ${data.missing} Missing Thumbnails`;
            stopThumbnailPolling();
        } else {
            // All good
            statusEl.innerHTML = `<span style="color:#4ade80;">✓ All ${data.total} photos have thumbnails</span>`;
            statusEl.style.display = 'block';
            progressEl.style.display = 'none';
            generateBtn.style.display = 'none';
            stopThumbnailPolling();
        }
    } catch (e) {
        statusEl.innerHTML = '<span style="color:#f87171;">Failed to check thumbnail status</span>';
        console.error('Thumbnail status error:', e);
    }
}

function updateThumbnailProgress(gen) {
    const progressText = document.getElementById('thumbnail-progress-text');
    const progressCount = document.getElementById('thumbnail-progress-count');
    const progressBar = document.getElementById('thumbnail-progress-bar');
    const currentFile = document.getElementById('thumbnail-current-file');

    const percent = gen.total > 0 ? (gen.processed / gen.total) * 100 : 0;

    progressText.innerText = gen.running ? 'Generating thumbnails...' : 'Complete!';
    progressCount.innerText = `${gen.processed}/${gen.total}`;
    progressBar.style.width = `${percent}%`;
    currentFile.innerText = gen.current_file || '';

    if (!gen.running && gen.processed > 0) {
        progressText.innerHTML = `<span style="color:#4ade80;">✓ Complete!</span> ${gen.success} generated, ${gen.failed} failed`;
    }
}

function startThumbnailPolling() {
    if (thumbnailPollInterval) return;
    thumbnailPollInterval = setInterval(checkThumbnailStatus, 1000);
}

function stopThumbnailPolling() {
    if (thumbnailPollInterval) {
        clearInterval(thumbnailPollInterval);
        thumbnailPollInterval = null;
    }
}

async function startThumbnailGeneration() {
    const generateBtn = document.getElementById('generate-thumbnails-btn');
    const statusEl = document.getElementById('thumbnail-status');
    const progressEl = document.getElementById('thumbnail-progress');

    generateBtn.innerText = 'Starting...';
    generateBtn.disabled = true;

    try {
        const res = await fetch('/api/thumbnails/generate', { method: 'POST' });
        const data = await res.json();

        if (data.error) {
            alert(data.error);
            generateBtn.disabled = false;
            checkThumbnailStatus();
            return;
        }

        // Show progress UI
        statusEl.style.display = 'none';
        progressEl.style.display = 'block';
        generateBtn.style.display = 'none';

        // Start polling for progress
        startThumbnailPolling();
    } catch (e) {
        alert('Failed to start thumbnail generation');
        generateBtn.disabled = false;
        console.error('Thumbnail generation error:', e);
    }
}

function setupThumbnailGeneration() {
    const generateBtn = document.getElementById('generate-thumbnails-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', startThumbnailGeneration);
    }
}

function setupSettingsUI() {
    const btn = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    const saveBtn = document.getElementById('save-settings-btn');
    const sleepCheck = document.getElementById('setting-sleep-enabled');

    btn.addEventListener('click', () => {
        const isOpening = panel.style.display === 'none';
        panel.style.display = isOpening ? 'block' : 'none';
        if (isOpening) {
            checkThumbnailStatus();
        }
    });

    sleepCheck.addEventListener('change', updateSleepUI);

    // Thumbnail generation
    setupThumbnailGeneration();

    saveBtn.addEventListener('click', async () => {
        saveBtn.innerText = "Saving...";
        const newSettings = {
            rotation_speed: parseInt(document.getElementById('setting-rotation').value),
            transition: document.getElementById('setting-transition').value,
            shuffle: document.getElementById('setting-shuffle').checked,
            sleep_enabled: document.getElementById('setting-sleep-enabled').checked,
            sleep_start: document.getElementById('setting-sleep-start').value,
            sleep_end: document.getElementById('setting-sleep-end').value
        };
        await saveSettings(newSettings);
        saveBtn.innerText = "Saved!";
        setTimeout(() => saveBtn.innerText = "Save Changes", 2000);
    });

    // Selection Mode Logic
    const toggleSelectBtn = document.getElementById('toggle-select-mode');
    const cancelSelectBtn = document.getElementById('cancel-selection');
    const selectionToolbar = document.getElementById('selection-toolbar');
    const moveBtn = document.getElementById('move-selected-btn');
    const newFolderInput = document.getElementById('new-folder-name');

    const toggleMode = (active) => {
        isSelectMode = active;
        selectedPhotos.clear();
        updateSelectionUI();
        
        selectionToolbar.style.display = active ? 'flex' : 'none';
        toggleSelectBtn.style.display = active ? 'none' : 'block';
        
        // Re-render to show checkboxes/selection state
        renderGallery();
    };

    toggleSelectBtn.addEventListener('click', () => toggleMode(true));
    cancelSelectBtn.addEventListener('click', () => toggleMode(false));

    moveBtn.addEventListener('click', async () => {
        const folder = newFolderInput.value.trim();
        const files = Array.from(selectedPhotos);
        
        if (files.length === 0) return alert("No photos selected");
        if (!folder) return alert("Please enter a folder name (or '.' for root)");

        moveBtn.innerText = "Moving...";
        await movePhotos(files, folder);
        moveBtn.innerText = "Move to Folder";
        newFolderInput.value = "";
        toggleMode(false);
        loadPhotos();
    });
}

function updateSelectionUI() {
    document.getElementById('selected-count').innerText = selectedPhotos.size;
}

function renderGallery() {
    const grid = document.getElementById('photo-grid');
    document.getElementById('photo-count').innerText = `(${allPhotos.length} photos)`;
    grid.innerHTML = '';
    
    // Group by folder
    const folders = {};
    allPhotos.forEach(p => {
        const folder = p.folder || '.';
        if (!folders[folder]) folders[folder] = [];
        folders[folder].push(p);
    });
    
    // Sort folders (root first, then alphabetical)
    const sortedKeys = Object.keys(folders).sort((a,b) => {
        if(a === '.') return -1;
        if(b === '.') return 1;
        return a.localeCompare(b);
    });

    sortedKeys.forEach(folder => {
        const group = folders[folder];
        
        // Render Photos for this folder
        // Container for collapse
        const groupContainer = document.createElement('div');
        groupContainer.className = 'photo-grid-group';
        groupContainer.style.display = 'contents'; // Default open
        
        // Folder Header
        const header = document.createElement('div');
        header.style.gridColumn = '1 / -1';
        header.style.marginTop = '20px';
        header.style.marginBottom = '10px';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '15px';
        header.style.background = 'rgba(255,255,255,0.02)';
        header.style.padding = '10px';
        header.style.borderRadius = '8px';
        
        const folderName = folder === '.' ? 'Root / Unsorted' : folder;
        const allActive = group.every(p => p.active);
        
        header.innerHTML = `
            <button class="btn btn-sm collapse-btn" style="padding:4px 8px;">▼</button>
            <h3 style="margin:0; font-size: 18px; color: var(--accent-color); flex-grow:1;">
                ${folderName} <span style="font-size:12px; opacity:0.6; color:white;">(${group.length})</span>
            </h3>
            
            <div style="display:flex; gap:10px;">
                <button class="btn btn-sm toggle-all-btn" style="padding: 4px 10px; font-size:12px;">
                    ${allActive ? 'Disable All' : 'Enable All'}
                </button>
                ${folder !== '.' ? `<button class="btn btn-danger btn-sm folder-del-btn" style="padding: 4px 10px; font-size:12px;" title="Delete Folder">🗑️ Folder</button>` : ''}
            </div>
        `;
        grid.appendChild(header);
        
        // Header Logic
        const collapseBtn = header.querySelector('.collapse-btn');
        let isCollapsed = false;
        
        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            collapseBtn.innerText = isCollapsed ? '▶' : '▼';
            // Toggle visibility of all cards in this group
            // We can't simply toggle groupContainer display because 'contents' unrwaps it
            // Instead we toggle the cards directly or use a wrapping logic.
            // Simpler: just toggle the card elements we are about to append
             groupContainer.querySelectorAll('.photo-card').forEach(c => {
                 c.style.display = isCollapsed ? 'none' : 'block';
             });
        });

        const toggleBtn = header.querySelector('.toggle-all-btn');
        toggleBtn.addEventListener('click', async () => {
            toggleBtn.innerText = "Processing...";
            await toggleFolder(folder, !allActive);
            loadPhotos();
        });
        
        if (folder !== '.') {
            const folderDelBtn = header.querySelector('.folder-del-btn');
            folderDelBtn.addEventListener('click', async () => {
                if(confirm(`Ideally we'd use the double-tap, but for now: Delete folder "${folder}" and ALL its contents?`)) {
                     folderDelBtn.innerText = "Deleting...";
                     await deleteFolder(folder);
                     loadPhotos();
                }
            });
        }

        // Render Cards
        groupContainer.innerHTML = ''; // Start empty
        group.forEach(photo => {
            const card = document.createElement('div');
            const isSelected = selectedPhotos.has(photo.filename);
            card.className = `photo-card ${photo.active ? '' : 'hidden-item'} ${isSelected ? 'selected' : ''}`;
            
            let overlayContent = '';
            
            if (isSelectMode) {
                // Select Mode Overlay
                overlayContent = `
                    <div style="position:absolute; top:10px; right:10px; width:24px; height:24px; border-radius:50%; border:2px solid white; background:${isSelected ? 'var(--accent-color)' : 'rgba(0,0,0,0.5)'}; display:flex; align-items:center; justify-content:center;">
                        ${isSelected ? '✓' : ''}
                    </div>
                `;
                // Make whole card clickable for selection
                card.style.cursor = 'pointer';
                card.onclick = (e) => {
                    e.stopPropagation(); // prevent other clicks
                    if (selectedPhotos.has(photo.filename)) {
                        selectedPhotos.delete(photo.filename);
                    } else {
                        selectedPhotos.add(photo.filename);
                    }
                    updateSelectionUI();
                    renderGallery(); // Re-render to update UI state (visuals)
                };
            } else {
                // Normal Mode Overlay
                overlayContent = `
                <div class="photo-overlay">
                    <button class="btn btn-sm rotate-btn" title="Rotate 90°">⟳</button>
                    <div class="bottom-actions" style="display:flex; gap:5px; width:100%; justify-content: center;">
                        <button class="btn btn-danger btn-sm delete-btn" title="Delete">🗑️</button>
                        <button class="btn btn-sm toggle-btn" title="${photo.active ? 'Hide from Frame' : 'Show in Frame'}">
                            ${photo.active ? '🔴' : '🟢'}
                        </button>
                    </div>
                </div>`;
            }

            // Append a timestamp to force browser to reload image after rotation
            const t = photo.added ? `?t=${photo.added}` : '';
            const disabledLabel = !photo.active ? '<div class="disabled-label">DISABLED</div>' : '';

            // Use thumbnail for gallery display, fallback to original if thumbnail fails
            const thumbSrc = `/static/thumbnails/${photo.filename}${t}`;
            const fallbackSrc = `/static/uploads/${photo.filename}${t}`;

            // Use lazy loading with Intersection Observer if available
            const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E";
            const imgHtml = imageObserver
                ? `<img class="lazy" data-src="${thumbSrc}" data-fallback="${fallbackSrc}" src="${placeholder}">`
                : `<img src="${thumbSrc}" onerror="this.onerror=null; this.src='${fallbackSrc}'" loading="lazy">`;

            card.innerHTML = `
                ${imgHtml}
                ${disabledLabel}
                ${overlayContent}
            `;
            
            if (!isSelectMode) {
                // Tap to show overlay logic (important for mobile)
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Toggle active on this card, remove from others
                    const wasActive = card.classList.contains('active');
                    document.querySelectorAll('.photo-card.active').forEach(c => c.classList.remove('active'));
                    if (!wasActive) card.classList.add('active');
                });

                // Global click to dismiss overlays
                if (!document._overlayListenerAdded) {
                    document.addEventListener('click', () => {
                        document.querySelectorAll('.photo-card.active').forEach(c => c.classList.remove('active'));
                    });
                    document._overlayListenerAdded = true;
                }

                // Event Listeners (Normal Mode)
                const delBtn = card.querySelector('.delete-btn');
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (delBtn.dataset.confirming === 'true') {
                        delBtn.innerHTML = '⏳';
                        await deletePhoto(photo.filename);
                        loadPhotos();
                    } else {
                        delBtn.dataset.confirming = 'true';
                        delBtn.innerText = 'Confirm?';
                        delBtn.classList.add('btn-primary');
                        delBtn.classList.remove('btn-danger');
                        setTimeout(() => {
                            delBtn.dataset.confirming = 'false';
                            delBtn.innerText = '🗑️';
                            delBtn.classList.add('btn-danger'); // revert colors
                            delBtn.classList.remove('btn-primary');
                        }, 5000);
                    }
                });

                const rotateBtn = card.querySelector('.rotate-btn');
                rotateBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    rotateBtn.innerText = '...';
                    await rotatePhoto(photo.filename);
                    loadPhotos();
                });

                const toggleBtn = card.querySelector('.toggle-btn');
                toggleBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await togglePhoto(photo.filename);
                    loadPhotos();
                });
            }

            groupContainer.appendChild(card);

            // Register with lazy loading observer
            if (imageObserver) {
                const img = card.querySelector('img.lazy');
                if (img) {
                    imageObserver.observe(img);
                }
            }
        });

        // Append container to main grid
        // Since grid is CSS grid, 'display: contents' makes children direct grid items
        grid.appendChild(groupContainer);
    });
}

// --- Upload Logic ---
function setupUpload() {
    const dz = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    
    // Enable directory selection
    input.setAttribute('webkitdirectory', '');

    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleFiles(input.files));

    dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    
    dz.addEventListener('drop', async (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
        
        const items = e.dataTransfer.items;
        if (items) {
             const files = await getAllFileEntries(items);
             uploadFiles(files);
        } else {
             handleFiles(e.dataTransfer.files);
        }
    });
}

// Recursive file scanner for Drop action
async function getAllFileEntries(dataTransferItems) {
    const files = [];
    const queue = [];
    
    for (let i = 0; i < dataTransferItems.length; i++) {
        queue.push(dataTransferItems[i].webkitGetAsEntry());
    }
    
    while (queue.length > 0) {
        const entry = queue.shift();
        if (entry.isFile) {
            files.push(await getFileFromEntry(entry));
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await readAllEntries(reader);
            queue.push(...entries);
        }
    }
    return files;
}

function readAllEntries(reader) {
    return new Promise((resolve) => {
        const entries = [];
        function read() {
            reader.readEntries((results) => {
                if (results.length) {
                    entries.push(...results);
                    read();
                } else {
                    resolve(entries);
                }
            });
        }
        read();
    });
}

async function uploadFiles(files) {
    const queue = document.getElementById('upload-queue');
    queue.innerHTML = '';
    
    for (const file of files) {
        const item = document.createElement('div');
        item.style.padding = '8px';
        item.style.marginBottom = '5px';
        item.style.background = 'rgba(255,255,255,0.05)';
        item.style.borderRadius = '4px';
        item.innerText = `Preparing ${file.name}...`;
        queue.appendChild(item);

        const formData = new FormData();
        formData.append('file', file);
        
        // Use path if available (from directory picker or drag-drop)
        if (file.fullPath) {
            formData.append('path', file.fullPath.substring(0, file.fullPath.lastIndexOf('/')));
        } else if (file.webkitRelativePath) {
            formData.append('path', file.webkitRelativePath.substring(0, file.webkitRelativePath.lastIndexOf('/')));
        }

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                item.innerText = `✓ ${file.name} uploaded`;
                item.style.color = '#4ade80';
            } else {
                item.innerText = `✗ ${file.name} failed: ${data.error}`;
                item.style.color = '#f87171';
            }
        } catch (e) {
            item.innerText = `✗ ${file.name} upload error`;
            item.style.color = '#f87171';
        }
    }
    
    setTimeout(() => {
        queue.innerHTML = '';
        loadPhotos();
    }, 3000);
}

function handleFiles(fileList) {
    // Convert FileList to Array
    uploadFiles(Array.from(fileList));
}

function getFileFromEntry(entry) {
    return new Promise((resolve) => {
        entry.file((file) => {
            // Attach full path info to the file object
            Object.defineProperty(file, 'fullPath', {
                value: entry.fullPath.substring(1) // remove leading /
            });
            resolve(file);
        });
    });
}


// --- Google Photos Logic ---
let googleSelected = new Set();
let googlePhotos = [];

function setupGoogleImport() {
    const importBtn = document.getElementById('import-google-btn');
    const modal = document.getElementById('google-modal');
    const closeBtn = document.getElementById('close-google-modal');
    const loginBtn = document.getElementById('google-login-btn');
    const listContainer = document.getElementById('google-photos-list');
    const loginState = document.getElementById('google-login-state');
    const footer = document.getElementById('google-footer');
    const importConfirmBtn = document.getElementById('google-import-confirm-btn');

    importBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        checkGoogleAuth();
    });

    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        // Reset state?
    });

    loginBtn.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/google/auth_url');
            if (res.status === 500) {
                 const data = await res.json();
                 if (data.error && data.error.includes('Missing client_secret')) {
                     alert("System Administrator Action Required:\n\nGoogle Photos integration is not configured. The 'client_secret.json' file is missing from the data directory.\n\nPlease refer to the documentation to set up Google Cloud credentials.");
                     return;
                 }
            }
            
            const data = await res.json();
            if (data.url) {
                // Open popup
                // Use standardized window size
                const width = 600;
                const height = 700;
                const left = (window.screen.width - width) / 2;
                const top = (window.screen.height - height) / 2;
                
                const popup = window.open(data.url, 'Google Auth', `width=${width},height=${height},top=${top},left=${left}`);
                
                if (!popup) {
                    alert("Please allow popups to sign in to Google.");
                    return;
                }

                const timer = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(timer);
                        checkGoogleAuth();
                    }
                }, 1000);
            } else if (data.error) {
                alert("Error: " + data.error);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to initiate Google Login. Check server logs.");
        }
    });

    async function checkGoogleAuth() {
        // Show loading state
        loginState.innerHTML = '<p>Checking connection...</p>';
        try {
            const res = await fetch('/api/google/photos');
            const data = await res.json();
            
            if (data.authenticated) {
                // Show photos
                loginState.style.display = 'none';
                listContainer.style.display = 'grid';
                footer.style.display = 'flex';
                googlePhotos = data.photos;
                renderGooglePhotos();
            } else {
                // Show login button
                loginState.style.display = 'block';
                listContainer.style.display = 'none';
                footer.style.display = 'none';
                loginState.innerHTML = `
                    <p>Connect your Google Account to access your photos.</p>
                    <button id="google-login-btn-retry" class="btn btn-primary">Connect Google Account</button>
                `;
                document.getElementById('google-login-btn-retry').addEventListener('click', () => loginBtn.click());
            }
        } catch (e) {
            loginState.innerHTML = '<p style="color:red">Failed to connect to backend.</p>';
        }
    }

    function renderGooglePhotos() {
        listContainer.innerHTML = '';
        googlePhotos.forEach(photo => {
            const el = document.createElement('div');
            const isSelected = googleSelected.has(photo);
            el.className = 'photo-card';
            el.style.border = isSelected ? '2px solid var(--accent-color)' : 'none';
            el.innerHTML = `
                <img src="${photo.url}=w200-h200-c" loading="lazy" style="width:100%; height:100px; object-fit:cover;">
                ${isSelected ? '<div style="position:absolute; top:5px; right:5px; background:var(--accent-color); width:20px; height:20px; border-radius:50%;"></div>' : ''}
            `;
            el.onclick = () => {
                if (googleSelected.has(photo)) {
                    googleSelected.delete(photo);
                } else {
                    googleSelected.add(photo);
                }
                renderGooglePhotos();
                updateGoogleFooter();
            };
            listContainer.appendChild(el);
        });
        updateGoogleFooter();
    }
    
    function updateGoogleFooter() {
        document.getElementById('google-selected-count').innerText = `${googleSelected.size} selected`;
    }

    importConfirmBtn.addEventListener('click', async () => {
        if (googleSelected.size === 0) return;
        
        importConfirmBtn.innerText = "Importing...";
        const items = Array.from(googleSelected);
        
        try {
            const res = await fetch('/api/google/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items }) // send minimal data
            });
            const result = await res.json();
            if (result.success) {
                alert(`Successfully imported ${result.count} photos!`);
                modal.style.display = 'none';
                loadPhotos();
                googleSelected.clear();
            } else {
                alert("Import failed partially.");
            }
        } catch (e) {
            alert("Error importing photos.");
        }
        importConfirmBtn.innerText = "Import Selected";
    });
}
