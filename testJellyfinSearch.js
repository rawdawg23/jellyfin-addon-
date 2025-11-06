/**
 * Test script to check how Jellyfin's search actually works
 * Run with: node testJellyfinSearch.js
 */

const axios = require('axios');

// Configuration - REPLACE WITH YOUR ACTUAL VALUES
const CONFIG = {
    serverUrl: 'https://ku98faa.freshticks.xyz:443',
    accessToken: 'YOUR_API_KEY_HERE', // Replace with your API key
    userId: '5f8170cc22064e18882e2e57c7406e35' // Replace with your User ID
};

const HEADER_JELLYFIN_TOKEN = 'X-Emby-Token';

async function testJellyfinSearch() {
    console.log('='.repeat(60));
    console.log('Testing Jellyfin Search API');
    console.log('='.repeat(60));
    
    const testImdbId = 'tt0147800'; // 12 Angry Men
    
    // Test 1: /Items endpoint with ImdbId parameter
    console.log('\n[TEST 1] /Items endpoint with ImdbId parameter');
    console.log('-'.repeat(60));
    try {
        const url1 = `${CONFIG.serverUrl}/Items`;
        const params1 = {
            ImdbId: testImdbId,
            IncludeItemTypes: 'Movie',
            Recursive: true,
            Fields: 'ProviderIds,Name,Id',
            Limit: 10
        };
        console.log(`URL: ${url1}`);
        console.log(`Params:`, JSON.stringify(params1, null, 2));
        
        const response1 = await axios({
            method: 'get',
            url: url1,
            headers: { [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken },
            params: params1,
            timeout: 10000
        });
        
        console.log(`Status: ${response1.status}`);
        console.log(`Items returned: ${response1.data?.Items?.length || 0}`);
        if (response1.data?.Items?.length > 0) {
            response1.data.Items.slice(0, 3).forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}"`);
                console.log(`    ID: ${item.Id}`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
            console.log(`Response:`, JSON.stringify(err.response.data, null, 2));
        }
    }
    
    // Test 2: /Users/{userId}/Items endpoint with ImdbId parameter
    console.log('\n[TEST 2] /Users/{userId}/Items endpoint with ImdbId parameter');
    console.log('-'.repeat(60));
    try {
        const url2 = `${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`;
        const params2 = {
            ImdbId: testImdbId,
            IncludeItemTypes: 'Movie',
            Recursive: true,
            Fields: 'ProviderIds,Name,Id',
            Limit: 10
        };
        console.log(`URL: ${url2}`);
        console.log(`Params:`, JSON.stringify(params2, null, 2));
        
        const response2 = await axios({
            method: 'get',
            url: url2,
            headers: { [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken },
            params: params2,
            timeout: 10000
        });
        
        console.log(`Status: ${response2.status}`);
        console.log(`Items returned: ${response2.data?.Items?.length || 0}`);
        if (response2.data?.Items?.length > 0) {
            response2.data.Items.slice(0, 3).forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}"`);
                console.log(`    ID: ${item.Id}`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
            console.log(`Response:`, JSON.stringify(err.response.data, null, 2));
        }
    }
    
    // Test 3: /Users/{userId}/Items endpoint with AnyProviderIdEquals
    console.log('\n[TEST 3] /Users/{userId}/Items endpoint with AnyProviderIdEquals=imdb.tt0147800');
    console.log('-'.repeat(60));
    try {
        const url3 = `${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`;
        const params3 = {
            AnyProviderIdEquals: 'imdb.tt0147800',
            IncludeItemTypes: 'Movie',
            Recursive: true,
            Fields: 'ProviderIds,Name,Id',
            Limit: 10
        };
        console.log(`URL: ${url3}`);
        console.log(`Params:`, JSON.stringify(params3, null, 2));
        
        const response3 = await axios({
            method: 'get',
            url: url3,
            headers: { [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken },
            params: params3,
            timeout: 10000
        });
        
        console.log(`Status: ${response3.status}`);
        console.log(`Items returned: ${response3.data?.Items?.length || 0}`);
        if (response3.data?.Items?.length > 0) {
            response3.data.Items.slice(0, 3).forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}"`);
                console.log(`    ID: ${item.Id}`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
            console.log(`Response:`, JSON.stringify(err.response.data, null, 2));
        }
    }
    
    // Test 4: /Search/Hints endpoint
    console.log('\n[TEST 4] /Search/Hints endpoint');
    console.log('-'.repeat(60));
    try {
        const url4 = `${CONFIG.serverUrl}/Search/Hints`;
        const params4 = {
            SearchTerm: testImdbId,
            IncludeItemTypes: 'Movie',
            Recursive: true,
            Limit: 10
        };
        console.log(`URL: ${url4}`);
        console.log(`Params:`, JSON.stringify(params4, null, 2));
        
        const response4 = await axios({
            method: 'get',
            url: url4,
            headers: { [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken },
            params: params4,
            timeout: 10000
        });
        
        console.log(`Status: ${response4.status}`);
        console.log(`SearchHints returned: ${response4.data?.SearchHints?.length || 0}`);
        if (response4.data?.SearchHints?.length > 0) {
            response4.data.SearchHints.slice(0, 3).forEach((hint, idx) => {
                console.log(`  Hint ${idx + 1}:`, JSON.stringify(hint, null, 2));
            });
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
            console.log(`Response:`, JSON.stringify(err.response.data, null, 2));
        }
    }
    
    // Test 5: Get a sample of movies to see what ProviderIds look like
    console.log('\n[TEST 5] Sample of movies from library (to see ProviderIds format)');
    console.log('-'.repeat(60));
    try {
        const url5 = `${CONFIG.serverUrl}/Users/${CONFIG.userId}/Items`;
        const params5 = {
            IncludeItemTypes: 'Movie',
            Recursive: true,
            Fields: 'ProviderIds,Name,Id',
            Limit: 5,
            StartIndex: 0
        };
        console.log(`URL: ${url5}`);
        console.log(`Params:`, JSON.stringify(params5, null, 2));
        
        const response5 = await axios({
            method: 'get',
            url: url5,
            headers: { [HEADER_JELLYFIN_TOKEN]: CONFIG.accessToken },
            params: params5,
            timeout: 10000
        });
        
        console.log(`Status: ${response5.status}`);
        console.log(`Items returned: ${response5.data?.Items?.length || 0}`);
        if (response5.data?.Items?.length > 0) {
            response5.data.Items.forEach((item, idx) => {
                console.log(`  Item ${idx + 1}: "${item.Name}"`);
                console.log(`    ID: ${item.Id}`);
                console.log(`    ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
        if (err.response) {
            console.log(`Status: ${err.response.status}`);
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Test Complete');
    console.log('='.repeat(60));
}

// Run the test
if (require.main === module) {
    testJellyfinSearch().catch(console.error);
}

module.exports = { testJellyfinSearch };

