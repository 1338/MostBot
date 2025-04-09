import 'dotenv/config';
import Discord, { GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';
import { setTimeout } from 'timers/promises';

const discordClient = new Discord.Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const LINKEDIN_API_KEY = process.env.LINKEDIN_API_KEY;
const LINKEDIN_USER_ID = process.env.LINKEDIN_USER_ID; // Add this to .env (user or org ID)
const LINKEDIN_ENTITY_TYPE = process.env.LINKEDIN_ENTITY_TYPE || 'PERSON'; // 'PERSON' or 'ORGANIZATION'
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DBNAME = process.env.MONGODB_DBNAME || 'linkedinReactions';

let db;

async function connectToDatabase() {
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db(MONGODB_DBNAME);
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

async function getLinkedInPostsToTrack() {
    const entityId = LINKEDIN_USER_ID;
    const entityType = LINKEDIN_ENTITY_TYPE; // 'PERSON' or 'ORGANIZATION'

    if (!entityId) {
        console.warn('LINKEDIN_USER_ID not set.  Tracking no posts.');
        return [];
    }

    const posts = await fetchLinkedInEntityPosts(entityId, entityType);

    return posts;
}

async function fetchLinkedInEntityPosts(entityId, entityType) {
    //LinkedIn API endpoint to fetch posts from a user or organization
    let apiUrl;
    if (entityType === 'PERSON') {
        apiUrl = `https://api.linkedin.com/v2/posts?author=urn:li:person:${entityId}&count=20`;  // Adjust count as needed
    } else if (entityType === 'ORGANIZATION') {
        apiUrl = `https://api.linkedin.com/v2/posts?author=urn:li:organization:${entityId}&count=20`; // Adjust count as needed
    } else {
        console.error('Invalid LINKEDIN_ENTITY_TYPE.  Must be PERSON or ORGANIZATION');
        return [];
    }

    try {
        const response = await fetch(apiUrl, {
            headers: {
                Authorization: `Bearer ${LINKEDIN_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`LinkedIn API error: ${response.status} ${response.statusText}`);
            return [];
        }

        const data = await response.json();

        if (!data.elements) {
            console.warn('No posts found for the specified entity.');
            return [];
        }

        return data.elements.map(post => post.id);
    } catch (error) {
        console.error('Error fetching LinkedIn posts:', error);
        return [];
    }
}

async function getLinkedInReactions(postId) {
    const apiUrl = `https://api.linkedin.com/v2/posts/${postId}/reactions?count=20`;

    try {
        const response = await fetch(apiUrl, {
            headers: {
                Authorization: `Bearer ${LINKEDIN_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`LinkedIn API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        return data.elements;
    } catch (error) {
        console.error('Error fetching LinkedIn reactions:', error);
        return null;
    }
}

async function processReactions(postId, reactions) {
    if (!reactions || reactions.length === 0) {
        return;
    }

    const reactionsCollection = db.collection('reactions');

    for (const reaction of reactions) {
        const reactionId = reaction.id;
        const existingReaction = await reactionsCollection.findOne({ reactionId: reactionId });

        if (!existingReaction) {
            await postToDiscord(reaction, postId);
            await reactionsCollection.insertOne({
                reactionId: reactionId,
                postId: postId,
                timestamp: new Date(),
            });
        }
    }
}

async function postToDiscord(reaction, postId) {
    const channel = await discordClient.channels.cache.get(DISCORD_CHANNEL_ID);

    if (!channel) {
        console.error('Invalid Discord channel ID.');
        return;
    }

    const message =
        `New reaction on post ${postId}:\n` +
        `- User: ${reaction.reactor.firstName.localized.en_US} ${reaction.reactor.lastName.localized.en_US}\n` +
        `- Reaction: ${reaction.reactionType}`;

    try {
        await channel.send(message);
        console.log('Successfully posted to Discord.');
    } catch (error) {
        console.error('Error posting to Discord:', error);
    }
}

async function main() {
    try {
        const postsToTrack = await getLinkedInPostsToTrack();

        if (!postsToTrack || postsToTrack.length === 0) {
            console.log('No LinkedIn posts to track.');
            return;
        }

        for (const postId of postsToTrack) {
            const reactions = await getLinkedInReactions(postId);
            if (reactions) {
                await processReactions(postId, reactions);
            }

            await setTimeout(2000);
        }
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

discordClient.on('ready', async () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
    await connectToDatabase();

    setInterval(main, 60000);
});

discordClient.login(DISCORD_TOKEN);