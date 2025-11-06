# Deploying to Hugging Face Spaces

This guide will help you deploy StreamBridge to Hugging Face Spaces.

## Prerequisites

- A Hugging Face account
- Git installed on your machine

## Deployment Steps

### 1. Create a New Space on Hugging Face

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces)
2. Click "Create new Space"
3. Fill in the details:
   - **Space name**: `streambridge` (or your preferred name)
   - **SDK**: Select **Docker**
   - **Visibility**: Public or Private (your choice)
   - Click "Create Space"

### 2. Prepare Your Repository

The following files are already created for Hugging Face Spaces:
- `Dockerfile` - Container configuration
- `.dockerignore` - Files to exclude from Docker build
- `README_HUGGINGFACE.md` - Space description (rename to `README.md` after deployment)

### 3. Push to Hugging Face

You have two options:

#### Option A: Using Git (Recommended)

```bash
# Add Hugging Face as a remote
git remote add huggingface https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME

# Push to Hugging Face
git push huggingface main
```

#### Option B: Using Hugging Face Web Interface

1. Go to your Space on Hugging Face
2. Click "Files and versions" tab
3. Click "Add file" → "Upload files"
4. Upload all your project files (or use drag & drop)

### 4. Configure the Space

1. Go to your Space settings
2. Make sure the **SDK** is set to **Docker**
3. The Space will automatically build using the `Dockerfile`

### 5. Update README for the Space

After deployment, you can:
- Rename `README_HUGGINGFACE.md` to `README.md` in your Space (this will replace the project README)
- Or keep both files and use the Hugging Face one for the Space description

### 6. Access Your Deployed Addon

Once deployed, your addon will be available at:
```
https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space
```

You can then:
- Visit `https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/configure` to set up the addon
- Use `https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/<cfg>/manifest.json` as your Stremio addon URL

## Important Notes

- Hugging Face Spaces automatically sets the `PORT` environment variable to `7860`
- The app will automatically bind to `0.0.0.0` for Docker compatibility
- Your Space will have HTTPS enabled by default
- The Space will automatically rebuild when you push changes

## Troubleshooting

### Build Fails

- Check the Space logs in the "Logs" tab
- Ensure all dependencies are listed in `package.json`
- Verify the Dockerfile is correct

### App Doesn't Start

- Check that the PORT is set correctly (should be 7860 for Hugging Face)
- Verify the app binds to `0.0.0.0` (already configured)
- Check the Space logs for errors

### CORS Issues

- The app already includes CORS middleware, so this should work out of the box

## Next Steps

After deployment:
1. Test the configure page at `/configure`
2. Generate your addon URL
3. Install it in Stremio
4. Enjoy streaming from your Jellyfin server!

