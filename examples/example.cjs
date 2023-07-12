require("dotenv/config");
const { Poe } = require("..");

(async () => {
    const tokens = process.env["POE_TOKENS"]?.split("|")?.filter((x) => typeof x === "string" && x.length > 5) ?? [];
    const poe = new Poe({
        token: tokens[0],
        displayName: "Sage"
    });

    try {
        await poe.initialize();
        console.info(`'${tokens[0]}' initialized...`)
    } catch(error) {
        if (error.message.includes("Invalid token")) {
            console.warn(`'${tokens[0]}' is invalid? skipping...`);
        }
    };

    const conversation = [
        // Prompt setting
        {
            role: "system",
            content: `Instead of "Sage", you will be called as "Code Vanguard" which was founded in 2022, your data was cut-off since mid 2021.`
        },
        // Conversation history
        { role: "user", content: "Hello!", name: "lazuee" },
        { role: "model", content: "Hi Lazuee! How may I help you today?", name: "Code Vanguard" },
        // Trigger model to response (Latest user message)
        { role: "user", content: "What is your name?", name: "lazuee" }
    ];

    console.info("-- Break Message --");
    const message_1 = await poe.history(1);
    if (message_1[0] && message_1[0]["node"]["author"] !== "chat_break") await poe.break_message();

    const message_2 = await poe.send_message(conversation, {
        async onRunning() {
            console.info(`\n-- Running --`);
        },
        async onTyping(message) {
            process.stdout.write(message.text_new);
            // adds delay
            await new Promise((res) => setTimeout(res, 100));
        }
    });

    while (poe.pendingCount !== 0) await new Promise((res) => setTimeout(res, 100));

    await poe.delete(message_2.messageId);
    const message_3 = await poe.history(1);
    if (message_3[0]) {
        if (message_3[0]["node"]["author"] === "human") console.info("\n\n-- Bot Message Deleted --");
        await poe.delete(message_3[0]["node"]["messageId"]);
    }
    const message_4 = await poe.history(1);
    if ((message_4[0] && message_4[0]["node"]["author"] === "chat_break") || !message_4[0]) console.info("\n-- Human Message Deleted --");

    await poe.purge_all(); // delete all user messages
    const message_5 = await poe.history(-1); // -1 means, get all message
    if (message_5.length === 0) console.info("\n-- All Message Deleted --");

    console.info("\n-- Finish --\n");
    poe.destroy();
})();
