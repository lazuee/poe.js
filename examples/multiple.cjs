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
		console.info(`'${token}' initialized...`);
	} catch(error) {
		if (error.message.includes("Invalid token")) {
			console.warn(`'${token}' is invalid? skipping...`);
		}
	};

	console.info("-- Break Message --");
	const message = await poe.history(1);
	if (message[0] && message[0]["node"]["author"] !== "chat_break") await poe.break_message();

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
	const questions = ["What's your name?", "Dad joke related to programming.", conversation];
	questions.forEach((question, index) => {
		// The function adds a request to a queue and waits for its turn to be executed.
		poe.send_message(question, {
			async onRunning() {
				console.info(`\n-- Running #${index} --`);
			},
			async onTyping(message) {
				process.stdout.write(message.text_new);
				// adds delay
				await new Promise((res) => setTimeout(res, 100));
			}
		});
	});

	while (poe.pendingCount !== 0) await new Promise((res) => setTimeout(res, 100));

	console.info("\n-- Finish --\n");
	poe.destroy();
})();
