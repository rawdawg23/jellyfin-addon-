const axios = require("axios");

// Configuration - UPDATE THESE VALUES
const CONFIG = {
    serverUrl: "https://ku98faa.freshticks.xyz:443",
    accessToken: "0aa1e72f30f64c628086a3ea50bbda5b", // Your API key
    userId: "5f8170cc22064e18882e2e57c7406e35" // Your User ID (already set)
};

const HEADER_JELLYFIN_TOKEN = 'X-Emby-Token';

// Test TV shows - UPDATE THESE WITH YOUR ACTUAL TV SHOWS
const TEST_TV_SHOWS = [
    { name: "The Witcher", imdbId: "tt5180504", tmdbId: null, tvdbId: null },
    { name: "Stranger Things", imdbId: "tt4574334", tmdbId: null, tvdbId: null },
    { name: "Game of Thrones", imdbId: "tt0944947", tmdbId: null, tvdbId: null },
    // Add more TV shows from your library here
];

async function makeJellyfinApiRequest(url, params = {}, timeoutMs = 10000) {
    try {
        const normalizedUrl = url.replace(/([^:]\/)\/+/g, '$1');
        
        console.log(`\n[API] Request to ${normalizedUrl}`);
        console.log(`[API] Params:`, JSON.stringify(params, null, 2));
        
        // Check if API key is set
        if (!CONFIG.accessToken || CONFIG.accessToken.includes('...')) {
            console.error(`❌ ERROR: API key not set! Please update CONFIG.accessToken in the script with your full API key.`);
            return null;
        }
        
        const response = await axios.get(normalizedUrl, {
            params: params,
            headers: {
                [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken,
                'Accept': 'application/json'
            },
            timeout: timeoutMs
        });
        
        return response.data;
    } catch (err) {
        if (err.response) {
            console.error(`❌ HTTP ${err.response.status}: ${err.response.statusText}`);
            if (err.response.status === 401) {
                console.error(`   ⚠️  Authentication failed! Check your API key in CONFIG.accessToken`);
            }
            if (err.response.data) {
                console.error(`   Error:`, JSON.stringify(err.response.data, null, 2));
            }
        } else if (err.request) {
            console.error(`❌ No response received: ${err.message}`);
        } else {
            console.error(`❌ Request error: ${err.message}`);
        }
        return null;
    }
}

function isMatchingProviderId(providerIds, imdbId, tmdbId, tvdbId) {
    if (!providerIds) return false;
    
    if (imdbId) {
        const hasImdb = providerIds.Imdb || providerIds.imdb || providerIds.IMDB;
        if (hasImdb) {
            const imdbKey = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
            const providerImdb = hasImdb.startsWith('tt') ? hasImdb : `tt${hasImdb}`;
            if (providerImdb === imdbKey) return true;
        }
    }
    
    if (tmdbId && (providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB)) {
        if (String(providerIds.Tmdb || providerIds.tmdb || providerIds.TMDB) === String(tmdbId)) return true;
    }
    
    if (tvdbId && (providerIds.Tvdb || providerIds.tvdb || providerIds.TVDB)) {
        if (String(providerIds.Tvdb || providerIds.tvdb || providerIds.TVDB) === String(tvdbId)) return true;
    }
    
    return false;
}

async function testTvShowSearch(tvShow) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing TV Show: "${tvShow.name}"`);
    console.log(`  IMDb ID: ${tvShow.imdbId || 'none'}`);
    console.log(`  TMDb ID: ${tvShow.tmdbId || 'none'}`);
    console.log(`  TVDB ID: ${tvShow.tvdbId || 'none'}`);
    console.log(`${'='.repeat(80)}`);
    
    const baseParams = {
        IncludeItemTypes: 'Series',
        Recursive: true,
        Fields: 'ProviderIds,Name,Id',
        Limit: 20,
        Filters: 'IsNotFolder',
        UserId: CONFIG.userId
    };
    
    // Strategy 1: Direct ID Lookup (/Items)
    console.log(`\n[STRATEGY 1] Direct ID Lookup (/Items)`);
    let found = false;
    
    if (tvShow.imdbId) {
        const params = { ...baseParams, ImdbId: tvShow.imdbId };
        const data = await makeJellyfinApiRequest(`${CONFIG.serverUrl}/Items`, params);
        
        if (data?.Items?.length > 0) {
            console.log(`✅ Found ${data.Items.length} item(s)`);
            data.Items.forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
                const matches = isMatchingProviderId(item.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId);
                console.log(`    Matches: ${matches ? '✅ YES' : '❌ NO'}`);
            });
            
            const matches = data.Items.filter(i => isMatchingProviderId(i.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId));
            if (matches.length > 0) {
                console.log(`\n✅ SUCCESS: Found ${matches.length} matching item(s) after filtering`);
                found = true;
            } else {
                console.log(`\n❌ FAILED: Jellyfin returned ${data.Items.length} items but NONE matched ProviderIds`);
            }
        } else {
            console.log(`❌ No items returned`);
        }
    }
    
    // Strategy 2: AnyProviderIdEquals
    if (!found && tvShow.imdbId) {
        console.log(`\n[STRATEGY 2] AnyProviderIdEquals`);
        const altParams = { ...baseParams };
        delete altParams.UserId;
        
        const formats = [
            `imdb.${tvShow.imdbId}`,
            `Imdb.${tvShow.imdbId}`,
            `imdb.${tvShow.imdbId.replace('tt', '')}`,
            `Imdb.${tvShow.imdbId.replace('tt', '')}`
        ];
        
        for (const format of formats) {
            console.log(`\n  Trying format: "${format}"`);
            altParams.AnyProviderIdEquals = format;
            const data = await makeJellyfinApiRequest(`${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`, altParams);
            
            if (data?.Items?.length > 0) {
                console.log(`  ✅ Found ${data.Items.length} item(s)`);
                data.Items.forEach((item, idx) => {
                    console.log(`    Item ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                    console.log(`      ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
                    const matches = isMatchingProviderId(item.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId);
                    console.log(`      Matches: ${matches ? '✅ YES' : '❌ NO'}`);
                });
                
                const matches = data.Items.filter(i => isMatchingProviderId(i.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId));
                if (matches.length > 0) {
                    console.log(`\n  ✅ SUCCESS: Found ${matches.length} matching item(s) after filtering`);
                    found = true;
                    break;
                } else {
                    console.log(`\n  ❌ FAILED: Returned ${data.Items.length} items but NONE matched`);
                }
            } else {
                console.log(`  ❌ No items returned`);
            }
        }
    }
    
    // Strategy 3: Search by Name
    if (!found) {
        console.log(`\n[STRATEGY 3] Search by Name`);
        const searchParams = {
            ...baseParams,
            SearchTerm: tvShow.name
        };
        delete searchParams.UserId;
        
        const data = await makeJellyfinApiRequest(`${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`, searchParams);
        
        if (data?.Items?.length > 0) {
            console.log(`✅ Found ${data.Items.length} item(s) with name "${tvShow.name}"`);
            data.Items.forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
                const matches = isMatchingProviderId(item.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId);
                console.log(`    Matches: ${matches ? '✅ YES' : '❌ NO'}`);
            });
            
            const matches = data.Items.filter(i => isMatchingProviderId(i.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId));
            if (matches.length > 0) {
                console.log(`\n✅ SUCCESS: Found ${matches.length} matching item(s) after filtering`);
                found = true;
            }
        } else {
            console.log(`❌ No items found with name "${tvShow.name}"`);
        }
    }
    
    // Strategy 4: List ALL Series with pagination and search manually
    if (!found) {
        console.log(`\n[STRATEGY 4] List ALL Series (with pagination) and search manually`);
        const allSeries = [];
        const pageSize = 500;
        let startIndex = 0;
        let hasMore = true;
        let totalRecords = 0;
        
        while (hasMore) {
            const listParams = {
                IncludeItemTypes: 'Series',
                Recursive: true,
                Fields: 'ProviderIds,Name,Id',
                Limit: pageSize,
                StartIndex: startIndex,
                UserId: CONFIG.userId
            };
            
            const data = await makeJellyfinApiRequest(`${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`, listParams);
            
            if (data?.Items?.length > 0) {
                allSeries.push(...data.Items);
                totalRecords = data.TotalRecordCount || allSeries.length;
                console.log(`  Loaded ${allSeries.length} / ${totalRecords} series...`);
                
                if (data.Items.length < pageSize || allSeries.length >= totalRecords) {
                    hasMore = false;
                } else {
                    startIndex += pageSize;
                    // Safety limit
                    if (startIndex >= pageSize * 100) {
                        console.log(`  ⚠️  Reached safety limit, stopping pagination`);
                        hasMore = false;
                    }
                }
            } else {
                hasMore = false;
            }
        }
        
        if (allSeries.length > 0) {
            console.log(`✅ Found ${allSeries.length} total series in library`);
            
            // Show sample of series and their ProviderIds
            console.log(`\n  Sample of series in library (first 10):`);
            allSeries.slice(0, 10).forEach((item, idx) => {
                console.log(`    ${idx + 1}. "${item.Name}" (ID: ${item.Id})`);
                console.log(`       ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
            
            // Search by name
            const nameMatches = allSeries.filter(i => 
                i.Name && i.Name.toLowerCase().includes(tvShow.name.toLowerCase())
            );
            
            if (nameMatches.length > 0) {
                console.log(`\n  Found ${nameMatches.length} series with similar name:`);
                nameMatches.forEach((item, idx) => {
                    console.log(`    ${idx + 1}. "${item.Name}" (ID: ${item.Id})`);
                    console.log(`       ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
                });
            }
            
            // Search by ProviderIds
            const idMatches = allSeries.filter(i => 
                isMatchingProviderId(i.ProviderIds, tvShow.imdbId, tvShow.tmdbId, tvShow.tvdbId)
            );
            
            if (idMatches.length > 0) {
                console.log(`\n  ✅ SUCCESS: Found ${idMatches.length} series matching ProviderIds:`);
                idMatches.forEach((item, idx) => {
                    console.log(`    ${idx + 1}. "${item.Name}" (ID: ${item.Id})`);
                    console.log(`       ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
                });
                found = true;
            } else {
                console.log(`\n  ❌ No series found matching ProviderIds in ${allSeries.length} total series`);
            }
            
            // Count how many series have IMDb IDs
            const seriesWithImdb = allSeries.filter(i => 
                i.ProviderIds && (i.ProviderIds.Imdb || i.ProviderIds.imdb || i.ProviderIds.IMDB)
            );
            console.log(`\n  📊 Statistics:`);
            console.log(`     - Series with IMDb IDs: ${seriesWithImdb.length} / ${allSeries.length}`);
            console.log(`     - Series with TMDb IDs: ${allSeries.filter(i => i.ProviderIds && (i.ProviderIds.Tmdb || i.ProviderIds.tmdb || i.ProviderIds.TMDB)).length} / ${allSeries.length}`);
            console.log(`     - Series with TVDB IDs: ${allSeries.filter(i => i.ProviderIds && (i.ProviderIds.Tvdb || i.ProviderIds.tvdb || i.ProviderIds.TVDB)).length} / ${allSeries.length}`);
        }
    }
    
    if (!found) {
        console.log(`\n❌❌❌ FINAL RESULT: TV Show "${tvShow.name}" NOT FOUND in library ❌❌❌`);
    } else {
        console.log(`\n✅✅✅ FINAL RESULT: TV Show "${tvShow.name}" FOUND ✅✅✅`);
    }
}

async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Jellyfin TV Show Search Test`);
    console.log(`Server: ${CONFIG.serverUrl}`);
    console.log(`User ID: ${CONFIG.userId}`);
    console.log(`${'='.repeat(80)}`);
    
    // Test each TV show
    for (const tvShow of TEST_TV_SHOWS) {
        await testTvShowSearch(tvShow);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between tests
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`All tests completed!`);
    console.log(`${'='.repeat(80)}\n`);
}

// Run the tests
main().catch(err => {
    console.error(`\n❌ Fatal error:`, err);
    process.exit(1);
});

