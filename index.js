/**
 * StreamBridge – Jellyfin → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const fs           = require("fs");
require("dotenv").config();

// Load jellyfinClient with error handling
let jellyfin;
try {
  jellyfin = require("./jellyfinClient");
} catch (err) {
  console.error("Failed to load jellyfinClient:", err);
  // Continue anyway - routes will handle errors
}

// Hugging Face Spaces sets PORT=7860, default to 7000 for local dev
// Force 7860 for Hugging Face Spaces if PORT is not explicitly set
const PORT = parseInt(process.env.PORT || '7860', 10);
const app  = express();

// ──────────────────────────────────────────────────────────────────────────
// Global middleware & static assets
// ──────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────────────────────────────────
// Helper: build a naked manifest (no user-specific data yet)
// ──────────────────────────────────────────────────────────────────────────
function baseManifest () {
  return {
    id      : "org.streambridge.jellyfinresolver",
    version : "1.1.2",
    name    : "StreamBridge: Jellyfin to Stremio",
    description:
      "Stream media from your personal or shared Jellyfin server using IMDb/TMDB IDs.",
    catalogs : [
      {
        type: "movie",
        id: "jellyfin-movies",
        name: "Jellyfin Movies"
      },
      {
        type: "series",
        id: "jellyfin-series",
        name: "Jellyfin Series"
      }
    ],
    resources: [
      { name: "catalog",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] },
      { name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:"] }
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Jellyfin Server URL",  required: true },
      { key: "userId",      type: "text", title: "Jellyfin User ID",     required: true },
      { key: "accessToken", type: "text", title: "Jellyfin Access Token", required: true }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: decode the cfg string into an object
// ──────────────────────────────────────────────────────────────────────────
function decodeCfg(str) {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}   

// ──────────────────────────────────────────────────────────────────────────
// Parameterised MANIFEST route  →  /<cfg>/manifest.json
//     <cfg> is a base64-url-encoded JSON blob with {serverUrl,userId,accessToken}
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", (req, res) => {
  const cfgString = req.params.cfg;
  let cfg;
  try {
    cfg = decodeCfg(cfgString);    
  } catch (err) {
    console.error("[ERROR] Error decoding cfg in manifest route:", err.message);
    console.error("[ERROR] Problematic cfgString was:", cfgString);
    return res.status(400).json({ err: "Bad config in URL", details: err.message });
  }

  const mf = baseManifest();

  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined. This is the cause of the error.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }

  mf.id += "." + cfgString.slice(0, 8); 

  const serverHostname = (cfg && cfg.serverUrl) ? cfg.serverUrl.replace(/^https?:\/\//, "") : "Unknown Server";
  mf.name += ` (${serverHostname})`;
  mf.behaviorHints.configurationRequired = false;
  
  // Update catalog names to include server info
  if (mf.catalogs && mf.catalogs.length > 0) {
    mf.catalogs.forEach(cat => {
      cat.name = `${cat.name} (${serverHostname})`;
    });
  }

  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM route  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch {
    return res.json({ streams: [] });
  }

  const { id } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken)
    return res.json({ streams: [] });

  try {
    if (!jellyfin) {
      console.error("jellyfinClient not loaded");
      return res.json({ streams: [] });
    }
    const raw = await jellyfin.getStream(id, cfg);         
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .map(s => {
        // Build behaviorHints with enriched data
        const behaviorHints = {
          filename: s.mediaInfo?.filename ?? undefined,
          videoSize: s.mediaInfo?.size ?? undefined,
          notWebReady: true, // Default to true for safety
          bingeGroup: `jellyfin-${s.itemId}` // Enables auto-play for series episodes
        };
        
        return {
          name: "Jellyfin", // Simple consistent name for all streams
          description: s.streamDescription || s.qualityTitle || "Direct Play", // Full detailed technical information
          url: s.directPlayUrl,
          behaviorHints: behaviorHints,
          subtitles: s.subtitles || [] // Include subtitles if available
        };
      });
    // Set cache based on whether streams were found
    if (streams.length > 0) {
      res.set('Cache-Control', 'public, max-age=120');  // Cache for 2 minutes when streams exist
    } else {
      res.set('Cache-Control', 'no-cache');  // Don't cache empty results
    }

    res.json({ streams });
  } catch (e) {
    console.error("Stream handler error:", e);
    res.json({ streams: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// CATALOG route  →  /<cfg>/catalog/<type>/<catalogId>.json
//     Also supports: /<cfg>/catalog/<type>/<catalogId>/<extra>.json
// ──────────────────────────────────────────────────────────────────────────
app.get(["/:cfg/catalog/:type/:catalogId.json", "/:cfg/catalog/:type/:catalogId/:extra.json"], async (req, res) => {
  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch (err) {
    console.error("[CATALOG] Failed to decode config:", err);
    return res.json({ metas: [] });
  }

  const { type, catalogId, extra } = req.params;
  if (!cfg.serverUrl || !cfg.userId || !cfg.accessToken) {
    return res.json({ metas: [] });
  }

  if (!jellyfin) {
    console.error("jellyfinClient not loaded");
    return res.json({ metas: [] });
  }

  try {
    console.log(`[CATALOG] Request for ${type}/${catalogId}${extra ? `/${extra}` : ''}`);
    let items = [];
    
    if (type === "movie" && catalogId === "jellyfin-movies") {
      console.log(`[CATALOG] Fetching movies from Jellyfin...`);
      items = await jellyfin.getMovies(cfg) || [];
      console.log(`[CATALOG] Found ${items.length} movies from Jellyfin`);
    } else if (type === "series" && catalogId === "jellyfin-series") {
      console.log(`[CATALOG] Fetching series from Jellyfin...`);
      items = await jellyfin.getSeries(cfg) || [];
      console.log(`[CATALOG] Found ${items.length} series from Jellyfin`);
    } else {
      console.log(`[CATALOG] Unknown catalog: ${type}/${catalogId}`);
      return res.json({ metas: [] });
    }
    
    if (items.length === 0) {
      console.log(`[CATALOG] No items found in Jellyfin library`);
      return res.json({ metas: [] });
    }

    // Convert Jellyfin items to Stremio meta format
    let itemsWithIds = 0;
    let itemsWithoutIds = 0;
    const metas = items
      .map(item => {
        const providerIds = item.ProviderIds || {};
        const hasImdb = providerIds.Imdb || providerIds.imdb || providerIds.IMDB;
        const hasTmdb = providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB;
        
        if (!hasImdb && !hasTmdb) {
          itemsWithoutIds++;
          return null; // Skip items without IDs
        }
        itemsWithIds++;
        
        // Extract IDs
        const imdbId = providerIds.Imdb || providerIds.imdb || providerIds.IMDB;
        const tmdbId = providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB;
        
        // Build Stremio ID (prefer IMDb, fallback to TMDB)
        let id;
        if (imdbId) {
          id = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
        } else if (tmdbId) {
          id = `tmdb:${tmdbId}`;
        } else {
          return null; // Skip items without IDs
        }

        const meta = {
          id: id,
          type: type,
          name: item.Name || "Untitled",
          overview: item.Overview || "",
          releaseInfo: item.ProductionYear ? `${item.ProductionYear}` : undefined,
          runtime: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000000) : undefined, // Convert to seconds
          genres: item.Genres || []
        };

        // Add poster/background images if available
        if (item.ImageTags && item.ImageTags.Primary) {
          meta.poster = `${cfg.serverUrl}/Items/${item.Id}/Images/Primary?api_key=${cfg.accessToken}`;
        }
        if (item.ImageTags && item.ImageTags.Backdrop) {
          meta.background = `${cfg.serverUrl}/Items/${item.Id}/Images/Backdrop?api_key=${cfg.accessToken}`;
        }

        return meta;
      })
      .filter(meta => meta !== null); // Remove nulls

    console.log(`[CATALOG] Items with IDs: ${itemsWithIds}, without IDs: ${itemsWithoutIds}`);
    console.log(`[CATALOG] Converted to ${metas.length} Stremio meta items`);
    
    if (metas.length === 0) {
      console.error(`[CATALOG] WARNING: No items with IMDb/TMDB IDs found!`);
      console.error(`[CATALOG] This means items in your Jellyfin library don't have metadata IDs.`);
      console.error(`[CATALOG] You may need to refresh metadata in Jellyfin.`);
    }
    
    // Cache catalog for 1 hour
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ metas });
  } catch (e) {
    console.error("Catalog handler error:", e);
    res.json({ metas: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// FALLBACK manifest for users who hit /manifest.json with no cfg
//     (Stremio will show its built-in config form)
// ──────────────────────────────────────────────────────────────────────────
app.get("/manifest.json", (_req, res) => {
  const mf = baseManifest();
  if (!mf) {
    console.error("[FATAL] baseManifest() returned undefined for fallback route.");
    return res.status(500).json({ err: "Server error: Failed to generate base manifest object." });
  }
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// HEALTH CHECK route (for Hugging Face Spaces)
// ──────────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "streambridge" });
});

// ──────────────────────────────────────────────────────────────────────────
// ROOT route  →  / (redirects to configure page)
// ──────────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.redirect("/configure");
});

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURE route  →  /configure (must be before /:cfg/configure)
// ──────────────────────────────────────────────────────────────────────────
app.get("/configure", (_req, res) => {
  const filePath = path.join(__dirname, "public", "configure.html");
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error("configure.html not found at:", filePath);
    console.error("Current directory:", __dirname);
    try {
      const publicDir = path.join(__dirname, "public");
      if (fs.existsSync(publicDir)) {
        console.error("Files in public:", fs.readdirSync(publicDir));
      } else {
        console.error("Public directory does not exist!");
      }
    } catch (err) {
      console.error("Error reading public directory:", err);
    }
    return res.status(500).send("Configuration file not found");
  }
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending configure.html:", err);
      res.status(500).send("Error loading configuration page: " + err.message);
    }
  });
});

app.get("/:cfg/configure", (req, res) => {
  const filePath = path.join(__dirname, "public", "configure.html");
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error("configure.html not found at:", filePath);
    return res.status(500).send("Configuration file not found");
  }
  
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending configure.html:", err);
      res.status(500).send("Error loading configuration page: " + err.message);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Error handling middleware
// ──────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// ──────────────────────────────────────────────────────────────────────────
// Start the server with error handling
// ──────────────────────────────────────────────────────────────────────────
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀  StreamBridge up at http://${HOST}:${PORT}/<cfg>/manifest.json`);
  console.log(`📋  Configure page: http://${HOST}:${PORT}/configure`);
  console.log(`💚  Health check: http://${HOST}:${PORT}/health`);
  console.log(`✅  Server listening on port ${PORT}`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Don't exit - let the server keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let the server keep running
});
