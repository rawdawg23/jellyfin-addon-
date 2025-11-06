const axios = require("axios");

// --- Constants ---
const ITEM_TYPE_MOVIE = 'Movie';
const ITEM_TYPE_EPISODE = 'Episode';
const ITEM_TYPE_SERIES = 'Series';
const HEADER_JELLYFIN_TOKEN = 'X-Emby-Token'; // Jellyfin uses the same header name as Emby
const DEFAULT_FIELDS = "ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber"; // Consolidated fields

// Codec to file format mapping for subtitles
const CODEC_FORMAT_MAP = {
  'subrip': 'srt',
  'webvtt': 'vtt',
  'ass': 'ass',
  'ssa': 'ssa'
};

// --- In-Memory Cache for Movies (to bypass Jellyfin's broken search API) ---
const movieCache = {
  items: [], // Array of all movie items
  indexedByImdb: new Map(), // Map<imdbId, Array<items>>
  indexedByTmdb: new Map(), // Map<tmdbId, Array<items>>
  indexedByTvdb: new Map(), // Map<tvdbId, Array<items>>
  indexedByAnidb: new Map(), // Map<anidbId, Array<items>>
  indexedById: new Map(), // Map<jellyfinId, item>
  lastUpdated: null,
  configHash: null // Hash of config to detect changes
};

// --- In-Memory Cache for Series (to bypass Jellyfin's broken search API) ---
const seriesCache = {
  items: [], // Array of all series items
  indexedByImdb: new Map(), // Map<imdbId, Array<items>>
  indexedByTmdb: new Map(), // Map<tmdbId, Array<items>>
  indexedByTvdb: new Map(), // Map<tvdbId, Array<items>>
  indexedByAnidb: new Map(), // Map<anidbId, Array<items>>
  indexedById: new Map(), // Map<jellyfinId, item>
  lastUpdated: null,
  configHash: null // Hash of config to detect changes
};

/**
 * Creates a hash from config for cache invalidation
 */
function getConfigHash(config) {
  return `${config.serverUrl}:${config.userId || 'auto'}`;
}

/**
 * Indexes movies in the cache for fast lookup
 */
function indexMovies(movies) {
  console.log(`[CACHE] Indexing ${movies.length} movies...`);
  
  // Clear old indexes
  movieCache.indexedByImdb.clear();
  movieCache.indexedByTmdb.clear();
  movieCache.indexedByTvdb.clear();
  movieCache.indexedByAnidb.clear();
  movieCache.indexedById.clear();
  
  movies.forEach(item => {
    // Index by Jellyfin ID
    movieCache.indexedById.set(item.Id, item);
    
    // Index by ProviderIds
    if (item.ProviderIds) {
      // IMDb
      if (item.ProviderIds.Imdb || item.ProviderIds.imdb || item.ProviderIds.IMDB) {
        const imdbId = item.ProviderIds.Imdb || item.ProviderIds.imdb || item.ProviderIds.IMDB;
        const imdbKey = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
        if (!movieCache.indexedByImdb.has(imdbKey)) {
          movieCache.indexedByImdb.set(imdbKey, []);
        }
        movieCache.indexedByImdb.get(imdbKey).push(item);
      }
      
      // TMDb
      if (item.ProviderIds.Tmdb || item.ProviderIds.tmdb || item.ProviderIds.TMDB) {
        const tmdbId = String(item.ProviderIds.Tmdb || item.ProviderIds.tmdb || item.ProviderIds.TMDB);
        if (!movieCache.indexedByTmdb.has(tmdbId)) {
          movieCache.indexedByTmdb.set(tmdbId, []);
        }
        movieCache.indexedByTmdb.get(tmdbId).push(item);
      }
      
      // TVDB
      if (item.ProviderIds.Tvdb || item.ProviderIds.tvdb || item.ProviderIds.TVDB) {
        const tvdbId = String(item.ProviderIds.Tvdb || item.ProviderIds.tvdb || item.ProviderIds.TVDB);
        if (!movieCache.indexedByTvdb.has(tvdbId)) {
          movieCache.indexedByTvdb.set(tvdbId, []);
        }
        movieCache.indexedByTvdb.get(tvdbId).push(item);
      }
      
      // AniDB
      if (item.ProviderIds.AniDb || item.ProviderIds.anidb || item.ProviderIds.ANIDB) {
        const anidbId = String(item.ProviderIds.AniDb || item.ProviderIds.anidb || item.ProviderIds.ANIDB);
        if (!movieCache.indexedByAnidb.has(anidbId)) {
          movieCache.indexedByAnidb.set(anidbId, []);
        }
        movieCache.indexedByAnidb.get(anidbId).push(item);
      }
    }
  });
  
  console.log(`[CACHE] Indexed: ${movieCache.indexedByImdb.size} IMDb IDs, ${movieCache.indexedByTmdb.size} TMDb IDs, ${movieCache.indexedByTvdb.size} TVDB IDs, ${movieCache.indexedByAnidb.size} AniDB IDs`);
}

/**
 * Indexes series in the cache for fast lookup
 */
function indexSeries(series) {
  console.log(`[CACHE] Indexing ${series.length} series...`);
  
  // Clear old indexes
  seriesCache.indexedByImdb.clear();
  seriesCache.indexedByTmdb.clear();
  seriesCache.indexedByTvdb.clear();
  seriesCache.indexedByAnidb.clear();
  seriesCache.indexedById.clear();
  
  series.forEach(item => {
    // Index by Jellyfin ID
    seriesCache.indexedById.set(item.Id, item);
    
    // Index by ProviderIds
    if (item.ProviderIds) {
      // IMDb
      if (item.ProviderIds.Imdb || item.ProviderIds.imdb || item.ProviderIds.IMDB) {
        const imdbId = item.ProviderIds.Imdb || item.ProviderIds.imdb || item.ProviderIds.IMDB;
        const imdbKey = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
        if (!seriesCache.indexedByImdb.has(imdbKey)) {
          seriesCache.indexedByImdb.set(imdbKey, []);
        }
        seriesCache.indexedByImdb.get(imdbKey).push(item);
      }
      
      // TMDb
      if (item.ProviderIds.Tmdb || item.ProviderIds.tmdb || item.ProviderIds.TMDB) {
        const tmdbId = String(item.ProviderIds.Tmdb || item.ProviderIds.tmdb || item.ProviderIds.TMDB);
        if (!seriesCache.indexedByTmdb.has(tmdbId)) {
          seriesCache.indexedByTmdb.set(tmdbId, []);
        }
        seriesCache.indexedByTmdb.get(tmdbId).push(item);
      }
      
      // TVDB
      if (item.ProviderIds.Tvdb || item.ProviderIds.tvdb || item.ProviderIds.TVDB) {
        const tvdbId = String(item.ProviderIds.Tvdb || item.ProviderIds.tvdb || item.ProviderIds.TVDB);
        if (!seriesCache.indexedByTvdb.has(tvdbId)) {
          seriesCache.indexedByTvdb.set(tvdbId, []);
        }
        seriesCache.indexedByTvdb.get(tvdbId).push(item);
      }
      
      // AniDB
      if (item.ProviderIds.AniDb || item.ProviderIds.anidb || item.ProviderIds.ANIDB) {
        const anidbId = String(item.ProviderIds.AniDb || item.ProviderIds.anidb || item.ProviderIds.ANIDB);
        if (!seriesCache.indexedByAnidb.has(anidbId)) {
          seriesCache.indexedByAnidb.set(anidbId, []);
        }
        seriesCache.indexedByAnidb.get(anidbId).push(item);
      }
    }
  });
  
  console.log(`[CACHE] Indexed: ${seriesCache.indexedByImdb.size} IMDb IDs, ${seriesCache.indexedByTmdb.size} TMDb IDs, ${seriesCache.indexedByTvdb.size} TVDB IDs, ${seriesCache.indexedByAnidb.size} AniDB IDs`);
}

/**
 * Adds movies to cache (called when catalog items are fetched)
 */
function addMoviesToCache(movies) {
  if (!movies || movies.length === 0) return;
  
  const newMovies = movies.filter(movie => {
    // Only add if not already in cache
    return !movieCache.indexedById.has(movie.Id);
  });
  
  if (newMovies.length > 0) {
    console.log(`[CACHE] Adding ${newMovies.length} new movies to cache...`);
    movieCache.items.push(...newMovies);
    
    // Re-index all movies
    indexMovies(movieCache.items);
    movieCache.lastUpdated = Date.now();
    console.log(`[CACHE] Cache now contains ${movieCache.items.length} movies`);
  }
}

/**
 * Loads ALL movies into cache using pagination
 */
async function loadMovieCache(config, forceRefresh = false) {
  const configHash = getConfigHash(config);
  
  // Check if cache is valid (never expires - only reloads on forceRefresh or config change)
  if (!forceRefresh && movieCache.items.length > 0 && movieCache.configHash === configHash) {
    const cacheAge = Date.now() - movieCache.lastUpdated;
    console.log(`[CACHE] Using cached movies (${Math.floor(cacheAge / 1000)}s old, ${movieCache.items.length} items)`);
    return movieCache.items;
  }
  
  // Load ALL movies using pagination
  if (forceRefresh || movieCache.items.length === 0 || movieCache.configHash !== configHash) {
    console.log(`[CACHE] Loading ALL movies from Jellyfin...`);
    
    const allMovies = [];
    const pageSize = 500; // Fetch in chunks to avoid timeouts
    let startIndex = 0;
    let hasMore = true;
    let totalRecords = 0;
    
    try {
      while (hasMore) {
        const params = {
          IncludeItemTypes: ITEM_TYPE_MOVIE,
          Recursive: true,
          Fields: DEFAULT_FIELDS,
          Limit: pageSize,
          StartIndex: startIndex,
          UserId: config.userId
        };
        
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, params, config, 30000);
        
        if (!data || !data.Items || data.Items.length === 0) {
          hasMore = false;
          break;
        }
        
        const items = data.Items || [];
        totalRecords = data.TotalRecordCount || items.length;
        
        allMovies.push(...items);
        console.log(`[CACHE] Loaded ${allMovies.length} / ${totalRecords} movies...`);
        
        // Check if we've got all items
        if (items.length < pageSize) {
          hasMore = false;
        } else if (totalRecords > 0 && allMovies.length >= totalRecords) {
          hasMore = false;
        } else {
          startIndex += pageSize;
          // Safety limit to prevent infinite loops (max 10,000 pages = 5 million items)
          if (startIndex >= pageSize * 10000) {
            console.warn(`[CACHE] Reached safety limit, stopping pagination`);
            hasMore = false;
          }
        }
      }
      
      if (allMovies.length > 0) {
        movieCache.items = allMovies;
        movieCache.configHash = configHash;
        movieCache.lastUpdated = Date.now();
        indexMovies(allMovies);
        console.log(`[CACHE] ✅ Loaded ALL ${allMovies.length} movies into cache`);
      } else {
        console.log(`[CACHE] No movies found in library`);
      }
    } catch (err) {
      console.error(`[CACHE] Failed to load movies: ${err.message}`);
      // If we got some movies before error, use those
      if (allMovies.length > 0) {
        movieCache.items = allMovies;
        movieCache.configHash = configHash;
        movieCache.lastUpdated = Date.now();
        indexMovies(allMovies);
        console.log(`[CACHE] Partial load: ${allMovies.length} movies (error occurred)`);
      }
    }
  }
  
  return movieCache.items;
}

/**
 * Adds series to cache (called when catalog items are fetched)
 * This ensures new series added to Jellyfin are immediately available
 */
function addSeriesToCache(series) {
  if (!series || series.length === 0) return;
  
  const newSeries = series.filter(s => {
    // Only add if not already in cache
    return !seriesCache.indexedById.has(s.Id);
  });
  
  if (newSeries.length > 0) {
    console.log(`[CACHE] Adding ${newSeries.length} new series to cache (new series detected!)...`);
    seriesCache.items.push(...newSeries);
    
    // Re-index all series
    indexSeries(seriesCache.items);
    seriesCache.lastUpdated = Date.now();
    console.log(`[CACHE] ✅ Cache now contains ${seriesCache.items.length} series (${newSeries.length} new)`);
  }
}

/**
 * Loads ALL series into cache using pagination
 */
async function loadSeriesCache(config, forceRefresh = false) {
  const configHash = getConfigHash(config);
  
  // Check if cache is valid (never expires - only reloads on forceRefresh or config change)
  if (!forceRefresh && seriesCache.items.length > 0 && seriesCache.configHash === configHash) {
    const cacheAge = Date.now() - seriesCache.lastUpdated;
    console.log(`[CACHE] Using cached series (${Math.floor(cacheAge / 1000)}s old, ${seriesCache.items.length} items)`);
    return seriesCache.items;
  }
  
  // Load ALL series using pagination
  if (forceRefresh || seriesCache.items.length === 0 || seriesCache.configHash !== configHash) {
    console.log(`[CACHE] Loading ALL series from Jellyfin...`);
    
    const allSeries = [];
    const pageSize = 500; // Fetch in chunks to avoid timeouts
    let startIndex = 0;
    let hasMore = true;
    let totalRecords = 0;
    
    try {
      while (hasMore) {
        const params = {
          IncludeItemTypes: ITEM_TYPE_SERIES,
          Recursive: true,
          Fields: "ProviderIds,Name,Id", // Only need these for series lookup
          Limit: pageSize,
          StartIndex: startIndex,
          UserId: config.userId
        };
        
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, params, config, 30000);
        
        if (!data || !data.Items || data.Items.length === 0) {
          hasMore = false;
          break;
        }
        
        const items = data.Items || [];
        totalRecords = data.TotalRecordCount || items.length;
        
        allSeries.push(...items);
        console.log(`[CACHE] Loaded ${allSeries.length} / ${totalRecords} series...`);
        
        // Check if we've got all items
        if (items.length < pageSize) {
          hasMore = false;
        } else if (totalRecords > 0 && allSeries.length >= totalRecords) {
          hasMore = false;
        } else {
          startIndex += pageSize;
          // Safety limit to prevent infinite loops (max 10,000 pages = 5 million items)
          if (startIndex >= pageSize * 10000) {
            console.warn(`[CACHE] Reached safety limit, stopping pagination`);
            hasMore = false;
          }
        }
      }
      
      if (allSeries.length > 0) {
        seriesCache.items = allSeries;
        seriesCache.configHash = configHash;
        seriesCache.lastUpdated = Date.now();
        indexSeries(allSeries);
        console.log(`[CACHE] ✅ Loaded ALL ${allSeries.length} series into cache`);
      } else {
        console.log(`[CACHE] No series found in library`);
      }
    } catch (err) {
      console.error(`[CACHE] Failed to load series: ${err.message}`);
      // If we got some series before error, use those
      if (allSeries.length > 0) {
        seriesCache.items = allSeries;
        seriesCache.configHash = configHash;
        seriesCache.lastUpdated = Date.now();
        indexSeries(allSeries);
        console.log(`[CACHE] Partial load: ${allSeries.length} series (error occurred)`);
      }
    }
  }
  
  return seriesCache.items;
}

// --- Helper Functions ---


/**
 * Checks if Jellyfin provider IDs match the given IMDb or TMDb IDs, handling variations.
 * @param {object} providerIds - The ProviderIds object from Jellyfin.
 * @param {string|null} imdbIdToMatch - The IMDb ID (e.g., "tt1234567").
 * @param {string|null} tmdbIdToMatch - The TMDb ID (as a string).
 * @param {string|null} tvdbIdToMatch - The TVDB ID (as a string).
 * @param {string|null} anidbIdToMatch - The AniDB ID (as a string).
 * @returns {boolean} True if a match is found, false otherwise.
 */
function _isMatchingProviderId(providerIds, imdbIdToMatch, tmdbIdToMatch, tvdbIdToMatch, anidbIdToMatch) {
    if (!providerIds) {
        return false;
    }

    // Check IMDb (case-insensitive and numeric format)
    if (imdbIdToMatch) {
        const numericImdbVal = imdbIdToMatch.replace('tt', '');
        const hasImdb = providerIds.Imdb || providerIds.imdb || providerIds.IMDB;
        
        const matchesFull = providerIds.Imdb === imdbIdToMatch || providerIds.imdb === imdbIdToMatch || providerIds.IMDB === imdbIdToMatch;
        const matchesNumeric = numericImdbVal && (providerIds.Imdb === numericImdbVal || providerIds.imdb === numericImdbVal || providerIds.IMDB === numericImdbVal);
        
        if (matchesFull || matchesNumeric) {
            return true;
        }
        
        // Debug mismatch
        if (hasImdb) {
            console.log(`[MATCH] IMDb mismatch: Looking for "${imdbIdToMatch}" or "${numericImdbVal}", found "${hasImdb}"`);
        }
    }

    // Check TMDb (case-insensitive and string/number comparison)
    if (tmdbIdToMatch) {
        const tmdbIdStr = String(tmdbIdToMatch);
        const hasTmdb = providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB;
        
        const matches = providerIds.Tmdb === tmdbIdStr || providerIds.tmdb === tmdbIdStr || providerIds.TMDB === tmdbIdStr ||
            (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdStr);
        
        if (matches) {
            return true;
        }
        
        // Debug mismatch
        if (hasTmdb) {
            console.log(`[MATCH] TMDB mismatch: Looking for "${tmdbIdStr}", found "${hasTmdb}"`);
        }
    }

    // Check TVDB (case-insensitive and string/number comparison)
    if (tvdbIdToMatch) {
        const tvdbIdStr = String(tvdbIdToMatch);
        const hasTvdb = providerIds.Tvdb || providerIds.tvdb || providerIds.TVDB;
        
        const matches = providerIds.Tvdb === tvdbIdStr || providerIds.tvdb === tvdbIdStr || providerIds.TVDB === tvdbIdStr ||
            (providerIds.Tvdb && String(providerIds.Tvdb) === tvdbIdStr);
        
        if (matches) {
            return true;
        }
        
        // Debug mismatch
        if (hasTvdb) {
            console.log(`[MATCH] TVDB mismatch: Looking for "${tvdbIdStr}", found "${hasTvdb}"`);
        }
    }

    // Check AniDB (case-insensitive and string/number comparison)
    if (anidbIdToMatch) {
        const anidbIdStr = String(anidbIdToMatch);
        const hasAnidb = providerIds.AniDb || providerIds.anidb || providerIds.ANIDB;
        
        const matches = providerIds.AniDb === anidbIdStr || providerIds.anidb === anidbIdStr || providerIds.ANIDB === anidbIdStr ||
            (providerIds.AniDb && String(providerIds.AniDb) === anidbIdStr);
        
        if (matches) {
            return true;
        }
        
        // Debug mismatch
        if (hasAnidb) {
            console.log(`[MATCH] AniDB mismatch: Looking for "${anidbIdStr}", found "${hasAnidb}"`);
        }
    }
    
    return false;
}

/**
 * Parses the Stremio-style ID (e.g., "tt12345", "tmdb12345", "tt12345:1:2")
 * into its components.
 * @param {string} idOrExternalId - The input ID string.
 * @returns {object|null} An object containing parsed info { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId } or null if format is invalid.
 */
function parseMediaId(idOrExternalId) {
    if (!idOrExternalId) return null;

    const parts = idOrExternalId.split(':');
    let baseId = parts[0];
    let itemType = ITEM_TYPE_MOVIE; // Default to Movie
    let seasonNumber = null;
    let episodeNumber = null;
    let imdbId = null;
    let tmdbId = null;
    let tvdbId = null;
    let anidbId = null;
    let jellyfinId = null; // Direct Jellyfin internal ID

    if (parts.length === 3) {
        // Check if it's jellyfin:ID:season:episode format
        if (parts[0].toLowerCase() === "jellyfin") {
            jellyfinId = parts[1];
            seasonNumber = parseInt(parts[2], 10);
            episodeNumber = parseInt(parts[3], 10);
            if (isNaN(seasonNumber) || isNaN(episodeNumber)) {
                console.warn("❌ Invalid season/episode number in Jellyfin ID:", idOrExternalId);
                return null;
            }
            itemType = ITEM_TYPE_EPISODE;
            baseId = `jellyfin:${jellyfinId}`;
        } else {
            itemType = ITEM_TYPE_EPISODE; // Indicates a series episode
            seasonNumber = parseInt(parts[1], 10);
            episodeNumber = parseInt(parts[2], 10);
            if (isNaN(seasonNumber) || isNaN(episodeNumber)) {
                 console.warn("❌ Invalid season/episode number in ID:", idOrExternalId);
                 return null; // Invalid format
            }
        }
    } else if (parts.length === 2) {
        
        const prefix = parts[0].toLowerCase();
        const idPart = parts[1];
        if (!idPart) {
            console.warn(`❌ Missing ${prefix.toUpperCase()} ID part in ID:`, idOrExternalId);
            return null;
        }
        if (prefix === "jellyfin") {
            jellyfinId = idPart;
            baseId = `jellyfin:${jellyfinId}`;
        } else if (prefix === "tmdb") {
            tmdbId = idPart;
            baseId = `tmdb${idPart}`; // normalized
        } else if (prefix === "imdb") {
            imdbId = idPart.startsWith("tt") ? idPart : `tt${idPart}`;
            baseId = imdbId; // normalized
        } else if (prefix === "tvdb") {
            tvdbId = idPart;
            baseId = `tvdb${idPart}`; // normalized
        } else if (prefix === "anidb") {
            anidbId = idPart;
            baseId = `anidb${idPart}`; // normalized
        } else {
            console.warn("❌ Unsupported prefix in ID:", prefix);
            return null;
        }
    } else if (parts.length !== 1) {
        console.warn("❌ Unexpected ID format:", idOrExternalId);
        return null; // Unexpected format
    }

    if (jellyfinId) {
        // Jellyfin ID already set, no need to parse baseId
    } else if (baseId.startsWith("tt")) {
        if (baseId.length <= 2) {
            console.warn("❌ Incomplete IMDb ID format:", baseId);
            return null;
        }
        imdbId = baseId;
    } else if (baseId.startsWith("imdb") && baseId.length > 4) { 
        imdbId = baseId.substring(4); 
        if (!imdbId.startsWith("tt")) imdbId = "tt" + imdbId; 
    } else if (baseId.startsWith("tmdb") && baseId.length > 4) {
        tmdbId = baseId.substring(4);
    } else if (baseId.startsWith("tvdb") && baseId.length > 4) {
        tvdbId = baseId.substring(4);
    } else if (baseId.startsWith("anidb") && baseId.length > 5) {
        anidbId = baseId.substring(5);
    } else if (baseId.startsWith("jellyfin:") && baseId.length > 9) {
        jellyfinId = baseId.substring(9);
    } else {
        console.warn("❌ Unsupported base ID format (expected tt..., tmdb..., tvdb..., anidb..., or jellyfin:...):", baseId);
        return null;
    }

    return { baseId, itemType, seasonNumber, episodeNumber, imdbId, tmdbId, tvdbId, anidbId, jellyfinId };
}


// --- Jellyfin Item Finding ---

/**
 * Gets the current user information from Jellyfin using the API key.
 * This automatically determines the User ID from the API key.
 * @param {object} config - The configuration object containing serverUrl and accessToken.
 * @returns {Promise<object|null>} The user object with Id property or null if unsuccessful.
 */
async function getCurrentUser(config) {
    if (!config.serverUrl || !config.accessToken) {
        console.error("❌ Configuration missing for getCurrentUser");
        return null;
    }
    
    try {
        // Method 1: Try /Users/Me (works with access tokens)
        let data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/Me`, {}, config);
        if (data && data.Id) {
            console.log(`[AUTH] Current user: ${data.Name} (ID: ${data.Id})`);
            return data;
        }
        
        // Method 2: Try /System/Info/Public to verify API key works
        // Then try /Users endpoint to get all users
        console.log(`[AUTH] /Users/Me not available, trying /Users endpoint...`);
        data = await makeJellyfinApiRequest(`${config.serverUrl}/Users`, {}, config);
        
        if (data && Array.isArray(data) && data.length > 0) {
            // Try each user to see which one the API key belongs to
            // Test by making a request to /Users/{userId}/Items
            for (const user of data) {
                if (user.Id) {
                    try {
                        // Test if this user's items are accessible with this API key
                        const testData = await makeJellyfinApiRequest(
                            `${config.serverUrl}/Users/${user.Id}/Items`, 
                            { Limit: 1 }, 
                            config
                        );
                        if (testData !== null) {
                            console.log(`[AUTH] Found matching user: ${user.Name} (ID: ${user.Id})`);
                            return user;
                        }
                    } catch (e) {
                        // This user doesn't match, try next
                        continue;
                    }
                }
            }
        }
        
        // Method 3: If /Users returns object instead of array, try direct access
        if (data && data.Id && !Array.isArray(data)) {
            console.log(`[AUTH] Single user object found: ${data.Name} (ID: ${data.Id})`);
            return data;
        }
        
        console.error("❌ Could not determine user from API key");
        return null;
    } catch (err) {
        console.error("❌ getCurrentUser error:", err.message);
        return null;
    }
}

/**
 * Performs a Jellyfin API request with standard headers and error handling.
 * @param {string} url - The full URL for the API request.
 * @param {object} [params] - Optional query parameters.
 * @param {string} [method='get'] - The HTTP method.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The response data object or null if an error occurs.
 */
async function makeJellyfinApiRequest(url, params = {}, config, timeoutMs = 5000) {
    try {
        // Normalize URL - ensure no double slashes (except after protocol)
        let normalizedUrl = url.replace(/([^:]\/)\/+/g, '$1');
        
        // Log API key info (first 10 chars only for security)
        const apiKeyPreview = config.accessToken ? 
            `${config.accessToken.substring(0, 10)}...` : 'MISSING';
        
        // Log the full request details for debugging
        const paramKeys = Object.keys(params);
        const importantParams = {};
        if (params.ImdbId) importantParams.ImdbId = params.ImdbId;
        if (params.TmdbId) importantParams.TmdbId = params.TmdbId;
        if (params.AnyProviderIdEquals) importantParams.AnyProviderIdEquals = params.AnyProviderIdEquals;
        if (params.IncludeItemTypes) importantParams.IncludeItemTypes = params.IncludeItemTypes;
        
        console.log(`[API] Request to ${normalizedUrl.split('?')[0]} with API key: ${apiKeyPreview} (timeout: ${timeoutMs}ms)`);
        console.log(`[API] Key params:`, JSON.stringify(importantParams));
        console.log(`[API] Full params count: ${paramKeys.length}, keys: ${paramKeys.slice(0, 10).join(', ')}${paramKeys.length > 10 ? '...' : ''}`);
        
        const response = await axios({
            method: 'get',
            url: normalizedUrl,
            headers: { [HEADER_JELLYFIN_TOKEN]: config.accessToken },
            params: params,
            timeout: timeoutMs, // Configurable timeout per request
        });
        
        // Log the actual request URL for debugging (especially for search requests)
        if (params.ImdbId || params.TmdbId || params.AnyProviderIdEquals) {
            const queryString = new URLSearchParams(params).toString();
            const fullUrl = `${normalizedUrl}?${queryString}`;
            console.log(`[API] Full request URL: ${fullUrl.substring(0, 200)}${fullUrl.length > 200 ? '...' : ''}`);
        }
        
        const responseData = response.data;
        
        // Log response summary for search requests
        if (params.ImdbId || params.TmdbId || params.AnyProviderIdEquals) {
            const itemCount = responseData?.Items?.length || 0;
            if (itemCount > 0) {
                const firstItem = responseData.Items[0];
                console.log(`[API] Search returned ${itemCount} items. First item: "${firstItem.Name}" (ID: ${firstItem.Id})`);
                console.log(`[API] First item ProviderIds:`, JSON.stringify(firstItem.ProviderIds || {}));
            } else {
                console.log(`[API] Search returned 0 items`);
            }
        }
        
        return responseData;
    } catch (err) {
        const paramSummary = params.ImdbId ? `ImdbId=${params.ImdbId}` : 
                            params.TmdbId ? `TmdbId=${params.TmdbId}` :
                            params.AnyProviderIdEquals ? `AnyProviderIdEquals=${params.AnyProviderIdEquals}` : 'other params';
        
        console.warn(`⚠️ API Request failed for ${url} with ${paramSummary}:`, err.message);
        
        if (err.response?.status === 401) {
            const apiKeyPreview = config.accessToken ? 
                `${config.accessToken.substring(0, 10)}...` : 'MISSING';
            console.log(`🔧 Detected Unauthorized (401). API key used: ${apiKeyPreview}`);
            console.log(`🔧 Server: ${config.serverUrl}, UserId: ${config.userId}`);
            console.log(`🔧 Full error response:`, err.response?.data);
        }
        if (err.response?.status === 404) {
            console.log(`🔧 Detected Not Found (404). This usually means:`);
            console.log(`🔧   - User ID "${config.userId}" doesn't exist in Jellyfin`);
            console.log(`🔧   - OR the endpoint URL is incorrect`);
            console.log(`🔧 Full error response:`, err.response?.data);
        }
        return null; // Indicate failure
    }
}

/**
 * Attempts to find a movie item in Jellyfin using various strategies.
 * @param {string|null} imdbId - The IMDb ID to search for.
 * @param {string|null} tmdbId - The TMDb ID to search for.
 * @param {string|null} tvdbId - The TVDB ID to search for.
 * @param {string|null} anidbId - The AniDB ID to search for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @param {string|null} [movieName] - Optional: The name of the movie for name-based search fallback.
 * @returns {Promise<object|null>} The found Jellyfin movie item or null.
 */
async function findMovieItem(imdbId, tmdbId, tvdbId, anidbId, config, movieName = null) {
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        config.userId = user.Id;
    }
    
    // Debug: Log what we're searching for
    console.log(`[FIND] ==========================================`);
    console.log(`[FIND] Searching for movie with:`);
    console.log(`[FIND]   IMDb ID: ${imdbId || 'none'}`);
    console.log(`[FIND]   TMDB ID: ${tmdbId || 'none'}`);
    console.log(`[FIND]   TVDB ID: ${tvdbId || 'none'}`);
    console.log(`[FIND]   AniDB ID: ${anidbId || 'none'}`);
    console.log(`[FIND] ==========================================`);
    
    // FIRST: Search existing cache if available - FAST PATH
    const configHash = getConfigHash(config);
    if (movieCache.items.length > 0 && movieCache.configHash === configHash) {
        console.log(`[FIND] Searching cache (${movieCache.items.length} movies)...`);
        
        let foundItems = [];
        
        // Search by IMDb ID
        if (imdbId) {
            const imdbKey = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
            const numericImdb = imdbId.replace('tt', '');
            
            const matches1 = movieCache.indexedByImdb.get(imdbKey) || [];
            const matches2 = numericImdb ? (movieCache.indexedByImdb.get(numericImdb) || []) : [];
            
            foundItems = [...matches1, ...matches2];
            console.log(`[FIND] Cache search (IMDb: ${imdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by TMDb ID
        if (foundItems.length === 0 && tmdbId) {
            const tmdbKey = String(tmdbId);
            foundItems = movieCache.indexedByTmdb.get(tmdbKey) || [];
            console.log(`[FIND] Cache search (TMDb: ${tmdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by TVDB ID
        if (foundItems.length === 0 && tvdbId) {
            const tvdbKey = String(tvdbId);
            foundItems = movieCache.indexedByTvdb.get(tvdbKey) || [];
            console.log(`[FIND] Cache search (TVDB: ${tvdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by AniDB ID
        if (foundItems.length === 0 && anidbId) {
            const anidbKey = String(anidbId);
            foundItems = movieCache.indexedByAnidb.get(anidbKey) || [];
            console.log(`[FIND] Cache search (AniDB: ${anidbKey}): Found ${foundItems.length} matches`);
        }
        
        // Verify matches
        if (foundItems.length > 0) {
            const verified = foundItems.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (verified.length < foundItems.length) {
                console.log(`[FIND] Warning: ${foundItems.length - verified.length} items filtered out during verification`);
            }
            foundItems = verified;
            
            if (foundItems.length > 0) {
                console.log(`[FIND] ✅ SUCCESS: Found ${foundItems.length} matching movie(s) in cache`);
                foundItems.forEach((item, idx) => {
                    console.log(`[FIND]   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                });
                return foundItems;
            }
        }
        
        console.log(`[FIND] ❌ Not found in cache (${movieCache.items.length} movies indexed), trying direct API search...`);
    } else {
        console.log(`[FIND] Cache is empty, skipping cache load and trying direct API search (fast)...`);
    }
    
    // FALLBACK: Direct API search (like original Emby StreamBridge) - FAST, doesn't load all movies
    console.log(`[FIND] Attempting direct API search (fast, no full cache load)...`);
    
    let foundItems = [];
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10,
        Filters: "IsNotFolder",
        UserId: config.userId
    };

    // Strategy 1: Direct ID Lookup (/Users/{userId}/Items) - more reliable than /Items
    const directLookupParams = { ...baseMovieParams };
    delete directLookupParams.UserId; // Remove UserId for /Users/{userId}/Items endpoint
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }
    else if (tvdbId) { directLookupParams.TvdbId = tvdbId; searchedIdField = "TvdbId"; }
    else if (anidbId) { directLookupParams.AniDbId = anidbId; searchedIdField = "AniDbId"; }
    
    if (searchedIdField) {
        try {
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, directLookupParams, config, 10000);
            if (data?.Items?.length > 0) {
                // CRITICAL: Jellyfin's API ignores search params and returns random items
                // We MUST filter by ProviderIds to get actual matches
                const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                if (matches.length > 0) {
                    console.log(`[FIND] ✅ Found ${matches.length} match(es) via /Users/{userId}/Items with ${searchedIdField} (filtered from ${data.Items.length} items)`);
                    foundItems.push(...matches);
                } else {
                    console.log(`[FIND] ⚠️ Jellyfin returned ${data.Items.length} items but NONE matched ProviderIds (Jellyfin's search is broken)`);
                    // Log first item's ProviderIds for debugging
                    if (data.Items[0]?.ProviderIds) {
                        console.log(`[FIND]   First item ProviderIds:`, JSON.stringify(data.Items[0].ProviderIds));
                    }
                }
            } else {
                console.log(`[FIND] Strategy 1: Jellyfin returned 0 items (movie may not be in library or search is broken)`);
            }
        } catch (err) {
            console.log(`[FIND] Strategy 1 failed: ${err.message}`);
        }
    }

    // Strategy 2: AnyProviderIdEquals (only if Strategy 1 failed)
    if (foundItems.length === 0) {
        const altParams = { ...baseMovieParams };
        delete altParams.UserId; // Remove UserId for /Users/{userId}/Items endpoint
        delete altParams.ImdbId; // Remove specific ID params when using AnyProviderIdEquals
        delete altParams.TmdbId;
        delete altParams.TvdbId;
        delete altParams.AniDbId;
        
        // Try IMDb formats first
        if (imdbId) {
            const formats = [`imdb.${imdbId}`, `Imdb.${imdbId}`, `imdb.${imdbId.replace('tt', '')}`, `Imdb.${imdbId.replace('tt', '')}`];
            for (const format of formats) { // Try all formats for better matching
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        // CRITICAL: Filter by ProviderIds - Jellyfin's API is unreliable
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
        
        // Try TMDb formats
        if (foundItems.length === 0 && tmdbId) {
            const formats = [`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`, `TMDB.${tmdbId}`];
            for (const format of formats) {
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
        
        // Try TVDB formats
        if (foundItems.length === 0 && tvdbId) {
            const formats = [`tvdb.${tvdbId}`, `Tvdb.${tvdbId}`, `TVDB.${tvdbId}`];
            for (const format of formats) {
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
    }
    
    // Strategy 3: Search by Name (only if ProviderId searches failed)
    if (foundItems.length === 0 && movieName) {
        console.log(`[FIND] Strategy 3: Searching by name "${movieName}"...`);
        const searchParams = {
            ...baseMovieParams,
            SearchTerm: movieName
        };
        // Jellyfin's /Users/{userId}/Items endpoint with SearchTerm works better
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, searchParams, config, 10000);
        if (data?.Items?.length > 0) {
            // Filter by name and type to ensure relevance
            const matches = data.Items.filter(item => 
                item.Name?.toLowerCase() === movieName.toLowerCase() && item.Type === ITEM_TYPE_MOVIE
            );
            if (matches.length > 0) {
                console.log(`[FIND] ✅ Found ${matches.length} match(es) via name search "${movieName}" (filtered from ${data.Items.length} items)`);
                foundItems.push(...matches);
            } else {
                console.log(`[FIND] ⚠️ Name search "${movieName}" returned ${data.Items.length} items but NONE matched exactly`);
            }
        } else {
            console.log(`[FIND] Strategy 3: Name search "${movieName}" returned 0 items`);
        }
    }
    
    if (foundItems.length === 0) {
        console.log(`[FIND] ❌ NO MATCH FOUND after all search strategies`);
    } else {
        console.log(`[FIND] ✅ SUCCESS: Found ${foundItems.length} matching movie(s) via API`);
        foundItems.forEach((item, idx) => {
            console.log(`[FIND]   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
        });
        // Add found items to cache for future searches
        if (foundItems.length > 0) {
            addMoviesToCache(foundItems);
        }
    }

    return foundItems;
}


/**
 * Attempts to find a series item in Jellyfin.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @param {string|null} tvdbId - The TVDB ID of the series.
 * @param {string|null} anidbId - The AniDB ID of the series.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @param {string|null} [seriesName] - Optional: The name of the series for name-based search fallback.
 * @returns {Promise<object|null>} The found Jellyfin series item or null.
 */
async function findSeriesItem(imdbId, tmdbId, tvdbId, anidbId, config, seriesName = null) {
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        config.userId = user.Id;
    }
    
    // Debug: Log what we're searching for
    console.log(`[FIND] ==========================================`);
    console.log(`[FIND] Searching for series with:`);
    console.log(`[FIND]   IMDb ID: ${imdbId || 'none'}`);
    console.log(`[FIND]   TMDB ID: ${tmdbId || 'none'}`);
    console.log(`[FIND]   TVDB ID: ${tvdbId || 'none'}`);
    console.log(`[FIND]   AniDB ID: ${anidbId || 'none'}`);
    console.log(`[FIND] ==========================================`);
    
    // FIRST: Search existing cache if available - FAST PATH
    const configHash = getConfigHash(config);
    if (seriesCache.items.length > 0 && seriesCache.configHash === configHash) {
        console.log(`[FIND] Searching cache (${seriesCache.items.length} series)...`);
        
        let foundItems = [];
        
        // Search by IMDb ID
        if (imdbId) {
            const imdbKey = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
            const numericImdb = imdbId.replace('tt', '');
            
            const matches1 = seriesCache.indexedByImdb.get(imdbKey) || [];
            const matches2 = numericImdb ? (seriesCache.indexedByImdb.get(numericImdb) || []) : [];
            
            foundItems = [...matches1, ...matches2];
            console.log(`[FIND] Cache search (IMDb: ${imdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by TMDb ID
        if (foundItems.length === 0 && tmdbId) {
            const tmdbKey = String(tmdbId);
            foundItems = seriesCache.indexedByTmdb.get(tmdbKey) || [];
            console.log(`[FIND] Cache search (TMDb: ${tmdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by TVDB ID
        if (foundItems.length === 0 && tvdbId) {
            const tvdbKey = String(tvdbId);
            foundItems = seriesCache.indexedByTvdb.get(tvdbKey) || [];
            console.log(`[FIND] Cache search (TVDB: ${tvdbKey}): Found ${foundItems.length} matches`);
        }
        
        // Search by AniDB ID
        if (foundItems.length === 0 && anidbId) {
            const anidbKey = String(anidbId);
            foundItems = seriesCache.indexedByAnidb.get(anidbKey) || [];
            console.log(`[FIND] Cache search (AniDB: ${anidbKey}): Found ${foundItems.length} matches`);
        }
        
        // Verify matches
        if (foundItems.length > 0) {
            const verified = foundItems.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
            if (verified.length < foundItems.length) {
                console.log(`[FIND] Warning: ${foundItems.length - verified.length} items filtered out during verification`);
            }
            foundItems = verified;
            
            if (foundItems.length > 0) {
                console.log(`[FIND] ✅ SUCCESS: Found ${foundItems.length} matching series in cache`);
                foundItems.forEach((item, idx) => {
                    console.log(`[FIND]   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                });
                return foundItems;
            }
        }
        
        console.log(`[FIND] ❌ Not found in cache (${seriesCache.items.length} series indexed), trying direct API search...`);
    } else {
        console.log(`[FIND] Cache is empty, skipping cache load and trying direct API search (fast)...`);
    }
    
    // FALLBACK: Direct API search (like original Emby StreamBridge) - FAST, doesn't load all series
    console.log(`[FIND] Attempting direct API search (fast, no full cache load)...`);
    
    let foundItems = [];
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10,
        Filters: "IsNotFolder",
        UserId: config.userId
    };

    // Strategy 1: Direct ID Lookup (/Users/{userId}/Items) - more reliable than /Items
    const directLookupParams = { ...baseSeriesParams };
    delete directLookupParams.UserId; // Remove UserId for /Users/{userId}/Items endpoint
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }
    else if (tvdbId) { directLookupParams.TvdbId = tvdbId; searchedIdField = "TvdbId"; }
    else if (anidbId) { directLookupParams.AniDbId = anidbId; searchedIdField = "AniDbId"; }
    
    if (searchedIdField) {
        try {
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, directLookupParams, config, 10000);
            if (data?.Items?.length > 0) {
                // CRITICAL: Jellyfin's API ignores search params and returns random items
                // We MUST filter by ProviderIds to get actual matches
                const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                if (matches.length > 0) {
                    console.log(`[FIND] ✅ Found ${matches.length} match(es) via /Users/{userId}/Items with ${searchedIdField} (filtered from ${data.Items.length} items)`);
                    foundItems.push(...matches);
                } else {
                    console.log(`[FIND] ⚠️ Jellyfin returned ${data.Items.length} items but NONE matched ProviderIds (Jellyfin's search is broken)`);
                    // Log first item's ProviderIds for debugging
                    if (data.Items[0]?.ProviderIds) {
                        console.log(`[FIND]   First item ProviderIds:`, JSON.stringify(data.Items[0].ProviderIds));
                    }
                }
            } else {
                console.log(`[FIND] Strategy 1: Jellyfin returned 0 items (series may not be in library or search is broken)`);
            }
        } catch (err) {
            console.log(`[FIND] Strategy 1 failed: ${err.message}`);
        }
    }

    // Strategy 2: AnyProviderIdEquals (only if Strategy 1 failed)
    if (foundItems.length === 0) {
        const altParams = { ...baseSeriesParams };
        delete altParams.UserId; // Remove UserId for /Users/{userId}/Items endpoint
        delete altParams.ImdbId; // Remove specific ID params when using AnyProviderIdEquals
        delete altParams.TmdbId;
        delete altParams.TvdbId;
        delete altParams.AniDbId;
        
        // Try IMDb formats first
        if (imdbId) {
            const formats = [`imdb.${imdbId}`, `Imdb.${imdbId}`, `imdb.${imdbId.replace('tt', '')}`, `Imdb.${imdbId.replace('tt', '')}`];
            for (const format of formats) { // Try all formats for better matching
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        // CRITICAL: Filter by ProviderIds - Jellyfin's API is unreliable
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
        
        // Try TVDB formats (important for TV shows)
        if (foundItems.length === 0 && tvdbId) {
            const formats = [`tvdb.${tvdbId}`, `Tvdb.${tvdbId}`, `TVDB.${tvdbId}`];
            for (const format of formats) { // Try all formats for better matching
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        // CRITICAL: Filter by ProviderIds - Jellyfin's API is unreliable
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
        
        // Try TMDb formats
        if (foundItems.length === 0 && tmdbId) {
            const formats = [`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`, `TMDB.${tmdbId}`];
            for (const format of formats) { // Try all formats for better matching
                try {
                    altParams.AnyProviderIdEquals = format;
                    const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config, 10000);
                    if (data?.Items?.length > 0) {
                        // CRITICAL: Filter by ProviderIds - Jellyfin's API is unreliable
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        if (matches.length > 0) {
                            console.log(`[FIND] ✅ Found ${matches.length} match(es) via AnyProviderIdEquals=${format} (filtered from ${data.Items.length} items)`);
                            foundItems.push(...matches);
                            break;
                        } else {
                            console.log(`[FIND] ⚠️ AnyProviderIdEquals=${format} returned ${data.Items.length} items but NONE matched`);
                        }
                    }
                } catch (err) {
                    console.log(`[FIND] Strategy 2 (${format}) failed: ${err.message}`);
                }
            }
        }
    }
    
    // Strategy 3: Search by Name (only if ProviderId searches failed)
    if (foundItems.length === 0 && seriesName) {
        console.log(`[FIND] Strategy 3: Searching by name "${seriesName}"...`);
        const searchParams = {
            ...baseSeriesParams,
            SearchTerm: seriesName
        };
        // Jellyfin's /Users/{userId}/Items endpoint with SearchTerm works better
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, searchParams, config, 10000);
        if (data?.Items?.length > 0) {
            // Filter by name and type to ensure relevance
            const matches = data.Items.filter(item => 
                item.Name?.toLowerCase() === seriesName.toLowerCase() && item.Type === ITEM_TYPE_SERIES
            );
            if (matches.length > 0) {
                console.log(`[FIND] ✅ Found ${matches.length} match(es) via name search "${seriesName}" (filtered from ${data.Items.length} items)`);
                foundItems.push(...matches);
            } else {
                console.log(`[FIND] ⚠️ Name search "${seriesName}" returned ${data.Items.length} items but NONE matched exactly`);
            }
        } else {
            console.log(`[FIND] Strategy 3: Name search "${seriesName}" returned 0 items`);
        }
    }
    
    if (foundItems.length === 0) {
        console.log(`[FIND] ❌ NO MATCH FOUND after all search strategies`);
        console.log(`[FIND] This could mean:`);
        console.log(`[FIND]   1. The series is not in your Jellyfin library`);
        console.log(`[FIND]   2. The series doesn't have IMDb/TMDb/TVDB IDs in its metadata`);
        console.log(`[FIND]   3. Jellyfin's search API is broken (common issue)`);
        console.log(`[FIND] Try browsing the series catalog in Stremio to add it to cache, then search again`);
    } else {
        console.log(`[FIND] ✅ SUCCESS: Found ${foundItems.length} matching series via API`);
        foundItems.forEach((item, idx) => {
            console.log(`[FIND]   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
        });
        // Add found items to cache for future searches
        if (foundItems.length > 0) {
            addSeriesToCache(foundItems);
        }
    }

    return foundItems;
}

/**
 * Finds an item by its Jellyfin internal ID.
 * @param {string} jellyfinId - The Jellyfin internal item ID.
 * @param {string} itemType - The item type ('Movie' or 'Series').
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Jellyfin item or null.
 */
async function findItemById(jellyfinId, itemType, config) {
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return null;
        }
        config.userId = user.Id;
    }
    
    try {
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items/${jellyfinId}`, {}, config, 30000);
        if (data && data.Id) {
            // Verify it's the right type
            if (itemType === ITEM_TYPE_MOVIE && data.Type === ITEM_TYPE_MOVIE) {
                console.log(`[FIND] Found movie by Jellyfin ID: ${jellyfinId} - "${data.Name}"`);
                return [data]; // Return array for consistency with findMovieItem
            } else if (itemType === ITEM_TYPE_SERIES && data.Type === ITEM_TYPE_SERIES) {
                console.log(`[FIND] Found series by Jellyfin ID: ${jellyfinId} - "${data.Name}"`);
                return [data]; // Return array for consistency with findSeriesItem
            } else {
                console.warn(`[FIND] Item ${jellyfinId} is type ${data.Type}, expected ${itemType}`);
                return null;
            }
        }
        return null;
    } catch (err) {
        console.error(`[FIND] Error finding item by Jellyfin ID ${jellyfinId}:`, err.message);
        return null;
    }
}

/**
 * Finds a specific episode within a given series and season in Jellyfin.
 * @param {object} parentSeriesItem - The Jellyfin series item object (must have Id and Name).
 * @param {number} seasonNumber - The season number to look for.
 * @param {number} episodeNumber - The episode number to look for.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Jellyfin episode item or null.
 */
async function findEpisodeItem(parentSeriesItem, seasonNumber, episodeNumber, config) {
    // 1. Get Seasons for the Series
    const seasonsParams = { UserId: config.userId, Fields: "Id,IndexNumber,Name" };
    const seasonsData = await makeJellyfinApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Seasons`, seasonsParams, config);

    if (!seasonsData?.Items?.length > 0) {
        console.warn(`❌ No seasons found for series: ${parentSeriesItem.Name} (${parentSeriesItem.Id})`);
        return null;
    }

    // 2. Find the Target Season
    const targetSeason = seasonsData.Items.find(s => s.IndexNumber === seasonNumber);
    if (!targetSeason) {
        //console.info(`ℹ️ Season ${seasonNumber} not found for series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 3. Get Episodes for the Target Season
    //console.log(`🔎 Fetching episodes for ${parentSeriesItem.Name} S${seasonNumber} (Season ID: ${targetSeason.Id})`);
    const episodesParams = {
        SeasonId: targetSeason.Id,
        UserId: config.userId,
        Fields: DEFAULT_FIELDS // Request all needed fields for the episode
    };
    const episodesData = await makeJellyfinApiRequest(`${config.serverUrl}/Shows/${parentSeriesItem.Id}/Episodes`, episodesParams, config);

    if (!episodesData?.Items?.length > 0) {
        console.warn(`❌ No episodes found for season ${seasonNumber} in series: ${parentSeriesItem.Name}`);
        return null;
    }

    // 4. Find the Target Episode
    const targetEpisode = episodesData.Items.find(ep => ep.IndexNumber === episodeNumber && ep.ParentIndexNumber === seasonNumber);

    if (!targetEpisode) {
        console.info(`ℹ️ Episode S${seasonNumber}E${episodeNumber} not found in series: ${parentSeriesItem.Name}`);
        return null;
    }

     //console.log(`🎯 Found episode: ${targetEpisode.Name} (S${targetEpisode.ParentIndexNumber}E${targetEpisode.IndexNumber}, ID: ${targetEpisode.Id})`);
    return targetEpisode;
}


// --- Stream Generation ---

// --- Helper Functions for Stream Enrichment ---

/**
 * Returns resolution label based on video stream dimensions, using Jellyfin's DisplayTitle when available.
 * Handles different aspect ratios correctly (4K UHD, DCI, ultrawide, etc.)
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string} Quality tag like "4K", "1080p", "720p", etc.
 */
function getQualityTag(videoStream) {
  if (!videoStream) return 'Unknown';
  
  const height = videoStream.Height;
  const width = videoStream.Width;
  const displayTitle = videoStream.DisplayTitle || '';
  
  // Try to extract resolution from Jellyfin's DisplayTitle first (most accurate)
  // DisplayTitle often contains formatted resolution like "1080p", "4K", "2160p", etc.
  const resolutionMatch = displayTitle.match(/\b(\d+k|4k|2160p|1440p|1080p|720p|576p|480p|sd)\b/i);
  if (resolutionMatch) {
    const resolution = resolutionMatch[1].toUpperCase();
    // Normalize variations
    if (resolution.includes('4K') || resolution.includes('2160')) return '4K';
    if (resolution.includes('1440')) return '1440p';
    if (resolution.includes('1080')) return '1080p';
    if (resolution.includes('720')) return '720p';
    if (resolution.includes('576')) return '576p';
    if (resolution.includes('480')) return '480p';
    if (resolution.includes('SD')) return 'SD';
  }
  
  // If DisplayTitle doesn't have resolution, calculate from dimensions
  if (!width && !height) return 'Unknown';
  
  // Use width-based detection for 4K (handles different aspect ratios correctly)
  // 4K UHD = 3840x2160, DCI 4K = 4096x2160, ultrawide 4K = 3840x1600+
  if (width >= 3840 || height >= 2160) {
    // Further distinguish based on width
    if (width >= 4096) return '4K DCI';
    if (width >= 3840) return '4K';
    // Some tall formats with 2160p height
    return '2160p';
  }
  
  // Standard resolution detection based on height
  // Only use height if width-based detection doesn't apply
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 576) return '576p';
  if (height >= 480) return '480p';
  
  return 'SD';
}

/**
 * Returns formatted resolution dimensions string (e.g., "3840x2160").
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string|null} Resolution dimensions string or null if unavailable.
 */
function getResolutionDimensions(videoStream) {
  if (!videoStream) return null;
  
  const width = videoStream.Width;
  const height = videoStream.Height;
  
  if (width && height) {
    return `${width}x${height}`;
  }
  
  return null;
}

/**
 * Returns formatted video codec with profile information.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string} Formatted codec tag like "H.264", "HEVC 10bit", etc.
 */
function getVideoTag(videoStream) {
  if (!videoStream) return '';
  
  const codec = videoStream.Codec?.toUpperCase();
  const profile = videoStream.Profile;
  
  // Map codec names to common abbreviations
  const codecMap = {
    'H264': 'H.264',
    'H265': 'HEVC',
    'HEVC': 'HEVC',
    'VP8': 'VP8',
    'VP9': 'VP9',
    'AV1': 'AV1',
    'MPEG2VIDEO': 'MPEG-2',
    'VC1': 'VC-1'
  };
  
  const displayCodec = codecMap[codec] || codec || '';
  
  // Add profile if meaningful (Main10 for 10-bit, etc.)
  if (profile && ['Main10', 'High10', 'Main 10'].some(p => profile.includes(p))) {
    return `${displayCodec} 10bit`;
  }
  
  return displayCodec;
}

/**
 * Returns HDR format using Jellyfin's ExtendedVideoType enum with fallback to ColorTransfer detection.
 * @param {object} videoStream - The video MediaStream object.
 * @returns {string|null} HDR tag like "HDR10", "HDR10+", "HLG", "DV", or null.
 */
function getHdrTag(videoStream) {
  if (!videoStream) return null;
  
  // Primary detection via ExtendedVideoType enum (most accurate)
  switch(videoStream.ExtendedVideoType) {
    case 'Hdr10': return 'HDR10';
    case 'Hdr10Plus': return 'HDR10+';
    case 'HyperLogGamma': return 'HLG';
    case 'DolbyVision': return 'DV';
    default: break;
  }
  
  // Fallback to ColorTransfer property
  if (videoStream.ColorTransfer === 'smpte2084') return 'HDR10';
  if (videoStream.ColorTransfer === 'arib-std-b67') return 'HLG';
  
  // Legacy IsHDR flag as last resort
  if (videoStream.IsHDR === true) return 'HDR';
  
  return null;
}

/**
 * Returns formatted audio codec with channel layout, preferring default audio stream.
 * @param {object} audioStream - The audio MediaStream object.
 * @returns {string} Formatted audio tag like "AAC 2.0", "TrueHD 7.1", etc.
 */
function getAudioTag(audioStream) {
  if (!audioStream) return '';
  
  const codec = audioStream.Codec?.toUpperCase();
  const channels = audioStream.Channels;
  
  // Map codec names to industry-standard abbreviations
  const codecMap = {
    'AAC': 'AAC',
    'AC3': 'DD',      // Dolby Digital
    'EAC3': 'DD+',    // Dolby Digital Plus
    'DTS': 'DTS',
    'DTSHD': 'DTS-HD',
    'TRUEHD': 'TrueHD',
    'FLAC': 'FLAC',
    'OPUS': 'Opus',
    'MP3': 'MP3',
    'VORBIS': 'Vorbis',
    'PCM': 'PCM'
  };
  
  const displayCodec = codecMap[codec] || codec || 'Unknown';
  
  // Format channel count to standard notation
  let channelStr = '';
  if (channels === 1) channelStr = 'Mono';
  else if (channels === 2) channelStr = '2.0';
  else if (channels === 6) channelStr = '5.1';
  else if (channels === 8) channelStr = '7.1';
  else if (channels) channelStr = `${channels}ch`;
  
  return channelStr ? `${displayCodec} ${channelStr}` : displayCodec;
}

/**
 * Returns uppercase container format.
 * @param {string} container - The container string (e.g., "mkv", "mp4").
 * @returns {string} Uppercase container tag or empty string.
 */
function getContainerTag(container) {
  if (!container) return '';
  return container.toUpperCase();
}

/**
 * Detects if the source is a remux by checking if filename contains "remux".
 * @param {object} source - The MediaSource object.
 * @param {object} videoStream - The video MediaStream object (unused but kept for compatibility).
 * @returns {boolean} True if filename contains "remux", false otherwise.
 */
function isRemux(source, videoStream) {
  if (!source) return false;
  
  // Check filename/path for remux indicator
  const path = source.Path?.toLowerCase() || '';
  const name = source.Name?.toLowerCase() || '';
  
  return path.includes('remux') || name.includes('remux');
}

/**
 * Converts bits per second to human-readable Mbps format.
 * @param {number} bps - Bitrate in bits per second.
 * @returns {string|null} Formatted bitrate like "8.2Mbps" or null if invalid.
 */
function formatBitrate(bps) {
  if (!bps || bps === 0) return null;
  const mbps = (bps / 1000000).toFixed(1);
  return `${mbps}Mbps`;
}

/**
 * Converts bytes to human-readable format with appropriate unit.
 * @param {number} bytes - File size in bytes.
 * @returns {string|null} Formatted size like "6.9GB" or "1.2MB" or null if invalid.
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return null;
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  // Use 1 decimal place for GB/TB, 0 for smaller units
  const decimals = unitIndex >= 3 ? 1 : 0;
  return `${size.toFixed(decimals)}${units[unitIndex]}`;
}

/**
 * Creates comprehensive description string matching Emby format: "1080p • 1920x1080 H.264 DD+5.1 MKV • 8.5Mbps • 7.6GB"
 * @param {object} mediaInfo - Enriched media information object.
 * @returns {string} Single-line description string with all available metadata.
 */
function buildStreamDescription(mediaInfo) {
  const parts = [];
  
  // Resolution (Quality tag + Dimensions) - format: "4K • 3840x2160"
  if (mediaInfo.qualityTag && mediaInfo.qualityTag !== 'Unknown') {
    parts.push(mediaInfo.qualityTag);
  }
  if (mediaInfo.resolutionDimensions) {
    parts.push(mediaInfo.resolutionDimensions);
  }
  
  // Video Codec (HDR + Video Codec) - format: "DV • HEVC 10bit"
  const videoParts = [];
  if (mediaInfo.hdrTag) {
    videoParts.push(mediaInfo.hdrTag);
  }
  if (mediaInfo.videoTag) {
    videoParts.push(mediaInfo.videoTag);
  }
  if (videoParts.length > 0) {
    parts.push(videoParts.join(' '));
  }
  
  // Audio - format: "DTS 5.1"
  if (mediaInfo.audioTag) {
    parts.push(mediaInfo.audioTag);
  }
  
  // Container - format: "MKV"
  if (mediaInfo.container) {
    parts.push(mediaInfo.container);
  }
  
  // Bitrate - format: "28.1Mbps"
  if (mediaInfo.bitrateFormatted) {
    parts.push(mediaInfo.bitrateFormatted);
  }
  
  // Size - format: "19.2GB"
  if (mediaInfo.sizeFormatted) {
    parts.push(mediaInfo.sizeFormatted);
  }
  
  // REMUX (if available, add at end)
  if (mediaInfo.isRemux) {
    parts.push('REMUX');
  }
  
  // Join all parts with bullet separator (matching Emby format exactly)
  // Result: "4K • 3840x2160 DV • HEVC 10bit DTS 5.1 MKV • 28.1Mbps • 19.2GB"
  return parts.length > 0 ? parts.join(' • ') : 'Direct Play';
}

/**
 * Safely extracts media information with error handling and fallbacks.
 * @param {object} source - The MediaSource object.
 * @param {object} videoStream - The video MediaStream object.
 * @param {object} audioStream - The audio MediaStream object.
 * @returns {object} Enriched media information object.
 */
function safeExtractMediaInfo(source, videoStream, audioStream) {
  try {
    return {
      qualityTag: getQualityTag(videoStream),
      resolutionDimensions: getResolutionDimensions(videoStream),
      videoTag: getVideoTag(videoStream),
      videoCodec: videoStream?.Codec,
      hdrTag: getHdrTag(videoStream),
      audioTag: getAudioTag(audioStream),
      audioCodec: audioStream?.Codec,
      container: getContainerTag(source.Container),
      isRemux: isRemux(source, videoStream),
      bitrate: source.Bitrate,
      bitrateFormatted: formatBitrate(source.Bitrate),
      size: source.Size,
      sizeFormatted: formatFileSize(source.Size),
      filename: source.Path?.split(/[\\/]/).pop() || source.Name,
      supportsDirectPlay: source.SupportsDirectPlay === true,
      supportsDirectStream: source.SupportsDirectStream === true
    };
  } catch (error) {
    console.error('Media info extraction failed:', error);
    
    // Return minimal fallback info
    return {
      qualityTag: 'Unknown',
      resolutionDimensions: null,
      videoTag: '',
      hdrTag: null,
      audioTag: '',
      container: source?.Container?.toUpperCase() || 'Unknown',
      isRemux: false,
      bitrateFormatted: null,
      sizeFormatted: null,
      filename: source?.Path?.split(/[\\/]/).pop() || source?.Name || 'stream',
      supportsDirectPlay: source?.SupportsDirectPlay || false
    };
  }
}

/**
 * Sorts streams by quality (highest first) and deduplicates by mediaSourceId.
 * @param {Array<object>} streams - Array of stream objects.
 * @returns {Array<object>} Deduplicated and sorted streams.
 */
function deduplicateAndSortStreams(streams) {
    if (!streams || streams.length === 0) return [];
    
    // Deduplicate by mediaSourceId
    const uniqueStreams = Array.from(
        new Map(streams.map(stream => [stream.mediaSourceId, stream])).values()
    );
    
    // Sort by quality (highest to lowest)
    uniqueStreams.sort((a, b) => {
        // 1. Direct play priority
        const aDirectPlay = a.mediaInfo?.supportsDirectPlay ?? false;
        const bDirectPlay = b.mediaInfo?.supportsDirectPlay ?? false;
        if (aDirectPlay !== bDirectPlay) return bDirectPlay ? 1 : -1;
        
        // 2. Quality order
        const resOrder = {
            '4K DCI': 0, '4K': 1, '2160p': 2, '1440p': 3, '1080p': 4,
            '720p': 5, '576p': 6, '480p': 7, '360p': 8, 'SD': 9, 'Unknown': 10
        };
        const aRes = resOrder[a.mediaInfo?.qualityTag] ?? 10;
        const bRes = resOrder[b.mediaInfo?.qualityTag] ?? 10;
        if (aRes !== bRes) return aRes - bRes;
        
        // 3. HDR priority
        const aHdr = a.mediaInfo?.hdrTag ? 1 : 0;
        const bHdr = b.mediaInfo?.hdrTag ? 1 : 0;
        if (aHdr !== bHdr) return bHdr - aHdr;
        
        // 4. REMUX priority
        const aRemux = a.mediaInfo?.isRemux ? 1 : 0;
        const bRemux = b.mediaInfo?.isRemux ? 1 : 0;
        if (aRemux !== bRemux) return bRemux - aRemux;
        
        // 5. Bitrate tiebreaker
        return (b.mediaInfo?.bitrate || 0) - (a.mediaInfo?.bitrate || 0);
    });
    
    return uniqueStreams;
}

/**
 * Gets playback information for a Jellyfin item and generates direct play stream URLs.
 * @param {object} jellyfinItem - The Jellyfin movie or episode item (must have Id, Name, Type).
 * @param {string|null} [seriesName=null] - Optional: The name of the series if item is an episode.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if no suitable streams are found.
 */
async function getPlaybackStreams(jellyfinItem, seriesName = null, config) {
    
    const playbackInfoParams = { UserId: config.userId};
    const playbackInfoData = await makeJellyfinApiRequest(
        `${config.serverUrl}/Items/${jellyfinItem.Id}/PlaybackInfo`,
        playbackInfoParams,
        config
    );

    if (!playbackInfoData?.MediaSources?.length > 0) {
        console.warn("❌ No MediaSources found for item:", jellyfinItem.Name, `(${jellyfinItem.Id})`);
        return null;
    }

    const streamDetailsArray = [];

    // Process ALL available MediaSources (multiple quality options)
    for (const source of playbackInfoData.MediaSources) {
        try {
            // Extract video stream (primary video track)
            const videoStream = source.MediaStreams?.find(ms => ms.Type === 'Video');
            
            // Extract audio stream (prefer default, fallback to first)
            const audioStream = source.MediaStreams?.find(ms => ms.Type === 'Audio' && ms.IsDefault)
                             || source.MediaStreams?.find(ms => ms.Type === 'Audio');
            
            // Extract subtitle streams
            const subtitleStreams = source.MediaStreams?.filter(ms => ms.Type === 'Subtitle') || [];
            
            // Build enriched media info object using safe extraction
            const mediaInfo = safeExtractMediaInfo(source, videoStream, audioStream);
            
            // Build comprehensive description string
            const streamDescription = buildStreamDescription(mediaInfo);
            
            // Build Quality Title (preserved for backward compatibility)
            let qualityTitle = "";
            if (videoStream) {
              qualityTitle += videoStream.DisplayTitle || "";
              if (videoStream.Width && videoStream.Height) {
                  if (!qualityTitle.toLowerCase().includes(videoStream.Height + "p") && !qualityTitle.toLowerCase().includes(videoStream.Width + "x" + videoStream.Height)) {
                      qualityTitle = (qualityTitle ? qualityTitle + " " : "") + `${videoStream.Height}p`;
                  }
              }
              if (videoStream.Codec) {
                  if (!qualityTitle.toLowerCase().includes(videoStream.Codec.toLowerCase())) {
                        qualityTitle = (qualityTitle ? qualityTitle + " " : "") + videoStream.Codec.toUpperCase();
                  }
              }
          } else if (source.Container) {
              qualityTitle = source.Container.toUpperCase();
          }
          if (source.Name && !qualityTitle) {
                qualityTitle = source.Name;
          }
          qualityTitle = qualityTitle || 'Direct Play'; // Fallback title

            // Construct direct play URL with authentication
            // Include UserId for Jellyfin compatibility and ensure proper authentication
            const container = source.Container || 'mkv'; // Fallback to mkv if no container
            const directPlayUrl = `${config.serverUrl}/Videos/${jellyfinItem.Id}/stream.${container}?MediaSourceId=${source.Id}&Static=true&api_key=${config.accessToken}&UserId=${config.userId}&DeviceId=stremio-addon-device-id`;
            
            // Format subtitles for Stremio
            const subtitles = subtitleStreams.map(sub => {
                const codec = sub.Codec?.toLowerCase();
                const format = CODEC_FORMAT_MAP[codec] || 'srt';
                
                return {
                    id: `sub-${jellyfinItem.Id}-${source.Id}-${sub.Index}`,
                    lang: sub.Language || 'und',  // Keep 3-letter ISO 639-2 code, fallback to 'und'
                    url: `${config.serverUrl}/Videos/${jellyfinItem.Id}/${source.Id}/Subtitles/${sub.Index}/Stream.${format}?api_key=${config.accessToken}`
                };
            });
            
            // Add enriched stream details (preserve all existing fields for backward compatibility)
            streamDetailsArray.push({
                // Existing fields (preserved for backward compatibility)
                directPlayUrl: directPlayUrl,
                itemName: jellyfinItem.Name,
                seriesName: seriesName,
                seasonNumber: jellyfinItem.Type === ITEM_TYPE_EPISODE ? jellyfinItem.ParentIndexNumber : null,
                episodeNumber: jellyfinItem.Type === ITEM_TYPE_EPISODE ? jellyfinItem.IndexNumber : null,
                itemId: jellyfinItem.Id,
                mediaSourceId: source.Id,
                container: source.Container,
                videoCodec: videoStream?.Codec || source.VideoCodec || null,
                audioCodec: audioStream?.Codec || null,
                qualityTitle: qualityTitle,
                jellyfinUrlBase: config.serverUrl,
                apiKey: config.accessToken,
                subtitles: subtitles,
                
                // New enriched fields
                streamDescription: streamDescription,
                mediaInfo: mediaInfo
            });
        } catch (error) {
            console.error(`❌ Error processing MediaSource ${source.Id} for item ${jellyfinItem.Id}:`, error);
            // Continue to next source instead of failing completely
            continue;
        }
    }

    if (streamDetailsArray.length === 0) {
        console.warn(`❌ No direct playable sources found for item: ${jellyfinItem.Name} (${jellyfinItem.Id})`);
        return null;
    }

    return streamDetailsArray;
}


// --- Main Exported Function ---

/**
 * Orchestrates the process of finding a Jellyfin item (movie or episode) based on
 * an external ID and returning direct play stream information, using provided configuration.
 * @param {string} idOrExternalId - The Stremio-style ID (e.g., "tt12345", "tmdb12345:1:2").
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of stream detail objects or null if unsuccessful.
 */
async function getStream(idOrExternalId, config) {
    // Validate provided configuration
    if (!config.serverUrl || !config.accessToken) {
        console.error("❌ Configuration missing (serverUrl or accessToken)");
        return null; // Critical configuration is missing
    }
    
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        console.log("[AUTH] User ID not provided, fetching from API key...");
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return null;
        }
        config.userId = user.Id;
        console.log(`[AUTH] Auto-detected User ID: ${config.userId}`);
    }
    let fullIdForLog = idOrExternalId;
    try {
        // 1. Parse Input ID
        const parsedId = parseMediaId(idOrExternalId);
        if (parsedId) {
            fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');
        }
        if (!parsedId) {
            console.error(`❌ Failed to parse input ID: ${idOrExternalId}`);
            return null;
        }
        //const fullIdForLog = parsedId.baseId + (parsedId.itemType === ITEM_TYPE_EPISODE ? ` S${parsedId.seasonNumber}E${parsedId.episodeNumber}` : '');

        // 2. Find the Jellyfin Item
        let jellyfinItem = null;
        let parentSeriesName = null;

        // Check if we have a direct Jellyfin ID
        if (parsedId.jellyfinId) {
            console.log(`[FIND] Using direct Jellyfin ID: ${parsedId.jellyfinId}`);
            const itemType = parsedId.itemType === ITEM_TYPE_EPISODE ? ITEM_TYPE_SERIES : parsedId.itemType;
            jellyfinItem = await findItemById(parsedId.jellyfinId, itemType, config);
        } else if (parsedId.itemType === ITEM_TYPE_MOVIE) {
            //console.log(`🎬 Searching for Movie: ${parsedId.imdbId || parsedId.tmdbId}`);
            jellyfinItem = await findMovieItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
        } else if (parsedId.itemType === ITEM_TYPE_EPISODE) {   
            //console.log(`📺 Searching for Series: ${parsedId.imdbId || parsedId.tmdbId}`);
            const seriesItems = await findSeriesItem(parsedId.imdbId, parsedId.tmdbId, parsedId.tvdbId, parsedId.anidbId, config);
            if (seriesItems && seriesItems.length > 0) {
                let allStreams = [];
                let totalSeries = seriesItems.length;
                let failedSeries = 0;
                for (const series of seriesItems) {
                    const episode = await findEpisodeItem(series, parsedId.seasonNumber, parsedId.episodeNumber, config);
                    if (episode) {
                        const streams = await getPlaybackStreams(episode, series.Name, config);  
                        if (streams) allStreams.push(...streams);
                    } else {
                        failedSeries++;  // 🔥 Count failures
                    }
                }
                if (allStreams.length > 0) {
                    // Deduplicate and sort streams
                    return deduplicateAndSortStreams(allStreams);
                } else {
                    if (failedSeries === totalSeries) {
                        console.warn(`📭 Could not find episode S${parsedId.seasonNumber}E${parsedId.episodeNumber} for ${fullIdForLog} in any matching series.`);
                    } else {
                        console.info(`ℹ️ Found partial matches, but no streams for S${parsedId.seasonNumber}E${parsedId.episodeNumber} in available series.`);
                    }
                    return null;
                }
            } else {
                console.warn(`📭 Could not find parent series for ${fullIdForLog}, cannot find episode.`);
                return null;
            }
        }

        // 3. Get Playback Streams if Item Found
        if (jellyfinItem && jellyfinItem.length > 0) {  
            let allStreams = [];
            for (const item of jellyfinItem) {
                const streams = await getPlaybackStreams(item, parentSeriesName, config);
                if (streams) allStreams.push(...streams);
            }
            // Deduplicate and sort streams
            return allStreams.length > 0 ? deduplicateAndSortStreams(allStreams) : null;
        } else {
             console.warn(`📭 No Jellyfin match found for ${fullIdForLog} after all attempts.`);
            return null;
        }

    } catch (err) {
        console.error(`❌ Unhandled error in getStreamWithConfig for ID ${fullIdForLog}:`, err.message, err.stack);
        return null;
    } 
}

/**
 * Gets all movies from Jellyfin library for catalog.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of Jellyfin movie items or null if unsuccessful.
 */
async function getMovies(config) {
    if (!config.serverUrl || !config.accessToken) {
        console.error("❌ Configuration missing for getMovies");
        return [];
    }
    
    // Auto-fetch User ID if not provided
    let userId = config.userId;
    if (!userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        userId = user.Id;
    }
    
    try {
        const allItems = [];
        const pageSize = 500; // Reduced from 10000 to prevent timeouts - fetch in smaller chunks
        let startIndex = 0;
        let hasMore = true;
        
        console.log(`[GETMOVIES] Starting to fetch movies (pageSize: ${pageSize})`);
        
        while (hasMore) {
            const params = {
                IncludeItemTypes: ITEM_TYPE_MOVIE,
                Recursive: true,
                Fields: DEFAULT_FIELDS, // Include ProviderIds, MediaSources, etc. for streaming
                Limit: pageSize,
                StartIndex: startIndex,
                UserId: userId
            };
            
            // Use longer timeout (30 seconds) for catalog requests since they can be large
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config, 30000);
            if (!data) {
                console.error("❌ getMovies: No data returned from Jellyfin API");
                break;
            }
            
            const items = data.Items || [];
            const totalRecords = data.TotalRecordCount || 0;
            
            console.log(`[GETMOVIES] Fetched page ${Math.floor(startIndex / pageSize) + 1}: ${items.length} items (Total: ${totalRecords})`);
            
            allItems.push(...items);
            
            // Always continue paginating until we get fewer items than page size
            // Don't rely solely on TotalRecordCount as it may be inaccurate for large libraries
            if (items.length < pageSize) {
                // Got fewer items than page size - we've reached the end
                hasMore = false;
            } else if (totalRecords > 0 && allItems.length >= totalRecords) {
                // TotalRecordCount says we're done and we've fetched that many
                hasMore = false;
            } else {
                // Continue to next page
                startIndex += pageSize;
                // Safety check: prevent infinite loops (max 1000 pages = 10 million items)
                if (startIndex >= pageSize * 1000) {
                    console.warn(`[GETMOVIES] Reached safety limit of ${pageSize * 1000} items, stopping pagination`);
                    hasMore = false;
                }
            }
        }
        
        console.log(`[GETMOVIES] Total movies fetched: ${allItems.length}`);
        return allItems;
    } catch (err) {
        console.error("❌ getMovies error:", err.message);
        return [];
    }
}

/**
 * Gets all Libraries (root folders/views) from Jellyfin.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of Jellyfin library items or null if unsuccessful.
 */
async function getLibraries(config) {
    if (!config.serverUrl || !config.accessToken) {
        console.error("❌ Configuration missing for getLibraries");
        return [];
    }
    
    // Auto-fetch User ID if not provided
    let userId = config.userId;
    if (!userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        userId = user.Id;
    }
    
    try {
        // First try: Get Views (libraries) - this is the standard way to get Jellyfin libraries
        const viewsData = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Views`, {}, config);
        
        if (viewsData && viewsData.Items && viewsData.Items.length > 0) {
            console.log(`[GETLIBRARIES] Found ${viewsData.Items.length} libraries from /Users/{userId}/Views`);
            return viewsData.Items;
        }
        
        // Fallback: Get root folders
        const params = {
            ParentId: null, // Root level
            Recursive: false,
            Fields: "Id,Name,Type,CollectionType",
            UserId: userId
        };
        
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config);
        
        if (!data || !data.Items) {
            console.error("❌ getLibraries: No data returned from Jellyfin API");
            return [];
        }
        
        // Filter for library folders (they have CollectionType like "movies", "tvshows", etc.)
        const libraries = data.Items.filter(item => 
            item.CollectionType && 
            (item.CollectionType === "movies" || 
             item.CollectionType === "tvshows" || 
             item.CollectionType === "musicvideos" ||
             item.CollectionType === "mixed" ||
             item.Type === "CollectionFolder" ||
             item.Type === "Folder")
        );
        
        console.log(`[GETLIBRARIES] Found ${libraries.length} libraries from root folders`);
        return libraries;
    } catch (err) {
        console.error("❌ getLibraries error:", err.message);
        return [];
    }
}

/**
 * Gets all Collections (libraries) from Jellyfin - kept for backward compatibility.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of Jellyfin collection items or null if unsuccessful.
 */
async function getCollections(config) {
    // Use getLibraries instead
    return await getLibraries(config);
}

/**
 * Gets items from a specific Collection by Collection ID.
 * @param {string} collectionId - The Jellyfin Collection ID.
 * @param {string} itemType - The item type to filter (Movie, Series, or null for all).
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of Jellyfin items or null if unsuccessful.
 */
async function getCollectionItems(collectionId, itemType, config) {
    if (!config.serverUrl || !config.accessToken || !collectionId) {
        console.error("❌ Configuration missing for getCollectionItems");
        return [];
    }
    
    // Auto-fetch User ID if not provided
    let userId = config.userId;
    if (!userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        userId = user.Id;
    }
    
    try {
        const allItems = [];
        const pageSize = 500; // Reduced from 10000 to prevent timeouts - fetch in smaller chunks
        const maxItems = 10000; // Limit to first 10,000 items to prevent timeout (Stremio can paginate if needed)
        let startIndex = 0;
        let hasMore = true;
        
        console.log(`[GETCOLLECTIONITEMS] Starting to fetch items from collection ${collectionId} (pageSize: ${pageSize}, maxItems: ${maxItems})`);
        
        while (hasMore && allItems.length < maxItems) {
            const params = {
                ParentId: collectionId,
                Recursive: true,
                Fields: DEFAULT_FIELDS,
                Limit: pageSize,
                StartIndex: startIndex,
                Filters: "IsNotFolder",
                UserId: userId
            };
            
            // If itemType is null, don't filter - get ALL items
            // This allows us to fetch everything from a library
            if (itemType) {
                params.IncludeItemTypes = itemType;
            }
            // If itemType is null, we fetch all types (Movie, Series, MusicVideo, etc.)
            
            // Use longer timeout (30 seconds) for catalog requests since they can be large
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config, 30000);
            
            if (!data || !data.Items) {
                console.error("❌ getCollectionItems: No data returned from Jellyfin API");
                break;
            }
            
            const items = data.Items || [];
            const totalRecords = data.TotalRecordCount || 0;
            
            console.log(`[GETCOLLECTIONITEMS] Fetched page ${Math.floor(startIndex / pageSize) + 1}: ${items.length} items (Total in library: ${totalRecords}, fetched so far: ${allItems.length + items.length})`);
            
            allItems.push(...items);
            
            // Check if we've reached the max items limit
            if (allItems.length >= maxItems) {
                console.log(`[GETCOLLECTIONITEMS] Reached max items limit (${maxItems}), stopping pagination`);
                hasMore = false;
                break;
            }
            
            // Always continue paginating until we get fewer items than page size
            // Don't rely solely on TotalRecordCount as it may be inaccurate for large libraries
            if (items.length < pageSize) {
                // Got fewer items than page size - we've reached the end
                hasMore = false;
            } else if (totalRecords > 0 && allItems.length >= totalRecords) {
                // TotalRecordCount says we're done and we've fetched that many
                hasMore = false;
            } else {
                // Continue to next page
                startIndex += pageSize;
                // Safety check: prevent infinite loops (max 1000 pages = 10 million items)
                if (startIndex >= pageSize * 1000) {
                    console.warn(`[GETCOLLECTIONITEMS] Reached safety limit of ${pageSize * 1000} items, stopping pagination`);
                    hasMore = false;
                }
            }
        }
        
        console.log(`[GETCOLLECTIONITEMS] Total items fetched from collection ${collectionId}: ${allItems.length}`);
        if (allItems.length >= maxItems) {
            console.log(`[GETCOLLECTIONITEMS] Note: Limited to first ${maxItems} items to prevent timeout. Library may have more items.`);
        }
        return allItems;
    } catch (err) {
        console.error("❌ getCollectionItems error:", err.message);
        return [];
    }
}

/**
 * Gets all series from Jellyfin library for catalog.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<Array<object>|null>} An array of Jellyfin series items or null if unsuccessful.
 */
async function getSeries(config) {
    if (!config.serverUrl || !config.accessToken) {
        console.error("❌ Configuration missing for getSeries");
        return [];
    }
    
    // Auto-fetch User ID if not provided
    let userId = config.userId;
    if (!userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        userId = user.Id;
    }
    
    try {
        const allItems = [];
        const pageSize = 500; // Reduced from 10000 to prevent timeouts - fetch in smaller chunks
        let startIndex = 0;
        let hasMore = true;
        
        console.log(`[GETSERIES] Starting to fetch series (pageSize: ${pageSize})`);
        
        while (hasMore) {
            const params = {
                IncludeItemTypes: ITEM_TYPE_SERIES,
                Recursive: true,
                Fields: "ProviderIds,Name,Id,Overview,ProductionYear,Genres,ImageTags",
                Limit: pageSize,
                StartIndex: startIndex,
                UserId: userId
            };
            
            // Use longer timeout (30 seconds) for catalog requests since they can be large
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config, 30000);
            if (!data) {
                console.error("❌ getSeries: No data returned from Jellyfin API");
                break;
            }
            
            const items = data.Items || [];
            const totalRecords = data.TotalRecordCount || 0;
            
            console.log(`[GETSERIES] Fetched page ${Math.floor(startIndex / pageSize) + 1}: ${items.length} items (Total: ${totalRecords})`);
            
            allItems.push(...items);
            
            // Always continue paginating until we get fewer items than page size
            // Don't rely solely on TotalRecordCount as it may be inaccurate for large libraries
            if (items.length < pageSize) {
                // Got fewer items than page size - we've reached the end
                hasMore = false;
            } else if (totalRecords > 0 && allItems.length >= totalRecords) {
                // TotalRecordCount says we're done and we've fetched that many
                hasMore = false;
            } else {
                // Continue to next page
                startIndex += pageSize;
                // Safety check: prevent infinite loops (max 1000 pages = 10 million items)
                if (startIndex >= pageSize * 1000) {
                    console.warn(`[GETSERIES] Reached safety limit of ${pageSize * 1000} items, stopping pagination`);
                    hasMore = false;
                }
            }
        }
        
        console.log(`[GETSERIES] Total series fetched: ${allItems.length}`);
        return allItems;
    } catch (err) {
        console.error("❌ getSeries error:", err.message);
        return [];
    }
}

// --- Exports ---
module.exports = {
    getStream,
    getMovies,
    getSeries,
    getCollections,
    getLibraries,
    getCollectionItems,
    getCurrentUser,
    parseMediaId,
    deduplicateAndSortStreams,
    makeJellyfinApiRequest,
    addMoviesToCache
};

