require("dotenv/config");
const { Poe } = require("..");

(async () => {
	const tokens = process.env["POE_TOKENS"]?.split("|")?.filter((x) => typeof x === "string" && x.length > 5) ?? [];
	/** @type {Map<string, Poe>} */
	const poes = new Map();

	for (const token of tokens) {
		const poe = new Poe({
			token: token,
			displayName: "Sage"
		});

		try {
			await poe.initialize();
			console.info(`'${token}' initialized...`);
		} catch(error) {
			if (error.message.includes("Invalid token")) {
				console.warn(`'${token}' is invalid? skipping...`);
			}
		}
	}

	console.info("-- Break Message --");
	for await (const poe of [...poes.values()]) {
		const message = await poe.history(1);
		if (message[0] && message[0]["node"]["author"] !== "chat_break") await poe.break_message();
	}

	// This function adds a request to a queue and waits for its turn to be executed.
	// The queue is implemented to prevent duplicated responses when sending requests to the chatbot.
	const send_message = /** @type {Poe["send_message"]} */ async function (...args) {
		return new Promise((resolve, reject) => {
			for (const poe of [...poes.values()]) {
				if (!poe.pendingCount) {
					poe.send_message(...args)
						.then(resolve)
						.catch(reject);
					return;
				}
			}

			for (const poe of [...poes.values()].sort((a, b) => a.pendingCount - b.pendingCount)) {
				poe.send_message(...args)
					.then(resolve)
					.catch(reject);
				return;
			}

			reject(new Error("No poe has been settled"));
		});
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
	const questions = ["What's your name?", "Dad joke related to programming.", conversation];
	const text = {};
	questions.forEach((question, index) => {
		// The function adds a request to a queue and waits for its turn to be executed.
		send_message(question, {
			async onTyping(message) {
				reply = message;
				if (!(message.messageId in text)) text[message.messageId] = "";
				text[message.messageId] += message.text_new;
			}
		}).then((message) => {
			console.info(`#${index} : ${text[message.messageId]}\n`);
		});
	});

	while ([...poes.values()].reduce((acc, curr) => acc + curr.pendingCount, 0) !== 0) await new Promise((res) => setTimeout(res, 100));

	console.info("-- Finish --\n");

	for (const poe of [...poes.values()]) poe.destroy();
})();
