/**
 * x-api-test.js — Test the official X (Twitter) API v2
 *
 * Usage:
 *   node x-api-test.js me              Verify authentication (get own profile)
 *   node x-api-test.js timeline        Get home timeline
 *   node x-api-test.js tweet "text"    Post a tweet
 *   node x-api-test.js like <id>       Like a tweet by ID
 *   node x-api-test.js reply <id> "text"  Reply to a tweet
 *   node x-api-test.js search "query"  Search recent tweets
 *   node x-api-test.js mentions        Get recent mentions
 */

const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

// Load credentials
const credsPath = path.join(__dirname, 'credentials.json');
if (!fs.existsSync(credsPath)) {
    console.error('❌ credentials.json not found');
    process.exit(1);
}
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

// Create client with OAuth 1.0a (user context — needed for posting)
const userClient = new TwitterApi({
    appKey: creds.consumer_key,
    appSecret: creds.consumer_secret,
    accessToken: creds.access_token,
    accessSecret: creds.access_token_secret,
});

// Read-write client
const rwClient = userClient.readWrite;

// Bearer token client (app context — higher rate limits for reading)
const appClient = new TwitterApi(decodeURIComponent(creds.bearer_token));

// ── Commands ────────────────────────────────────────────────────────────

async function getMe() {
    console.log('🔍 Fetching authenticated user profile...\n');
    try {
        const { data } = await rwClient.v2.me({
            'user.fields': ['id', 'name', 'username', 'description', 'public_metrics', 'created_at', 'profile_image_url'],
        });
        console.log('✅ Authenticated as:');
        console.log(`   Name: ${data.name}`);
        console.log(`   Handle: @${data.username}`);
        console.log(`   ID: ${data.id}`);
        console.log(`   Bio: ${data.description}`);
        if (data.public_metrics) {
            console.log(`   Followers: ${data.public_metrics.followers_count}`);
            console.log(`   Following: ${data.public_metrics.following_count}`);
            console.log(`   Tweets: ${data.public_metrics.tweet_count}`);
        }
        console.log(`   Created: ${data.created_at}`);
        return data;
    } catch (e) {
        handleError('getMe', e);
    }
}

async function getTimeline() {
    console.log('📰 Fetching home timeline...\n');
    try {
        // Use reverse chronological timeline (requires user context)
        const timeline = await rwClient.v2.homeTimeline({
            max_results: 10,
            'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id'],
        });

        const users = {};
        if (timeline.includes?.users) {
            for (const u of timeline.includes.users) {
                users[u.id] = u;
            }
        }

        console.log('✅ Home Timeline (latest 10):\n');
        let i = 1;
        for (const tweet of timeline.data?.data || []) {
            const author = users[tweet.author_id];
            const handle = author ? `@${author.username}` : tweet.author_id;
            const metrics = tweet.public_metrics || {};
            console.log(`  ${i}. ${handle}: "${tweet.text.substring(0, 120)}${tweet.text.length > 120 ? '...' : ''}"`);
            console.log(`     ID: ${tweet.id} | ❤️ ${metrics.like_count || 0} | 🔁 ${metrics.retweet_count || 0} | 💬 ${metrics.reply_count || 0}`);
            console.log();
            i++;
        }
        return timeline;
    } catch (e) {
        handleError('getTimeline', e);
    }
}

async function postTweet(text) {
    console.log(`📝 Posting tweet: "${text}"\n`);
    try {
        const { data } = await rwClient.v2.tweet(text);
        console.log('✅ Tweet posted!');
        console.log(`   ID: ${data.id}`);
        console.log(`   Text: ${data.text}`);
        console.log(`   URL: https://x.com/i/status/${data.id}`);
        return data;
    } catch (e) {
        handleError('postTweet', e);
    }
}

async function likeTweet(tweetId) {
    console.log(`❤️  Liking tweet ${tweetId}...\n`);
    try {
        const me = await rwClient.v2.me();
        const result = await rwClient.v2.like(me.data.id, tweetId);
        console.log(`✅ Liked tweet ${tweetId}: ${result.data.liked ? 'success' : 'already liked'}`);
        return result;
    } catch (e) {
        handleError('likeTweet', e);
    }
}

async function replyToTweet(tweetId, text) {
    console.log(`💬 Replying to ${tweetId}: "${text}"\n`);
    try {
        const { data } = await rwClient.v2.reply(text, tweetId);
        console.log('✅ Reply posted!');
        console.log(`   ID: ${data.id}`);
        console.log(`   Text: ${data.text}`);
        console.log(`   URL: https://x.com/i/status/${data.id}`);
        return data;
    } catch (e) {
        handleError('replyToTweet', e);
    }
}

async function searchTweets(query) {
    console.log(`🔎 Searching for: "${query}"\n`);
    try {
        const results = await rwClient.v2.search(query, {
            max_results: 10,
            'tweet.fields': ['created_at', 'public_metrics', 'author_id'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id'],
        });

        const users = {};
        if (results.includes?.users) {
            for (const u of results.includes.users) {
                users[u.id] = u;
            }
        }

        console.log(`✅ Search results for "${query}" (up to 10):\n`);
        let i = 1;
        for (const tweet of results.data?.data || []) {
            const author = users[tweet.author_id];
            const handle = author ? `@${author.username}` : tweet.author_id;
            console.log(`  ${i}. ${handle}: "${tweet.text.substring(0, 120)}${tweet.text.length > 120 ? '...' : ''}"`);
            console.log(`     ID: ${tweet.id} | ❤️ ${tweet.public_metrics?.like_count || 0}`);
            console.log();
            i++;
        }
        return results;
    } catch (e) {
        handleError('searchTweets', e);
    }
}

async function getMentions() {
    console.log('📢 Fetching recent mentions...\n');
    try {
        const me = await rwClient.v2.me();
        const mentions = await rwClient.v2.userMentionTimeline(me.data.id, {
            max_results: 10,
            'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'in_reply_to_user_id'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id'],
        });

        const users = {};
        if (mentions.includes?.users) {
            for (const u of mentions.includes.users) {
                users[u.id] = u;
            }
        }

        console.log(`✅ Recent mentions of @${me.data.username} (up to 10):\n`);
        let i = 1;
        for (const tweet of mentions.data?.data || []) {
            const author = users[tweet.author_id];
            const handle = author ? `@${author.username}` : tweet.author_id;
            console.log(`  ${i}. ${handle}: "${tweet.text.substring(0, 120)}${tweet.text.length > 120 ? '...' : ''}"`);
            console.log(`     ID: ${tweet.id} | ${tweet.created_at}`);
            console.log();
            i++;
        }
        return mentions;
    } catch (e) {
        handleError('getMentions', e);
    }
}

// ── Error handling ──────────────────────────────────────────────────────

function handleError(fn, e) {
    console.error(`\n❌ ${fn} failed:`);
    if (e.code) console.error(`   Code: ${e.code}`);
    if (e.data) {
        console.error(`   API error:`, JSON.stringify(e.data, null, 2));
    } else {
        console.error(`   ${e.message}`);
    }
    if (e.rateLimit) {
        console.error(`   Rate limit: ${e.rateLimit.remaining}/${e.rateLimit.limit} remaining`);
        console.error(`   Resets at: ${new Date(e.rateLimit.reset * 1000).toISOString()}`);
    }
}

// ── Main ────────────────────────────────────────────────────────────────

(async () => {
    const [cmd, ...rest] = process.argv.slice(2);

    if (!cmd) {
        console.log(`
X API v2 Test Script
━━━━━━━━━━━━━━━━━━━

Usage:
  node x-api-test.js me              Verify auth (own profile)
  node x-api-test.js timeline        Home timeline
  node x-api-test.js tweet "text"    Post a tweet
  node x-api-test.js like <id>       Like a tweet
  node x-api-test.js reply <id> "text"  Reply to a tweet
  node x-api-test.js search "query"  Search tweets
  node x-api-test.js mentions        Recent mentions
`);
        process.exit(0);
    }

    switch (cmd) {
        case 'me':
            await getMe();
            break;
        case 'timeline':
            await getTimeline();
            break;
        case 'tweet':
            if (!rest[0]) { console.error('Usage: node x-api-test.js tweet "text"'); process.exit(1); }
            await postTweet(rest.join(' '));
            break;
        case 'like':
            if (!rest[0]) { console.error('Usage: node x-api-test.js like <tweetId>'); process.exit(1); }
            await likeTweet(rest[0]);
            break;
        case 'reply':
            if (!rest[0] || !rest[1]) { console.error('Usage: node x-api-test.js reply <tweetId> "text"'); process.exit(1); }
            await replyToTweet(rest[0], rest.slice(1).join(' '));
            break;
        case 'search':
            if (!rest[0]) { console.error('Usage: node x-api-test.js search "query"'); process.exit(1); }
            await searchTweets(rest.join(' '));
            break;
        case 'mentions':
            await getMentions();
            break;
        default:
            console.error(`Unknown command: ${cmd}`);
            process.exit(1);
    }
})();
