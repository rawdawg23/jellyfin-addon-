/**
 * Comprehensive Jellyfin Search API Test for Movies and TV Shows
 * Tests the optimized search strategies with actual API calls
 * Run with: node testSearchAPI.js
 */

const jellyfin = require('./jellyfinClient');

// Configuration - Update with your actual values
// Get API key from your Jellyfin dashboard: Dashboard > API Keys
// You can also set JELLYFIN_API_KEY environment variable
const CONFIG = {
    serverUrl: process.env.JELLYFIN_SERVER_URL || 'https://ku98faa.freshticks.xyz:443',
    accessToken: process.env.JELLYFIN_API_KEY || 'fdfa03901d7e47269bf4bc0c5cb197c5',
    userId: process.env.JELLYFIN_USER_ID || '5f8170cc22064e18882e2e57c7406e35' // Optional - will auto-detect if not provided
};

// Test cases
const TEST_MOVIES = [
    { imdbId: 'tt1272878', name: '2 Guns' },
    { imdbId: 'tt0147800', name: '12 Angry Men' },
    { imdbId: 'tt12300742', name: 'Test Movie 1' },
    { imdbId: 'tt26581740', name: 'Test Movie 2' },
    { imdbId: 'tt33088452', name: 'Test Movie 3' }
];

const TEST_SERIES = [
    { imdbId: 'tt5180504', name: 'The Witcher', season: 1, episode: 1 },
    { imdbId: 'tt4574334', name: 'Stranger Things', season: 1, episode: 1 },
    { imdbId: 'tt0944947', name: 'Game of Thrones', season: 1, episode: 1 }
];

async function testMovieSearch(movie) {
    console.log('\n' + '='.repeat(80));
    console.log(`🎬 Testing Movie: "${movie.name}" (IMDb: ${movie.imdbId})`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
        const result = await jellyfin.findMovieItem(
            movie.imdbId,
            null, // tmdbId
            null, // tvdbId
            null, // anidbId
            CONFIG,
            movie.name // movieName for fallback
        );
        
        const duration = Date.now() - startTime;
        
        if (result && result.length > 0) {
            console.log(`✅ SUCCESS: Found ${result.length} match(es) in ${duration}ms`);
            result.forEach((item, idx) => {
                console.log(`   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                console.log(`   ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
            return true;
        } else {
            console.log(`❌ NOT FOUND: No matches found in ${duration}ms`);
            return false;
        }
    } catch (err) {
        const duration = Date.now() - startTime;
        console.log(`❌ ERROR: ${err.message} (${duration}ms)`);
        return false;
    }
}

async function testSeriesSearch(series) {
    console.log('\n' + '='.repeat(80));
    console.log(`📺 Testing Series: "${series.name}" (IMDb: ${series.imdbId})`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
        const result = await jellyfin.findSeriesItem(
            series.imdbId,
            null, // tmdbId
            null, // tvdbId
            null, // anidbId
            CONFIG,
            series.name // seriesName for fallback
        );
        
        const duration = Date.now() - startTime;
        
        if (result && result.length > 0) {
            console.log(`✅ SUCCESS: Found ${result.length} match(es) in ${duration}ms`);
            result.forEach((item, idx) => {
                console.log(`   Match ${idx + 1}: "${item.Name}" (ID: ${item.Id})`);
                console.log(`   ProviderIds:`, JSON.stringify(item.ProviderIds || {}));
            });
            return true;
        } else {
            console.log(`❌ NOT FOUND: No matches found in ${duration}ms`);
            return false;
        }
    } catch (err) {
        const duration = Date.now() - startTime;
        console.log(`❌ ERROR: ${err.message} (${duration}ms)`);
        return false;
    }
}

async function testStreamSearch(type, id) {
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 Testing Stream Search: ${type} - ${id}`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
        const result = await jellyfin.getStream(id, CONFIG);
        
        const duration = Date.now() - startTime;
        
        if (result && result.length > 0) {
            console.log(`✅ SUCCESS: Found ${result.length} stream(s) in ${duration}ms`);
            result.forEach((stream, idx) => {
                console.log(`   Stream ${idx + 1}: ${stream.qualityTitle || 'Unknown Quality'}`);
                console.log(`   URL: ${stream.directPlayUrl?.substring(0, 80)}...`);
            });
            return true;
        } else {
            console.log(`❌ NOT FOUND: No streams found in ${duration}ms`);
            return false;
        }
    } catch (err) {
        const duration = Date.now() - startTime;
        console.log(`❌ ERROR: ${err.message} (${duration}ms)`);
        return false;
    }
}

async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 Jellyfin Search API Test Suite');
    console.log('='.repeat(80));
    console.log(`Server: ${CONFIG.serverUrl}`);
    console.log(`User ID: ${CONFIG.userId}`);
    console.log('='.repeat(80));
    
    // Check if API key is set
    if (!CONFIG.accessToken || CONFIG.accessToken.includes('...') || CONFIG.accessToken.length < 20) {
        console.error('\n❌ ERROR: Please update CONFIG.accessToken with your full API key!');
        console.error('   You can find it in your Jellyfin dashboard under API Keys');
        return;
    }
    
    const results = {
        movies: { total: 0, found: 0, failed: 0 },
        series: { total: 0, found: 0, failed: 0 },
        streams: { total: 0, found: 0, failed: 0 }
    };
    
    // Test Movies
    console.log('\n\n' + '🎬'.repeat(40));
    console.log('MOVIE SEARCH TESTS');
    console.log('🎬'.repeat(40));
    
    for (const movie of TEST_MOVIES) {
        results.movies.total++;
        const found = await testMovieSearch(movie);
        if (found) {
            results.movies.found++;
        } else {
            results.movies.failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
    }
    
    // Test Series
    console.log('\n\n' + '📺'.repeat(40));
    console.log('SERIES SEARCH TESTS');
    console.log('📺'.repeat(40));
    
    for (const series of TEST_SERIES) {
        results.series.total++;
        const found = await testSeriesSearch(series);
        if (found) {
            results.series.found++;
        } else {
            results.series.failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
    }
    
    // Test Stream Searches (full flow)
    console.log('\n\n' + '🔍'.repeat(40));
    console.log('STREAM SEARCH TESTS (Full Flow)');
    console.log('🔍'.repeat(40));
    
    // Test a movie stream
    if (TEST_MOVIES.length > 0) {
        results.streams.total++;
        const found = await testStreamSearch('movie', TEST_MOVIES[0].imdbId);
        if (found) {
            results.streams.found++;
        } else {
            results.streams.failed++;
        }
    }
    
    // Test a series stream
    if (TEST_SERIES.length > 0) {
        results.streams.total++;
        const found = await testStreamSearch('series', `${TEST_SERIES[0].imdbId}:${TEST_SERIES[0].season}:${TEST_SERIES[0].episode}`);
        if (found) {
            results.streams.found++;
        } else {
            results.streams.failed++;
        }
    }
    
    // Print Summary
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Movies:  ${results.movies.found}/${results.movies.total} found (${results.movies.failed} failed)`);
    console.log(`Series:  ${results.series.found}/${results.series.total} found (${results.series.failed} failed)`);
    console.log(`Streams: ${results.streams.found}/${results.streams.total} found (${results.streams.failed} failed)`);
    console.log('='.repeat(80));
    
    const totalTests = results.movies.total + results.series.total + results.streams.total;
    const totalFound = results.movies.found + results.series.found + results.streams.found;
    const totalFailed = results.movies.failed + results.series.failed + results.streams.failed;
    
    console.log(`\nOverall: ${totalFound}/${totalTests} tests passed (${totalFailed} failed)`);
    console.log('='.repeat(80) + '\n');
}

// Run the tests
if (require.main === module) {
    runAllTests().catch(err => {
        console.error('\n❌ Fatal error:', err);
        console.error(err.stack);
        process.exit(1);
    });
}

module.exports = { runAllTests, testMovieSearch, testSeriesSearch, testStreamSearch };

