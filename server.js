import 'dotenv/config';
import Discord, { GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import { Sequelize, DataTypes } from 'sequelize';  // Import Sequelize
import { setTimeout } from 'timers/promises';
import { Reaction as ReactionModel } from './models/reaction.js'; // Import models
import { Post as PostModel } from './models/post.js';

const discordClient = new Discord.Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const LINKEDIN_API_KEY = process.env.LINKEDIN_API_KEY;
const LINKEDIN_USER_ID = process.env.LINKEDIN_USER_ID;
const LINKEDIN_ENTITY_TYPE = process.env.LINKEDIN_ENTITY_TYPE || 'PERSON';

// Sequelize setup
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: 'database.sqlite', // Ensure this matches your config
    logging: false,  // Disable logging for cleaner output
});

// Initialize models
const Reaction = ReactionModel(sequelize);
const Post = PostModel(sequelize);

//Optionally create db on app start
//await sequelize.sync({ force: true });

async function getLinkedInPostsToTrack() {
    const entityId = LINKEDIN_USER_ID;
    const entityType = LINKEDIN_ENTITY_TYPE;

    if (!entityId) {
        console.warn('LINKEDIN_USER_ID not set.  Tracking no posts.');
        return [];
    }

    const posts = await fetchLinkedInEntityPosts(entityId, entityType);

    return posts;
}

async function fetchLinkedInEntityPosts(entityId, entityType) {
    let apiUrl;
    if (entityType === 'PERSON') {
        apiUrl = `https://api.linkedin.com/v2/posts?author=urn:li:person:${entityId}&count=20`;
    } else if (entityType === 'ORGANIZATION') {
        apiUrl = `https://api.linkedin.com/v2/posts?author=urn:li:organization:${entityId}&count=20`;
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

    for (const reaction of reactions) {
        const reactionId = reaction.id;

        //Check if the reaction already exists in the DB
        const existingReaction = await Reaction.findByPk(reactionId);

        if (!existingReaction) {
            await postToDiscord(reaction, postId);

            try {
                await Reaction.create({
                    reactionId: reactionId,
                    postId: postId,
                    timestamp: new Date(),
                });
            } catch (error) {
                console.error('Error creating reaction in database:', error);
            }
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
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');
        await sequelize.sync(); // This creates the table if it doesn't exist (and does nothing if it already exists)
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }

    setInterval(main, 60000);
});

discordClient.login(DISCORD_TOKEN);