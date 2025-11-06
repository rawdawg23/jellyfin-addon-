const axios = require("axios");

// Configuration - UPDATE THESE VALUES
const CONFIG = {
    serverUrl: "https://ku98faa.freshticks.xyz:443",
    accessToken: "fdfa03901d...", // Your API key
    userId: "5f8170cc22064e18882e2e57c7406e35" // Your User ID
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
    
    // Strategy 4: List all Series and search manually
    if (!found) {
        console.log(`\n[STRATEGY 4] List all Series and search manually`);
        const listParams = {
            IncludeItemTypes: 'Series',
            Recursive: true,
            Fields: 'ProviderIds,Name,Id',
            Limit: 100,
            UserId: CONFIG.userId
        };
        
        const data = await makeJellyfinApiRequest(`${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`, listParams);
        
        if (data?.Items?.length > 0) {
            console.log(`✅ Found ${data.Items.length} total series in library`);
            
            // Search by name
            const nameMatches = data.Items.filter(i => 
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
            const idMatches = data.Items.filter(i => 
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
                console.log(`\n  ❌ No series found matching ProviderIds`);
            }
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

