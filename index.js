/**
 * StreamBridge – Jellyfin → Stremio addon
 * Full Express server with parameterised manifest + stream routes
 * User data is embedded in the URL path as a base64-url string.
 */

const express      = require("express");
const path         = require("path");
const cors         = require("cors");
const jellyfin     = require("./jellyfinClient");   
require("dotenv").config();

const PORT = process.env.PORT || 7000;
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
    catalogs : [],
    resources: [
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
// ROOT route  →  / (redirects to configure page)
// ──────────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.redirect("/configure");
});

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURE route  →  /configure
// ──────────────────────────────────────────────────────────────────────────
app.get("/configure", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "configure.html")));

app.get("/:cfg/configure", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "configure.html"));
});
// ──────────────────────────────────────────────────────────────────────────
// Start the server
// ──────────────────────────────────────────────────────────────────────────
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () =>
  console.log(`🚀  StreamBridge up at http://${HOST}:${PORT}/<cfg>/manifest.json`)
);
