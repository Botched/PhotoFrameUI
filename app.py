import os
import json
import time
import uuid
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import shutil
import requests
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# Google Photos Config
SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly']
CLIENT_SECRETS_FILE = os.path.join('data', 'client_secret.json')
CREDENTIALS_FILE = os.path.join('data', 'credentials.json')

# Allow HTTP for local testing
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'uploads')
app.config['DATA_FOLDER'] = 'data'
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB max upload

# Ensure directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['DATA_FOLDER'], exist_ok=True)

SETTINGS_FILE = os.path.join(app.config['DATA_FOLDER'], 'settings.json')
PHOTOS_META_FILE = os.path.join(app.config['DATA_FOLDER'], 'photos.json')

DEFAULT_SETTINGS = {
    "rotation_speed": 10,  # seconds
    "transition": "fade",
    "sleep_enabled": False,
    "sleep_start": "22:00",
    "sleep_end": "08:00"
}

def load_settings():
    if not os.path.exists(SETTINGS_FILE):
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS
    try:
        with open(SETTINGS_FILE, 'r') as f:
            return json.load(f)
    except:
        return DEFAULT_SETTINGS

def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=4)

def load_photos_meta():
    if not os.path.exists(PHOTOS_META_FILE):
        return {}
    try:
        with open(PHOTOS_META_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_photos_meta(meta):
    with open(PHOTOS_META_FILE, 'w') as f:
        json.dump(meta, f, indent=4)

def sync_photos():
    """Scan upload folder recursively and sync with metadata"""
    meta = load_photos_meta()
    
    # 1. Scan disk
    files_on_disk = set()
    upload_root = app.config['UPLOAD_FOLDER']
    
    for root, dirs, files in os.walk(upload_root):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp')):
                # Create relative path from upload_root
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, upload_root).replace('\\', '/')
                files_on_disk.add(rel_path)

    # 2. Remove metadata for missing files
    keys_to_remove = [k for k in meta if k not in files_on_disk]
    for k in keys_to_remove:
        del meta[k]
        
    # 3. Add new files
    for f in files_on_disk:
        if f not in meta:
            folder = os.path.dirname(f)
            meta[f] = {
                "filename": f,
                "folder": folder if folder else ".",
                "active": True,
                "added": time.time()
            }
            
    save_photos_meta(meta)
    return meta

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/frame')
def frame():
    return render_template('frame.html')

@app.route('/api/photos', methods=['GET'])
def get_photos():
    meta = sync_photos()
    # Return list sorted by added date desc
    photos = sorted(meta.values(), key=lambda x: x.get('added', 0), reverse=True)
    return jsonify(photos)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        # Handle folder structure if provided
        rel_path = request.form.get('path', '')
        # Sanitize path components
        safe_path_parts = [secure_filename(p) for p in rel_path.split('/') if p and p != '.']
        safe_rel_path = os.path.join(*safe_path_parts) if safe_path_parts else ''
        
        target_dir = os.path.join(app.config['UPLOAD_FOLDER'], safe_rel_path)
        os.makedirs(target_dir, exist_ok=True)
        
        filename = secure_filename(file.filename)
        # Avoid collisions if same name exists in same folder
        unique_name = filename
        if os.path.exists(os.path.join(target_dir, filename)):
             base, ext = os.path.splitext(filename)
             unique_name = f"{base}_{uuid.uuid4().hex[:6]}{ext}"
        
        file.save(os.path.join(target_dir, unique_name))
        
        # Determine stored path key
        stored_key = os.path.join(safe_rel_path, unique_name).replace('\\', '/')
        
        # Update meta
        meta = load_photos_meta()
        meta[stored_key] = {
            "filename": stored_key,
            "folder": safe_rel_path.replace('\\', '/') or ".",
            "active": True,
            "added": time.time()
        }
        save_photos_meta(meta)
        
        return jsonify({'success': True, 'filename': stored_key})

@app.route('/api/photo/<path:filename>', methods=['DELETE'])
def delete_photo(filename):
    # secure_filename is too aggressive for paths, we rely on previous sanitization and basic checks
    # but for safety, we construct path carefully
    upload_root = os.path.abspath(app.config['UPLOAD_FOLDER'])
    target_path = os.path.abspath(os.path.join(upload_root, filename))
    
    # Jail check
    if not target_path.startswith(upload_root):
        return jsonify({'error': 'Invalid path'}), 403
    
    if os.path.exists(target_path):
        os.remove(target_path)
        
    meta = load_photos_meta()
    if filename in meta:
        del meta[filename]
        save_photos_meta(meta)
        
    return jsonify({'success': True})

@app.route('/api/folder/delete', methods=['POST'])
def delete_folder():
    data = request.json
    folder_path = data.get('folder', '.')
    
    if folder_path == '.' or not folder_path:
        return jsonify({'error': 'Cannot delete root folder'}), 400

    # Safety: clean path
    safe_path_parts = [secure_filename(p) for p in folder_path.split('/') if p and p != '.']
    safe_rel_path = os.path.join(*safe_path_parts)
    
    upload_root = os.path.abspath(app.config['UPLOAD_FOLDER'])
    target_path = os.path.abspath(os.path.join(upload_root, safe_rel_path))
    
    if not target_path.startswith(upload_root):
        return jsonify({'error': 'Invalid path'}), 403
        
    if os.path.exists(target_path):
        import shutil
        shutil.rmtree(target_path)
    
    # Sync will clean up metadata
    sync_photos()
    
    return jsonify({'success': True})

@app.route('/api/batch/move', methods=['POST'])
def move_photos():
    # ... existing implementation ...
    data = request.json
    filenames = data.get('filenames', [])
    target_folder = data.get('folder', '').strip()
    
    # Sanitize target folder
    if target_folder == '.' or target_folder == '':
         safe_target_rel = ''
    else:
        safe_parts = [secure_filename(p) for p in target_folder.split('/') if p and p != '.']
        safe_target_rel = os.path.join(*safe_parts)
    
    upload_root = os.path.abspath(app.config['UPLOAD_FOLDER'])
    abs_target_dir = os.path.join(upload_root, safe_target_rel)
    os.makedirs(abs_target_dir, exist_ok=True)
    
    meta = load_photos_meta()
    moved_count = 0
    
    for fname in filenames:
        # fname is relative path like "folder/image.jpg"
        if fname not in meta:
            continue
            
        old_abs_path = os.path.abspath(os.path.join(upload_root, fname))
        
        # Security check
        if not old_abs_path.startswith(upload_root):
            continue
            
        if os.path.exists(old_abs_path):
            filename_only = os.path.basename(fname)
            new_rel_path = os.path.join(safe_target_rel, filename_only).replace('\\', '/')
            new_abs_path = os.path.join(abs_target_dir, filename_only)
            
            # Prevent overwrite
            if old_abs_path != new_abs_path:
                try:
                    shutil.move(old_abs_path, new_abs_path)
                    
                    # Update metadata
                    meta[new_rel_path] = meta[fname].copy()
                    meta[new_rel_path]['filename'] = new_rel_path
                    meta[new_rel_path]['folder'] = safe_target_rel.replace('\\', '/') or '.'
                    del meta[fname]
                    moved_count += 1
                except Exception as e:
                    print(f"Error moving {fname}: {e}")

    save_photos_meta(meta)
    return jsonify({'success': True, 'moved': moved_count})

# --- Google Photos Integration ---

def get_google_creds():
    creds = None
    if os.path.exists(CREDENTIALS_FILE):
        try:
            creds = Credentials.from_authorized_user_file(CREDENTIALS_FILE, SCOPES)
        except:
            pass
            
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(CREDENTIALS_FILE, 'w') as token:
                token.write(creds.to_json())
    return creds

@app.route('/api/google/auth_url')
def google_auth_url():
    if not os.path.exists(CLIENT_SECRETS_FILE):
        return jsonify({'error': 'Missing client_secret.json'}), 500
        
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri='http://localhost:5000/api/google/callback'
    )
    
    auth_url, _ = flow.authorization_url(prompt='consent')
    return jsonify({'url': auth_url})

@app.route('/api/google/callback')
def google_callback():
    code = request.args.get('code')
    if not code:
        return "Error: No code provided", 400
        
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri='http://localhost:5000/api/google/callback'
    )
    
    flow.fetch_token(code=code)
    creds = flow.credentials
    
    with open(CREDENTIALS_FILE, 'w') as token:
        token.write(creds.to_json())
        
    return "<script>window.close();</script>" # Close popup

@app.route('/api/google/photos')
def google_list_photos():
    creds = get_google_creds()
    if not creds:
        return jsonify({'authenticated': False})
        
    try:
        # Fetch photos
        headers = {'Authorization': f'Bearer {creds.token}'}
        # Get last 50 media items
        response = requests.get(
            'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=50',
            headers=headers
        )
        if response.status_code != 200:
             return jsonify({'error': 'Failed to fetch photos', 'details': response.text}), 500
             
        data = response.json()
        items = []
        if 'mediaItems' in data:
            for item in data['mediaItems']:
                if item.get('mimeType', '').startswith('image/'):
                    items.append({
                        'id': item['id'],
                        'url': item['baseUrl'], # Valid for 60 mins
                        'filename': item.get('filename', 'photo.jpg')
                    })
        return jsonify({'authenticated': True, 'photos': items})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/google/import', methods=['POST'])
def google_import():
    creds = get_google_creds()
    if not creds:
        return jsonify({'error': 'Not authenticated'}), 401
        
    data = request.json
    items = data.get('items', []) # List of {url, filename}
    
    upload_root = app.config['UPLOAD_FOLDER']
    imported_count = 0
    
    for item in items:
        # Append =d to get full resolution download
        download_url = f"{item['url']}=d"
        filename = secure_filename(item['filename'])
        
        # Ensure unique
        base,ext = os.path.splitext(filename)
        unique_name = f"{base}_{uuid.uuid4().hex[:6]}{ext}"
        save_path = os.path.join(upload_root, unique_name)
        
        try:
            r = requests.get(download_url, stream=True)
            if r.status_code == 200:
                with open(save_path, 'wb') as f:
                    for chunk in r.iter_content(1024):
                        f.write(chunk)
                
                # Update meta
                meta = load_photos_meta()
                meta[unique_name] = {
                    "filename": unique_name,
                    "folder": ".",
                    "active": True,
                    "added": time.time()
                }
                save_photos_meta(meta)
                imported_count += 1
        except Exception as e:
            print(f"Failed to import {filename}: {e}")
            
    return jsonify({'success': True, 'count': imported_count})

@app.route('/api/folder/toggle', methods=['POST'])
def toggle_folder():
    data = request.json
    folder_path = data.get('folder', '.')
    active_state = data.get('active', True)
    
    meta = load_photos_meta()
    changed_count = 0
    
    for key, info in meta.items():
        # Check if file belongs to folder (or subfolder if needed, but for now exact folder match or direct child)
        # Requirement: "folder (and all its contents)"
        # We check provided folder against info['folder']
        # If folder_path is ".", it matches root files
        # If folder_path is "Vacation", it matches "Vacation" and "Vacation/2023" ideally
        
        file_folder = info.get('folder', '.')
        
        # Match logic: exact match OR file_folder starts with folder_path + '/'
        is_match = (file_folder == folder_path) or \
                   (folder_path != '.' and file_folder.startswith(folder_path + '/'))
                   
        if is_match:
            info['active'] = active_state
            changed_count += 1
            
    save_photos_meta(meta)
    return jsonify({'success': True, 'count': changed_count})

@app.route('/api/photo/toggle/<path:filename>', methods=['POST'])
def toggle_photo(filename):
    # filename here is a path like "vacation/img.jpg"
    meta = load_photos_meta()
    if filename in meta:
        meta[filename]['active'] = not meta[filename]['active']
        save_photos_meta(meta)
        return jsonify({'success': True, 'active': meta[filename]['active']})
    return jsonify({'error': 'Photo not found'}), 404

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'POST':
        new_settings = request.json
        current = load_settings()
        # Merge keys to avoid wiping unknown settings
        current.update(new_settings)
        save_settings(current)
        return jsonify(current)
    else:
        return jsonify(load_settings())

if __name__ == '__main__':
    # Run on all interfaces so it's accessible on network
    app.run(host='0.0.0.0', port=5000, debug=True)
