# Google Photos Integration Setup Guide

Since this Photo Frame application runs on your own device (Raspberry Pi/PC) rather than a central cloud server, you need to create your own "Keys" to allow it to talk to Google Photos safely.

This is a **one-time setup**. Once done, anyone using this frame can log in easily.

---

## Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown in the top left and select **"New Project"**.
3. Name it something like `PhotoFrame-Pi` and click **Create**.
4. Select the new project from the notification or dropdown.

## Step 2: Enable the Google Photos API
1. In the left sidebar, go to **APIs & Services** > **Library**.
2. Search for **"Photos Library API"**.
3. Click on **Photos Library API** and click **Enable**.

## Step 3: Configure the Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Choose **External** user type (unless you have a Google Workspace organization) and click **Create**.
3. **App Information**:
   - **App Name**: Photo Frame
   - **User Support Email**: Your email.
   - **Developer Contact Info**: Your email.
4. Click **Save and Continue** until you reach the **Test Users** step.
5. **IMPORTANT**: Click **Add Users** and add the Google Email Address(es) that you intend to use on this frame.
   - *Note: Until you "Publish" the app (which requires a review), only these specific emails can log in.*
6. Click **Save and Continue** to finish.

## Step 4: Create Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** (top bar) > **OAuth client ID**.
3. **Application Type**: Select **Web application**.
4. **Name**: `PhotoFrame Client`.
5. **Authorized Redirect URIs**:
   - Click **ADD URI**.
   - You must add the specific URLs you use to access the frame.
   - Valid examples:
     - `http://localhost:5000/api/google/callback` (For testing on PC)
     - `http://raspberrypi.local:5000/api/google/callback` (If accessing via hostname)
     - `http://192.168.1.50:5000/api/google/callback` (If you have a static IP)
   - *Tip: Add all of them if you aren't sure.*
6. Click **Create**.

## Step 5: Download the Key
1. A popup will appear. Click **Download JSON** (it looks like a download icon or says "Download JSON").
2. Rename this file to `client_secret.json`.
3. Place this file into the `data/` folder of your project:
   - Path: `g:\Projects\PhotoFrameUI\data\client_secret.json`

## Step 6: Restart & Connect
1. Restart your Photo Frame application (`python app.py`).
2. Refresh the web page.
3. Click **Google Photos**, sign in, and import your photos!
