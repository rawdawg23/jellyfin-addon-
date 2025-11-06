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
    if (!providerIds) return false;

    // Check IMDb (case-insensitive and numeric format)
    if (imdbIdToMatch) {
        const numericImdbVal = imdbIdToMatch.replace('tt', '');
        if (providerIds.Imdb === imdbIdToMatch || providerIds.imdb === imdbIdToMatch || providerIds.IMDB === imdbIdToMatch) return true;
        if (numericImdbVal && (providerIds.Imdb === numericImdbVal || providerIds.imdb === numericImdbVal || providerIds.IMDB === numericImdbVal)) return true;
    }

    // Check TMDb (case-insensitive and string/number comparison)
    if (tmdbIdToMatch) {
        const tmdbIdStr = String(tmdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tmdb === tmdbIdStr || providerIds.tmdb === tmdbIdStr || providerIds.TMDB === tmdbIdStr ||
            (providerIds.Tmdb && String(providerIds.Tmdb) === tmdbIdStr)) return true; // Compare against Jellyfin's value as string too
    }

    // Check TVDB (case-insensitive and string/number comparison)
    if (tvdbIdToMatch) {
        const tvdbIdStr = String(tvdbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.Tvdb === tvdbIdStr || providerIds.tvdb === tvdbIdStr || providerIds.TVDB === tvdbIdStr ||
            (providerIds.Tvdb && String(providerIds.Tvdb) === tvdbIdStr)) return true; // Compare against Jellyfin's value as string too
    }

    // Check AniDB (case-insensitive and string/number comparison)
    if (anidbIdToMatch) {
        const anidbIdStr = String(anidbIdToMatch); // Ensure it's a string for comparison
        if (providerIds.AniDb === anidbIdStr || providerIds.anidb === anidbIdStr || providerIds.ANIDB === anidbIdStr ||
            (providerIds.AniDb && String(providerIds.AniDb) === anidbIdStr)) return true; // Compare against Jellyfin's value as string too
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
async function makeJellyfinApiRequest(url, params = {}, config) {
    try {
        // Normalize URL - ensure no double slashes (except after protocol)
        let normalizedUrl = url.replace(/([^:]\/)\/+/g, '$1');
        
        // Log API key info (first 10 chars only for security)
        const apiKeyPreview = config.accessToken ? 
            `${config.accessToken.substring(0, 10)}...` : 'MISSING';
        console.log(`[API] Request to ${normalizedUrl.split('?')[0]} with API key: ${apiKeyPreview}`);
        
        const response = await axios({
            method: 'get',
            url: normalizedUrl,
            headers: { [HEADER_JELLYFIN_TOKEN]: config.accessToken },
            params: params,
            timeout: 5000, // 5 second timeout per request to prevent hanging on large libraries
        });
        return response.data;
    } catch (err) {
        
        console.warn(`⚠️ API Request failed for ${url} with params ${JSON.stringify(params)}:`, err.message);
        
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
 * @returns {Promise<object|null>} The found Jellyfin movie item or null.
 */
async function findMovieItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        config.userId = user.Id;
    }
    
    let foundItems = [];
    const baseMovieParams = {
        IncludeItemTypes: ITEM_TYPE_MOVIE,
        Recursive: true,
        Fields: DEFAULT_FIELDS,
        Limit: 10, // Limit results per query
        Filters: "IsNotFolder", // Important filter for movies
        UserId: config.userId
    };

    // --- Strategy 1 & 2: Run in parallel for faster results ---
    // Build all search promises upfront
    const searchPromises = [];
    
    // Strategy 1: Direct ID Lookup
    const directLookupParams = { ...baseMovieParams };
    let searchedIdField = "";
    if (imdbId) { directLookupParams.ImdbId = imdbId; searchedIdField = "ImdbId"; }
    else if (tmdbId) { directLookupParams.TmdbId = tmdbId; searchedIdField = "TmdbId"; }
    else if (tvdbId) { directLookupParams.TvdbId = tvdbId; searchedIdField = "TvdbId"; }
    else if (anidbId) { directLookupParams.AniDbId = anidbId; searchedIdField = "AniDbId"; }
    delete directLookupParams.UserId;
    directLookupParams.Limit = 10;
    
    if (searchedIdField) {
        searchPromises.push(
            makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, directLookupParams, config)
                .then(data => {
                    if (data?.Items?.length > 0) {
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        return matches.length > 0 ? matches : null;
                    }
                    return null;
                })
                .catch(err => {
                    console.log(`[FIND] Strategy 1 failed: ${err.message}`);
                    return null;
                })
        );
    }
    
    // Strategy 2: AnyProviderIdEquals - try most common formats first
    const anyProviderIdFormats = [];
    if (imdbId) {
        const numericImdbId = imdbId.replace('tt', '');
        // Try most common format first
        anyProviderIdFormats.push(`imdb.${imdbId}`, `Imdb.${imdbId}`);
        if (numericImdbId !== imdbId) {
            anyProviderIdFormats.push(`imdb.${numericImdbId}`, `Imdb.${numericImdbId}`);
        }
    } else if (tmdbId) {
        anyProviderIdFormats.push(`tmdb.${tmdbId}`, `Tmdb.${tmdbId}`);
    } else if (tvdbId) {
        anyProviderIdFormats.push(`tvdb.${tvdbId}`, `Tvdb.${tvdbId}`);
    } else if (anidbId) {
        anyProviderIdFormats.push(`anidb.${anidbId}`, `AniDb.${anidbId}`);
    }
    
    // Only try first 2 formats in parallel to avoid too many simultaneous requests
    for (const attemptFormat of anyProviderIdFormats.slice(0, 2)) {
        const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
        delete altParams.ImdbId;
        delete altParams.TmdbId;
        delete altParams.TvdbId;
        delete altParams.AniDbId;
        delete altParams.UserId;
        altParams.Limit = 10;
        
        searchPromises.push(
            makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config)
                .then(data => {
                    if (data?.Items?.length > 0) {
                        const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                        return matches.length > 0 ? matches : null;
                    }
                    return null;
                })
                .catch(err => {
                    console.log(`[FIND] Strategy 2 format ${attemptFormat} failed: ${err.message}`);
                    return null;
                })
        );
    }
    
    // Wait for first successful result
    if (searchPromises.length > 0) {
        const results = await Promise.allSettled(searchPromises);
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                foundItems.push(...result.value);
                break; // Found match, stop
            }
        }
    }
    
    // If still no results and we have more formats to try, try them sequentially
    if (foundItems.length === 0 && anyProviderIdFormats.length > 2) {
        for (const attemptFormat of anyProviderIdFormats.slice(2)) {
            const altParams = { ...baseMovieParams, AnyProviderIdEquals: attemptFormat };
            delete altParams.ImdbId;
            delete altParams.TmdbId;
            delete altParams.TvdbId;
            delete altParams.AniDbId;
            delete altParams.UserId;
            altParams.Limit = 10;
            
            try {
                const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, altParams, config);
                if (data?.Items?.length > 0) {
                    const matches = data.Items.filter(i => _isMatchingProviderId(i.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                    if (matches.length > 0) {
                        foundItems.push(...matches);
                        break;
                    }
                }
            } catch (err) {
                console.log(`[FIND] Strategy 2 format ${attemptFormat} failed: ${err.message}`);
                continue;
            }
        }
    }

    return foundItems; // Return foundItems if found after all attempts
}


/**
 * Attempts to find a series item in Jellyfin.
 * @param {string|null} imdbId - The IMDb ID of the series.
 * @param {string|null} tmdbId - The TMDb ID of the series.
 * @param {string|null} tvdbId - The TVDB ID of the series.
 * @param {string|null} anidbId - The AniDB ID of the series.
 * @param {object} config - The configuration object containing serverUrl, userId, and accessToken.
 * @returns {Promise<object|null>} The found Jellyfin series item or null.
 */
async function findSeriesItem(imdbId, tmdbId, tvdbId, anidbId, config) {
    // Auto-fetch User ID if not provided
    if (!config.userId) {
        const user = await getCurrentUser(config);
        if (!user || !user.Id) {
            console.error("❌ Could not determine User ID from API key");
            return [];
        }
        config.userId = user.Id;
    }
    
    let foundSeries = [];
    const baseSeriesParams = {
        IncludeItemTypes: ITEM_TYPE_SERIES,
        Recursive: true,
        Fields: "ProviderIds,Name,Id", // Only need these fields for series lookup
        Limit: 5
    };

    // --- Strategy 1: Direct ID Lookup (/Users/{UserId}/Items) ---
    const seriesLookupParams1 = { ...baseSeriesParams };
    if (imdbId) seriesLookupParams1.ImdbId = imdbId;
    else if (tmdbId) seriesLookupParams1.TmdbId = tmdbId;
    else if (tvdbId) seriesLookupParams1.TvdbId = tvdbId;
    else if (anidbId) seriesLookupParams1.AniDbId = anidbId;
    const data1 = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams1, config);
    if (data1?.Items?.length > 0) {
        const matches = data1.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
        if (matches.length > 0) {
             //console.log(`🔍 Found series via /Users/{UserId}/Items with ImdbId/TmdbId`);
            foundSeries.push(...matches);
        }
    }

    // --- Strategy 2: AnyProviderIdEquals Lookup (/Users/{UserId}/Items) ---
    if (foundSeries.length === 0) {
        let anyProviderIdValue = null;
        if (imdbId) anyProviderIdValue = `imdb.${imdbId}`;
        else if (tmdbId) anyProviderIdValue = `tmdb.${tmdbId}`;
        else if (tvdbId) anyProviderIdValue = `tvdb.${tvdbId}`;
        else if (anidbId) anyProviderIdValue = `anidb.${anidbId}`;
        if (anyProviderIdValue) {
            const seriesLookupParams2 = { ...baseSeriesParams, AnyProviderIdEquals: anyProviderIdValue };
            delete seriesLookupParams2.ImdbId; // Remove specific ID params
            delete seriesLookupParams2.TmdbId;
            delete seriesLookupParams2.TvdbId;
            delete seriesLookupParams2.AniDbId;
            const data2 = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, seriesLookupParams2, config);
            if (data2?.Items?.length > 0) {
                const matches = data2.Items.filter(s => _isMatchingProviderId(s.ProviderIds, imdbId, tmdbId, tvdbId, anidbId));
                 if (matches.length > 0) {
                    //console.log(`🔍 Found series via /Users/{UserId}/Items with AnyProviderIdEquals=${anyProviderIdValue}`);
                    foundSeries.push(...matches);
                }
            }
        }
    }

    //if (foundSeries.length === 0) console.log(`📭 No Jellyfin series match found for ${imdbId || tmdbId || tvdbId || anidbId}.`);
    return foundSeries;
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
        const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${config.userId}/Items/${jellyfinId}`, {}, config);
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
  
  // Resolution (Quality tag + Dimensions)
  if (mediaInfo.qualityTag && mediaInfo.qualityTag !== 'Unknown') {
    parts.push(mediaInfo.qualityTag);
  }
  if (mediaInfo.resolutionDimensions) {
    parts.push(mediaInfo.resolutionDimensions);
  }
  
  // Video Codec (HDR + Video Codec)
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
  
  // Audio
  if (mediaInfo.audioTag) {
    parts.push(mediaInfo.audioTag);
  }
  
  // Container
  if (mediaInfo.container) {
    parts.push(mediaInfo.container);
  }
  
  // Bitrate
  if (mediaInfo.bitrateFormatted) {
    parts.push(mediaInfo.bitrateFormatted);
  }
  
  // Size
  if (mediaInfo.sizeFormatted) {
    parts.push(mediaInfo.sizeFormatted);
  }
  
  // REMUX (if available, add at end)
  if (mediaInfo.isRemux) {
    parts.push('REMUX');
  }
  
  // Join all parts with bullet separator (matching Emby format)
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
        const pageSize = 10000; // Items per page (increased to reduce requests)
        let startIndex = 0;
        let hasMore = true;
        
        console.log(`[GETMOVIES] Starting paginated fetch for movies...`);
        
        while (hasMore) {
            const params = {
                IncludeItemTypes: ITEM_TYPE_MOVIE,
                Recursive: true,
                Fields: "ProviderIds,Name,Id,Overview,ProductionYear,RunTimeTicks,Genres,ImageTags",
                Limit: pageSize,
                StartIndex: startIndex,
                UserId: userId
            };
            
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config);
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
        const pageSize = 10000;
        let startIndex = 0;
        let hasMore = true;
        
        while (hasMore) {
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
            
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config);
            
            if (!data || !data.Items) {
                console.error("❌ getCollectionItems: No data returned from Jellyfin API");
                break;
            }
            
            const items = data.Items || [];
            const totalRecords = data.TotalRecordCount || 0;
            
            console.log(`[GETCOLLECTIONITEMS] Fetched page ${Math.floor(startIndex / pageSize) + 1}: ${items.length} items (Total: ${totalRecords})`);
            
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
                    console.warn(`[GETCOLLECTIONITEMS] Reached safety limit of ${pageSize * 1000} items, stopping pagination`);
                    hasMore = false;
                }
            }
        }
        
        console.log(`[GETCOLLECTIONITEMS] Total items fetched from collection ${collectionId}: ${allItems.length}`);
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
        const pageSize = 10000; // Items per page (increased to reduce requests)
        let startIndex = 0;
        let hasMore = true;
        
        console.log(`[GETSERIES] Starting paginated fetch for series...`);
        
        while (hasMore) {
            const params = {
                IncludeItemTypes: ITEM_TYPE_SERIES,
                Recursive: true,
                Fields: "ProviderIds,Name,Id,Overview,ProductionYear,Genres,ImageTags",
                Limit: pageSize,
                StartIndex: startIndex,
                UserId: userId
            };
            
            const data = await makeJellyfinApiRequest(`${config.serverUrl}/Users/${userId}/Items`, params, config);
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
    makeJellyfinApiRequest
};

