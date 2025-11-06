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
    version : "1.2.0",
    name    : "StreamBridge: Jellyfin to Stremio",
    description:
      "Stream media from your personal or shared Jellyfin server using IMDb/TMDB IDs.",
    catalogs : [], // Will be populated dynamically based on Jellyfin collections
    resources: [
      { name: "catalog",
        types: ["movie", "series"],
        idPrefixes: ["tt", "imdb:", "tmdb:", "jellyfin:"] },
      { name: "stream",
        types: ["movie", "series"] }
        // No idPrefixes restriction - makes it a universal stream provider like Torrentio
    ],
    types: ["movie", "series"],
    behaviorHints: { configurable: true, configurationRequired: true },
    config: [
      { key: "serverUrl",   type: "text", title: "Jellyfin Server URL",  required: true },
      { key: "accessToken", type: "text", title: "Jellyfin API Key", required: true }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: decode the cfg string into an object
// ──────────────────────────────────────────────────────────────────────────
function decodeCfg(str) {
  const cfg = JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
  // Normalize serverUrl - remove trailing slashes
  if (cfg.serverUrl) {
    cfg.serverUrl = cfg.serverUrl.replace(/\/+$/, '');
  }
  return cfg;
}   

// ──────────────────────────────────────────────────────────────────────────
// Parameterised MANIFEST route  →  /<cfg>/manifest.json
//     <cfg> is a base64-url-encoded JSON blob with {serverUrl,userId,accessToken}
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/manifest.json", async (req, res) => {
  const cfgString = req.params.cfg;
  console.log(`[MANIFEST] Request received - cfg length: ${cfgString.length}`);
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
  mf.name = `StreamBridge: Jellyfin to Stremio (${serverHostname})`;
  mf.behaviorHints.configurationRequired = false;
  
  // Dynamically fetch Libraries from Jellyfin and create catalogs for each
  try {
    if (jellyfin && cfg.serverUrl && cfg.accessToken) {
      const libraries = await jellyfin.getLibraries(cfg) || [];
      console.log(`[MANIFEST] Found ${libraries.length} libraries from Jellyfin`);
      
      // Create catalogs for each library - show ALL content
      for (const library of libraries) {
        const libraryName = library.Name || `Library ${library.Id}`;
        const libraryId = `jellyfin-library-${library.Id}`;
        
        // Determine library type based on CollectionType
        const collectionType = library.CollectionType || library.Type || '';
        
        // Always create both movie and series catalogs for every library
        // This ensures ALL content is accessible (movies, series, music videos shown as movies)
        mf.catalogs.push(
          { type: "movie", id: libraryId, name: libraryName },
          { type: "series", id: libraryId, name: libraryName }
        );
      }
      
      // If no libraries found, add default catalogs
      if (mf.catalogs.length === 0) {
        console.log(`[MANIFEST] No libraries found, adding default catalogs`);
        mf.catalogs.push(
          { type: "movie", id: "jellyfin-movies", name: "Movies" },
          { type: "series", id: "jellyfin-series", name: "Series" }
        );
      }
      
      console.log(`[MANIFEST] Created ${mf.catalogs.length} catalog(s) total`);
    } else {
      // Fallback to default catalogs if we can't fetch libraries
      mf.catalogs.push(
        { type: "movie", id: "jellyfin-movies", name: "Movies" },
        { type: "series", id: "jellyfin-series", name: "Series" }
      );
    }
  } catch (err) {
    console.error("[MANIFEST] Error fetching libraries:", err.message);
    console.error("[MANIFEST] Error stack:", err.stack);
    // Fallback to default catalogs on error
    mf.catalogs.push(
      { type: "movie", id: "jellyfin-movies", name: "Movies" },
      { type: "series", id: "jellyfin-series", name: "Series" }
    );
  }

  console.log(`[MANIFEST] Returning manifest for: ${mf.name}`);
  console.log(`[MANIFEST] Stream resource configured:`, mf.resources.find(r => r.name === 'stream'));
  res.json(mf);
});

// ──────────────────────────────────────────────────────────────────────────
// STREAM route  →  /<cfg>/stream/<type>/<id>.json
// ──────────────────────────────────────────────────────────────────────────
app.get("/:cfg/stream/:type/:id.json", async (req, res) => {
  // Set CORS headers explicitly
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  // Set timeout to prevent hanging - Stremio needs quick responses
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    console.error("[STREAM] Request timeout - returning empty streams");
    timeoutTriggered = true;
    if (!res.headersSent) {
      res.set('Cache-Control', 'no-cache');
      res.json({ streams: [] });
    }
  }, 15000); // 15 second timeout - reduced since we have 5s per API request

  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch (err) {
    console.error("[STREAM] Failed to decode config:", err);
    clearTimeout(timeout);
    return res.json({ streams: [] });
  }

  const { type, id } = req.params;
  console.log(`[STREAM] ==========================================`);
  console.log(`[STREAM] Request received from Stremio!`);
  console.log(`[STREAM] Type: ${type}, ID: ${id}`);
  console.log(`[STREAM] ==========================================`);
  
  if (!cfg.serverUrl || !cfg.accessToken) {
    console.error("[STREAM] Missing configuration (need serverUrl and accessToken)");
    clearTimeout(timeout);
    return res.json({ streams: [] });
  }
  
  // User ID is optional - will be auto-fetched if not provided
  if (!cfg.userId) {
    console.log("[STREAM] User ID not provided, will auto-fetch from API key");
  }

  if (!jellyfin) {
    console.error("[STREAM] jellyfinClient not loaded");
    clearTimeout(timeout);
    return res.json({ streams: [] });
  }

  try {
    // Log config info for debugging
    const apiKeyPreview = cfg.accessToken ? 
      `${cfg.accessToken.substring(0, 10)}...` : 'MISSING';
    const userIdPreview = cfg.userId || '(will auto-fetch)';
    console.log(`[STREAM] Config: Server=${cfg.serverUrl}, UserId=${userIdPreview}, APIKey=${apiKeyPreview}`);
    console.log(`[STREAM] Searching for ${type} with ID: ${id}`);
    const raw = await jellyfin.getStream(id, cfg);
    console.log(`[STREAM] Found ${raw?.length || 0} stream(s) from Jellyfin`);         
    const streams = (raw || [])
      .filter(s => s.directPlayUrl)
      .map(s => {
        // Build behaviorHints with enriched data (matching Stremio/StreamBridge format)
        const behaviorHints = {};
        if (s.mediaInfo?.filename) behaviorHints.filename = s.mediaInfo.filename;
        if (s.mediaInfo?.size) behaviorHints.videoSize = s.mediaInfo.size;
        // notWebReady: true means Stremio will use external player or direct stream
        // This is needed for Jellyfin direct play URLs
        behaviorHints.notWebReady = true;
        behaviorHints.externalPlayer = false; // Let Stremio handle playback
        if (s.itemId) behaviorHints.bingeGroup = `jellyfin-${s.itemId}`; // Enables auto-play for series
        
        const stream = {
          name: "StreamBridge",
          description: s.streamDescription || s.qualityTitle || "Direct Play",
          url: s.directPlayUrl,
          behaviorHints: Object.keys(behaviorHints).length > 0 ? behaviorHints : undefined
        };
        
        // Only add subtitles if they exist
        if (s.subtitles && s.subtitles.length > 0) {
          stream.subtitles = s.subtitles;
        }
        
        return stream;
      });
    // Set cache based on whether streams were found
    clearTimeout(timeout);
    if (timeoutTriggered) {
      console.log("[STREAM] Timeout already triggered, skipping response");
      return; // Timeout already sent response
    }
    
    if (streams.length > 0) {
      console.log(`[STREAM] Returning ${streams.length} stream(s) to Stremio`);
      res.set('Cache-Control', 'public, max-age=120');  // Cache for 2 minutes when streams exist
      res.json({ streams });
    } else {
      console.warn(`[STREAM] No streams found for ${type}/${id} - movie may not be in Jellyfin library`);
      res.set('Cache-Control', 'no-cache');  // Don't cache empty results
      res.json({ streams: [] });
    }
  } catch (e) {
    clearTimeout(timeout);
    console.error("[STREAM] Handler error:", e);
    console.error("[STREAM] Error stack:", e.stack);
    if (!timeoutTriggered && !res.headersSent) {
      res.set('Cache-Control', 'no-cache');
      res.json({ streams: [] });
    }
  }
});

// ──────────────────────────────────────────────────────────────────────────
// CATALOG route  →  /<cfg>/catalog/<type>/<catalogId>.json
//     Also supports: /<cfg>/catalog/<type>/<catalogId>/<extra>.json
// ──────────────────────────────────────────────────────────────────────────
app.get(["/:cfg/catalog/:type/:catalogId.json", "/:cfg/catalog/:type/:catalogId/:extra.json"], async (req, res) => {
  // Set CORS headers explicitly
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  // Set timeout to prevent hanging - Stremio needs responses but catalogs can be large
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    console.error("[CATALOG] Request timeout");
    timeoutTriggered = true;
    if (!res.headersSent) {
      res.set('Cache-Control', 'no-cache');
      res.json({ metas: [] });
    }
  }, 90000); // 90 second timeout for catalog requests (increased for very large libraries - 10k items = ~20 pages)

  let cfg;
  try {
    cfg = decodeCfg(req.params.cfg);
  } catch (err) {
    console.error("[CATALOG] Failed to decode config:", err);
    clearTimeout(timeout);
    return res.json({ metas: [] });
  }

  const { type, catalogId, extra } = req.params;
  if (!cfg.serverUrl || !cfg.accessToken) {
    console.error("[CATALOG] Missing configuration (need serverUrl and accessToken)");
    clearTimeout(timeout);
    return res.json({ metas: [] });
  }
  
  // User ID is optional - will be auto-fetched if not provided
  if (!cfg.userId) {
    console.log("[CATALOG] User ID not provided, will auto-fetch from API key");
  }

  if (!jellyfin) {
    console.error("[CATALOG] jellyfinClient not loaded");
    clearTimeout(timeout);
    return res.json({ metas: [] });
  }

  try {
    // Log config info for debugging
    const apiKeyPreview = cfg.accessToken ? 
      `${cfg.accessToken.substring(0, 10)}...` : 'MISSING';
    const userIdPreview = cfg.userId || '(will auto-fetch)';
    console.log(`[CATALOG] Config: Server=${cfg.serverUrl}, UserId=${userIdPreview}, APIKey=${apiKeyPreview}`);
    console.log(`[CATALOG] Request for ${type}/${catalogId}${extra ? `/${extra}` : ''}`);
    let items = [];
    
    // Handle library-specific catalogs (jellyfin-library-{libraryId})
    if (catalogId.startsWith("jellyfin-library-")) {
      const libraryId = catalogId.replace("jellyfin-library-", "");
      console.log(`[CATALOG] Fetching ALL items from library ${libraryId} (${type})...`);
      
      // Get ALL items from specific library (no type filter - get everything)
      const allItems = await jellyfin.getCollectionItems(libraryId, null, cfg) || [];
      console.log(`[CATALOG] Found ${allItems.length} total items from library ${libraryId}`);
      
      // Filter by type: movies + music videos for movie catalog, series for series catalog
      if (type === "movie") {
        // Include Movies and MusicVideo (treat music videos as movies)
        items = allItems.filter(item => 
          item.Type === "Movie" || 
          item.Type === "MusicVideo" ||
          item.Type === "Video" // Generic video items
        );
        console.log(`[CATALOG] Filtered to ${items.length} movie/MusicVideo items`);
      } else if (type === "series") {
        // Include Series only
        items = allItems.filter(item => item.Type === "Series");
        console.log(`[CATALOG] Filtered to ${items.length} series items`);
      } else {
        // Unknown type, return all items
        items = allItems;
      }
    } else if (type === "movie" && catalogId === "jellyfin-movies") {
      console.log(`[CATALOG] Fetching all movies from Jellyfin...`);
      items = await jellyfin.getMovies(cfg) || [];
      console.log(`[CATALOG] Found ${items.length} movies from Jellyfin`);
    } else if (type === "series" && catalogId === "jellyfin-series") {
      console.log(`[CATALOG] Fetching all series from Jellyfin...`);
      items = await jellyfin.getSeries(cfg) || [];
      console.log(`[CATALOG] Found ${items.length} series from Jellyfin`);
    } else if (catalogId.startsWith("jellyfin-collection-")) {
      // Handle old collection format (backward compatibility)
      const collectionId = catalogId.replace("jellyfin-collection-", "");
      console.log(`[CATALOG] Fetching items from collection ${collectionId} (${type})...`);
      items = await jellyfin.getCollectionItems(collectionId, type === "movie" ? "Movie" : (type === "series" ? "Series" : null), cfg) || [];
      console.log(`[CATALOG] Found ${items.length} ${type} items from collection ${collectionId}`);
    } else {
      console.log(`[CATALOG] Unknown catalog: ${type}/${catalogId}`);
      clearTimeout(timeout);
      return res.json({ metas: [] });
    }
    
    if (items.length === 0) {
      console.log(`[CATALOG] No items found in Jellyfin library`);
      clearTimeout(timeout);
      res.set('Cache-Control', 'no-cache');
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
        
        // Extract IDs
        const imdbId = providerIds.Imdb || providerIds.imdb || providerIds.IMDB;
        const tmdbId = providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB;
        
        // Build Stremio ID (prefer IMDb, fallback to TMDB, fallback to Jellyfin ID)
        let id;
        if (imdbId) {
          id = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
          itemsWithIds++;
        } else if (tmdbId) {
          id = `tmdb:${tmdbId}`;
          itemsWithIds++;
        } else {
          // Use Jellyfin internal ID for items without ProviderIds
          id = `jellyfin:${item.Id}`;
          itemsWithoutIds++;
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
    
    // Cache catalog for 30 seconds for near-instant updates when media is added to Jellyfin
    if (!timeoutTriggered && !res.headersSent) {
      res.set('Cache-Control', 'public, max-age=30');
      clearTimeout(timeout);
      res.json({ metas });
    } else {
      clearTimeout(timeout);
      console.log("[CATALOG] Response already sent (timeout or error), skipping");
    }
  } catch (e) {
    clearTimeout(timeout);
    console.error("[CATALOG] Handler error:", e);
    console.error("[CATALOG] Error stack:", e.stack);
    // Always return valid JSON response
    if (!timeoutTriggered && !res.headersSent) {
      res.set('Cache-Control', 'no-cache');
      res.json({ metas: [] });
    }
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
// TEST endpoint  →  /test-search?cfg=<base64config>&imdbId=tt0147800
// ──────────────────────────────────────────────────────────────────────────
app.get("/test-search", async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  console.log('[TEST-SEARCH] Request received');

  const cfgStr = req.query.cfg;
  if (!cfgStr) {
    console.log('[TEST-SEARCH] Missing cfg parameter');
    return res.status(400).json({ error: "Missing cfg parameter" });
  }

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(cfgStr, "base64url").toString("utf8"));
    if (cfg.serverUrl) {
      cfg.serverUrl = cfg.serverUrl.replace(/\/+$/, '');
    }
    console.log('[TEST-SEARCH] Config parsed:', { serverUrl: cfg.serverUrl, userId: cfg.userId || 'auto-detect' });
  } catch (err) {
    console.log('[TEST-SEARCH] Error parsing cfg:', err.message);
    return res.status(400).json({ error: "Invalid cfg parameter: " + err.message });
  }

  const testImdbId = req.query.imdbId || 'tt0147800';
  console.log('[TEST-SEARCH] Testing with IMDb ID:', testImdbId);
  
  const results = {
    config: {
      serverUrl: cfg.serverUrl,
      userId: cfg.userId || '(will auto-fetch)',
      apiKeyPreview: cfg.accessToken ? `${cfg.accessToken.substring(0, 10)}...` : 'MISSING'
    },
    testImdbId: testImdbId,
    tests: []
  };

  if (!jellyfin) {
    console.log('[TEST-SEARCH] Error: jellyfinClient not loaded');
    return res.status(500).json({ error: "jellyfinClient not loaded", results });
  }

  // Auto-fetch User ID if needed
  if (!cfg.userId) {
    const user = await jellyfin.getCurrentUser(cfg);
    if (user && user.Id) {
      cfg.userId = user.Id;
      results.config.userId = cfg.userId;
    }
  }

  const jellyfinApi = require('./jellyfinClient');
  const axios = require('axios');
  const HEADER_JELLYFIN_TOKEN = 'X-Emby-Token';

  // Test 1: /Users/{userId}/Items with ImdbId
  try {
    const url1 = `${cfg.serverUrl}/Users/${cfg.userId}/Items`;
    const params1 = {
      ImdbId: testImdbId,
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'ProviderIds,Name,Id',
      Limit: 10
    };
    const response1 = await axios({
      method: 'get',
      url: url1,
      headers: { [HEADER_JELLYFIN_TOKEN]: cfg.accessToken },
      params: params1,
      timeout: 10000
    });
    results.tests.push({
      name: '/Users/{userId}/Items with ImdbId parameter',
      url: url1,
      params: params1,
      status: response1.status,
      itemsCount: response1.data?.Items?.length || 0,
      items: (response1.data?.Items || []).slice(0, 3).map(item => ({
        name: item.Name,
        id: item.Id,
        providerIds: item.ProviderIds
      }))
    });
  } catch (err) {
    results.tests.push({
      name: '/Users/{userId}/Items with ImdbId parameter',
      error: err.message,
      status: err.response?.status
    });
  }

  // Test 2: /Users/{userId}/Items with AnyProviderIdEquals
  try {
    const url2 = `${cfg.serverUrl}/Users/${cfg.userId}/Items`;
    const params2 = {
      AnyProviderIdEquals: `imdb.${testImdbId}`,
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'ProviderIds,Name,Id',
      Limit: 10
    };
    const response2 = await axios({
      method: 'get',
      url: url2,
      headers: { [HEADER_JELLYFIN_TOKEN]: cfg.accessToken },
      params: params2,
      timeout: 10000
    });
    results.tests.push({
      name: '/Users/{userId}/Items with AnyProviderIdEquals=imdb.xxx',
      url: url2,
      params: params2,
      status: response2.status,
      itemsCount: response2.data?.Items?.length || 0,
      items: (response2.data?.Items || []).slice(0, 3).map(item => ({
        name: item.Name,
        id: item.Id,
        providerIds: item.ProviderIds
      }))
    });
  } catch (err) {
    results.tests.push({
      name: '/Users/{userId}/Items with AnyProviderIdEquals=imdb.xxx',
      error: err.message,
      status: err.response?.status
    });
  }

  // Test 3: Sample of movies to see ProviderIds format
  try {
    const url3 = `${cfg.serverUrl}/Users/${cfg.userId}/Items`;
    const params3 = {
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'ProviderIds,Name,Id',
      Limit: 5,
      StartIndex: 0
    };
    const response3 = await axios({
      method: 'get',
      url: url3,
      headers: { [HEADER_JELLYFIN_TOKEN]: cfg.accessToken },
      params: params3,
      timeout: 10000
    });
    results.tests.push({
      name: 'Sample movies (to see ProviderIds format)',
      url: url3,
      params: params3,
      status: response3.status,
      itemsCount: response3.data?.Items?.length || 0,
      items: (response3.data?.Items || []).map(item => ({
        name: item.Name,
        id: item.Id,
        providerIds: item.ProviderIds
      }))
    });
  } catch (err) {
    results.tests.push({
      name: 'Sample movies (to see ProviderIds format)',
      error: err.message,
      status: err.response?.status
    });
  }

  res.json(results);
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
