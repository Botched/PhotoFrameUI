#!/usr/bin/env python3
"""
Migration script to generate thumbnails for existing photos.
Run once after enabling thumbnail support: python migrate_thumbnails.py
"""
import os
import json
from PIL import Image, ImageOps

UPLOAD_FOLDER = os.path.join('static', 'uploads')
THUMBNAIL_FOLDER = os.path.join('static', 'thumbnails')
PHOTOS_META_FILE = os.path.join('data', 'photos.json')
THUMBNAIL_SIZE = (300, 300)
THUMBNAIL_QUALITY = 80


def generate_thumbnail(source_path, filename):
    """Generate a thumbnail for the given image."""
    thumb_full_path = os.path.join(THUMBNAIL_FOLDER, filename)

    # Ensure directory exists
    thumb_dir = os.path.dirname(thumb_full_path)
    if thumb_dir:
        os.makedirs(thumb_dir, exist_ok=True)

    try:
        with Image.open(source_path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)

            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            img.save(thumb_full_path, 'JPEG', quality=THUMBNAIL_QUALITY, optimize=True)

        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def main():
    print("Thumbnail Migration Script")
    print("=" * 50)

    # Ensure thumbnail directory exists
    os.makedirs(THUMBNAIL_FOLDER, exist_ok=True)

    # Load photo metadata
    if not os.path.exists(PHOTOS_META_FILE):
        print("No photos.json found. Nothing to migrate.")
        return

    with open(PHOTOS_META_FILE, 'r') as f:
        meta = json.load(f)

    total = len(meta)
    success = 0
    skipped = 0
    failed = 0

    print(f"Found {total} photos to process\n")

    for filename in meta.keys():
        source_path = os.path.join(UPLOAD_FOLDER, filename)
        thumb_path = os.path.join(THUMBNAIL_FOLDER, filename)

        # Skip if thumbnail already exists
        if os.path.exists(thumb_path):
            print(f"[SKIP] {filename} - thumbnail exists")
            skipped += 1
            continue

        if not os.path.exists(source_path):
            print(f"[MISS] {filename} - source not found")
            failed += 1
            continue

        print(f"[GEN]  {filename}...", end=" ")
        if generate_thumbnail(source_path, filename):
            print("OK")
            success += 1
        else:
            failed += 1

    print("\n" + "=" * 50)
    print(f"Migration complete!")
    print(f"  Generated: {success}")
    print(f"  Skipped:   {skipped}")
    print(f"  Failed:    {failed}")
    print(f"  Total:     {total}")


if __name__ == '__main__':
    main()
