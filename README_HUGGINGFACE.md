---
title: EP-FIN
emoji: 🎬
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
---

# EP-FIN: Jellyfin to Stremio Addon

**EP-FIN** is a Stremio addon that lets you stream content from your personal or shared Jellyfin server using IMDb or TMDb IDs.

## 🚀 Quick Start

1. **Access the configure page**: Visit `/configure` in your browser
2. **Enter your Jellyfin credentials**:
   - Server URL (must be HTTPS)
   - Username
   - Password
3. **Get your Access Token**: Click "Get Access Info" to retrieve your User ID and Access Token
4. **Install the addon**: Click "Create & Install Addon" and follow the installation link

## 📋 Requirements

- Your Jellyfin server must be accessible via **HTTPS** (HTTP and localhost are not supported)
- Your Jellyfin server must be publicly accessible from the internet

## 🔧 Features

- ✅ One-page setup with automatic token generation
- ✅ IMDb / TMDb / TVDB / AniDB ID matching
- ✅ Direct-play multi-quality streams
- ✅ Automatic subtitle loading
- ✅ Support for movies and series

## 📖 Usage

After installation, browse titles in Stremio using catalog addons like Cinemeta. When you click on a movie or episode, EP-FIN will check if it exists in your Jellyfin library and return a direct play link if found.

## ⚠️ Important Notes

- This addon requires your Jellyfin server to be accessible via HTTPS
- The server must be publicly accessible (not just localhost)
- Your credentials are encoded in the addon URL but never stored on our servers

## 🔗 Links

- [GitHub Repository](https://github.com/h4harsimran/streambridge)

