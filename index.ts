import { App, AwsLambdaReceiver } from '@slack/bolt';
import {
    AwsCallback,
    AwsEvent
} from '@slack/bolt/dist/receivers/AwsLambdaReceiver';
import { isAxiosError } from 'axios';
import OpenAI from 'openai';

if (!process.env.SLACK_SIGNING_SECRET) process.exit(1);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});


const awsLambdaReceiver = new AwsLambdaReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET
});
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver: awsLambdaReceiver
});

const bot_userid = 'D0592RZJHKK';

app.event('app_mention', async ({ event, context, client, say }) => {
    if (context.retryNum) {
        console.log(
            `skipped retry. retryReason: ${context.retryReason}`
        );
        return;
    }
    console.log(event);
    try {
        const { channel, thread_ts, event_ts } = event;
        const threadTs = thread_ts ?? event_ts;
        await say({
            channel,
            thread_ts: threadTs,
            text: '`system` 処理中……'
        });
        try {
            const threadResponse = await client.conversations.replies({
                channel,
                ts: threadTs
            });
            const chatCompletionRequestMessage: OpenAI.ChatCompletionMessageParam[] =  [];
            threadResponse.messages?.forEach((message) => {
                const { text, user } = message;
                if (!text) return;
                if (user && user === bot_userid) {
                    if (!text.startsWith('`system`')) {
                        chatCompletionRequestMessage.push({
                            role: 'assistant',
                            content: text
                        });
                    }
                } else {
                    chatCompletionRequestMessage.push({
                        role: 'user',
                        content:
                            text.replace(`<@${bot_userid}>`, '') ?? ''
                    });
                }
            });
            const completion = await openai.chat.completions.create({
                model: 'gpt-4',
                messages: chatCompletionRequestMessage
            });
            const outputText = completion.choices
                .map(({ message }) => message?.content)
                .join('');
            await client.chat.postMessage({
                channel,
                thread_ts: threadTs,
                text: outputText
            });
        } catch (error) {
            if (isAxiosError(error)) {
                console.error(error.response?.data);
            } else {
                console.error(error);
            }
            await client.chat.postMessage({
                channel,
                thread_ts: threadTs,
                text: '`system` エラーが発生しました。(管理人: <@...>)'
            });
        }
    } catch (error) {
        console.error(error);
    }
});

module.exports.handler = async (
    event: AwsEvent,
    context: unknown,
    callback: AwsCallback
) => {
    const handler = await awsLambdaReceiver.start();
    return handler(event, context, callback);
};
